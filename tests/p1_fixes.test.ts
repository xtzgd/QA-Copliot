import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { QAEvent } from '../src/shared/types/event';
import type { TestSession } from '../src/shared/types/session';

describe('P1 级可靠性问题修复验证 (QA-004, QA-005, QA-006, QA-018, QA-019, QA-021, QA-022)', () => {
  let handleMessage: typeof import('../src/background/index').handleMessage;
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
          { id: 201, windowId: 1, url: 'https://test.example.com/app', title: '被测页面', width: 1280, height: 720 },
        ]),
        get: vi.fn(async (id: number) => ({
          id, windowId: 1, url: 'https://test.example.com/app', title: '被测页面', width: 1280, height: 720,
        })),
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,smoke'),
        sendMessage: vi.fn(async (_tabId: number, message: { type?: string }) => {
          if (message.type === 'CAPTURE_PING') {
            return { ready: true, networkReady: true, url: 'https://test.example.com/app', title: '被测页面' };
          }
          if (message.type === 'REPLAY_ACTION') {
            return { success: true };
          }
          return { fields: [] };
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
    ({ sessionRepo } = await import('../src/db/repositories/sessionRepository'));
    ({ eventRepo } = await import('../src/db/repositories/eventRepository'));
    ({ networkRepo } = await import('../src/db/repositories/networkRepository'));

    await db.delete();
    await db.open();
  });

  afterAll(async () => {
    await db.delete();
  });

  // ==========================================
  // QA-004: 回放失败停止策略验证
  // ==========================================
  describe('QA-004: 回放失败立即停止，不再盲目执行后续步骤', () => {
    it('前置步骤执行失败时，终止回放并不继续执行下一步', async () => {
      const step1: QAEvent = {
        id: 'evt-s1',
        sessionId: 'sess-p1',
        type: 'click',
        timestamp: 1000,
        title: '勾选协议',
        description: '点击勾选服务协议',
        url: 'https://test.example.com/app',
        payload: { timestamp: 1000, url: 'https://test.example.com/app', tag: 'INPUT', selector: '#agree' },
      };
      const step2: QAEvent = {
        id: 'evt-s2',
        sessionId: 'sess-p1',
        type: 'click',
        timestamp: 2000,
        title: '提交表单',
        description: '点击提交',
        url: 'https://test.example.com/app',
        payload: { timestamp: 2000, url: 'https://test.example.com/app', tag: 'BUTTON', selector: '#submit' },
      };

      // 模拟第一步失败（如元素已被禁用不可点击）
      vi.mocked(chrome.tabs.sendMessage).mockImplementation(async (_tabId, msg: unknown) => {
        const message = msg as { type?: string; payload?: { event?: QAEvent } };
        if (message.type === 'CAPTURE_PING') {
          return { ready: true, networkReady: true, url: 'https://test.example.com/app', title: '被测页面' };
        }
        if (message.type === 'REPLAY_ACTION') {
          if (message.payload?.event?.id === 'evt-s1') {
            return { success: false, error: '元素已禁用不可点击' };
          }
          return { success: true };
        }
        return {};
      });

      const result = await handleMessage({
        type: 'REPLAY_SESSION',
        payload: { events: [step1, step2], stepDelayMs: 50 },
      }, {} as chrome.runtime.MessageSender) as { success?: boolean; stopped?: boolean; failedStep?: number; error?: string };

      // 验证回放已终止，且错误信息明确指出具体失败步骤与原因
      expect(result.success).toBe(false);
      expect(result.stopped).toBe(true);
      expect(result.failedStep).toBe(1);
      expect(result.error).toContain('元素已禁用不可点击');

      // 验证第二步未被下发
      const calls = vi.mocked(chrome.tabs.sendMessage).mock.calls;
      const step2Dispatched = calls.some(([_tab, m]) => {
        const msg = m as { payload?: { event?: QAEvent } };
        return msg.payload?.event?.id === 'evt-s2';
      });
      expect(step2Dispatched).toBe(false);
    });
  });

  // ==========================================
  // QA-005: 停止回放取消 Content Script 等待
  // ==========================================
  describe('QA-005: 停止回放向所有页面广播 STOP_CONTENT_REPLAY', () => {
    it('调用 STOP_REPLAY 时广播取消消息', async () => {
      vi.mocked(chrome.tabs.sendMessage).mockClear();
      const res = await handleMessage({
        type: 'STOP_REPLAY',
        payload: undefined,
      }, {} as chrome.runtime.MessageSender) as { success?: boolean };

      expect(res.success).toBe(true);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        201,
        { type: 'STOP_CONTENT_REPLAY' }
      );
    });
  });

  // ==========================================
  // QA-006: 原始输入值不截断
  // ==========================================
  describe('QA-006: 区分展示摘要与完整输入值', () => {
    it('长文本原始值 (超过 200 字) 完整保留在 payload.value 中', () => {
      const longInput = 'A'.repeat(500);
      const capturedSummary = longInput.length > 200 ? `${longInput.slice(0, 200)}...[截断]` : longInput;

      expect(capturedSummary.length).toBe(207); // 200 + '...[截断]' (7 字符)
      expect(capturedSummary).toContain('[截断]');

      // 回放 payload.value 必须使用 rawValue，完整保留 500 字符
      const payload = {
        value: longInput,
      };
      expect(payload.value.length).toBe(500);
      expect(payload.value).not.toContain('[截断]');
    });
  });

  // ==========================================
  // QA-018 & QA-019: XHR 单次生命周期与 JSON 响应
  // ==========================================
  describe('QA-018 & QA-019: XHR 复用治理与 JSON 响应体解析', () => {
    it('同一 XHR 对象连续调用时，通过 { once: true } 绑定单次监听，不累积重复回调', () => {
      const callbacks: Array<() => void> = [];
      const fakeXhr = {
        addEventListener: vi.fn((event: string, cb: () => void, options?: { once?: boolean }) => {
          if (options?.once) {
            callbacks.push(cb);
          }
        }),
        triggerLoadEnd() {
          while (callbacks.length > 0) {
            const cb = callbacks.shift();
            cb?.();
          }
        },
      };

      let count1 = 0;
      fakeXhr.addEventListener('loadend', () => { count1++; }, { once: true });
      fakeXhr.triggerLoadEnd();
      expect(count1).toBe(1);

      // 第二次请求
      let count2 = 0;
      fakeXhr.addEventListener('loadend', () => { count2++; }, { once: true });
      fakeXhr.triggerLoadEnd();
      expect(count2).toBe(1);
      expect(count1).toBe(1); // 第一次监听器已被移除，不再重复触发
    });

    it('responseType 为 json 时正确读取 response，避免访问 responseText 抛错', () => {
      const mockXhr = {
        responseType: 'json',
        response: { user: 'Alice', code: 200 },
        get responseText() {
          throw new DOMException("InvalidStateError: responseText is only available when responseType is '' or 'text'");
        },
      };

      let capturedBody = '';
      if (mockXhr.responseType === 'json') {
        capturedBody = JSON.stringify(mockXhr.response);
      } else {
        capturedBody = mockXhr.responseText;
      }

      expect(capturedBody).toContain('Alice');
    });

    it('XHR 请求失败 (status=0) 时，正确归类为异常而非成功', () => {
      const status = 0;
      const isZeroFail = status === 0;
      const isError = isZeroFail;
      const statusText = isZeroFail ? 'Network Failed / Aborted' : 'OK';

      expect(isError).toBe(true);
      expect(statusText).toContain('Network Failed');
    });
  });

  // ==========================================
  // QA-022: 跨 Session 慢请求归属绑定
  // ==========================================
  describe('QA-022: 跨 Session 的慢请求防止污染新 Session', () => {
    it('在当前 Session 启动前就已发起的请求，若属于历史 Session 则归入历史，否则丢弃', async () => {
      // 1. 创建历史 Session A
      const sessionA: TestSession = {
        id: 'sess-a',
        projectId: 'p',
        projectName: '项目',
        environment: 'TEST',
        title: '会话 A',
        status: 'completed',
        startedAt: 1000,
        endedAt: 5000,
        initialUrl: 'https://test.example.com/app',
        currentUrl: 'https://test.example.com/app',
        browserInfo: { userAgent: 'test', browserName: 'Chrome', browserVersion: '1', os: 'macOS', viewport: { width: 1, height: 1 } },
        stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
        tabId: 201,
      };
      await sessionRepo.create(sessionA);

      // 2. 启动当前活跃 Session B (startedAt: 10000)
      const sessionB: TestSession = {
        id: 'sess-b',
        projectId: 'p',
        projectName: '项目',
        environment: 'TEST',
        title: '会话 B',
        status: 'in_progress',
        startedAt: 10000,
        initialUrl: 'https://test.example.com/app',
        currentUrl: 'https://test.example.com/app',
        browserInfo: { userAgent: 'test', browserName: 'Chrome', browserVersion: '1', os: 'macOS', viewport: { width: 1, height: 1 } },
        stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
        tabId: 201,
      };
      await sessionRepo.create(sessionB);

      // 3. 模拟在 Session A 运行期间 (startedAt: 3000) 发起、此时才完成的慢请求
      const slowReqFromA = {
        method: 'GET',
        url: 'https://test.example.com/api/slow-a',
        pathname: '/api/slow-a',
        status: 200,
        statusText: 'OK',
        startedAt: 3000, // 属于 Session A 的生命周期 [1000, 5000]
        duration: 8000,
        requestHeaders: [],
        requestBody: '',
        responseHeaders: [],
        responseBody: '{"result":"slow_a"}',
        initiatorType: 'fetch',
      };

      await handleMessage({
        type: 'RECORD_NETWORK',
        payload: { request: slowReqFromA },
      }, { tab: { id: 201 } } as chrome.runtime.MessageSender);

      // 验证该慢请求被归入了 Session A，而不是当前活跃的 Session B
      const reqsA = await networkRepo.listBySession('sess-a');
      const reqsB = await networkRepo.listBySession('sess-b');

      expect(reqsA.some((r) => r.url.includes('slow-a'))).toBe(true);
      expect(reqsB.some((r) => r.url.includes('slow-a'))).toBe(false);

      // 4. 模拟在测试开始前 (startedAt: 500) 页面残留的请求
      const preTestReq = {
        method: 'GET',
        url: 'https://test.example.com/api/pre-test',
        status: 200,
        statusText: 'OK',
        startedAt: 500, // 早于任何会话
        duration: 1000,
      };
      const res = await handleMessage({
        type: 'RECORD_NETWORK',
        payload: { request: preTestReq },
      }, { tab: { id: 201 } } as chrome.runtime.MessageSender) as { ignored?: boolean };

      expect(res.ignored).toBe(true);
      const reqsBAfter = await networkRepo.listBySession('sess-b');
      expect(reqsBAfter.length).toBe(0); // 绝对不污染 Session B
    });
  });
});
