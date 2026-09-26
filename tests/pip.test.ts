/**
 * 悬浮小窗与侧边栏服务测试套件 tests/pip.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PipService } from '../src/sidepanel/services/pipService';

describe('悬浮小窗与侧边栏吸附服务 PipService', () => {
  let pipService: PipService;

  beforeEach(() => {
    pipService = new PipService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('正确判断是否处于独立悬浮小窗模式 isDetachedMode', () => {
    // 1. 普通侧边栏 URL
    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html',
      },
    };
    expect(pipService.isDetachedMode()).toBe(false);

    // 2. 独立小窗 URL (带 mode=detached)
    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached&hostWindowId=123',
      },
    };
    expect(pipService.isDetachedMode()).toBe(true);
  });

  it('detachToWindow 能够拉起独立小窗，并自动调用 window.close 关闭当前右侧栏', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 888 });
    const mockGetCurrent = vi.fn().mockResolvedValue({ id: 101 });
    const mockClose = vi.fn();

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html',
      },
      close: mockClose,
    };

    (global as any).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock/${path}`,
      },
      windows: {
        getCurrent: mockGetCurrent,
        create: mockCreate,
      },
    };

    const res = await pipService.detachToWindow();
    expect(res).toBe(true);

    expect(mockCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://mock/sidepanel/index.html?mode=detached&hostWindowId=101',
      type: 'popup',
      width: 420,
      height: 750,
      focused: true,
    });

    // 快进定时器，验证 window.close 被触发收起侧边栏
    vi.advanceTimersByTime(60);
    expect(mockClose).toHaveBeenCalled();
  });

  it('attachToSidePanel 根据 hostWindowId 重新唤起原生侧边栏，并关闭当前独立小窗', async () => {
    const mockOpen = vi.fn().mockResolvedValue(undefined);
    const mockClose = vi.fn();

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached&hostWindowId=202',
      },
      close: mockClose,
    };

    (global as any).chrome = {
      sidePanel: {
        open: mockOpen,
      },
    };

    await pipService.attachToSidePanel();

    expect(mockOpen).toHaveBeenCalledWith({ windowId: 202 });
    expect(mockClose).toHaveBeenCalled();
  });

  it('attachToSidePanel 若无 hostWindowId，回退查询正常窗口并唤起侧边栏', async () => {
    const mockOpen = vi.fn().mockResolvedValue(undefined);
    const mockGetAll = vi.fn().mockResolvedValue([{ id: 303 }]);
    const mockClose = vi.fn();

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached',
      },
      close: mockClose,
    };

    (global as any).chrome = {
      sidePanel: {
        open: mockOpen,
      },
      windows: {
        getAll: mockGetAll,
      },
    };

    await pipService.attachToSidePanel();

    expect(mockGetAll).toHaveBeenCalledWith({ windowTypes: ['normal'] });
    expect(mockOpen).toHaveBeenCalledWith({ windowId: 303 });
    expect(mockClose).toHaveBeenCalled();
  });
});
