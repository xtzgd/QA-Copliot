import { describe, expect, it } from 'vitest';

// 初始化 Node 测试环境下的最小全局对象，避免 index.ts 顶层执行报错
(globalThis as any).window = {
  location: { href: 'https://test.example.com' },
  postMessage: () => {},
  addEventListener: () => {},
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
  createElement: () => ({ style: {}, dataset: {} }),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const { describeClickElement } = await import('../src/shared/tools/elementLabel');
const { findClickTarget } = await import('../src/content/index');
import type { ClickEventPayload } from '../src/shared/types/event';

// 轻量 DOM 节点模拟器
class MockElement {
  tagName: string;
  id: string = '';
  className: string = '';
  innerText: string = '';
  textContent: string = '';
  attributes: Record<string, string> = {};
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  offsetParent: any = {};

  constructor(tagName: string, props: Partial<MockElement> = {}) {
    this.tagName = tagName.toUpperCase();
    Object.assign(this, props);
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    if (k in this.attributes) return this.attributes[k];
    if (k === 'id') return this.id || null;
    return null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getClientRects() {
    return [{ width: 100, height: 30 }];
  }
}

describe('回放点击目标定位算法 (findClickTarget) 健壮性验证', () => {
  it('多行文本节点点击时，describeClickElement 自动提炼首行作为主标题', () => {
    const mockSubmenu = new MockElement('li', {
      className: 'el-submenu',
      innerText: '融资管理\n额度\n融资认证 (新)额度管理\n企业信息变更申请\n额度调整\n额度审核',
    });

    const desc = describeClickElement(mockSubmenu);
    expect(desc.text).toBe('融资管理');
    expect(desc.title).toBe('点击 融资管理');
    expect(desc.description).toBe('点击「融资管理」');
  });

  it('针对历史已录制的多项拼接文本，回放时页面菜单处于折叠状态（文本仅第一项），也能通过前缀/包含关系成功定位', () => {
    // 模拟全局 document 环境
    const menuLi = new MockElement('li', {
      className: 'el-submenu',
      innerText: '融资管理',
    });

    const originalGetElementById = (globalThis as any).document?.getElementById;
    const originalQuerySelector = (globalThis as any).document?.querySelector;
    const originalQuerySelectorAll = (globalThis as any).document?.querySelectorAll;
    const originalEvaluate = (globalThis as any).document?.evaluate;

    try {
      (globalThis as any).document = {
        getElementById: () => null,
        querySelector: (sel: string) => (sel.includes('el-submenu') ? menuLi : null),
        querySelectorAll: (sel: string) => (sel.includes('el-submenu') ? [menuLi] : []),
        evaluate: () => ({ singleNodeValue: menuLi }),
      };

      const payload: ClickEventPayload = {
        tag: 'LI',
        text: '融资管理 额度 融资认证 (新)额度管理 企业信息变更申请 额度调整 额度审核',
        selector: 'li.el-submenu:nth-of-type(2)',
        xpath: '/html/body/div/ul/li[2]',
        url: 'https://test.example.com',
        timestamp: 100,
      };

      const target = findClickTarget(payload);
      expect(target).toBe(menuLi);
    } finally {
      if ((globalThis as any).document) {
        (globalThis as any).document.getElementById = originalGetElementById;
        (globalThis as any).document.querySelector = originalQuerySelector;
        (globalThis as any).document.querySelectorAll = originalQuerySelectorAll;
        (globalThis as any).document.evaluate = originalEvaluate;
      }
    }
  });

  it('当文本因截断或轻微变动无法完全匹配时，非 option 常规元素的唯一选择器或 XPath 仍能保底命中目标', () => {
    const button = new MockElement('button', {
      className: 'el-button',
      innerText: '保存并提交审核 (V2.0.1)',
    });

    try {
      (globalThis as any).document = {
        getElementById: () => null,
        querySelector: (sel: string) => (sel.includes('el-button') ? button : null),
        querySelectorAll: (sel: string) => (sel.includes('el-button') ? [button] : []),
        evaluate: () => ({ singleNodeValue: button }),
      };

      const payload: ClickEventPayload = {
        tag: 'BUTTON',
        text: '保存并提交审核',
        selector: 'button.el-button',
        xpath: '/html/body/div/button',
        url: 'https://test.example.com',
        timestamp: 100,
      };

      const target = findClickTarget(payload);
      expect(target).toBe(button);
    } finally {
      // cleanup
    }
  });

  it('针对下拉选项 (isOption=true)，文本不匹配时严禁使用坐标盲点 (保持 QA-001 约束)', () => {
    try {
      (globalThis as any).document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        evaluate: () => ({ singleNodeValue: null }),
        elementFromPoint: () => new MockElement('li', { innerText: '上海市' }),
      };

      const payload: ClickEventPayload = {
        tag: 'LI',
        role: 'option',
        text: '北京市',
        selector: 'li.option:nth-of-type(1)',
        x: 100,
        y: 200,
        url: 'https://test.example.com',
        timestamp: 100,
      };

      const target = findClickTarget(payload);
      expect(target).toBeNull();
    } finally {
      // cleanup
    }
  });

  it('当目标是隐藏折叠的下拉选项 (role="option" / el-select-dropdown__item) 时，replayAction 穿透点击并成功执行', async () => {
    const { replayAction } = await import('../src/content/index');
    let clicked = false;
    const optionLi: any = {
      tagName: 'LI',
      className: 'el-select-dropdown__item',
      innerText: '河钢集团供应链管理有限公司',
      textContent: '河钢集团供应链管理有限公司',
      offsetParent: null,
      getClientRects: () => [],
      getAttribute: (k: string) => (k === 'role' ? 'option' : null),
      closest: (sel: string) => (sel.includes('select-dropdown') ? {} : null),
      scrollIntoView: () => {},
      style: {},
      click: () => { clicked = true; },
      dispatchEvent: () => true,
    };

    const originalQuerySelector = (globalThis as any).document.querySelector;
    const originalQuerySelectorAll = (globalThis as any).document.querySelectorAll;
    const originalGetElementById = (globalThis as any).document.getElementById;
    try {
      (globalThis as any).document = {
        getElementById: () => null,
        querySelector: () => optionLi,
        querySelectorAll: () => [optionLi],
      };

      const event: any = {
        id: 'evt-opt-1',
        type: 'click',
        title: '点击选项',
        description: '点击「河钢集团供应链管理有限公司」',
        url: 'https://test.example.com',
        payload: {
          role: 'option',
          tag: 'LI',
          text: '河钢集团供应链管理有限公司',
          selector: 'li.el-select-dropdown__item',
          url: 'https://test.example.com',
          timestamp: 100,
        },
      };

      const res = await replayAction(event);
      expect(res.success).toBe(true);
      expect(clicked).toBe(true);
    } finally {
      (globalThis as any).document.querySelector = originalQuerySelector;
      (globalThis as any).document.querySelectorAll = originalQuerySelectorAll;
      (globalThis as any).document.getElementById = originalGetElementById;
    }
  });
});
