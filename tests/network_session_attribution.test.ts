/**
 * IMP-03: 请求生命周期和 Session 归属统一专项验证
 * 覆盖：跨会话慢请求隔离、会话结束后晚到归档、无会话残留请求隔离、幂等防重与多标签页隔离
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { TestSession } from '../src/shared/types/session';

describe('IMP-03 网络请求生命周期与 Session 归属统一', () => {
  let handleMessage: typeof import('../src/background/index').handleMessage;
  let inFlightRequests: typeof import('../src/background/index').inFlightRequests;
  let processedRequestIds: typeof import('../src/background/index').processedRequestIds;
  let db: typeof import('../src/db').db;
  let sessionRepo: typeof import('../src/db/repositories/sessionRepository').sessionRepo;
  let eventRepo: typeof import('../src/db/repositories/eventRepository').eventRepo;
  let networkRepo: typeof import('../src/db/repositories/networkRepository').networkRepo;

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
        query: vi.fn(async () => [
          { id: 101, windowId: 1, url: 'https://test.example.com/app', title: '被测页面', width: 1280, height: 720 },
        ]),
        get: vi.fn(async (id: number) => ({
          id, windowId: 1, url: 'https://test.example.com/app', title: '被测页面', width: 1280, height: 720,
        })),
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,smoke'),
        sendMessage: vi.fn(async () => ({ ready: true, networkReady: true })),
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
    ({ handleMessage, inFlightRequests, processedRequestIds } = await import('../src/background/index'));
    ({ db } = await import('../src/db'));
    ({ sessionRepo } = await import('../src/db/repositories/sessionRepository'));
    ({ eventRepo } = await import('../src/db/repositories/eventRepository'));
    ({ networkRepo } = await import('../src/db/repositories/networkRepository'));

    await db.delete();
    await db.open();
  });

  afterAll(async () => {
    await db.delete();
  });

  beforeEach(async () => {
    inFlightRequests.clear();
    processedRequestIds.clear();
    await db.networkRequests.clear();
    await db.events.clear();
    await db.sessions.clear();
  });

  it('场景 1: Session A 发起慢请求 -> 结束 A -> 开始 B -> 慢请求响应到达: 只更新 A 的记录与时间线，B 不受污染', async () => {
    // 1. 创建并开启 Session A (tabId: 101)
    const sessionA: TestSession = {
      id: 'sess-imp03-a',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Session A',
      status: 'in_progress',
      startedAt: 1000,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 101,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(sessionA);

    // 2. 在 Session A 期间发起慢请求
    const reqId = 'req-slow-1001';
    const startRes = await handleMessage({
      type: 'NETWORK_START',
      payload: {
        requestId: reqId,
        method: 'GET',
        url: 'https://example.com/api/slow-report',
        startedAt: 1500,
      },
    }, { tab: { id: 101 }, frameId: 0 } as chrome.runtime.MessageSender);
    expect(startRes).toEqual({ success: true });

    // 3. 结束 Session A
    await sessionRepo.complete('sess-imp03-a');

    // 4. 开启 Session B (同一标签页 101)
    const sessionB: TestSession = {
      id: 'sess-imp03-b',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Session B',
      status: 'in_progress',
      startedAt: 3000,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 101,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(sessionB);

    // 5. 慢请求现在返回 (耗时 2500ms，在 Session B 运行期间完成)
    const completeRes = await handleMessage({
      type: 'RECORD_NETWORK',
      payload: {
        request: {
          requestId: reqId,
          method: 'GET',
          url: 'https://example.com/api/slow-report',
          pathname: '/api/slow-report',
          status: 200,
          statusText: 'OK',
          startedAt: 1500,
          duration: 2500,
          isError: false,
          isSlow: true,
        },
      },
    }, { tab: { id: 101 }, frameId: 0 } as chrome.runtime.MessageSender) as { success?: boolean; requestId?: string };

    expect(completeRes.success).toBe(true);

    // 6. 核心断言：
    // 网络请求必须归档在 Session A
    const reqsA = await networkRepo.listBySession('sess-imp03-a');
    const reqsB = await networkRepo.listBySession('sess-imp03-b');
    expect(reqsA.length).toBe(1);
    expect(reqsA[0].url).toContain('slow-report');
    expect(reqsA[0].sessionId).toBe('sess-imp03-a');
    expect(reqsB.length).toBe(0); // B 绝对干净

    // 时间线事件的 sessionId 必须是 Session A，严禁错乱挂在 Session B
    const eventsA = await eventRepo.listBySession('sess-imp03-a');
    const eventsB = await eventRepo.listBySession('sess-imp03-b');
    expect(eventsA.length).toBe(1);
    expect(eventsA[0].sessionId).toBe('sess-imp03-a');
    expect(eventsB.length).toBe(0);

    // Session A 的统计已更新
    const updatedA = await sessionRepo.getById('sess-imp03-a');
    expect(updatedA?.stats.apiCount).toBe(1);
    expect(updatedA?.stats.errorCount).toBe(1); // 因 isSlow 为 true

    // Session B 的统计依然保持 0
    const updatedB = await sessionRepo.getById('sess-imp03-b');
    expect(updatedB?.stats.apiCount).toBe(0);
  });

  it('场景 2: Session A 发起请求 -> 结束 A -> 不开始新会话 (当前无活动会话) -> 晚到响应到达: 依然成功归档 Session A', async () => {
    // 1. 创建 Session A
    const sessionA: TestSession = {
      id: 'sess-imp03-no-active',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Session A',
      status: 'in_progress',
      startedAt: 1000,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 102,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(sessionA);

    // 2. 发起请求
    const reqId = 'req-late-2001';
    await handleMessage({
      type: 'NETWORK_START',
      payload: {
        requestId: reqId,
        method: 'POST',
        url: 'https://example.com/api/save',
        startedAt: 1200,
      },
    }, { tab: { id: 102 }, frameId: 0 } as chrome.runtime.MessageSender);

    // 3. 结束 Session A，且不开启任何新 Session
    await sessionRepo.complete('sess-imp03-no-active');
    const active = await sessionRepo.getCurrentActive();
    expect(active).toBeUndefined();

    // 4. 晚到响应到达
    const res = await handleMessage({
      type: 'RECORD_NETWORK',
      payload: {
        request: {
          requestId: reqId,
          method: 'POST',
          url: 'https://example.com/api/save',
          pathname: '/api/save',
          status: 200,
          statusText: 'OK',
          startedAt: 1200,
          duration: 3000,
          isError: false,
          isSlow: true,
        },
      },
    }, { tab: { id: 102 }, frameId: 0 } as chrome.runtime.MessageSender) as { success?: boolean };

    expect(res.success).toBe(true);

    // 验证成功归档进 Session A
    const reqs = await networkRepo.listBySession('sess-imp03-no-active');
    expect(reqs.length).toBe(1);
    expect(reqs[0].sessionId).toBe('sess-imp03-no-active');

    const events = await eventRepo.listBySession('sess-imp03-no-active');
    expect(events.length).toBe(1);
    expect(events[0].sessionId).toBe('sess-imp03-no-active');
  });

  it('场景 3: 无会话时发起的在途请求 -> 开启 Session B -> 响应到达: 绝不被错误算入 Session B', async () => {
    // 1. 当前无任何会话，页面发起网络请求 (startedAt: 800)
    const reqId = 'req-pre-session-3001';
    await handleMessage({
      type: 'NETWORK_START',
      payload: {
        requestId: reqId,
        method: 'GET',
        url: 'https://example.com/api/pre-check',
        startedAt: 800,
      },
    }, { tab: { id: 103 }, frameId: 0 } as chrome.runtime.MessageSender);

    // 2. 之后开启 Session B
    const sessionB: TestSession = {
      id: 'sess-imp03-clean-b',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Session B',
      status: 'in_progress',
      startedAt: 1500,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 103,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(sessionB);

    // 3. 残留请求此时完成响应
    const res = await handleMessage({
      type: 'RECORD_NETWORK',
      payload: {
        request: {
          requestId: reqId,
          method: 'GET',
          url: 'https://example.com/api/pre-check',
          pathname: '/api/pre-check',
          status: 200,
          statusText: 'OK',
          startedAt: 800,
          duration: 1000,
          isError: false,
          isSlow: false,
        },
      },
    }, { tab: { id: 103 }, frameId: 0 } as chrome.runtime.MessageSender) as { ignored?: boolean; reason?: string };

    // 必须被明确标记为忽略，拒绝录入
    expect(res.ignored).toBe(true);
    expect(res.reason).toContain('before session began');

    const reqsB = await networkRepo.listBySession('sess-imp03-clean-b');
    expect(reqsB.length).toBe(0); // 绝对不污染 Session B
  });

  it('场景 4: 同一 requestId 的重复完成消息幂等处理: 仅入库一次', async () => {
    const session: TestSession = {
      id: 'sess-imp03-idempotent',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Idempotent Session',
      status: 'in_progress',
      startedAt: 1000,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 104,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(session);

    const reqId = 'req-dup-4001';
    await handleMessage({
      type: 'NETWORK_START',
      payload: {
        requestId: reqId,
        method: 'GET',
        url: 'https://example.com/api/dup',
        startedAt: 1100,
      },
    }, { tab: { id: 104 }, frameId: 0 } as chrome.runtime.MessageSender);

    const payload = {
      request: {
        requestId: reqId,
        method: 'GET',
        url: 'https://example.com/api/dup',
        pathname: '/api/dup',
        status: 200,
        statusText: 'OK',
        startedAt: 1100,
        duration: 150,
        isError: false,
        isSlow: false,
      },
    };

    // 第一次到达
    const res1 = await handleMessage({
      type: 'RECORD_NETWORK',
      payload,
    }, { tab: { id: 104 }, frameId: 0 } as chrome.runtime.MessageSender) as { success?: boolean };
    expect(res1.success).toBe(true);

    // 第二次到达 (重复)
    const res2 = await handleMessage({
      type: 'RECORD_NETWORK',
      payload,
    }, { tab: { id: 104 }, frameId: 0 } as chrome.runtime.MessageSender) as { ignored?: boolean; reason?: string };
    expect(res2.ignored).toBe(true);
    expect(res2.reason).toContain('Duplicate');

    const reqs = await networkRepo.listBySession('sess-imp03-idempotent');
    expect(reqs.length).toBe(1); // 严格只有一条记录
  });

  it('场景 5: 跨标签页隔离: 非测试绑定的标签页请求被忽略', async () => {
    const session: TestSession = {
      id: 'sess-imp03-tab-isolation',
      projectId: 'proj-1',
      projectName: 'TestProject',
      environment: 'test',
      title: 'Tab Isolation Session',
      status: 'in_progress',
      startedAt: 1000,
      initialUrl: 'https://example.com/page',
      currentUrl: 'https://example.com/page',
      tabId: 105,
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(session);

    // 来自无关的 tab 999
    const res = await handleMessage({
      type: 'RECORD_NETWORK',
      payload: {
        request: {
          method: 'GET',
          url: 'https://other-site.com/api/test',
          pathname: '/api/test',
          status: 200,
          statusText: 'OK',
          startedAt: 1200,
          duration: 100,
          isError: false,
          isSlow: false,
        },
      },
    }, { tab: { id: 999 }, frameId: 0 } as chrome.runtime.MessageSender) as { ignored?: boolean; reason?: string };

    expect(res.ignored).toBe(true);
    expect(res.reason).toContain('another tab');

    const reqs = await networkRepo.listBySession('sess-imp03-tab-isolation');
    expect(reqs.length).toBe(0);
  });
});
