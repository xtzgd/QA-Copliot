import { describe, it, expect } from 'vitest';
import { AIProvider, AIProviderError, AIProviderService, BugContextBuilder, RemoteGatewayProviderAdapter } from '../src/ai';
import { BugSnapshot } from '../src/shared/types/snapshot';

describe('AI Copilot 增强 (E4 - TASK-401 ~ TASK-407)', () => {
  it('AIProvider.generateBug 能从快照生成结构化初稿并包含参考建议', async () => {
    const mockSnapshot: BugSnapshot = {
      id: 'SNAP-1',
      sessionId: 'sess-1',
      createdAt: Date.now(),
      url: 'https://test.xxx.com/order/create',
      browserInfo: { userAgent: 'Chrome', browserName: 'Chrome', browserVersion: '120', os: 'macOS', viewport: { width: 1920, height: 1080 } },
      windowDurationSec: 60,
      events: [
        {
          id: '1',
          sessionId: 'sess-1',
          type: 'click',
          timestamp: Date.now() - 500,
          title: '点击提交',
          description: '点击「提交订单」',
          url: 'https://test.xxx.com/order/create',
          payload: { timestamp: Date.now(), url: 'https://test.xxx.com/order/create' },
        },
      ],
      networkRequests: [
        {
          id: 'req-1',
          sessionId: 'sess-1',
          method: 'POST',
          url: 'https://test.xxx.com/api/order/create',
          pathname: '/api/order/create',
          status: 500,
          startedAt: Date.now(),
          duration: 350,
          responseBody: '{"code":50001,"error":"stock limit"}',
          isError: true,
          isSlow: false,
        },
        {
          id: 'req-static',
          sessionId: 'sess-1',
          method: 'GET',
          url: 'https://test.xxx.com/logo.png',
          pathname: '/logo.png',
          status: 404,
          startedAt: Date.now(),
          duration: 30,
          mimeType: 'image/png',
          isError: true,
          isSlow: false,
        },
      ],
      consoleErrors: [],
      summary: { eventCount: 1, requestCount: 1, errorCount: 1 },
    };

    const draft = await AIProvider.generateBug(mockSnapshot);

    expect(draft.severity).toBe('Critical');
    expect(draft.title).toContain('/api/order/create');
    expect(draft.title).toContain('500');
    expect(draft.reproductionSteps).toContain('点击「提交订单」');
    expect(draft.aiAnalysis).toContain('疑似原因');

    const context = BugContextBuilder.build(mockSnapshot, 50);
    expect(context.snapshotId).toBe(mockSnapshot.id);
    expect(context.actions.length).toBeGreaterThan(0);
    expect(context.requests.every((request) => (request.responseBody?.length || 0) <= 50)).toBe(true);
    expect(context.requests.map((request) => request.pathname)).not.toContain('/logo.png');
    expect(draft.aiAnalysis).toContain('排查建议');
  });

  it('Provider 可以关闭且不影响非 AI 主链路', async () => {
    const service = new AIProviderService();
    service.configure('disabled');
    expect(service.mode).toBe('disabled');
    await expect(service.generateBug({} as BugSnapshot)).rejects.toEqual(
      expect.objectContaining<Partial<AIProviderError>>({ code: 'DISABLED' })
    );
    service.configure('heuristic');
    expect(service.activeProvider.label).toBe('本地规则');
    await expect(service.analyzeIssue({
      networkRequests: [],
      consoleErrors: [],
      events: [],
      url: 'https://example.test',
    } as BugSnapshot)).resolves.toContain('疑似原因');
  });

  it('远程网关接收完整 Context，且不携带浏览器凭据', async () => {
    let capturedInit: RequestInit | undefined;
    const adapter = new RemoteGatewayProviderAdapter('http://localhost:8787/qa-copilot', async (_input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ data: {
        title: '提交失败', severity: 'Major', reproductionSteps: ['点击提交'],
        expectedResult: '成功', actualResult: '失败', aiAnalysis: '仅供参考',
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const snapshot = {
      id: 'snap-remote', url: 'https://example.test', events: [], consoleErrors: [],
      networkRequests: [{
        id: 'req', sessionId: 'sess', method: 'POST', url: 'https://example.test/api', pathname: '/api',
        status: 500, startedAt: 1, duration: 10, isError: true, isSlow: false,
        requestBody: '{"token":"raw-secret","name":"qa"}',
      }],
    } as BugSnapshot;

    await expect(adapter.generateBug(snapshot)).resolves.toEqual(expect.objectContaining({ title: '提交失败' }));
    expect(capturedInit?.credentials).toBe('omit');
    expect(capturedInit?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(String(capturedInit?.body)).toContain('raw-secret');
    expect(JSON.parse(String(capturedInit?.body))).toEqual(expect.objectContaining({ version: 1, task: 'generate_bug' }));
  });

  it('normalizeLlmEndpoint 正确规范化各种形式的大模型 Base URL', async () => {
    const { normalizeLlmEndpoint } = await import('../src/ai');
    expect(normalizeLlmEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(normalizeLlmEndpoint('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(normalizeLlmEndpoint('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions');
    expect(normalizeLlmEndpoint('http://localhost:11434/v1')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('extractJsonFromLlmResponse 能够从大模型包裹的 Markdown 代码块或文本中稳健提取 JSON', async () => {
    const { extractJsonFromLlmResponse } = await import('../src/ai');
    const rawWithMarkdown = '好的，生成如下：\n```json\n{"title":"支付异常","severity":"Critical"}\n```\n祝您使用愉快！';
    const parsed = extractJsonFromLlmResponse<{ title: string; severity: string }>(rawWithMarkdown);
    expect(parsed.title).toBe('支付异常');
    expect(parsed.severity).toBe('Critical');
  });

  it('OpenAILlmProviderAdapter 正确发送 OpenAI Chat Completions 协议并携带 Bearer API Key', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');
    let capturedUrl = '';
    let capturedHeaders: any;
    let capturedBody: any;

    const mockFetcher = async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: '订单创建接口 500 严重错误',
                  severity: 'Blocker',
                  reproductionSteps: ['进入页面', '点击提交'],
                  expectedResult: '订单创建成功',
                  actualResult: '返回 500 内部服务错误',
                  aiAnalysis: '库存服务死锁导致',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapter = new OpenAILlmProviderAdapter(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-test-secret-key',
        model: 'deepseek-chat',
      },
      mockFetcher as any
    );

    const snapshot = {
      id: 'snap-llm',
      url: 'https://test.com/pay',
      events: [{ type: 'click', description: '点击支付' }],
      networkRequests: [
        {
          id: 'req-1',
          method: 'POST',
          pathname: '/api/pay',
          status: 500,
          duration: 200,
          isError: true,
          isSlow: false,
        },
      ],
      consoleErrors: [],
    } as any;

    const result = await adapter.generateBug(snapshot);

    expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-test-secret-key');
    expect(capturedBody.model).toBe('deepseek-chat');
    expect(capturedBody.messages[0].role).toBe('system');
    expect(result.title).toBe('订单创建接口 500 严重错误');
    expect(result.severity).toBe('Blocker');
    expect(result.aiAnalysis).toContain('库存服务');
  });

  it('OpenAILlmProviderAdapter.testConnection 正确探测模型健康度及异常状态处理', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');

    // 1. 成功连通测试
    const successFetcher = async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'pong' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapterSuccess = new OpenAILlmProviderAdapter(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-valid-key',
        model: 'deepseek-chat',
      },
      successFetcher as any
    );

    const testRes = await adapterSuccess.testConnection();
    expect(testRes.success).toBe(true);
    expect(testRes.message).toContain('连接成功');
    expect(testRes.message).toContain('pong');

    // 2. 401 鉴权失败测试
    const authFailFetcher = async () => {
      return new Response(JSON.stringify({ error: 'invalid api key' }), { status: 401 });
    };

    const adapterFail = new OpenAILlmProviderAdapter(
      {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-invalid',
      },
      authFailFetcher as any
    );

    const failRes = await adapterFail.testConnection();
    expect(failRes.success).toBe(false);
    expect(failRes.error).toContain('API Key 鉴权失败 (HTTP 401)');
  });

  it('操作步骤顺序必须严格按事件发生先后正序排列，即使快照输入为倒序也自动保证第 1 步为最早操作', async () => {
    const baseTime = 1700000000000;
    const reversedEvents: QAEvent[] = [
      {
        id: 'evt-3',
        sessionId: 'sess-1',
        type: 'click',
        timestamp: baseTime + 3000,
        title: '点击提交',
        description: '点击「提交订单」',
        url: 'https://test.example.com/order',
        payload: { timestamp: baseTime + 3000, url: 'https://test.example.com/order' },
      },
      {
        id: 'evt-2',
        sessionId: 'sess-1',
        type: 'input',
        timestamp: baseTime + 2000,
        title: '输入手机号',
        description: '输入手机号「13812345678」',
        url: 'https://test.example.com/order',
        payload: { timestamp: baseTime + 2000, url: 'https://test.example.com/order' },
      },
      {
        id: 'evt-1',
        sessionId: 'sess-1',
        type: 'navigation',
        timestamp: baseTime + 1000,
        title: '进入订单页',
        description: 'https://test.example.com/order',
        url: 'https://test.example.com/order',
        payload: { timestamp: baseTime + 1000, url: 'https://test.example.com/order' },
      },
    ];

    const snapshot = {
      id: 'snap-order-test',
      sessionId: 'sess-1',
      createdAt: baseTime + 4000,
      url: 'https://test.example.com/order',
      environment: 'TEST',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
      events: reversedEvents,
      networkRequests: [],
      consoleErrors: [],
      summary: { eventCount: 3, requestCount: 0, errorCount: 0 },
    } as any;

    const draft = await AIProvider.generateBug(snapshot);
    // 第一步必须是时间最早的进入订单页，最后一步必须是点击提交订单
    expect(draft.reproductionSteps[0]).toContain('https://test.example.com/order');
    expect(draft.reproductionSteps[1]).toContain('输入手机号「13812345678」');
    expect(draft.reproductionSteps[2]).toContain('点击「提交订单」');

    const context = BugContextBuilder.build(snapshot);
    expect(context.actions[0].description).toContain('https://test.example.com/order');
    expect(context.actions[1].description).toContain('输入手机号「13812345678」');
    expect(context.actions[2].description).toContain('点击「提交订单」');
  });
});

