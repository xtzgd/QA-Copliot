/**
 * 禅道网页提单页面自动化填表执行器
 * 负责在用户打开禅道原生提 Bug 页面时，自动将 QA Copilot 的标题、卡片步骤、
 * 严重度、优先级、指派人以及现场截图附件安全装配到页面表单中。
 */

import {
  ZentaoPendingFillData,
  ZENTAO_AUTOFILL_STORAGE_KEY,
  ZentaoPendingAttachment,
  ZENTAO_PENDING_ATTACHMENT_KEY,
} from '../shared/types/zentaoAutoFill';

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const [header, base64] = dataUrl.split(',', 2);
    if (!base64) return null;
    const mimeMatch = header.match(/^data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new File([array], fileName, { type: mimeType });
  } catch {
    return null;
  }
}

export class ZentaoFillExecutor {
  private static hasFilled = false;
  private static observer: MutationObserver | null = null;

  static resetStateForTesting() {
    this.hasFilled = false;
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * 检查当前页面是否为 Bug 详情页
   */
  static isZentaoBugViewPage(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const url = window.location.href || '';
    const isUrlMatch = (
      url.includes('bug-view') ||
      (url.includes('m=bug') && url.includes('f=view')) ||
      /bug.*view/i.test(url) ||
      /\/bug\/(?:view|detail)\/\d+/i.test(url)
    );
    if (isUrlMatch) return true;

    // DOM 特征辅助判断
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      try {
        const hasDetailLayout = Boolean(
          document.querySelector('.detail-title, .bug-title, #mainContent .detail, #legendBasicInfo, #mainContent .main-col')
        );
        if (hasDetailLayout && this.getBugIdFromViewPage() !== null) {
          return true;
        }
      } catch {}
    }

    return false;
  }

  /**
   * 从详情页 URL 或 DOM 提取 Bug ID
   */
  static getBugIdFromViewPage(): number | null {
    if (typeof window === 'undefined' || !window.location) return null;
    const url = window.location.href || '';
    const m1 = url.match(/bug-view-(\d+)/i);
    if (m1) return Number(m1[1]);
    const m2 = url.match(/[?&](?:bugID|id|bug)=(\d+)/i);
    if (m2) return Number(m2[1]);
    const m3 = url.match(/\/bug\/(?:view|detail)\/(\d+)/i);
    if (m3) return Number(m3[1]);
    const m4 = url.match(/bug-(\d+)\.html/i);
    if (m4) return Number(m4[1]);

    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      try {
        const idInput = document.querySelector<HTMLInputElement>('input[name="bugID"], input[name="bug"], input[name="id"]');
        if (idInput && idInput.value && /^\d+$/.test(idInput.value)) {
          return Number(idInput.value);
        }
        const labelId = document.querySelector('.label-id, .prefix, .bug-id, span[data-id]');
        if (labelId && labelId.textContent) {
          const match = labelId.textContent.match(/#?(\d+)/);
          if (match) return Number(match[1]);
        }
      } catch {}
    }
    return null;
  }

  /**
   * 检查当前环境是否包含禅道提 Bug 表单
   */
  static isZentaoCreateBugPage(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const url = window.location.href || '';
    const isUrlMatch =
      url.includes('bug-create') ||
      url.includes('m=bug&f=create') ||
      /bug.*create/i.test(url);

    if (isUrlMatch) return true;

    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      try {
        const hasBugForm = Boolean(
          document.querySelector('form#dataform') ||
          document.querySelector('form[action*="bug-create"]') ||
          document.querySelector('form[action*="f=create"]')
        );
        const hasTitleAndSteps = Boolean(
          document.querySelector('input#title, input[name="title"]') &&
          (document.querySelector('textarea#steps, textarea[name="steps"]') ||
            document.querySelector('.ke-container, .editor, iframe.ke-edit-iframe'))
        );
        return hasBugForm || hasTitleAndSteps;
      } catch {}
    }

    return false;
  }

  /**
   * 检查并执行自动填写或附件挂载
   */
  static async checkAndExecute(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return false;
    }

    if (this.hasFilled) {
      return false;
    }

    // 优先：检查是否处于 Bug 详情页且有待同步附件 (方案 A)
    if (this.isZentaoBugViewPage()) {
      return this.checkAndAttachOnBugViewPage();
    }

    let pendingData: ZentaoPendingFillData | undefined;
    try {
      const getRes = chrome.storage.local.get(ZENTAO_AUTOFILL_STORAGE_KEY);
      const res = typeof (getRes as any)?.then === 'function'
        ? await getRes
        : await new Promise((resolve) => chrome.storage.local.get(ZENTAO_AUTOFILL_STORAGE_KEY, resolve));
      pendingData = (res as any)?.[ZENTAO_AUTOFILL_STORAGE_KEY];
    } catch {
      return false;
    }

    if (!pendingData) {
      return false;
    }

    // 超过 10 分钟视为过期废弃
    if (Date.now() - pendingData.createdAt > 10 * 60 * 1000) {
      try {
        chrome.storage.local.remove(ZENTAO_AUTOFILL_STORAGE_KEY);
      } catch {}
      return false;
    }

    console.log('[QA Copilot] 探测到待填写的禅道 Bug 任务:', pendingData.title);

    // 如果处于提单页或检测到了表单元素，立即启动重试装配流程
    if (this.isZentaoCreateBugPage()) {
      return this.fillFormWithRetry(pendingData);
    }

    // 如果当前不在提单页，但域名或结构类似禅道，展示常驻悬浮胶囊协助用户
    if (this.isLikelyZentaoSite()) {
      this.showFloatingHelper(pendingData);
      this.setupDomWatcher(pendingData);
    }

    return false;
  }

  /**
   * 外部或消息主动触发填写
   */
  static async executeWithData(data: ZentaoPendingFillData): Promise<boolean> {
    if (!data) return false;
    console.log('[QA Copilot] 接收到主动触发的禅道填单指令:', data.title);
    return this.fillFormWithRetry(data);
  }

  /**
   * 判断是否属于禅道相关页面
   */
  private static isLikelyZentaoSite(): boolean {
    if (typeof window === 'undefined' || !window.location) return false;
    const url = window.location.href || '';
    const title = typeof document !== 'undefined' && typeof document.title === 'string' ? document.title : '';
    if (url.includes('zentao') || title.includes('禅道') || (window as any).config?.version) {
      return true;
    }
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      try {
        return Boolean(document.querySelector('#mainMenu, #navbar, .navbar-nav, #userNav, .user-name'));
      } catch {}
    }
    return false;
  }

  /**
   * 监听 DOM 树变化，针对 SPA 路由延迟加载提单表单场景进行自愈补填
   */
  private static setupDomWatcher(data: ZentaoPendingFillData) {
    if (this.observer) return;
    let elapsedMs = 0;
    const interval = 500;

    const timer = setInterval(() => {
      elapsedMs += interval;
      if (this.hasFilled || elapsedMs >= 20000) {
        clearInterval(timer);
        this.observer?.disconnect();
        this.observer = null;
        return;
      }

      if (this.isZentaoCreateBugPage()) {
        clearInterval(timer);
        this.observer?.disconnect();
        this.observer = null;
        void this.fillFormWithRetry(data);
      }
    }, interval);

    try {
      this.observer = new MutationObserver(() => {
        if (!this.hasFilled && this.isZentaoCreateBugPage()) {
          clearInterval(timer);
          this.observer?.disconnect();
          this.observer = null;
          void this.fillFormWithRetry(data);
        }
      });
      this.observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch {}
  }

  /**
   * 轮询重试直到富文本编辑器和各字段就绪并成功注入
   */
  private static fillFormWithRetry(data: ZentaoPendingFillData): Promise<boolean> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30; // 30 * 200ms = 6秒，极大提高异步加载成功率

      const timer = setInterval(async () => {
        attempts++;
        const titleInput = this.findTitleInput();
        const hasEditor = this.hasEditorReady();

        if ((titleInput && hasEditor) || attempts >= maxAttempts) {
          clearInterval(timer);

          // 尝试填充本 frame 表单
          const success = this.applyFields(data);

          // 若本 frame 填充成功，标记并安全消费任务
          if (success) {
            this.hasFilled = true;
            try {
              chrome.storage?.local?.remove?.(ZENTAO_AUTOFILL_STORAGE_KEY);
            } catch {}
            this.showSuccessBanner(data);
            this.removeFloatingHelper();
            resolve(true);
            return;
          }

          // 若当前为顶层页面且本 frame 没找到表单，尝试穿透子 iframe 进行填表
          if (window === window.top) {
            const childSuccess = this.tryFillChildIframes(data);
            if (childSuccess) {
              this.hasFilled = true;
              try {
                chrome.storage?.local?.remove?.(ZENTAO_AUTOFILL_STORAGE_KEY);
              } catch {}
              this.showSuccessBanner(data);
              this.removeFloatingHelper();
              resolve(true);
              return;
            }
          }

          // 兜底提示：页面已就绪但未能自动识别全部字段，保留悬浮助手让用户一键点击重试
          this.showFloatingHelper(data);
          resolve(false);
        }
      }, 200);
    });
  }

  /**
   * 寻找标题输入框
   */
  private static findTitleInput(doc: Document = document): HTMLInputElement | null {
    return doc.querySelector<HTMLInputElement>(
      'input#title, input[name="title"], input[id*="title"], [name*="title"] input'
    );
  }

  /**
   * 检查编辑器是否就绪
   */
  private static hasEditorReady(doc: Document = document): boolean {
    return Boolean(
      doc.querySelector('iframe.ke-edit-iframe') ||
      (window as any).KindEditor?.instances?.length > 0 ||
      doc.querySelector('textarea#steps, textarea[name="steps"]') ||
      doc.querySelector('.ke-container, .editor')
    );
  }

  /**
   * 穿透子 iframe 尝试注入
   */
  private static tryFillChildIframes(data: ZentaoPendingFillData): boolean {
    try {
      const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            const titleInput = this.findTitleInput(doc);
            if (titleInput) {
              return this.applyFields(data, doc, iframe.contentWindow);
            }
          }
        } catch {}
      }
    } catch {}
    return false;
  }

  /**
   * 填充具体表单项
   */
  private static applyFields(
    data: ZentaoPendingFillData,
    doc: Document = document,
    win: any = window
  ): boolean {
    let filledCount = 0;

    // 1. 标题
    const titleInput = this.findTitleInput(doc);
    if (titleInput && data.title) {
      titleInput.value = data.title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      filledCount++;
    }

    // 2. 严重程度
    const severitySelect = doc.querySelector<HTMLSelectElement>('select#severity, select[name="severity"]');
    if (severitySelect && data.severity) {
      severitySelect.value = String(data.severity);
      severitySelect.dispatchEvent(new Event('change', { bubbles: true }));
      this.triggerChosenUpdate(severitySelect, win);
      filledCount++;
    }

    // 3. 优先级
    const priSelect = doc.querySelector<HTMLSelectElement>('select#pri, select[name="pri"]');
    if (priSelect && data.pri) {
      priSelect.value = String(data.pri);
      priSelect.dispatchEvent(new Event('change', { bubbles: true }));
      this.triggerChosenUpdate(priSelect, win);
      filledCount++;
    }

    // 4. 指派给
    if (data.assignedTo) {
      const assignedSelect = doc.querySelector<HTMLSelectElement>('select#assignedTo, select[name="assignedTo"]');
      if (assignedSelect) {
        const targetVal = data.assignedTo.trim();
        const matchedOpt = Array.from(assignedSelect.options).find(
          (opt) => opt.value === targetVal || opt.text.toLowerCase().includes(targetVal.toLowerCase())
        );
        if (matchedOpt) {
          assignedSelect.value = matchedOpt.value;
          assignedSelect.dispatchEvent(new Event('change', { bubbles: true }));
          this.triggerChosenUpdate(assignedSelect, win);
          filledCount++;
        }
      }
    }

    // 5. 影响版本
    if (data.openedBuild) {
      const buildSelect = doc.querySelector<HTMLSelectElement>('select#openedBuild, select[name="openedBuild[]"]');
      if (buildSelect) {
        const matched = Array.from(buildSelect.options).find((opt) => opt.value === data.openedBuild);
        if (matched) {
          buildSelect.value = matched.value;
          buildSelect.dispatchEvent(new Event('change', { bubbles: true }));
          this.triggerChosenUpdate(buildSelect, win);
        }
      }
    }

    // 6. 重现步骤富文本
    const injectedRich = this.injectRichText(data.stepsHtml, doc, win);
    if (injectedRich) filledCount++;

    // 7. 现场截图附件装配
    if (data.screenshotUrl) {
      this.attachScreenshotFile(data.screenshotUrl, data.bugId, doc);
    }

    return filledCount > 0;
  }

  /**
   * 向富文本编辑器注入 HTML
   */
  private static injectRichText(htmlContent: string, doc: Document = document, win: any = window): boolean {
    let success = false;

    // A. 尝试通过 KindEditor API 注入
    try {
      if (win.KindEditor && Array.isArray(win.KindEditor.instances)) {
        win.KindEditor.instances.forEach((inst: any) => {
          if (inst && typeof inst.html === 'function') {
            inst.html(htmlContent);
            if (typeof inst.sync === 'function') inst.sync();
            success = true;
          }
        });
      }
      if (win.editor && typeof win.editor.html === 'function') {
        win.editor.html(htmlContent);
        if (typeof win.editor.sync === 'function') win.editor.sync();
        success = true;
      }
    } catch {}

    // B. 尝试直接向 KindEditor iframe 注入
    const iframes = Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe.ke-edit-iframe, iframe[class*="editor"]'));
    iframes.forEach((iframe) => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body) {
          iframeDoc.body.innerHTML = htmlContent;
          iframeDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
          success = true;
        }
      } catch {}
    });

    // C. 同步给底层 textarea
    const textareas = Array.from(doc.querySelectorAll<HTMLTextAreaElement>('textarea#steps, textarea[name="steps"]'));
    textareas.forEach((ta) => {
      ta.value = htmlContent;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      success = true;
    });

    return success;
  }

  /**
   * 自动将 Base64 截图装配到页面的文件上传域
   */
  private static attachScreenshotFile(dataUrl: string, bugId: string, doc: Document = document) {
    const file = dataUrlToFile(dataUrl, `qa-screenshot-${bugId || Date.now()}.png`);
    if (!file) return;

    // 寻找页面的附件上传 input
    const fileInputs = Array.from(
      doc.querySelectorAll<HTMLInputElement>('input[type="file"][name*="files"], input[type="file"][name*="file"], input[type="file"]')
    );

    if (fileInputs.length === 0) return;

    for (const input of fileInputs) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[QA Copilot] 已成功通过 DataTransfer 装配截图附件:', file.name);
        break;
      } catch (err) {
        console.warn('[QA Copilot] 装配截图附件出现异常:', err);
      }
    }
  }

  /**
   * 触发 Chosen 下拉刷新
   */
  private static triggerChosenUpdate(selectEl: HTMLSelectElement, win: any = window) {
    try {
      if (win.$ && typeof win.$(selectEl).trigger === 'function') {
        win.$(selectEl).trigger('chosen:updated');
      }
    } catch {}
  }

  /**
   * 在页面顶部展示美观的操作横幅
   */
  private static showSuccessBanner(data: ZentaoPendingFillData) {
    const existing = document.getElementById('qa-copilot-zentao-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'qa-copilot-zentao-banner';
    banner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      animation: qaSlideDown 0.3s ease-out;
    `;

    const hasScreenshot = Boolean(data.screenshotUrl);
    banner.innerHTML = `
      <style>
        @keyframes qaSlideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      </style>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">🎉</span>
        <div>
          <strong style="font-weight: 700;">QA Copilot 自动化填单完成！</strong>
          <span style="opacity: 0.95; font-size: 12px; margin-left: 4px;">
            标题、排版步骤${hasScreenshot ? '与现场截图附件' : ''}已全部自动就位。
          </span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="qa-zentao-auto-submit" style="
          background: #ffffff;
          color: #065f46;
          border: none;
          padding: 5px 12px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          transition: all 0.2s;
        ">立刻帮我提交</button>
        <button id="qa-zentao-banner-close" style="
          background: rgba(255,255,255,0.2);
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">我来核对</button>
      </div>
    `;

    document.body.appendChild(banner);

    // 绑定自动提交按钮
    const submitBtn = banner.querySelector?.('#qa-zentao-auto-submit');
    submitBtn?.addEventListener('click', () => {
      this.injectRichText(data.stepsHtml);

      const pageSubmit = document.querySelector<HTMLElement>(
        '#submit, button#submit, input#submit, form#dataform button[type="submit"], form#dataform input[type="submit"]'
      );
      if (pageSubmit) {
        pageSubmit.click();
        banner.remove();
      } else {
        alert('未找到页面的保存按钮，请手动点击页面下方的“保存”提交');
      }
    });

    // 绑定关闭按钮
    const closeBtn = banner.querySelector?.('#qa-zentao-banner-close');
    closeBtn?.addEventListener('click', () => {
      banner.remove();
    });
  }

  /**
   * 在页面右下角显示常驻的悬浮助手胶囊，确保用户任何情况下都能一键填入
   */
  private static showFloatingHelper(data: ZentaoPendingFillData) {
    if (this.hasFilled) return;
    const existing = document.getElementById('qa-copilot-floating-helper');
    if (existing) return;

    const widget = document.createElement('div');
    widget.id = 'qa-copilot-floating-helper';
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999998;
      background: #1e293b;
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      max-width: 380px;
      cursor: default;
    `;

    const cleanTitle = data.title.length > 20 ? `${data.title.slice(0, 20)}…` : data.title;
    widget.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">🚀</span>
        <div>
          <div style="font-weight: 700; color: #38bdf8;">QA Copilot 待填 Bug</div>
          <div style="color: #cbd5e1; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${cleanTitle}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button id="qa-btn-manual-fill" style="
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 11px;
          cursor: pointer;
          white-space: nowrap;
        ">一键填入</button>
        <button id="qa-btn-floating-dismiss" style="
          background: transparent;
          color: #94a3b8;
          border: none;
          padding: 4px;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
        ">✕</button>
      </div>
    `;

    document.body.appendChild(widget);

    const fillBtn = widget.querySelector('#qa-btn-manual-fill');
    fillBtn?.addEventListener('click', async () => {
      const ok = await this.fillFormWithRetry(data);
      if (!ok) {
        alert('未在当前可视区域探测到 Bug 表单。若您在首页或列表页，请先点击页面上的“提 Bug”按钮进入提单页，插件将自动完成填单。');
      }
    });

    const dismissBtn = widget.querySelector('#qa-btn-floating-dismiss');
    dismissBtn?.addEventListener('click', () => {
      widget.remove();
    });
  }

  private static removeFloatingHelper() {
    const helper = document.getElementById('qa-copilot-floating-helper');
    if (helper) helper.remove();
  }

  /**
   * 检查并在 Bug 详情页自动挂载现场截图 (方案 A)
   */
  static async checkAndAttachOnBugViewPage(): Promise<boolean> {
    // 仅在顶层窗口运行，避免子 iframe 干扰
    if (typeof window !== 'undefined' && window !== window.top) {
      return false;
    }

    const bugId = this.getBugIdFromViewPage();
    if (!bugId) return false;

    let pending: ZentaoPendingAttachment | undefined;
    try {
      const getRes = chrome.storage.local.get(ZENTAO_PENDING_ATTACHMENT_KEY);
      const res = typeof (getRes as any)?.then === 'function'
        ? await getRes
        : await new Promise((resolve) => chrome.storage.local.get(ZENTAO_PENDING_ATTACHMENT_KEY, resolve));
      pending = (res as any)?.[ZENTAO_PENDING_ATTACHMENT_KEY];
    } catch {
      return false;
    }

    // 宽松类型匹配：String(pending.bugId) === String(bugId) 杜绝数字/字符串类型不一致导致的静默失败
    if (!pending || String(pending.bugId) !== String(bugId)) {
      return false;
    }

    // 超过 10 分钟废弃
    if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
      try {
        chrome.storage?.local?.remove?.(ZENTAO_PENDING_ATTACHMENT_KEY);
      } catch {}
      return false;
    }

    console.log(`[QA Copilot] 探测到 Bug #${bugId} 待同步截图附件，正在通过网页端同源会话上传…`);

    // 若 DOM 尚未完全加载，等待 DOM 就绪后执行
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        void this.uploadAttachmentInViewPage(pending!);
      }, { once: true });
      return true;
    }

    return this.uploadAttachmentInViewPage(pending);
  }

  /**
   * 确保详情页正文末尾显示高清截图（如果正文尚未显示图片）
   */
  private static ensureScreenshotRenderedInViewPage(screenshotUrl: string) {
    if (typeof document === 'undefined') return;
    try {
      const detailContainer = document.querySelector(
        '.detail-content, .article-content, #mainContent .detail, #legendLife, fieldset, .main-col'
      );
      if (!detailContainer) return;

      const existingImg = detailContainer.querySelector('img[src^="data:image"], img[alt*="截图"], img[src*="qa-"]');
      if (existingImg) return;

      const card = document.createElement('div');
      card.id = 'qa-copilot-view-screenshot-card';
      card.style.cssText = `
        margin-top: 20px;
        padding: 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      `;
      card.innerHTML = `
        <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 10px; border-left: 4px solid #2563eb; padding-left: 8px;">
          📷 [问题现场截图 (QA Copilot 自动呈现)]
        </div>
        <div style="text-align: center;">
          <img src="${screenshotUrl}" alt="问题现场截图" style="max-width: 100%; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #cbd5e1;" />
        </div>
      `;
      detailContainer.appendChild(card);
    } catch {}
  }

  /**
   * 在 Bug 详情页通过同源网络请求直接上传附件并关联到该 Bug
   */
  private static async uploadAttachmentInViewPage(pending: ZentaoPendingAttachment): Promise<boolean> {
    const filesToUpload: File[] = [];
    if (pending.screenshotUrl) {
      const imgFile = dataUrlToFile(pending.screenshotUrl, pending.fileName || `qa-screenshot-bug-${pending.bugId}.png`);
      if (imgFile) filesToUpload.push(imgFile);
      // 即时在页面正文确保截图呈现
      this.ensureScreenshotRenderedInViewPage(pending.screenshotUrl);
    }

    if (pending.recordingDataUrl) {
      const recFile = dataUrlToFile(pending.recordingDataUrl, pending.recordingFileName || `qa-recording-bug-${pending.bugId}.webm`);
      if (recFile) filesToUpload.push(recFile);
    }

    if (filesToUpload.length === 0) return false;

    let uploaded = false;

    let pathname = '/';
    if (typeof window !== 'undefined' && window.location) {
      if (typeof window.location.pathname === 'string') {
        pathname = window.location.pathname;
      } else if (typeof window.location.href === 'string') {
        try {
          pathname = new URL(window.location.href).pathname;
        } catch {
          pathname = '/';
        }
      }
    }
    const dirPath = pathname.substring(0, pathname.lastIndexOf('/') + 1) || '/';

    // 1. 首选通道：禅道通用的 action-comment 接口（向该 Bug 追加备注并同时持久化挂载附件）
    const commentEndpoints = [
      `${dirPath}action-comment-bug-${pending.bugId}.html`,
      `${dirPath}index.php?m=action&f=comment&objectType=bug&objectID=${pending.bugId}`,
      `/action-comment-bug-${pending.bugId}.html`,
      `/index.php?m=action&f=comment&objectType=bug&objectID=${pending.bugId}`,
    ];

    for (const ep of commentEndpoints) {
      try {
        const formData = new FormData();
        formData.append('comment', `<p>【QA Copilot 自动同步现场附件：${filesToUpload.map((f) => f.name).join(', ')}】</p>`);
        formData.append('objectType', 'bug');
        formData.append('objectID', String(pending.bugId));
        for (const file of filesToUpload) {
          formData.append('files[]', file, file.name);
          formData.append('labels[]', file.name);
        }

        const resp = await fetch(ep, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });

        if (resp.ok || resp.status === 302 || resp.redirected) {
          const text = await resp.text().catch(() => '');
          if (!text.toLowerCase().includes('user-login') && !text.toLowerCase().includes('m=user&f=login')) {
            uploaded = true;
            console.log('[QA Copilot] 网页端通过 action-comment 成功挂载附件:', ep);
            break;
          }
        }
      } catch {}
    }

    // 2. 备选通道：禅道专用 file-ajaxUpload 接口逐个文件上传并关联到该 Bug
    if (!uploaded) {
      const uploadEndpoints = [
        `${dirPath}file-ajaxUpload-bug-${pending.bugId}.html`,
        `${dirPath}index.php?m=file&f=ajaxUpload&objectType=bug&objectID=${pending.bugId}`,
        `/file-ajaxUpload-bug-${pending.bugId}.html`,
        `${dirPath}file-ajaxUpload.html?objectType=bug&objectID=${pending.bugId}`,
        `/file-ajaxUpload.html?objectType=bug&objectID=${pending.bugId}`,
        `index.php?m=file&f=ajaxUpload&objectType=bug&objectID=${pending.bugId}`,
        `${dirPath}file-upload-bug-${pending.bugId}.html`,
        `${dirPath}index.php?m=file&f=upload&objectType=bug&objectID=${pending.bugId}`,
      ];

      for (const ep of uploadEndpoints) {
        try {
          let allSuccess = true;
          for (const file of filesToUpload) {
            const formData = new FormData();
            formData.append('file', file, file.name);
            formData.append('files[]', file, file.name);
            formData.append('files', file, file.name);
            formData.append('imgFile', file, file.name);
            formData.append('upfile', file, file.name);
            formData.append('objectType', 'bug');
            formData.append('objectID', String(pending.bugId));
            formData.append('comment', `【QA Copilot 自动同步现场附件：${file.name}】`);

            const resp = await fetch(ep, {
              method: 'POST',
              credentials: 'include',
              body: formData,
            });

            if (resp.ok) {
              const text = await resp.text().catch(() => '');
              let isSuccess = false;
              // 坚决防止将只读 HTML 页面误判为上传成功
              const isHtmlDoc = text.includes('<!DOCTYPE') || (text.includes('<html') && !text.includes('afterUpload') && !text.includes('parent.location'));
              if (!isHtmlDoc) {
                try {
                  const data = JSON.parse(text);
                  if (
                    data.result === 'success' ||
                    data.status === 'success' ||
                    data.status === 'ok' ||
                    data.id ||
                    data.url ||
                    data.files ||
                    (!data.error && !data.message?.toLowerCase().includes('fail'))
                  ) {
                    isSuccess = true;
                  }
                } catch {
                  if (text.includes('afterUpload') || text.includes('loadFiles') || resp.redirected) {
                    isSuccess = true;
                  }
                }
              }
              if (!isSuccess) {
                allSuccess = false;
                break;
              }
            } else {
              allSuccess = false;
              break;
            }
          }

          if (allSuccess) {
            uploaded = true;
            console.log('[QA Copilot] 网页端通过 file-ajaxUpload 接口成功上传附件:', ep);
            break;
          }
        } catch {}
      }
    }

    // 3. 兜底通道：如果同源网络接口未直接成功，尝试利用详情页现有的“添加备注/评论”表单自动挂载提交
    if (!uploaded) {
      uploaded = await this.tryAttachViaCommentForm(filesToUpload, pending.bugId);
    }

    // 成功挂载后清理任务，避免重复
    if (uploaded) {
      try {
        chrome.storage?.local?.remove?.(ZENTAO_PENDING_ATTACHMENT_KEY);
      } catch {}
    }

    // 展示清晰的顶部横幅并提供一键刷新或查看
    this.showAttachmentSuccessBanner(pending.bugId, uploaded, Boolean(pending.recordingDataUrl));

    // 上传成功后自动延迟 1.2 秒刷新详情页，让刚刚挂载的录屏与截图在附件列表中直接可见
    if (uploaded && typeof window !== 'undefined' && window.location) {
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    }

    return uploaded;
  }

  /**
   * 兜底：通过详情页的备注与附件表单自动挂载提交
   */
  private static async tryAttachViaCommentForm(files: File[], bugId: number): Promise<boolean> {
    try {
      const fileInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'form input[type="file"][name*="files"], form input[type="file"][name*="file"], input[type="file"]'
        )
      );

      if (fileInputs.length === 0) return false;

      for (const input of fileInputs) {
        try {
          const dt = new DataTransfer();
          files.forEach((f) => dt.items.add(f));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));

          const form = input.closest('form');
          if (form) {
            const commentBox = form.querySelector<HTMLTextAreaElement>('textarea#comment, textarea[name="comment"]');
            if (commentBox && !commentBox.value) {
              commentBox.value = `【QA Copilot 自动补充 Bug #${bugId} 现场截图与录屏附件】`;
              commentBox.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const submitBtn = form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], #submit');
            if (submitBtn) {
              submitBtn.click();
              console.log('[QA Copilot] 已通过详情页备注表单提交附件');
              return true;
            }
          }
        } catch {}
      }
    } catch {}
    return false;
  }

  /**
   * 在详情页顶部展示附件关联成功的操作横幅
   */
  private static showAttachmentSuccessBanner(bugId: number, success: boolean, hasRecording = false) {
    const existing = document.getElementById('qa-copilot-attachment-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'qa-copilot-attachment-banner';
    banner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: ${success ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)' : 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)'};
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      animation: qaSlideDown 0.3s ease-out;
    `;

    const labelText = hasRecording ? '现场截图与录屏附件' : '现场截图附件';
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">${success ? '🎉' : '⚠️'}</span>
        <div>
          <strong style="font-weight: 700;">
            ${success ? `Bug #${bugId} ${labelText}已自动同步至附件列表！` : `Bug #${bugId} 已创建，附件已就绪`}
          </strong>
          <span style="opacity: 0.95; font-size: 12px; margin-left: 4px;">
            ${success ? '利用网页端同源合法会话挂载完成，免去 API 权限限制。' : '如附件区未出现，可点击编辑直接 Ctrl+V / Cmd+V 粘贴。'}
          </span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="qa-zentao-banner-refresh" style="
          background: #ffffff;
          color: ${success ? '#065f46' : '#92400e'};
          border: none;
          padding: 5px 12px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        ">刷新查看附件</button>
        <button id="qa-zentao-banner-close" style="
          background: rgba(255,255,255,0.2);
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">✕</button>
      </div>
    `;

    const mountNode = document.body || document.documentElement;
    if (mountNode) {
      mountNode.appendChild(banner);
    }

    banner.querySelector('#qa-zentao-banner-refresh')?.addEventListener('click', () => {
      window.location.reload();
    });

    banner.querySelector('#qa-zentao-banner-close')?.addEventListener('click', () => {
      banner.remove();
    });

    // 若上传成功，自动在 2 秒后移除提示，保持页面干净
    if (success) {
      setTimeout(() => {
        banner.remove();
      }, 5000);
    }
  }
}
