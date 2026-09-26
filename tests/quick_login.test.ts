/**
 * 快捷登录与多环境导航测试套件 tests/quick_login.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from 'vitest';
import { QuickLoginExecutor } from '../src/content/quickLoginExecutor';

// ==========================================
// 轻量级 DOM 环境 Mock (适配 Node.js 运行环境)
// ==========================================
class FakeElement {
  tagName: string;
  id: string = '';
  className: string = '';
  type: string = 'text';
  value: string = '';
  placeholder: string = '';
  name: string = '';
  disabled: boolean = false;
  readOnly: boolean = false;
  isConnected: boolean = true;
  offsetParent: any = {};
  innerText: string = '';
  textContent: string = '';
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  listeners: Record<string, Array<(e: any) => void>> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    child.isConnected = true;
    this.children.push(child);
    triggerMutation();
    return child;
  }

  removeChild(child: FakeElement) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.isConnected = false;
      triggerMutation();
    }
    return child;
  }

  focus() {}
  blur() {}

  click() {
    this.dispatchEvent(new FakeEvent('click'));
  }

  addEventListener(type: string, handler: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (e: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
  }

  dispatchEvent(event: FakeEvent) {
    event.target = this;
    event.currentTarget = this;
    const handlers = this.listeners[event.type] || [];
    handlers.forEach((h) => h(event));
    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return true;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, bottom: 30, right: 100 };
  }

  matches(selector: string): boolean {
    if (selector.includes(',')) {
      return selector.split(',').some((s) => this.matches(s));
    }
    selector = selector.trim().toLowerCase();
    if (selector === 'input' && this.tagName === 'INPUT') return true;
    if (selector === 'form' && this.tagName === 'FORM') return true;
    if (selector === 'button' && this.tagName === 'BUTTON') return true;
    if (selector === 'a' && this.tagName === 'A') return true;
    if (selector === 'div' && this.tagName === 'DIV') return true;
    if (selector.startsWith('#') && this.id.toLowerCase() === selector.slice(1)) return true;
    if (selector.startsWith('.') && this.className.toLowerCase().includes(selector.slice(1))) return true;
    if (selector.includes('input[type="password"]') && this.tagName === 'INPUT' && this.type === 'password') return true;
    if (selector.includes('input[type="button"]') && this.tagName === 'INPUT' && this.type === 'button') return true;
    if (selector.includes('input[type="submit"]') && this.tagName === 'INPUT' && this.type === 'submit') return true;
    if (selector.includes('button[type="submit"]') && this.tagName === 'BUTTON' && this.type === 'submit') return true;
    if (selector.includes('[class*="login"]') && this.className.toLowerCase().includes('login')) return true;
    if (selector.includes('[id*="login"]') && this.id.toLowerCase().includes('login')) return true;
    return false;
  }

  closest(selector: string): FakeElement | null {
    let curr: FakeElement | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const res: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          res.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return res;
  }

  querySelector(selector: string): FakeElement | null {
    const list = this.querySelectorAll(selector);
    return list[0] || null;
  }
}

class FakeEvent {
  type: string;
  bubbles: boolean;
  target: any = null;
  currentTarget: any = null;
  defaultPrevented = false;

  constructor(type: string, options?: { bubbles?: boolean }) {
    this.type = type;
    this.bubbles = Boolean(options?.bubbles);
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeKeyboardEvent extends FakeEvent {
  key: string;
  code: string;
  keyCode: number;
  which: number;

  constructor(type: string, options?: any) {
    super(type, options);
    this.key = options?.key || '';
    this.code = options?.code || '';
    this.keyCode = options?.keyCode || 0;
    this.which = options?.which || 0;
  }
}

let activeObservers: Array<() => void> = [];
function triggerMutation() {
  activeObservers.forEach((cb) => cb());
}

class FakeMutationObserver {
  callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    activeObservers.push(this.callback);
  }
  disconnect() {
    activeObservers = activeObservers.filter((cb) => cb !== this.callback);
  }
}

let fakeBody: FakeElement;

beforeAll(() => {
  fakeBody = new FakeElement('body');
  (global as any).HTMLElement = FakeElement;
  (global as any).HTMLInputElement = FakeElement;
  (global as any).HTMLButtonElement = FakeElement;
  (global as any).Event = FakeEvent;
  (global as any).KeyboardEvent = FakeKeyboardEvent;
  (global as any).MutationObserver = FakeMutationObserver;

  (global as any).window = {
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  };

  (global as any).document = {
    body: fakeBody,
    querySelector: (sel: string) => fakeBody.querySelector(sel),
    querySelectorAll: (sel: string) => fakeBody.querySelectorAll(sel),
  };
});

describe('快捷登录执行器 QuickLoginExecutor', () => {
  beforeEach(() => {
    fakeBody.children = [];
    activeObservers = [];
  });

  afterEach(() => {
    fakeBody.children = [];
    activeObservers = [];
    vi.restoreAllMocks();
  });

  it('正确识别可见密码输入框并排除 disabled/readonly 框', () => {
    const pwdDisabled = new FakeElement('input');
    pwdDisabled.type = 'password';
    pwdDisabled.disabled = true;
    fakeBody.appendChild(pwdDisabled);

    const pwdReadonly = new FakeElement('input');
    pwdReadonly.type = 'password';
    pwdReadonly.readOnly = true;
    fakeBody.appendChild(pwdReadonly);

    const pwdValid = new FakeElement('input');
    pwdValid.type = 'password';
    pwdValid.id = 'pwd-valid';
    fakeBody.appendChild(pwdValid);

    const pwd = QuickLoginExecutor.findVisiblePasswordInput();
    expect(pwd).not.toBeNull();
    expect(pwd?.id).toBe('pwd-valid');
  });

  it('智能探测登录弹窗触发按钮 (文本/类名/自定义选择器)', () => {
    const btnCustom = new FakeElement('button');
    btnCustom.id = 'custom-btn';
    btnCustom.className = 'my-custom-login';
    btnCustom.innerText = '登录系统';
    fakeBody.appendChild(btnCustom);

    // 1. 自定义选择器命中
    const btn1 = QuickLoginExecutor.findLoginTriggerButton('.my-custom-login');
    expect(btn1).not.toBeNull();
    expect(btn1?.id).toBe('custom-btn');

    // 2. 智能模糊匹配文本“登录系统”
    const btn2 = QuickLoginExecutor.findLoginTriggerButton();
    expect(btn2).not.toBeNull();
    expect(btn2?.id).toBe('custom-btn');
  });

  it('精准定位与密码框配对的用户名输入框', () => {
    const form = new FakeElement('form');
    const userInput = new FakeElement('input');
    userInput.type = 'text';
    userInput.id = 'user-input';
    userInput.name = 'username';
    form.appendChild(userInput);

    const pwdInput = new FakeElement('input');
    pwdInput.type = 'password';
    pwdInput.id = 'pwd-input';
    pwdInput.name = 'password';
    form.appendChild(pwdInput);

    fakeBody.appendChild(form);

    const detectedUser = QuickLoginExecutor.findUsernameInput(pwdInput as any);
    expect(detectedUser).not.toBeNull();
    expect(detectedUser?.id).toBe('user-input');
  });

  it('原生原型 setter 赋值并完整派发 input/change 事件流', () => {
    const input = new FakeElement('input');
    let inputFired = false;
    let changeFired = false;

    input.addEventListener('input', () => {
      inputFired = true;
    });
    input.addEventListener('change', () => {
      changeFired = true;
    });

    QuickLoginExecutor.setInputValue(input as any, 'admin_user');

    expect(input.value).toBe('admin_user');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });

  it('直接存在登录框时，直接完成账号密码填充', async () => {
    const form = new FakeElement('form');
    const userInput = new FakeElement('input');
    userInput.type = 'text';
    userInput.name = 'account';
    form.appendChild(userInput);

    const pwdInput = new FakeElement('input');
    pwdInput.type = 'password';
    pwdInput.name = 'password';
    form.appendChild(pwdInput);

    fakeBody.appendChild(form);

    const result = await QuickLoginExecutor.execute({
      username: 'test_admin',
      password: 'password_123',
      autoSubmit: false,
    });

    expect(result.success).toBe(true);
    expect(userInput.value).toBe('test_admin');
    expect(pwdInput.value).toBe('password_123');
  });

  it('弹窗登录场景：无初始密码框，模拟点击弹窗按钮后挂载密码框并完成填充', async () => {
    const navBtn = new FakeElement('button');
    navBtn.id = 'login-nav-btn';
    navBtn.innerText = '登录';

    navBtn.addEventListener('click', () => {
      // 模拟弹窗异步渲染挂载
      const dialog = new FakeElement('div');
      dialog.className = 'login-dialog';

      const userModalInput = new FakeElement('input');
      userModalInput.type = 'text';
      userModalInput.name = 'username';
      dialog.appendChild(userModalInput);

      const pwdModalInput = new FakeElement('input');
      pwdModalInput.type = 'password';
      pwdModalInput.name = 'password';
      dialog.appendChild(pwdModalInput);

      fakeBody.appendChild(dialog);
    });

    fakeBody.appendChild(navBtn);

    const result = await QuickLoginExecutor.execute({
      username: 'modal_user',
      password: 'modal_password',
      autoSubmit: false,
    });

    expect(result.success).toBe(true);
    const pwd = fakeBody.querySelector('input[type="password"]');
    expect(pwd).not.toBeNull();
    expect(pwd?.value).toBe('modal_password');
  });

  it('开启 autoSubmit 时，填充后自动触发点击提交按钮', async () => {
    let submitClicked = false;
    const form = new FakeElement('form');

    const userInput = new FakeElement('input');
    userInput.type = 'text';
    userInput.name = 'account';
    form.appendChild(userInput);

    const pwdInput = new FakeElement('input');
    pwdInput.type = 'password';
    pwdInput.name = 'password';
    form.appendChild(pwdInput);

    const submitBtn = new FakeElement('button');
    submitBtn.type = 'submit';
    submitBtn.innerText = '登录';
    submitBtn.addEventListener('click', () => {
      submitClicked = true;
    });
    form.appendChild(submitBtn);

    fakeBody.appendChild(form);

    const result = await QuickLoginExecutor.execute({
      username: 'auto_admin',
      password: 'auto_password',
      autoSubmit: true,
    });

    expect(result.success).toBe(true);
    expect(submitClicked).toBe(true);
  });

  it('边界异常：既没有密码框也没有弹窗触发按钮时，返回友好错误提示', async () => {
    document.body.innerHTML = `
      <div class="empty-page">这里没有任何登录表单</div>
    `;

    const result = await QuickLoginExecutor.execute({
      username: 'test',
      password: '123',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('未在页面中找到登录密码框');
  });

  it('边界异常：有密码框但没有用户名输入框时，返回明确提示', async () => {
    const pwdInput = new FakeElement('input');
    pwdInput.type = 'password';
    fakeBody.appendChild(pwdInput);

    const result = await QuickLoginExecutor.execute({
      username: 'test',
      password: '123',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('未定位到对应的用户名输入框');
  });

  it('自定义选择器优先触发指定弹窗并完成填充', async () => {
    const customTrigger = new FakeElement('button');
    customTrigger.id = 'special-login-opener';
    customTrigger.innerText = '进入工作台';

    customTrigger.addEventListener('click', () => {
      const dialog = new FakeElement('div');
      dialog.className = 'login-dialog';

      const userModalInput = new FakeElement('input');
      userModalInput.type = 'text';
      userModalInput.name = 'user';
      dialog.appendChild(userModalInput);

      const pwdModalInput = new FakeElement('input');
      pwdModalInput.type = 'password';
      pwdModalInput.name = 'pwd';
      dialog.appendChild(pwdModalInput);

      fakeBody.appendChild(dialog);
    });

    fakeBody.appendChild(customTrigger);

    const result = await QuickLoginExecutor.execute({
      username: 'vip_user',
      password: 'vip_password',
      loginTriggerSelector: '#special-login-opener',
    });

    expect(result.success).toBe(true);
    const pwd = fakeBody.querySelector('input[type="password"]');
    expect(pwd?.value).toBe('vip_password');
  });
});
