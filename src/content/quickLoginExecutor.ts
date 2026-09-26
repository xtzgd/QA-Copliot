/**
 * 快捷登录执行器 (QUICK-LOGIN)
 * 具备弹窗自适应探测、Vue/React 响应式数据绑定穿透、账号密码自动填充与可选自动提交
 */

export interface QuickLoginParams {
  username: string;
  password: string;
  loginTriggerSelector?: string;
  autoSubmit?: boolean;
}

export interface QuickLoginResult {
  success: boolean;
  message: string;
}

export class QuickLoginExecutor {
  /**
   * 判断元素是否在页面中可见
   */
  static isElementVisible(el: HTMLElement | null): boolean {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent === null && el.tagName.toLowerCase() !== 'body') {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return true;
  }

  /**
   * 查找可见的密码输入框
   */
  static findVisiblePasswordInput(): HTMLInputElement | null {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    for (const input of inputs) {
      if (this.isElementVisible(input) && !input.disabled && !input.readOnly) {
        return input;
      }
    }
    return null;
  }

  /**
   * 查找弹窗登录触发按钮（优先使用自定义选择器，否则采用多维智能嗅探）
   */
  static findLoginTriggerButton(customSelector?: string): HTMLElement | null {
    if (customSelector && customSelector.trim()) {
      try {
        const customEl = document.querySelector<HTMLElement>(customSelector.trim());
        if (customEl && this.isElementVisible(customEl)) return customEl;
      } catch (err) {
        console.warn('[QuickLogin] 自定义选择器解析失败:', err);
      }
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a, input[type="button"], [role="button"], [class*="login"], [id*="login"]'
      )
    );

    // 精确匹配“登录”、“登 录”、“Sign In”、“Log In”
    for (const el of candidates) {
      if (!this.isElementVisible(el)) continue;
      const text = (el.innerText || el.textContent || (el as HTMLInputElement).value || '').trim();
      if (/^(登\s*录|sign\s*in|log\s*in|login)$/i.test(text)) {
        return el;
      }
    }

    // 模糊匹配短文本
    for (const el of candidates) {
      if (!this.isElementVisible(el)) continue;
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length <= 8 && /(登\s*录|Sign In|Log In)/i.test(text)) {
        return el;
      }
    }

    return null;
  }

  /**
   * 等待可见密码框出现（支持弹窗挂载异步动画）
   */
  static async waitForPasswordInput(timeoutMs = 5000): Promise<HTMLInputElement> {
    const existing = this.findVisiblePasswordInput();
    if (existing) return existing;

    return new Promise<HTMLInputElement>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let observer: MutationObserver | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (pollTimer) clearInterval(pollTimer);
        if (observer) observer.disconnect();
      };

      const check = () => {
        const found = QuickLoginExecutor.findVisiblePasswordInput();
        if (found) {
          cleanup();
          resolve(found);
          return true;
        }
        return false;
      };

      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(() => {
          check();
        });
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        }
      }

      pollTimer = setInterval(check, 100);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`未在 ${timeoutMs}ms 内检测到登录密码框`));
      }, timeoutMs);
    });
  }

  /**
   * 定位用户名输入框（根据与密码框的关联关系与语义属性探查）
   */
  static findUsernameInput(passwordInput: HTMLInputElement): HTMLInputElement | null {
    // 1. 同一 form 内的可见文本 input
    const form = passwordInput.closest('form');
    if (form) {
      const formInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
      const textInputs = formInputs.filter(
        (i) =>
          i !== passwordInput &&
          this.isElementVisible(i) &&
          !i.disabled &&
          !i.readOnly &&
          ['text', 'email', 'tel', 'number', ''].includes((i.type || 'text').toLowerCase())
      );
      if (textInputs.length > 0) {
        const matched = textInputs.find((i) =>
          /(user|account|name|phone|email|账号|用户|手机)/i.test((i.name || '') + (i.placeholder || '') + (i.id || ''))
        );
        return matched || textInputs[textInputs.length - 1];
      }
    }

    // 2. 页面中在密码框之前的可见文本 input
    const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    const pIndex = allInputs.indexOf(passwordInput);
    const priorInputs = (pIndex > 0 ? allInputs.slice(0, pIndex) : allInputs).filter(
      (i) =>
        i !== passwordInput &&
        this.isElementVisible(i) &&
        !i.disabled &&
        !i.readOnly &&
        ['text', 'email', 'tel', 'number', ''].includes((i.type || 'text').toLowerCase())
    );

    if (priorInputs.length > 0) {
      const matched = priorInputs.find((i) =>
        /(user|account|name|phone|email|账号|用户|手机)/i.test((i.name || '') + (i.placeholder || '') + (i.id || ''))
      );
      return matched || priorInputs[priorInputs.length - 1];
    }

    return null;
  }

  /**
   * 原生原型 setter 赋值，保证 Vue / React 受控组件正常响应
   */
  static setInputValue(input: HTMLInputElement, value: string): void {
    input.focus();
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.blur();
  }

  /**
   * 尝试自动提交登录表单
   */
  static async trySubmit(passwordInput: HTMLInputElement): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 200));

    const form = passwordInput.closest('form');
    if (form) {
      const submitBtn = form.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
      if (submitBtn && this.isElementVisible(submitBtn)) {
        submitBtn.click();
        return true;
      }
    }

    const container =
      form ||
      passwordInput.closest('.modal, .dialog, .el-dialog, .ant-modal, [role="dialog"]') ||
      document.body;

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>('button, a, input[type="button"], [role="button"]')
    );
    for (const btn of buttons) {
      if (!this.isElementVisible(btn)) continue;
      const text = (btn.innerText || btn.textContent || (btn as HTMLInputElement).value || '').trim();
      if (/^(登\s*录|sign\s*in|log\s*in|确定|进入系统)$/i.test(text)) {
        btn.click();
        return true;
      }
    }

    // 兜底回车
    passwordInput.focus();
    passwordInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    passwordInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    passwordInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return true;
  }

  /**
   * 执行完整的快捷登录流程
   */
  static async execute(params: QuickLoginParams): Promise<QuickLoginResult> {
    try {
      let passwordInput = this.findVisiblePasswordInput();

      // 如果当前没有可见密码框，尝试寻找弹窗按钮唤起
      if (!passwordInput) {
        const triggerBtn = this.findLoginTriggerButton(params.loginTriggerSelector);
        if (triggerBtn) {
          triggerBtn.click();
          // 等待弹窗与输入框渲染
          passwordInput = await this.waitForPasswordInput(5000);
        } else {
          // 若未找到弹窗按钮，依然给 1.5 秒缓冲等待可能的页面懒加载
          try {
            passwordInput = await this.waitForPasswordInput(1500);
          } catch {
            return {
              success: false,
              message: '未在页面中找到登录密码框，也未探查到登录弹窗触发按钮。',
            };
          }
        }
      }

      if (!passwordInput) {
        return { success: false, message: '未找到登录密码框。' };
      }

      // 定位用户名框
      const usernameInput = this.findUsernameInput(passwordInput);
      if (!usernameInput) {
        return { success: false, message: '已找到密码框，但未定位到对应的用户名输入框。' };
      }

      // 执行填充
      this.setInputValue(usernameInput, params.username);
      this.setInputValue(passwordInput, params.password);

      // 如果配置了自动提交
      if (params.autoSubmit) {
        await this.trySubmit(passwordInput);
        return {
          success: true,
          message: `账号 [${params.username}] 已自动填写并提交登录`,
        };
      }

      // 默认仅填充：光标聚焦在密码框，方便用户确认或输入验证码
      passwordInput.focus();
      return {
        success: true,
        message: `账号 [${params.username}] 凭据已自动填写完毕`,
      };
    } catch (error) {
      return {
        success: false,
        message: (error as Error).message || '快捷登录执行异常',
      };
    }
  }
}
