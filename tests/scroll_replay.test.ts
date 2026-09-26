import { describe, expect, it, vi } from 'vitest';

// 初始化 Node 测试环境下的最小全局对象
(globalThis as any).window = {
  location: { href: 'https://test.example.com' },
  postMessage: () => {},
  addEventListener: () => {},
  scrollTo: vi.fn(),
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
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const { findScrollTarget, replayAction } = await import('../src/content/index');
import type { QAEvent } from '../src/shared/types/event';

// 轻量 Mock DOM 元素
class MockScrollElement {
  tagName: string;
  className: string = '';
  parentElement: MockScrollElement | null = null;
  children: MockScrollElement[] = [];
  offsetParent: any = {};
  scrollTop: number = 0;
  scrollLeft: number = 0;
  scrollHeight: number = 1000;
  clientHeight: number = 200;
  scrollTo = vi.fn((opts: { top?: number; left?: number }) => {
    if (opts.top !== undefined) this.scrollTop = opts.top;
    if (opts.left !== undefined) this.scrollLeft = opts.left;
  });

  constructor(tagName: string, props: Partial<MockScrollElement> = {}) {
    this.tagName = tagName.toUpperCase();
    Object.assign(this, props);
  }

  getClientRects() {
    return [{ width: 200, height: 200 }];
  }

  matches(sel: string): boolean {
    if (sel.includes('.el-select-dropdown__wrap') && this.className.includes('el-select-dropdown__wrap')) return true;
    if (sel.includes('.el-scrollbar__wrap') && this.className.includes('el-scrollbar__wrap')) return true;
    return false;
  }
}

describe('滚动步骤回放与智能容错机制 (findScrollTarget & replayAction)', () => {
  it('当选择器包含脆弱的 :nth-of-type 且实际 DOM 索引变动时，清洗伪类并成功定位目标滚动容器', () => {
    const scrollWrap = new MockScrollElement('div', {
      className: 'el-select-dropdown__wrap el-scrollbar__wrap',
    });

    const originalQuerySelector = (globalThis as any).document.querySelector;
    const originalQuerySelectorAll = (globalThis as any).document.querySelectorAll;
    try {
      (globalThis as any).document.querySelector = vi.fn((sel: string) => {
        if (sel.includes(':nth-of-type(3)')) return null;
        return null;
      });
      (globalThis as any).document.querySelectorAll = vi.fn((sel: string) => {
        // 模拟带 :nth-of-type(3) 的精确查询查不到，清洗后查得到
        if (sel.includes(':nth-of-type(3)')) return [];
        if (sel.includes('el-select-dropdown') || sel.includes('el-scrollbar__wrap')) {
          return [scrollWrap];
        }
        return [];
      });

      const fragileSelector =
        'div.el-select-dropdown.el-popper:nth-of-type(3) > div.el-scrollbar:nth-of-type(1) > div.el-select-dropdown__wrap.el-scrollbar__wrap:nth-of-type(1)';

      const found = findScrollTarget({
        timestamp: Date.now(),
        url: 'https://test.example.com',
        target: 'element',
        selector: fragileSelector,
        scrollTop: 996,
        scrollLeft: 0,
      });

      expect(found).toBe(scrollWrap);
    } finally {
      (globalThis as any).document.querySelector = originalQuerySelector;
      (globalThis as any).document.querySelectorAll = originalQuerySelectorAll;
    }
  });

  it('如果下拉弹窗在回放时已关闭或销毁导致完全查不到元素，replayAction 优雅放行而不阻断业务流程', async () => {
    const originalQuerySelector = (globalThis as any).document.querySelector;
    const originalQuerySelectorAll = (globalThis as any).document.querySelectorAll;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      (globalThis as any).document.querySelector = vi.fn(() => null);
      (globalThis as any).document.querySelectorAll = vi.fn(() => []);

      const scrollEvent: QAEvent = {
        id: 'evt-scroll-lost',
        sessionId: 'session-1',
        type: 'scroll',
        timestamp: Date.now(),
        title: '滚动列表',
        description: '下拉选项列表 滚动到 996',
        url: 'https://test.example.com',
        payload: {
          timestamp: Date.now(),
          url: 'https://test.example.com',
          target: 'element',
          selector: 'div.el-select-dropdown.el-popper:nth-of-type(3) > div.el-scrollbar__wrap',
          scrollTop: 996,
          scrollLeft: 0,
        },
      };

      const res = await replayAction(scrollEvent);
      // 容错降级保证业务不中断
      expect(res.success).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('滚动目标未就绪或已自动关闭，安全跳过该滚动步骤以保证主流程执行')
      );
    } finally {
      (globalThis as any).document.querySelector = originalQuerySelector;
      (globalThis as any).document.querySelectorAll = originalQuerySelectorAll;
      warnSpy.mockRestore();
    }
  });

  it('找到有效滚动容器时，正常执行滚动操作', async () => {
    const scrollWrap = new MockScrollElement('div', {
      className: 'el-scrollbar__wrap',
    });

    const originalQuerySelector = (globalThis as any).document.querySelector;
    const originalQuerySelectorAll = (globalThis as any).document.querySelectorAll;
    try {
      (globalThis as any).document.querySelector = vi.fn((sel: string) => {
        if (sel === '.el-scrollbar__wrap') return scrollWrap;
        return null;
      });
      (globalThis as any).document.querySelectorAll = vi.fn(() => [scrollWrap]);

      const scrollEvent: QAEvent = {
        id: 'evt-scroll-ok',
        sessionId: 'session-1',
        type: 'scroll',
        timestamp: Date.now(),
        title: '滚动列表',
        description: '列表 滚动到 500',
        url: 'https://test.example.com',
        payload: {
          timestamp: Date.now(),
          url: 'https://test.example.com',
          target: 'element',
          selector: '.el-scrollbar__wrap',
          scrollTop: 500,
          scrollLeft: 0,
        },
      };

      const res = await replayAction(scrollEvent);
      expect(res.success).toBe(true);
      expect(scrollWrap.scrollTo).toHaveBeenCalledWith({ top: 500, left: 0, behavior: 'auto' });
    } finally {
      (globalThis as any).document.querySelector = originalQuerySelector;
      (globalThis as any).document.querySelectorAll = originalQuerySelectorAll;
    }
  });
});
