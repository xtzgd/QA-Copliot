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

const { replayAction, findClickTarget, isDatePickerEvent } = await import('../src/content/index');
import type { QAEvent } from '../src/shared/types/event';

describe('回放引擎日期选择器交互与日历单元格定位能力验证 (tests/replay_date_picker.test.ts)', () => {
  it('isDatePickerEvent 能精准识别日期相关的点击事件', () => {
    const dateEvent1: QAEvent = {
      id: 'step-1',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: Date.now(),
      title: '点击 30',
      description: '点击「30」',
      url: 'https://test.example.com',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com',
        tag: 'SPAN',
        text: '30',
        fieldLabel: '创建时间',
        selector: '.el-picker-panel .el-date-table td div span',
      },
    };
    expect(isDatePickerEvent(dateEvent1)).toBe(true);

    const normalButtonEvent: QAEvent = {
      id: 'step-2',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: Date.now(),
      title: '点击 搜索',
      description: '点击「搜索」',
      url: 'https://test.example.com',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com',
        tag: 'BUTTON',
        text: '搜索',
        selector: '.el-button--primary',
      },
    };
    expect(isDatePickerEvent(normalButtonEvent)).toBe(false);
  });

  it('在活动日历浮层中存在多个「30」（如上月末 30 与本月末 30）时，能够自动排除 prev-month 干扰并精准选中当月有效日期单元格', () => {
    // 模拟 Element Plus / Element UI 双月份日期范围选择器 DOM
    let cell30Clicked = false;

    // 上月末 30 (8月30日)
    const prevMonth30: any = {
      tagName: 'TD',
      className: 'el-date-table__cell prev-month',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 32, height: 32 }],
      getBoundingClientRect: () => ({ width: 32, height: 32 }),
      querySelector: () => null,
    };

    // 当月末 30 (9月30日 - 用户真正要选中的目标)
    const currentMonth30Span: any = {
      tagName: 'SPAN',
      className: 'el-date-table-cell__text',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 24, height: 24 }],
      getBoundingClientRect: () => ({ width: 24, height: 24 }),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      click: () => {
        cell30Clicked = true;
      },
    };

    const currentMonth30Td: any = {
      tagName: 'TD',
      className: 'el-date-table__cell available',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 32, height: 32 }],
      getBoundingClientRect: () => ({ width: 32, height: 32 }),
      querySelector: (sel: string) => (sel.includes('span') ? currentMonth30Span : null),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      click: () => {
        cell30Clicked = true;
      },
    };

    // 左侧 9 月份日历面板
    const leftPanel: any = {
      tagName: 'DIV',
      className: 'el-date-range-picker__content is-left',
      offsetParent: {},
      getClientRects: () => [{ width: 260, height: 260 }],
      getBoundingClientRect: () => ({ width: 260, height: 260 }),
      querySelectorAll: (sel: string) => {
        if (sel.includes('td') || sel.includes('cell')) return [prevMonth30, currentMonth30Td];
        return [];
      },
      querySelector: () => null,
    };

    // 日期选择器 Popper 浮层
    const popperEl: any = {
      tagName: 'DIV',
      className: 'el-picker__popper el-popper',
      offsetParent: {},
      getClientRects: () => [{ width: 550, height: 300, left: 200, top: 150 }],
      getBoundingClientRect: () => ({ width: 550, height: 300, left: 200, top: 150 }),
      contains: (el: any) => el === prevMonth30 || el === currentMonth30Td || el === currentMonth30Span || el === leftPanel,
      querySelectorAll: (sel: string) => {
        if (sel.includes('el-date-range-picker__content') || sel.includes('table')) return [leftPanel];
        if (sel.includes('td') || sel.includes('cell')) return [prevMonth30, currentMonth30Td];
        if (sel.includes('button')) return [];
        return [];
      },
      querySelector: () => null,
    };

    // 挂载到 document
    (globalThis as any).document.querySelectorAll = vi.fn((sel: string) => {
      if (sel.includes('el-picker__popper') || sel.includes('picker')) return [popperEl];
      if (sel.includes('dialog') || sel.includes('modal')) return [];
      return [];
    });

    const target = findClickTarget({
      timestamp: Date.now(),
      url: 'https://test.example.com',
      tag: 'SPAN',
      text: '30',
      fieldLabel: '创建时间',
      selector: '.el-date-range-picker__content.is-left table td:nth-of-type(4) span',
    });

    expect(target).not.toBeNull();
    expect(target === currentMonth30Span || target === currentMonth30Td).toBe(true);
  });

  it('一键回放日期步骤时，若日历浮层处于打开状态，能够平滑定位并成功完成点击', async () => {
    let cellClicked = false;

    const spanEl: any = {
      tagName: 'SPAN',
      className: 'el-date-table-cell__text',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 24, height: 24 }],
      getBoundingClientRect: () => ({ width: 24, height: 24 }),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      style: { outline: '' },
      click: () => {
        cellClicked = true;
      },
    };

    const tdEl: any = {
      tagName: 'TD',
      className: 'el-date-table__cell available',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 32, height: 32 }],
      getBoundingClientRect: () => ({ width: 32, height: 32 }),
      querySelector: () => spanEl,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      style: { outline: '' },
      click: () => {
        cellClicked = true;
      },
    };

    const panel: any = {
      tagName: 'DIV',
      className: 'el-date-range-picker__content is-left',
      offsetParent: {},
      getClientRects: () => [{ width: 260, height: 260 }],
      getBoundingClientRect: () => ({ width: 260, height: 260 }),
      querySelectorAll: (sel: string) => (sel.includes('td') ? [tdEl] : []),
      querySelector: () => null,
    };

    const popperEl: any = {
      tagName: 'DIV',
      className: 'el-picker__popper',
      offsetParent: {},
      getClientRects: () => [{ width: 550, height: 300, left: 100, top: 100 }],
      getBoundingClientRect: () => ({ width: 550, height: 300, left: 100, top: 100 }),
      contains: () => true,
      querySelectorAll: (sel: string) => {
        if (sel.includes('el-date-range-picker__content') || sel.includes('table')) return [panel];
        if (sel.includes('td')) return [tdEl];
        return [];
      },
      querySelector: () => null,
    };

    (globalThis as any).document.querySelectorAll = vi.fn((sel: string) => {
      if (sel.includes('el-picker__popper') || sel.includes('picker')) return [popperEl];
      return [];
    });

    const replayEvent: QAEvent = {
      id: 'step-6',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: Date.now(),
      title: '点击 30',
      description: '点击「30」',
      url: 'https://test.example.com',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com',
        tag: 'SPAN',
        text: '30',
        fieldLabel: '创建时间',
        selector: '.el-date-range-picker__content.is-left table td span',
      },
    };

    const result = await replayAction(replayEvent);
    expect(result.success).toBe(true);
    expect(cellClicked).toBe(true);
  });

  it('若回放时日期组件浮层未展开，自愈机制能主动点击对应表单项日期输入框将其展开，并成功完成日期点选', async () => {
    let dateInputClicked = false;
    let cellClicked = false;

    // 页面表单项中的日期范围输入框
    const dateInput: any = {
      tagName: 'INPUT',
      className: 'el-range-input',
      placeholder: '开始日期',
      offsetParent: {},
      getClientRects: () => [{ width: 100, height: 32 }],
      getBoundingClientRect: () => ({ width: 100, height: 32 }),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      focus: vi.fn(),
      click: () => {
        dateInputClicked = true;
      },
    };

    const dateEditor: any = {
      tagName: 'DIV',
      className: 'el-date-editor el-range-editor',
      offsetParent: {},
      getClientRects: () => [{ width: 220, height: 32 }],
      getBoundingClientRect: () => ({ width: 220, height: 32 }),
      querySelector: (sel: string) => (sel.includes('input') ? dateInput : null),
      dispatchEvent: vi.fn(),
      click: () => {
        dateInputClicked = true;
      },
    };

    const formItem: any = {
      tagName: 'DIV',
      className: 'el-form-item',
      textContent: '创建时间',
      offsetParent: {},
      getClientRects: () => [{ width: 300, height: 40 }],
      querySelector: (sel: string) => (sel.includes('date') || sel.includes('picker') ? dateEditor : null),
    };

    // 动态挂载的日期单元格（在 dateInputClicked === true 后挂载）
    const cellSpan: any = {
      tagName: 'SPAN',
      className: 'el-date-table-cell__text',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 24, height: 24 }],
      getBoundingClientRect: () => ({ width: 24, height: 24 }),
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      style: { outline: '' },
      click: () => {
        cellClicked = true;
      },
    };

    const cellTd: any = {
      tagName: 'TD',
      className: 'el-date-table__cell available',
      textContent: '30',
      innerText: '30',
      offsetParent: {},
      getClientRects: () => [{ width: 32, height: 32 }],
      getBoundingClientRect: () => ({ width: 32, height: 32 }),
      querySelector: () => cellSpan,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn(),
      style: { outline: '' },
      click: () => {
        cellClicked = true;
      },
    };

    const panel: any = {
      tagName: 'DIV',
      className: 'el-date-range-picker__content',
      offsetParent: {},
      getClientRects: () => [{ width: 260, height: 260 }],
      getBoundingClientRect: () => ({ width: 260, height: 260 }),
      querySelectorAll: () => [cellTd],
      querySelector: () => null,
    };

    const popperEl: any = {
      tagName: 'DIV',
      className: 'el-picker__popper',
      offsetParent: {},
      getClientRects: () => [{ width: 550, height: 300, left: 100, top: 100 }],
      getBoundingClientRect: () => ({ width: 550, height: 300, left: 100, top: 100 }),
      contains: () => true,
      querySelectorAll: (sel: string) => {
        if (sel.includes('el-date-range-picker__content') || sel.includes('table')) return [panel];
        if (sel.includes('td')) return [cellTd];
        return [];
      },
      querySelector: () => null,
    };

    (globalThis as any).document.querySelectorAll = vi.fn((sel: string) => {
      if (sel.includes('el-form-item')) return [formItem];
      if (sel.includes('el-date-editor') || sel.includes('el-range-input')) return [dateEditor];
      if (dateInputClicked && (sel.includes('el-picker__popper') || sel.includes('picker'))) {
        return [popperEl];
      }
      return [];
    });

    const replayEvent: QAEvent = {
      id: 'step-6',
      sessionId: 'sess-1',
      type: 'click',
      timestamp: Date.now(),
      title: '点击 30',
      description: '点击「30」',
      url: 'https://test.example.com',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com',
        tag: 'SPAN',
        text: '30',
        fieldLabel: '创建时间',
        selector: '.el-date-range-picker__content table td span',
      },
    };

    const result = await replayAction(replayEvent);
    expect(dateInputClicked).toBe(true);
    expect(result.success).toBe(true);
    expect(cellClicked).toBe(true);
  });
});
