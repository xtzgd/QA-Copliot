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

  it('planBrowserAction 接收 screenshotUrl 时，构造包含 image_url 的多模态请求', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');
    let capturedBody: any = null;

    const visionFetcher = async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'tap',
                  elementId: 'btn-submit',
                  reason: '视觉定位到提交按钮',
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
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o',
      },
      visionFetcher as any
    );

    const plan = await adapter.planBrowserAction({
      instruction: '点击提交按钮',
      mode: 'act',
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com',
          title: '测试页面',
          text: '欢迎提交',
          scrollY: 0,
          scrollX: 0,
          elements: [
            { id: 'btn-submit', tag: 'button', text: '提交', role: 'button' },
          ],
        },
      ],
      screenshotUrl: 'data:image/jpeg;base64,mockJpegData',
    });

    expect(plan.action).toBe('tap');
    expect((plan as any).elementId).toBe('btn-submit');
    expect(capturedBody).not.toBeNull();
    const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content.some((c: any) => c.type === 'image_url' && c.image_url.url === 'data:image/jpeg;base64,mockJpegData')).toBe(true);
    expect(userMsg.content.some((c: any) => c.type === 'text')).toBe(true);
  });

  it('planBrowserAction 遇到视觉不支持报错时自动降级重试并完成断言', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');
    let attemptCount = 0;
    const capturedBodies: any[] = [];

    const fallbackFetcher = async (_url: string, init: any) => {
      attemptCount++;
      const body = JSON.parse(init.body);
      capturedBodies.push(body);
      if (attemptCount === 1) {
        return new Response(
          JSON.stringify({
            error: { message: 'Image input is not supported for this model' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'assertion',
                  passed: true,
                  reason: '文本匹配断言通过',
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
        apiKey: 'sk-test',
        model: 'deepseek-chat',
      },
      fallbackFetcher as any
    );

    const plan = await adapter.planBrowserAction({
      instruction: '验证提交成功',
      mode: 'assert',
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com',
          title: '测试页面',
          text: '操作成功',
          scrollY: 0,
          scrollX: 0,
          elements: [],
        },
      ],
      screenshotUrl: 'data:image/jpeg;base64,mockJpegData',
    });

    expect(attemptCount).toBe(2);
    expect(plan.action).toBe('assertion');
    expect((plan as any).passed).toBe(true);
    expect(typeof capturedBodies[1].messages.find((m: any) => m.role === 'user').content).toBe('string');
  });

  it('extractJsonFromLlmResponse 能正确规避后附文本括号干扰、多对象并发、think 标签与微语法瑕疵', async () => {
    const { extractJsonFromLlmResponse } = await import('../src/ai');

    // 1. 用户现场出现的典型报错情境：JSON 后面跟着带有花括号的说明文本
    const rawWithBracesSuffix = `{"action":"finished","reason":"已根据可见页面状态完成全部表单项的填写，表单无更多未填写项"}
如果需要提交，请点击【提交】按钮。{操作提示：无需继续操作}`;
    const parsed1 = extractJsonFromLlmResponse<any>(rawWithBracesSuffix);
    expect(parsed1.action).toBe('finished');
    expect(parsed1.reason).toContain('已根据可见页面状态完成全部表单项的填写');

    // 2. 模型一次输出了两个动作对象
    const rawMultipleObjects = `{"action":"input","elementId":"elem-3","value":"张三","reason":"填写姓名"}
{"action":"tap","elementId":"elem-5","reason":"点击提交"}`;
    const parsed2 = extractJsonFromLlmResponse<any>(rawMultipleObjects);
    expect(parsed2.action).toBe('input');
    expect(parsed2.elementId).toBe('elem-3');
    expect(parsed2.value).toBe('张三');

    // 3. 模型输出了思考链标签 + 代码块 + 尾部多余逗号与注释
    const rawThinkWithCodeBlock = `<think>
用户想要填写表单，本轮进行第 4 步...
{临时分析}
</think>
\`\`\`json
{
  // 核心动作
  "action": "finished",
  "reason": "所有必填输入框已填满",
}
\`\`\`
已全部完成。`;
    const parsed3 = extractJsonFromLlmResponse<any>(rawThinkWithCodeBlock);
    expect(parsed3.action).toBe('finished');
    expect(parsed3.reason).toBe('所有必填输入框已填满');
  });

  it('planBrowserAction 遇到模型返回数组形式的动作列表时能够平滑提取首个动作', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');

    const arrayFetcher = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { action: 'input', elementId: 'elem-field-1', value: '测试数据', reason: '填写第一个输入框' },
                  { action: 'tap', elementId: 'btn-next', reason: '点击下一步' },
                ]),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapter = new OpenAILlmProviderAdapter(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o' },
      arrayFetcher as any
    );

    const plan = await adapter.planBrowserAction({
      instruction: '填写当前表单',
      mode: 'act',
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com',
          title: '表单',
          text: '姓名：',
          scrollY: 0,
          scrollX: 0,
          elements: [
            { id: 'elem-field-1', tag: 'input', role: 'textbox', name: 'name', text: '' },
          ],
        },
      ],
    });

    expect(plan.action).toBe('input');
    expect((plan as any).elementId).toBe('elem-field-1');
    expect((plan as any).value).toBe('测试数据');
  });

  it('extractJsonFromLlmResponse 能够自愈因中途截断未闭合的 JSON（解决 Unexpected end of JSON input）', async () => {
    const { extractJsonFromLlmResponse } = await import('../src/ai');

    // 缺少右花括号
    const truncated1 = '{"action":"input","elementId":"elem-3","value":"张三"';
    const parsed1 = extractJsonFromLlmResponse<any>(truncated1);
    expect(parsed1.action).toBe('input');
    expect(parsed1.value).toBe('张三');

    // 缺少右引号与花括号
    const truncated2 = '{"action":"finished","reason":"已填完所有内容';
    const parsed2 = extractJsonFromLlmResponse<any>(truncated2);
    expect(parsed2.action).toBe('finished');
    expect(parsed2.reason).toBe('已填完所有内容');

    // Markdown 代码块开门但中途被截断未关门
    const truncated3 = '```json\n{"action":"tap","elementId":"btn-submit"';
    const parsed3 = extractJsonFromLlmResponse<any>(truncated3);
    expect(parsed3.action).toBe('tap');
    expect(parsed3.elementId).toBe('btn-submit');
  });

  it('chatCompletion 在 content 为空时能够从推理模型的 reasoning_content 中回退提取动作', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');

    const reasoningFetcher = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '', // content 为空
                reasoning_content: '我分析了当前页面，决定点击提交。\n```json\n{"action":"tap","elementId":"btn-1"}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapter = new OpenAILlmProviderAdapter(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'deepseek-r1' },
      reasoningFetcher as any
    );

    const plan = await adapter.planBrowserAction({
      instruction: '点击按钮',
      mode: 'act',
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com',
          title: '测试',
          text: '',
          scrollY: 0,
          scrollX: 0,
          elements: [{ id: 'btn-1', tag: 'button', text: '提交' }],
        },
      ],
    });

    expect(plan.action).toBe('tap');
    expect((plan as any).elementId).toBe('btn-1');
  });

  it('extractBrowserPlanFromRawText 能够从包含未转义内部引号或混杂文本中稳健提取动作', async () => {
    const { extractBrowserPlanFromRawText } = await import('../src/ai');

    const rawWithInnerQuotes = `The user wants to add user.
    {
      "action": "tap",
      "elementId": "0:el-12",
      "reason": "Click the "新增" button to open modal"
    }`;

    const plan = extractBrowserPlanFromRawText(rawWithInnerQuotes);
    expect(plan).not.toBeNull();
    expect(plan?.action).toBe('tap');
    expect((plan as any)?.elementId).toBe('0:el-12');
  });

  it('inferPlanFromNaturalText 能够从大模型纯自然语言对话（如 "The user wants to add a new user... I need to click the "新增" button"）中救活并提取动作意图', async () => {
    const { inferPlanFromNaturalText } = await import('../src/ai');

    const rawNaturalResponse = 'The user wants to add a new user with all fields required. I need to click the "新增" button. Looking ';
    const context = {
      instruction: '新增个用户 字段都必填',
      mode: 'act' as const,
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com/system/user',
          title: '用户管理',
          text: '',
          scrollY: 0,
          scrollX: 0,
          elements: [
            { id: '0:el-5', tag: 'input', name: '用户名称' } as any,
            { id: '0:el-12', tag: 'button', role: 'button', name: '+ 新增', text: '新增' } as any,
          ],
        },
      ],
    };

    const plan = inferPlanFromNaturalText(rawNaturalResponse, context);
    expect(plan).not.toBeNull();
    expect(plan?.action).toBe('tap');
    expect((plan as any)?.elementId).toBe('0:el-12');
  });

  it('planBrowserAction 遇到纯英文/自然语言解释型回复时不崩溃并能成功继续执行', async () => {
    const { OpenAILlmProviderAdapter } = await import('../src/ai');

    const conversationalFetcher = async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'The user wants to add a new user with all fields required. I need to click the "新增" button. Looking at the UI, the button is ready.',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const adapter = new OpenAILlmProviderAdapter(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'vision-model' },
      conversationalFetcher as any
    );

    const plan = await adapter.planBrowserAction({
      instruction: '新增个用户 字段都必填',
      mode: 'act',
      history: [],
      observations: [
        {
          frameId: 0,
          frameUrl: 'https://example.com',
          title: '用户管理',
          text: '',
          scrollY: 0,
          scrollX: 0,
          elements: [
            { id: '0:el-1', tag: 'input', name: '用户名称' } as any,
            { id: '0:el-2', tag: 'button', role: 'button', name: '+ 新增', text: '新增' } as any,
          ],
        },
      ],
    });

    expect(plan.action).toBe('tap');
    expect((plan as any).elementId).toBe('0:el-2');
  });
});

