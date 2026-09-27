/**
 * 悬浮小窗与侧边栏吸附服务 src/sidepanel/services/pipService.ts
 * 支持在「Chrome 右侧边栏吸附」与「独立桌面悬浮小窗」之间无缝流转：
 * 1. 悬浮时：开启独立小窗，右侧边栏自动彻底关闭收起 (0 占位，网页恢复全屏宽)
 * 2. 置顶时：无缝切换为系统级画中画 (Document Picture-in-Picture) 置顶小窗，操作网页 100% 保持在最前
 * 3. 恢复时：重新唤起 Chrome 右侧边栏，当前独立小窗自动关闭
 */

export class PipService {
  private static instance: PipService;
  private alwaysOnTop = false;
  private pipWindow: Window | null = null;
  private openerWindowId: number | null = null;
  private pipSubscribers: Array<(win: Window | null) => void> = [];

  constructor() {
    this.initFromStorage();
  }

  static getInstance(): PipService {
    if (!this.instance) {
      this.instance = new PipService();
    }
    return this.instance;
  }

  /**
   * 从 Storage 初始化置顶偏好
   */
  private initFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = window.localStorage.getItem('qa_copilot_always_on_top');
        if (saved !== null) {
          this.alwaysOnTop = saved === 'true';
        }
      }
    } catch {}

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
        chrome.storage.local.get(['pipAlwaysOnTop'], (res) => {
          if (typeof res?.pipAlwaysOnTop === 'boolean') {
            this.alwaysOnTop = res.pipAlwaysOnTop;
          }
        });
      }
    } catch {}
  }

  /**
   * 保存置顶状态到持久化存储
   */
  private saveAlwaysOnTop(enabled: boolean): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('qa_copilot_always_on_top', String(enabled));
      }
    } catch {}

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
        chrome.storage.local.set({ pipAlwaysOnTop: enabled });
      }
    } catch {}
  }

  /**
   * 订阅 PiP Window 变化 (供 React 使用)
   */
  subscribePip(callback: (win: Window | null) => void): () => void {
    this.pipSubscribers.push(callback);
    callback(this.pipWindow);
    return () => {
      this.pipSubscribers = this.pipSubscribers.filter((cb) => cb !== callback);
    };
  }

  private notifyPipChanged(win: Window | null): void {
    this.pipSubscribers.forEach((cb) => {
      try {
        cb(win);
      } catch (err) {
        console.error('[PipService] 通知订阅者失败:', err);
      }
    });
  }

  private dispatchTopChangedEvent(enabled: boolean): void {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(
          new CustomEvent('PIP_ALWAYS_ON_TOP_CHANGED', { detail: { enabled } })
        );
      } catch {}
    }
  }

  /**
   * 判断当前页面是否处于独立悬浮小窗运行中
   */
  isDetachedMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('mode') === 'detached';
    } catch {
      return false;
    }
  }

  /**
   * 获取当前激活的置顶画中画窗口引用
   */
  getPipWindow(): Window | null {
    return this.pipWindow;
  }

  /**
   * 判断当前是否开启了置顶 (Always on Top)
   */
  isAlwaysOnTop(): boolean {
    return Boolean(this.pipWindow) || this.alwaysOnTop;
  }

  /**
   * 检查当前浏览器是否支持 Document Picture-in-Picture
   */
  isDocumentPipSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'documentPictureInPicture' in window &&
      typeof (window as any).documentPictureInPicture?.requestWindow === 'function'
    );
  }

  /**
   * 复制页面所有样式表到目标文档，杜绝白屏与无样式闪烁
   */
  private syncStylesToDocument(sourceDoc: Document, targetDoc: Document): void {
    try {
      // 1. 同步 link 样式文件 (Vite assets index-xxx.css)
      sourceDoc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
        targetDoc.head.appendChild(link.cloneNode(true));
      });

      // 2. 同步 inline style 标签
      sourceDoc.querySelectorAll('style').forEach((style) => {
        targetDoc.head.appendChild(style.cloneNode(true));
      });

      // 3. 动态提取 styleSheets 规则防止跨源或特殊动态样式遗漏
      try {
        Array.from(sourceDoc.styleSheets).forEach((sheet) => {
          try {
            if (!sheet.href && sheet.cssRules && sheet.cssRules.length > 0) {
              const style = targetDoc.createElement('style');
              Array.from(sheet.cssRules).forEach((rule) => {
                style.appendChild(targetDoc.createTextNode(rule.cssText));
              });
              targetDoc.head.appendChild(style);
            }
          } catch {}
        });
      } catch {}

      // 4. 继承 body 样式与类名
      targetDoc.body.className = sourceDoc.body.className;
      targetDoc.body.style.cssText = sourceDoc.body.style.cssText;
    } catch (e) {
      console.warn('[PipService] 样式同步存在部分忽略:', e);
    }
  }

  /**
   * 开启 Document Picture-in-Picture 系统原生置顶小窗
   */
  async requestDocumentPip(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    if (this.isDocumentPipSupported()) {
      try {
        const width = Math.max(380, window.innerWidth || 420);
        const height = Math.max(600, window.innerHeight || 750);

        const pipWin = await (window as any).documentPictureInPicture.requestWindow({
          width,
          height,
        });

        this.pipWindow = pipWin;
        this.alwaysOnTop = true;

        // 1. 同步样式与标题
        this.syncStylesToDocument(document, pipWin.document);
        pipWin.document.title = 'QA Copilot';

        // 2. 记录父窗口 ID 并尽量最小化父窗口，避免双窗口冗余
        try {
          if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
            const currentWin = await chrome.windows.getCurrent();
            if (currentWin?.id) {
              this.openerWindowId = currentWin.id;
              await chrome.windows.update(currentWin.id, { state: 'minimized' });
            }
          }
        } catch {}

        // 3. 监听 PiP 窗口关闭 (包括用户点击原生右上角 X 关闭或退出置顶)
        const handleClose = async () => {
          const { screenX, screenY, outerWidth, outerHeight } = pipWin;
          this.pipWindow = null;
          this.alwaysOnTop = false;
          this.saveAlwaysOnTop(false);
          this.notifyPipChanged(null);

          // 恢复父窗口到 PiP 所在的原地位置与尺寸，消除坐标跳跃
          if (this.openerWindowId && typeof chrome !== 'undefined' && chrome.windows?.update) {
            try {
              await chrome.windows.update(this.openerWindowId, {
                state: 'normal',
                focused: true,
                left: screenX,
                top: screenY,
                width: outerWidth,
                height: outerHeight,
              });
            } catch {
              try {
                await chrome.windows.update(this.openerWindowId, {
                  state: 'normal',
                  focused: true,
                });
              } catch {}
            }
          }

          this.dispatchTopChangedEvent(false);
        };

        pipWin.addEventListener('pagehide', handleClose, { once: true });

        // 4. 持久化并通知
        this.saveAlwaysOnTop(true);
        this.notifyPipChanged(pipWin);
        this.dispatchTopChangedEvent(true);

        return true;
      } catch (err) {
        console.warn('[PipService] 开启 Document Picture-in-Picture 失败，回退到普通置顶模式:', err);
      }
    }

    // 回退降级方案：若当前环境不支持 Document PiP，则使用焦点前台守护
    this.alwaysOnTop = true;
    this.saveAlwaysOnTop(true);
    await this.bringToFront();
    this.dispatchTopChangedEvent(true);
    return true;
  }

  /**
   * 关闭 Document Picture-in-Picture 置顶窗口
   */
  closeDocumentPip(): void {
    if (this.pipWindow) {
      try {
        this.pipWindow.close();
      } catch {}
      this.pipWindow = null;
    }
    this.alwaysOnTop = false;
    this.saveAlwaysOnTop(false);
    this.notifyPipChanged(null);
    this.dispatchTopChangedEvent(false);
  }

  /**
   * 设置悬浮小窗置顶状态
   */
  async setAlwaysOnTop(enabled: boolean): Promise<boolean> {
    if (enabled) {
      return this.requestDocumentPip();
    } else {
      this.closeDocumentPip();
      try {
        if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
          const currentWin = await chrome.windows.getCurrent();
          if (currentWin?.id) {
            await (chrome.windows as any).update(currentWin.id, { alwaysOnTop: false });
          }
        }
      } catch {}
      return false;
    }
  }

  /**
   * 切换悬浮小窗置顶状态
   */
  async toggleAlwaysOnTop(): Promise<boolean> {
    if (this.pipWindow || this.alwaysOnTop) {
      await this.setAlwaysOnTop(false);
      return false;
    } else {
      return this.setAlwaysOnTop(true);
    }
  }

  /**
   * 将当前悬浮小窗带至前台 (激活焦点置顶)
   */
  async bringToFront(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
        const currentWin = await chrome.windows.getCurrent();
        if (currentWin?.id) {
          try {
            await (chrome.windows as any).update(currentWin.id, { alwaysOnTop: true });
          } catch {}
          await chrome.windows.update(currentWin.id, { focused: true });
        }
      }
    } catch (err) {
      console.warn('[PipService] 置顶前置失败:', err);
    }
  }

  /**
   * 独立悬浮脱离：
   * 1. 弹出独立的小窗运行 (无地址栏、自由拖拽缩放)
   * 2. 当前右侧栏立即执行 window.close() 自动收回，右侧 0 占位
   */
  async detachToWindow(): Promise<boolean> {
    if (typeof chrome !== 'undefined' && chrome.windows?.create) {
      try {
        let hostWindowId = '';
        if (chrome.windows?.getCurrent) {
          const currentWin = await chrome.windows.getCurrent();
          if (currentWin?.id) hostWindowId = String(currentWin.id);
        }

        const newWin = await chrome.windows.create({
          url: chrome.runtime.getURL(
            `sidepanel/index.html?mode=detached${hostWindowId ? `&hostWindowId=${hostWindowId}` : ''}`
          ),
          type: 'popup',
          width: 420,
          height: 750,
          focused: true,
        });

        if (newWin?.id && this.alwaysOnTop) {
          try {
            await (chrome.windows as any).update(newWin.id, { alwaysOnTop: true });
          } catch {}
        }

        // 延迟 50ms 确保新窗口成功拉起后，当前侧边栏立即自我关闭收起
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            window.close();
          }
        }, 50);

        return true;
      } catch (err) {
        console.error('[PipService] 脱离为独立浮窗失败:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * 恢复吸附：
   * 1. 重新唤出 Chrome 原生右侧栏 sidePanel
   * 2. 关闭当前独立小浮窗与置顶 PiP 窗口
   */
  async attachToSidePanel(): Promise<void> {
    try {
      if (this.pipWindow) {
        this.closeDocumentPip();
      }
      if (typeof chrome !== 'undefined' && chrome.sidePanel?.open) {
        const url = new URL(window.location.href);
        const hostWindowId = url.searchParams.get('hostWindowId');

        if (hostWindowId) {
          await chrome.sidePanel.open({ windowId: Number(hostWindowId) });
        } else {
          const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
          const targetWin = wins[0];
          if (targetWin?.id) {
            await chrome.sidePanel.open({ windowId: targetWin.id });
          }
        }
      }
    } catch (err) {
      console.warn('[PipService] 重新唤起侧边栏失败:', err);
    } finally {
      if (typeof window !== 'undefined') {
        window.close();
      }
    }
  }

  // 兼容旧接口命名
  isPipActive(): boolean {
    return Boolean(this.pipWindow) || this.isDetachedMode();
  }

  isPipSupported(): boolean {
    return true;
  }

  async enterPip(): Promise<boolean> {
    return this.detachToWindow();
  }

  exitPip(): void {
    this.attachToSidePanel();
  }
}

export const pipService = PipService.getInstance();
