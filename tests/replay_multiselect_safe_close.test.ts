import { describe, expect, it, vi } from 'vitest';

class FakeElement {
  tagName: string;
  className: string;
  textContent: string = '';
  innerText: string = '';
  style: any = {};
  offsetParent: any = {};
  attributes: Record<string, string> = {};

  constructor(tagName = 'DIV', className = '') {
    this.tagName = tagName;
    this.className = className;
  }

  getClientRects() {
    return [{ width: 200, height: 100, left: 100, top: 100 }];
  }

  getBoundingClientRect() {
    return { width: 200, height: 100, left: 100, top: 100 };
  }

  getAttribute(k: string) {
    return this.attributes[k] || null;
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  querySelector(sel: string): any {
    return null;
  }

  querySelectorAll(sel: string): any[] {
    return [];
  }

  closest(sel: string): any {
    return null;
  }

  contains(el: any) {
    return false;
  }

  dispatchEvent(e: any) {
    return true;
  }

  scrollIntoView() {}
  click() {}
}

(globalThis as any).HTMLElement = FakeElement;
(globalThis as any).HTMLButtonElement = FakeElement;
(globalThis as any).HTMLInputElement = FakeElement;

class FakeMouseEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  constructor(type: string, init?: any) {
    this.type = type;
    this.bubbles = !!init?.bubbles;
    this.cancelable = !!init?.cancelable;
  }
}
(globalThis as any).MouseEvent = FakeMouseEvent;
(globalThis as any).PointerEvent = FakeMouseEvent;

(globalThis as any).window = {
  location: { href: 'https://test.example.com' },
  postMessage: () => {},
  addEventListener: () => {},
  setTimeout: (fn: any, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: any) => clearTimeout(id),
  getComputedStyle: () => ({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
  }),
};

(globalThis as any).chrome = {
  storage: {
    local: { get: (_: any, cb: any) => cb?.({}) },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    onMessage: { addListener: () => {} },
  },
};

(globalThis as any).history = {
  pushState: () => {},
  replaceState: () => {},
};

(globalThis as any).document = {
  documentElement: { appendChild: () => {} },
  createElement: () => new FakeElement(),
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
  addEventListener: () => {},
  referrer: '',
  title: '',
};

const { replayAction } = await import('../src/content/index');
import type { QAEvent } from '../src/shared/types/event';

describe('多选下拉框选项点击与弹窗防误关安全防护验证 (tests/replay_multiselect_safe_close.test.ts)', () => {
  it('多选下拉选项点击后，应平滑收起浮层，且绝对不误关外层弹窗', async () => {
    let modalClosed = false;
    let optionClicked = false;
    let titleClicked = false;

    // 1. 模拟外层活动弹窗
    const modalDialog = new FakeElement('DIV', 'el-dialog');
    const titleElement = new FakeElement('SPAN', 'el-dialog__title');
    titleElement.textContent = '新建用户';
    titleElement.dispatchEvent = (e: any) => {
      if (e.type === 'click' || e.type === 'mousedown') {
        titleClicked = true;
      }
      return true;
    };

    modalDialog.querySelector = (sel: string) => {
      if (sel.includes('el-dialog__title') || sel.includes('modal-title')) {
        return titleElement;
      }
      return null;
    };

    // 2. 模拟下拉浮层
    const popperDropdown = new FakeElement('DIV', 'el-select-dropdown');
    popperDropdown.style = { display: 'block' };

    const optionElement = new FakeElement('LI', 'el-select-dropdown__item');
    optionElement.textContent = '研发部';
    optionElement.innerText = '研发部';
    optionElement.setAttribute('role', 'option');
    optionElement.click = () => {
      optionClicked = true;
    };
    optionElement.closest = (sel: string) => {
      if (sel.includes('select-dropdown')) return popperDropdown;
      return null;
    };

    popperDropdown.contains = (el: any) => el === optionElement;
    popperDropdown.querySelectorAll = (sel: string) => {
      if (sel.includes('el-select-dropdown__item')) return [optionElement];
      return [];
    };

    (globalThis as any).document.querySelectorAll = (sel: string) => {
      if (sel.includes('el-dialog') || sel.includes('modal')) {
        return [modalDialog];
      }
      if (sel.includes('select-dropdown')) {
        return [popperDropdown];
      }
      if (sel.includes('button, a, option, li')) {
        return [optionElement];
      }
      return [];
    };
    (globalThis as any).document.querySelector = (sel: string) => {
      if (sel.includes('select-dropdown')) return popperDropdown;
      return null;
    };
    (globalThis as any).document.dispatchEvent = (e: any) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        modalClosed = true;
      }
    };
    (globalThis as any).document.body = {
      dispatchEvent: (e: any) => {
        if (e.key === 'Escape') modalClosed = true;
      },
    };

    const optionStep: QAEvent = {
      id: 'evt-opt-multi-1',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: 1000,
      title: '点击 研发部',
      description: '点击「研发部」',
      url: 'https://test.example.com',
      payload: {
        timestamp: 1000,
        url: 'https://test.example.com',
        tag: 'LI',
        role: 'option',
        text: '研发部',
        fieldLabel: '所属部门',
        selector: '.el-select-dropdown__item:nth-child(1)',
      },
    };

    const result = await replayAction(optionStep);

    expect(result.success).toBe(true);
    expect(optionClicked).toBe(true);
    // 弹窗未被误关
    expect(modalClosed).toBe(false);

    // 等待 150ms 检查 safeCloseDropdownPopper 是否在弹窗安全区域（标题）派发了点击收起浮层
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(titleClicked).toBe(true);
    expect(modalClosed).toBe(false);
  });

  it('当准备点击弹窗底部的确定按钮时，若浮层未闭合，遮挡防护自动触发安全收起且弹窗完好', async () => {
    let confirmClicked = false;
    let modalClosed = false;
    let safeCloseTriggered = false;

    const modalDialog = new FakeElement('DIV', 'el-dialog');
    const titleElement = new FakeElement('SPAN', 'el-dialog__title');
    titleElement.dispatchEvent = (e: any) => {
      if (e.type === 'click' || e.type === 'mousedown') {
        safeCloseTriggered = true;
      }
      return true;
    };
    modalDialog.querySelector = (sel: string) => {
      if (sel.includes('el-dialog__title') || sel.includes('modal-title')) {
        return titleElement;
      }
      return null;
    };

    const popperDropdown = new FakeElement('DIV', 'el-select-dropdown');
    popperDropdown.style = { display: 'block' };

    const confirmButton = new FakeElement('BUTTON', 'el-button el-button--primary');
    confirmButton.textContent = '确定';
    confirmButton.innerText = '确定';
    confirmButton.click = () => {
      confirmClicked = true;
    };

    (globalThis as any).document.querySelectorAll = (sel: string) => {
      if (sel.includes('el-dialog') || sel.includes('modal')) {
        return [modalDialog];
      }
      if (sel.includes('select-dropdown')) {
        return [popperDropdown];
      }
      if (sel.includes('button, a, option, li')) {
        return [confirmButton];
      }
      return [];
    };
    (globalThis as any).document.querySelector = (sel: string) => {
      if (sel.includes('select-dropdown')) return popperDropdown;
      return null;
    };
    (globalThis as any).document.dispatchEvent = (e: any) => {
      if (e.key === 'Escape') modalClosed = true;
    };
    (globalThis as any).document.body = {
      dispatchEvent: (e: any) => {
        if (e.key === 'Escape') modalClosed = true;
      },
    };

    const confirmStep: QAEvent = {
      id: 'evt-btn-confirm-1',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: 2000,
      title: '点击 确定',
      description: '点击「确定」',
      url: 'https://test.example.com',
      payload: {
        timestamp: 2000,
        url: 'https://test.example.com',
        tag: 'BUTTON',
        text: '确定',
        selector: '.el-dialog__footer .el-button--primary',
      },
    };

    const result = await replayAction(confirmStep);

    expect(result.success).toBe(true);
    expect(confirmClicked).toBe(true);
    expect(safeCloseTriggered).toBe(true);
    expect(modalClosed).toBe(false);
  });
});
