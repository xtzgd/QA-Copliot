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

  it('悬浮小窗置顶控制: setAlwaysOnTop, toggleAlwaysOnTop 与持久化存储', async () => {
    const mockStorage = new Map<string, string>();
    const mockChromeStorage: Record<string, any> = {};
    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockGetCurrent = vi.fn().mockResolvedValue({ id: 505 });
    const dispatchedEvents: any[] = [];

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached',
      },
      localStorage: {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
      },
      dispatchEvent: (evt: any) => dispatchedEvents.push(evt),
    };

    (global as any).chrome = {
      storage: {
        local: {
          set: vi.fn().mockImplementation((obj) => {
            Object.assign(mockChromeStorage, obj);
            return Promise.resolve();
          }),
          get: vi.fn().mockImplementation((keys, cb) => {
            if (cb) cb(mockChromeStorage);
            return Promise.resolve(mockChromeStorage);
          }),
        },
      },
      windows: {
        getCurrent: mockGetCurrent,
        update: mockUpdate,
      },
    };

    // 初始状态为 false
    expect(pipService.isAlwaysOnTop()).toBe(false);

    // 开启置顶
    const res1 = await pipService.setAlwaysOnTop(true);
    expect(res1).toBe(true);
    expect(pipService.isAlwaysOnTop()).toBe(true);
    expect(mockStorage.get('qa_copilot_always_on_top')).toBe('true');
    expect(mockChromeStorage.pipAlwaysOnTop).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(505, { focused: true });
    expect(dispatchedEvents.length).toBeGreaterThan(0);
    expect(dispatchedEvents[dispatchedEvents.length - 1].detail).toEqual({ enabled: true });

    // 切换置顶 (toggleAlwaysOnTop) -> false
    const res2 = await pipService.toggleAlwaysOnTop();
    expect(res2).toBe(false);
    expect(pipService.isAlwaysOnTop()).toBe(false);
    expect(mockStorage.get('qa_copilot_always_on_top')).toBe('false');
    expect(mockChromeStorage.pipAlwaysOnTop).toBe(false);
    expect(dispatchedEvents[dispatchedEvents.length - 1].detail).toEqual({ enabled: false });
  });

  it('detachToWindow 在已置顶状态下为新建独立窗口继承置顶配置', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 999 });
    const mockGetCurrent = vi.fn().mockResolvedValue({ id: 101 });
    const mockUpdate = vi.fn().mockResolvedValue({});

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html',
      },
      close: vi.fn(),
      localStorage: {
        getItem: () => 'true',
        setItem: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };

    (global as any).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://mock/${path}`,
      },
      windows: {
        getCurrent: mockGetCurrent,
        create: mockCreate,
        update: mockUpdate,
      },
      storage: {
        local: {
          set: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({ pipAlwaysOnTop: true }),
        },
      },
    };

    const detachedService = new PipService();
    await detachedService.setAlwaysOnTop(true);

    const res = await detachedService.detachToWindow();
    expect(res).toBe(true);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(999, { alwaysOnTop: true });
  });

  it('置顶状态切换稳定性：原地状态切换，不跳跃、不销毁 DOM 节点', async () => {
    const mockStorage = new Map<string, string>();
    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockGetCurrent = vi.fn().mockResolvedValue({ id: 707 });

    (global as any).window = {
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached',
      },
      localStorage: {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
      },
      dispatchEvent: vi.fn(),
    };

    (global as any).chrome = {
      storage: {
        local: {
          set: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
        },
      },
      windows: {
        getCurrent: mockGetCurrent,
        update: mockUpdate,
      },
    };

    const service = new PipService();
    expect(service.isAlwaysOnTop()).toBe(false);

    // 开启置顶：原地激活焦点与属性，不产生新窗口
    const on1 = await service.setAlwaysOnTop(true);
    expect(on1).toBe(true);
    expect(service.isAlwaysOnTop()).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(707, { focused: true });

    // 再次切换：平滑解除置顶，不触发任何跳转
    const on2 = await service.toggleAlwaysOnTop();
    expect(on2).toBe(false);
    expect(service.isAlwaysOnTop()).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(707, { alwaysOnTop: false });
  });

  it('Document Picture-in-Picture 深度集成：开启原生置顶、复制样式、关闭时精确恢复坐标与尺寸', async () => {
    let pageHideHandler: (() => void) | null = null;
    const mockPipDoc = {
      title: '',
      head: {
        appendChild: vi.fn(),
      },
      body: {
        className: '',
        style: { cssText: '' },
      },
    };

    const mockPipWin = {
      document: mockPipDoc,
      screenX: 850,
      screenY: 220,
      outerWidth: 430,
      outerHeight: 760,
      addEventListener: vi.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'pagehide') {
          pageHideHandler = handler;
        }
      }),
      close: vi.fn().mockImplementation(() => {
        if (pageHideHandler) pageHideHandler();
      }),
    };

    const mockRequestWindow = vi.fn().mockResolvedValue(mockPipWin);
    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockGetCurrent = vi.fn().mockResolvedValue({ id: 808 });

    (global as any).document = {
      querySelectorAll: vi.fn().mockReturnValue([]),
      styleSheets: [],
      body: { className: 'bg-slate-50', style: { cssText: '' } },
    };

    (global as any).window = {
      innerWidth: 420,
      innerHeight: 750,
      location: {
        href: 'chrome-extension://mock/sidepanel/index.html?mode=detached',
      },
      documentPictureInPicture: {
        requestWindow: mockRequestWindow,
      },
      dispatchEvent: vi.fn(),
    };

    (global as any).chrome = {
      windows: {
        getCurrent: mockGetCurrent,
        update: mockUpdate,
      },
      storage: {
        local: {
          set: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
        },
      },
    };

    const service = new PipService();
    const pipStates: any[] = [];
    service.subscribePip((win) => pipStates.push(win));

    // 1. 开启 Document PiP 置顶
    const success = await service.setAlwaysOnTop(true);
    expect(success).toBe(true);
    expect(service.isAlwaysOnTop()).toBe(true);
    expect(service.getPipWindow()).toBe(mockPipWin as any);
    expect(mockRequestWindow).toHaveBeenCalled();
    // 验证父窗口最小化以避免双窗冗余
    expect(mockUpdate).toHaveBeenCalledWith(808, { state: 'minimized' });
    expect(pipStates[pipStates.length - 1]).toBe(mockPipWin);

    // 2. 关闭 PiP 置顶：验证父窗口在 PiP 所在的精确坐标与尺寸处被还原，杜绝跳动
    await service.setAlwaysOnTop(false);
    expect(mockPipWin.close).toHaveBeenCalled();
    expect(service.isAlwaysOnTop()).toBe(false);
    expect(service.getPipWindow()).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(808, {
      state: 'normal',
      focused: true,
      left: 850,
      top: 220,
      width: 430,
      height: 760,
    });
    expect(pipStates[pipStates.length - 1]).toBeNull();
  });
});
