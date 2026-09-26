import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { QAEvent } from '../src/shared/types/event';

describe('Background 消息处理集成链路', () => {
  let handleMessage: typeof import('../src/background/index').handleMessage;
  let db: typeof import('../src/db').db;

  beforeAll(async () => {
    const sessionStorage: Record<string, unknown> = {};
    const localStorage: Record<string, unknown> = {};
    const chromeMock = {
      runtime: {
        lastError: undefined,
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      tabs: {
        query: vi.fn(async () => [{
          id: 7,
          windowId: 1,
          url: 'https://test.example.com/order/create',
          title: '创建订单',
          width: 1280,
          height: 720,
        }]),
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,smoke'),
        sendMessage: vi.fn(async (_tabId: number, message: { type?: string }) => message.type === 'CAPTURE_PING'
          ? { ready: true, networkReady: true, url: 'https://test.example.com/order/create', title: '创建订单' }
          : message.type === 'REPLAY_ACTION'
            ? { success: true }
            : {
              fields: [{ tag: 'input', name: 'age', label: '年龄', type: 'number', required: true, min: 0, max: 120 }],
              url: 'https://test.example.com/order/create',
              title: '创建订单',
            }),
      },
      scripting: { executeScript: vi.fn(async () => []) },
      storage: {
        session: {
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(sessionStorage, value)),
          remove: vi.fn(async (key: string) => { delete sessionStorage[key]; }),
        },
        local: {
          get: vi.fn(async (defaults: Record<string, unknown>) => ({ ...defaults, ...localStorage })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(localStorage, value)),
        },
      },
    };
    vi.stubGlobal('chrome', chromeMock);
    ({ handleMessage } = await import('../src/background/index'));
    ({ db } = await import('../src/db'));
    await db.delete();
    await db.open();
  });

  afterAll(async () => {
    await db.delete();
    vi.unstubAllGlobals();
  });

  it('处理真实消息对象并拒绝其他标签页的数据', async () => {
    const started = await handleMessage({
      type: 'START_SESSION',
      payload: {
        projectId: 'proj-smoke',
        projectName: 'Smoke 项目',
        environment: 'TEST',
        title: 'Background 集成测试',
      },
    }, {} as chrome.runtime.MessageSender) as { session: { id: string; tabId?: number } };

    expect(started.session.id).toMatch(/^sess-/);
    expect(started.session.tabId).toBe(7);

    const event = {
      type: 'click',
      timestamp: Date.now(),
      title: '点击提交',
      description: '点击「提交订单」',
      url: 'https://test.example.com/order/create',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com/order/create',
        tag: 'BUTTON',
        text: '提交订单',
        selector: '#submit',
      },
    } satisfies Omit<QAEvent, 'id' | 'sessionId'>;

    const ignored = await handleMessage(
      { type: 'RECORD_EVENT', payload: { event } },
      { tab: { id: 99 } } as chrome.runtime.MessageSender
    ) as { ignored: boolean; reason: string };
    expect(ignored).toEqual({ ignored: true, reason: 'Event belongs to another tab' });

    const recorded = await handleMessage(
      { type: 'RECORD_EVENT', payload: { event } },
      { tab: { id: 7, url: event.url } } as chrome.runtime.MessageSender
    ) as { success: boolean; eventId: string };
    expect(recorded.success).toBe(true);
    expect(recorded.eventId).toMatch(/^evt-/);

    const analyzed = await handleMessage(
      { type: 'ANALYZE_PAGE', payload: undefined },
      {} as chrome.runtime.MessageSender
    ) as { fields: Array<{ label: string }> };
    expect(analyzed.fields.map((field) => field.label)).toEqual(['年龄']);

    const current = await handleMessage(
      { type: 'GET_CURRENT_SESSION', payload: undefined },
      {} as chrome.runtime.MessageSender
    ) as { session: { stats: { actionCount: number } } };
    expect(current.session.stats.actionCount).toBe(2); // 首次导航 + 点击

    const networkRecorded = await handleMessage({
      type: 'RECORD_NETWORK',
      payload: { request: {
        method: 'POST', url: 'https://test.example.com/api/order', pathname: '/api/order', status: 500,
        startedAt: Date.now(), duration: 120, requestBody: '{"token":"raw-secret"}', responseBody: '{"error":"failed"}',
        isError: true, isSlow: false, initiatorType: 'fetch',
      } },
    }, { tab: { id: 7, url: event.url } } as chrome.runtime.MessageSender) as { success: boolean };
    expect(networkRecorded.success).toBe(true);

    const captured = await handleMessage({
      type: 'CREATE_SNAPSHOT',
      payload: { sessionId: started.session.id, windowDurationSec: 30 },
    }, {} as chrome.runtime.MessageSender) as { snapshot: { id: string; events: QAEvent[]; networkRequests: Array<{ requestBody?: string }>; screenshotUrl?: string } };
    expect(captured.snapshot.events.some((item) => item.title === '点击提交')).toBe(true);
    expect(captured.snapshot.networkRequests[0]?.requestBody).toContain('raw-secret');
    expect(captured.snapshot.screenshotUrl).toBe('data:image/png;base64,smoke');
    const storedSnapshot = await db.snapshots.get(captured.snapshot.id);
    expect(storedSnapshot?.eventIds?.length).toBeGreaterThan(0);
    expect(storedSnapshot?.networkRequestIds?.length).toBe(1);
    expect(storedSnapshot?.screenshotId).toBeTruthy();

    await handleMessage(
      { type: 'STOP_SESSION', payload: { sessionId: started.session.id } },
      {} as chrome.runtime.MessageSender
    );
    const stopped = await handleMessage(
      { type: 'GET_CURRENT_SESSION', payload: undefined },
      {} as chrome.runtime.MessageSender
    ) as { session: null };
    expect(stopped.session).toBeNull();
  });

  it('拒绝在 Chrome 内部页面启动虚假的采集 Session', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{
      id: 8, windowId: 1, url: 'chrome://extensions', title: '扩展程序',
    } as chrome.tabs.Tab]);
    const result = await handleMessage({
      type: 'START_SESSION',
      payload: { projectId: 'proj', projectName: '项目', environment: 'TEST', title: '测试' },
    }, {} as chrome.runtime.MessageSender) as { error: string };
    expect(result.error).toContain('Chrome 内部页面');
  });

  it('页面采集连接失效时自动重新注入脚本', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error('Receiving end does not exist'));
    const result = await handleMessage({
      type: 'START_SESSION',
      payload: { projectId: 'proj', projectName: '项目', environment: 'TEST', title: '重连测试' },
    }, {} as chrome.runtime.MessageSender) as { session?: { id: string }; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.session?.id).toBeTruthy();
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    await handleMessage({
      type: 'STOP_SESSION', payload: { sessionId: result.session!.id },
    }, {} as chrome.runtime.MessageSender);
  });

  it('将已保存的点击步骤发送到被测标签页执行', async () => {
    const replayEvent: QAEvent = {
      id: 'evt-replay',
      sessionId: 'session-history',
      type: 'click',
      timestamp: Date.now(),
      title: '点击提交',
      description: '点击「提交订单」',
      url: 'https://test.example.com/order/create',
      payload: {
        timestamp: Date.now(),
        url: 'https://test.example.com/order/create',
        tag: 'BUTTON',
        text: '提交订单',
        selector: '#submit',
      },
    };
    const scrollEvent: QAEvent = {
      id: 'evt-scroll', sessionId: 'session-history', type: 'scroll', timestamp: replayEvent.timestamp - 1,
      title: '滚动列表', description: '列表滚动到 300', url: replayEvent.url,
      payload: {
        timestamp: replayEvent.timestamp - 1, url: replayEvent.url, target: 'element',
        selector: '[role="listbox"]', scrollTop: 300, scrollLeft: 0,
      },
    };
    const result = await handleMessage({
      type: 'REPLAY_SESSION',
      payload: { events: [replayEvent, scrollEvent], stepDelayMs: 200 },
    }, {} as chrome.runtime.MessageSender) as { success: boolean; completed: number; failures: unknown[] };

    expect(result).toMatchObject({ success: true, completed: 2, failures: [] });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'REPLAY_ACTION',
        payload: expect.objectContaining({ event: replayEvent }),
      })
    );
  });

  it('方案3：未显式指定标题时，根据活动页面标题智能生成会话名，并支持 UPDATE_SESSION_TITLE 重命名', async () => {
    // 1. 结束前置残留会话
    await handleMessage({
      type: 'STOP_SESSION',
      payload: { sessionId: 'any' },
    }, {} as chrome.runtime.MessageSender);

    // 2. 开启新会话，不传 title，当前 mock tab.title 为 '创建订单'
    const res = await handleMessage({
      type: 'START_SESSION',
      payload: {
        projectId: 'proj-shop',
        projectName: '商城系统',
        environment: 'TEST',
        title: '',
      },
    }, {} as chrome.runtime.MessageSender) as { session: { id: string; title: string } };

    expect(res.session).toBeDefined();
    // 应该智能拼成：创建订单 (商城系统-TEST)
    expect(res.session.title).toBe('创建订单 (商城系统-TEST)');

    // 3. 发送 UPDATE_SESSION_TITLE 进行重命名
    const renameRes = await handleMessage({
      type: 'UPDATE_SESSION_TITLE',
      payload: {
        sessionId: res.session.id,
        title: '验证优惠券叠加抵扣异常',
      },
    }, {} as chrome.runtime.MessageSender) as { success: boolean; title: string };

    expect(renameRes.success).toBe(true);
    expect(renameRes.title).toBe('验证优惠券叠加抵扣异常');

    // 4. 获取当前 session，验证标题已更新
    const curRes = await handleMessage({
      type: 'GET_CURRENT_SESSION',
      payload: undefined,
    }, {} as chrome.runtime.MessageSender) as { session: { id: string; title: string } };

    expect(curRes.session.title).toBe('验证优惠券叠加抵扣异常');
  });
});

