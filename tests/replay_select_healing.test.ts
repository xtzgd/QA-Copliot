import { describe, expect, it, vi } from 'vitest';

// 初始化最小测试环境
(globalThis as any).window = {
  location: { href: 'https://test.example.com' },
  postMessage: () => {},
  addEventListener: () => {},
  setTimeout: (fn: any, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: any) => clearTimeout(id),
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
  querySelector: () => null,
  getElementById: () => null,
  addEventListener: () => {},
  referrer: '',
  title: '',
};

const { replayAction } = await import('../src/content/index');
import type { QAEvent } from '../src/shared/types/event';

describe('回放引擎下拉框交互与 Option 自愈展开能力验证 (tests/replay_select_healing.test.ts)', () => {
  it('当回放选择下拉选项时，若下拉框未展开导致选项未挂载，自愈机制主动激活对应表单项下拉框并完成选项选中', async () => {
    // 构建模拟 DOM 结构：
    // 页面上有一个表单项「行业类型」，里面包含一个 Element Plus 下拉框
    let dropdownOpened = false;
    let optionClicked = false;

    const selectWrapper: any = {
      tagName: 'DIV',
      className: 'el-select__wrapper',
      offsetParent: {},
      getClientRects: () => [{ width: 120, height: 32, left: 100, top: 100 }],
      getBoundingClientRect: () => ({ width: 120, height: 32, left: 100, top: 100 }),
      dispatchEvent: vi.fn(),
      click: () => {
        dropdownOpened = true;
      },
      querySelector: () => null,
      closest: (sel: string) => (sel.includes('el-select') ? selectContainer : null),
    };

    const selectContainer: any = {
      tagName: 'DIV',
      className: 'el-select',
      offsetParent: {},
      getClientRects: () => [{ width: 120, height: 32, left: 100, top: 100 }],
      getBoundingClientRect: () => ({ width: 120, height: 32, left: 100, top: 100 }),
      querySelector: (sel: string) => {
        if (sel.includes('el-select__wrapper')) return selectWrapper;
        return null;
      },
      closest: () => null,
    };

    const formItem: any = {
      tagName: 'DIV',
      className: 'el-form-item',
      textContent: '行业类型',
      offsetParent: {},
      getClientRects: () => [{ width: 300, height: 40 }],
      querySelector: (sel: string) => {
        if (sel.includes('el-select') || sel.includes('select')) return selectWrapper;
        return null;
      },
    };

    // 动态选项（只有在 dropdownOpened === true 时才能查到）
    const optionElement: any = {
      tagName: 'LI',
      className: 'el-select-dropdown__item',
      textContent: '软件服务',
      innerText: '软件服务',
      offsetParent: {},
      style: { outline: '' },
      getClientRects: () => [{ width: 100, height: 30, left: 100, top: 135 }],
      getBoundingClientRect: () => ({ width: 100, height: 30, left: 100, top: 135 }),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      click: () => {
        optionClicked = true;
      },
      getAttribute: (k: string) => (k === 'role' ? 'option' : null),
      closest: (sel: string) => (sel.includes('select-dropdown') ? {} : null),
    };

    (globalThis as any).document = {
      getElementById: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('select-dropdown')) return dropdownOpened ? {} : null;
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel.includes('form-item')) return [formItem];
        if (sel.includes('button, a, option, li')) {
          return dropdownOpened ? [optionElement] : [];
        }
        return [];
      },
      addEventListener: () => {},
    };

    const optionStep: QAEvent = {
      id: 'evt-opt-1',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: 1000,
      title: '点击 软件服务',
      description: '点击「软件服务」',
      url: 'https://test.example.com',
      payload: {
        timestamp: 1000,
        url: 'https://test.example.com',
        tag: 'LI',
        role: 'option',
        text: '软件服务',
        fieldLabel: '行业类型',
        selector: '.el-select-dropdown__item:nth-child(1)',
      },
    };

    const result = await replayAction(optionStep);

    // 验证自愈展开被成功触发，且选项成功被点击选中
    expect(dropdownOpened).toBe(true);
    expect(result.success).toBe(true);
    expect(optionClicked).toBe(true);
  });

  it('如果选项在超时后依然无法找到，严格模式返回错误并不谎报成功', async () => {
    (globalThis as any).document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };

    const notFoundStep: QAEvent = {
      id: 'evt-opt-2',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: 1000,
      title: '点击 不存在的选项',
      description: '点击「不存在的选项」',
      url: 'https://test.example.com',
      payload: {
        timestamp: 1000,
        url: 'https://test.example.com',
        tag: 'LI',
        role: 'option',
        text: '不存在的选项',
        selector: '.not-found-item',
      },
    };

    const result = await replayAction(notFoundStep);

    expect(result.success).toBe(false);
    expect(result.error).toContain('找不到元素');
  }, 12000);
});
