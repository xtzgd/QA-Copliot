/**
 * IMP-08: AI 网关与禅道连接验证及附件独立重试专项测试
 * 验证：只读连接检测、鉴权/超时/配置错误类型区分、支持 Task 列表发现、附件失败后仅重试上传而不重复建单
 */

import { describe, it, expect, vi } from 'vitest';
import { RemoteGatewayProviderAdapter } from '../src/ai';
import { ZentaoClient } from '../src/shared/integrations/zentao';

describe('IMP-08 外部集成连接测试与防护', () => {
  describe('AI 网关 testConnection 连通性与能力检测', () => {
    it('缺少地址或非安全协议时给出 CONFIG 错误提示', async () => {
      const adapter = new RemoteGatewayProviderAdapter('');
      const res1 = await adapter.testConnection('');
      expect(res1.success).toBe(false);
      expect(res1.errorType).toBe('CONFIG');
      expect(res1.error).toContain('请先填写');

      const res2 = await adapter.testConnection('http://external-insecure.com/api');
      expect(res2.success).toBe(false);
      expect(res2.errorType).toBe('CONFIG');
      expect(res2.error).toContain('HTTPS');
    });

    it('模拟网关鉴权失败 (HTTP 401): 正确捕获并标记 AUTH 错误', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid gateway token' }),
      });
      const adapter = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcher as any);
      const res = await adapter.testConnection();

      expect(res.success).toBe(false);
      expect(res.errorType).toBe('AUTH');
      expect(res.error).toContain('网关鉴权失败');
    });

    it('模拟网关连接成功: 返回延迟、版本号与支持的 task 列表', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: 1,
          supportedTasks: ['generate_bug', 'plan_form_fill'],
        }),
      });
      const adapter = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcher as any);
      const res = await adapter.testConnection();

      expect(res.success).toBe(true);
      expect(res.version).toBe(1);
      expect(res.supportedTasks).toEqual(['generate_bug', 'plan_form_fill']);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('模拟连接超时: 正确捕获并标记 TIMEOUT 错误', async () => {
      const mockFetcher = vi.fn().mockImplementation(() => {
        const err = new Error('The user aborted a request');
        err.name = 'AbortError';
        return Promise.reject(err);
      });
      const adapter = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcher as any);
      const res = await adapter.testConnection();

      expect(res.success).toBe(false);
      expect(res.errorType).toBe('TIMEOUT');
      expect(res.error).toContain('超时');
    });
  });

  describe('禅道客户端 testConnection 只读检测与附件单独上传', () => {
    it('缺少必要参数或使用非安全协议给出明确配置错误', async () => {
      const client1 = new ZentaoClient({
        baseUrl: '',
        token: '',
        productId: 0,
        openedBuild: ['trunk'],
      });
      const res1 = await client1.testConnection();
      expect(res1.success).toBe(false);
      expect(res1.errorType).toBe('CONFIG');

      const client2 = new ZentaoClient({
        baseUrl: 'http://zentao.remote-company.com',
        token: 'valid-token',
        productId: 10,
        openedBuild: ['trunk'],
      });
      const res2 = await client2.testConnection();
      expect(res2.success).toBe(false);
      expect(res2.errorType).toBe('CONFIG');
      expect(res2.error).toContain('HTTPS');
    });

    it('只读验证产品有效性: 请求 /api.php/v2/products/{id} 且绝不创建 Bug', async () => {
      const requestedUrls: string[] = [];
      const mockFetcher = vi.fn().mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 88, name: '核心电商平台' }),
        });
      });

      const client = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'my-token-123',
        productId: 88,
        openedBuild: ['trunk'],
      }, mockFetcher as any);

      const res = await client.testConnection();
      expect(res.success).toBe(true);
      expect(res.productName).toBe('核心电商平台');

      // 验证调用的确实是只读产品接口，未调用创建 Bug 接口
      expect(requestedUrls.length).toBe(1);
      expect(requestedUrls[0]).toBe('https://zentao.mycompany.com/api.php/v2/products/88');
      expect(requestedUrls[0]).not.toContain('/bugs');
    });

    it('禅道 Token 失效时给出 AUTH 错误；产品不存在给出 NOT_FOUND 错误', async () => {
      const mockFetcher401 = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });
      const clientAuth = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'expired-token',
        productId: 88,
        openedBuild: ['trunk'],
      }, mockFetcher401 as any);
      const resAuth = await clientAuth.testConnection();
      expect(resAuth.success).toBe(false);
      expect(resAuth.errorType).toBe('AUTH');

      const mockFetcher404 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Product not found' }),
      });
      const client404 = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'valid-token',
        productId: 999,
        openedBuild: ['trunk'],
      }, mockFetcher404 as any);
      const res404 = await client404.testConnection();
      expect(res404.success).toBe(false);
      expect(res404.errorType).toBe('NOT_FOUND');
    });

    it('单独上传截图 (uploadScreenshot): 仅上传附件，绝不重复调用建单接口', async () => {
      const requestedUrls: string[] = [];
      const mockFetcher = vi.fn().mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'success' }),
        });
      });

      const client = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'my-token',
        productId: 10,
        openedBuild: ['trunk'],
      }, mockFetcher as any);

      // base64 png 格式
      const fakeScreenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      await client.uploadScreenshot(12345, fakeScreenshot);

      expect(requestedUrls.length).toBe(1);
      expect(requestedUrls[0]).toBe('https://zentao.mycompany.com/api.php/v2/files');
      expect(requestedUrls[0]).not.toContain('/bugs');
    });

    it('[P1 回归] AI 网关返回 HTTP 200 HTML 登录页时必须判定 PROTOCOL 失败，绝不能假成功', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      });
      const adapter = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcher as any);
      const res = await adapter.testConnection();

      expect(res.success).toBe(false);
      expect(res.errorType).toBe('PROTOCOL');
      expect(res.error).toContain('HTML 页面');
    });

    it('[P1 回归] AI 网关返回空对象或缺失 supportedTasks 数组时绝不兜底假数据，直接报错', async () => {
      const mockFetcherEmpty = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });
      const adapter1 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherEmpty as any);
      const res1 = await adapter1.testConnection();
      expect(res1.success).toBe(false);
      expect(res1.errorType).toBe('PROTOCOL');
      expect(res1.error).toContain('空数据或非合法对象');

      const mockFetcherNoTasks = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ version: 1 }), // 没有 supportedTasks
      });
      const adapter2 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherNoTasks as any);
      const res2 = await adapter2.testConnection();
      expect(res2.success).toBe(false);
      expect(res2.errorType).toBe('PROTOCOL');
      expect(res2.error).toContain('supportedTasks');
    });

    it('[P1 回归] 禅道接口返回 HTTP 200 但业务状态为 fail/failed/error 时绝不假成功', async () => {
      // 场景 1: status === 'fail'
      const mockFetcherFail = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ status: 'fail', message: 'Token 权限不足' }),
      });
      const client1 = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'invalid-token',
        productId: 10,
        openedBuild: ['trunk'],
      }, mockFetcherFail as any);
      const res1 = await client1.testConnection();
      expect(res1.success).toBe(false);
      expect(res1.errorType).toBe('AUTH');
      expect(res1.error).toContain('Token 权限不足');

      // 场景 2: 未指定产品时，返回无产品空列表 { products: [] }
      const mockFetcherEmptyProducts = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ products: [] }),
      });
      const client2 = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'token-without-products',
        productId: 0,
        openedBuild: ['trunk'],
      }, mockFetcherEmptyProducts as any);
      const res2 = await client2.testConnection();
      expect(res2.success).toBe(false);
      expect(res2.errorType).toBe('FORBIDDEN');
      expect(res2.error).toContain('未读取到任何有效产品');
    });

    it('[P2 回归] 显式指定 apiVersion 为 v1 时，所有接口统一走 /api.php/v1 路径', async () => {
      const requestedUrls: string[] = [];
      const mockFetcher = vi.fn().mockImplementation((url: string) => {
        requestedUrls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ id: 66, name: '企业内部系统' }),
        });
      });

      const client = new ZentaoClient({
        baseUrl: 'https://zentao.hbisscm.com',
        token: 'token-v1',
        apiVersion: 'v1',
        productId: 66,
        openedBuild: ['trunk'],
      }, mockFetcher as any);

      const res = await client.testConnection();
      expect(res.success).toBe(true);
      expect(requestedUrls[0]).toBe('https://zentao.hbisscm.com/api.php/v1/products/66');
      expect(requestedUrls[0]).not.toContain('/v2/');
    });

    it('[P2 回归] 全程超时与 Abort 信号生效：createBug 与 uploadScreenshot 超时正确捕获', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mockFetcherAbort = vi.fn().mockRejectedValue(abortError);

      const client = new ZentaoClient({
        baseUrl: 'https://zentao.mycompany.com',
        token: 'token',
        productId: 10,
        openedBuild: ['trunk'],
      }, mockFetcherAbort as any);

      // createBug 超时
      await expect(client.createBug({
        title: '测试超时',
        severity: 'Major',
        reproductionSteps: ['步骤 1'],
        expectedResult: '期望',
        actualResult: '实际',
      }, {
        id: 'snap-1',
        url: 'https://example.com',
        timestamp: Date.now(),
        screenshot: '',
        environment: 'Chrome',
        browserInfo: {
          userAgent: 'Chrome',
          language: 'zh-CN',
          platform: 'MacIntel',
          cookieEnabled: true,
          screenResolution: '1920x1080',
          viewportSize: '1200x800',
          browserName: 'Chrome',
          browserVersion: '120.0',
          os: 'macOS',
        },
      })).rejects.toThrow('创建 Bug 请求超时');

      // uploadScreenshot 超时
      await expect(client.uploadScreenshot(100, 'data:image/png;base64,abc')).rejects.toThrow('附件上传超时');
    });

    it('[P2 回归] AI 网关严格校验协议版本 (仅支持 v1) 与任务数组元素类型 (必须为非空字符串)', async () => {
      // 场景 1: version: 999 必须拒绝
      const mockFetcherVer999 = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          version: 999,
          supportedTasks: ['generate_bug'],
        }),
      });
      const adapter1 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherVer999 as any);
      const res1 = await adapter1.testConnection();
      expect(res1.success).toBe(false);
      expect(res1.errorType).toBe('PROTOCOL');
      expect(res1.error).toContain('协议版本不受支持');

      // 场景 2: supportedTasks: [123] 包含非字符串必须拒绝
      const mockFetcherInvalidType = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          version: 1,
          supportedTasks: [123],
        }),
      });
      const adapter2 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherInvalidType as any);
      const res2 = await adapter2.testConnection();
      expect(res2.success).toBe(false);
      expect(res2.errorType).toBe('PROTOCOL');
      expect(res2.error).toContain('包含非字符串');

      // 场景 3: supportedTasks 全是不支持的任务，返回 CAPABILITY 错误
      const mockFetcherUnknownTasks = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          version: 1,
          supportedTasks: ['unknown_model_chat', 'custom_action'],
        }),
      });
      const adapter3 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherUnknownTasks as any);
      const res3 = await adapter3.testConnection();
      expect(res3.success).toBe(false);
      expect(res3.errorType).toBe('CAPABILITY');
      expect(res3.error).toContain('未包含本插件支持的任何已知任务');

      // 场景 4: 包含部分合法任务，成功提取插件支持的交集并保留声明任务
      const mockFetcherMixed = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          version: 1,
          supportedTasks: ['generate_bug', 'custom_experimental_task'],
        }),
      });
      const adapter4 = new RemoteGatewayProviderAdapter('https://ai.example.com', mockFetcherMixed as any);
      const res4 = await adapter4.testConnection();
      expect(res4.success).toBe(true);
      expect(res4.version).toBe(1);
      expect(res4.supportedTasks).toEqual(['generate_bug']);
      expect(res4.declaredTasks).toEqual(['generate_bug', 'custom_experimental_task']);
    });

    it('[P1 回归] 禅道 v1 适配器向 /products/{id}/bugs 提交，并正确解析 status=active 的 Bug 实体', async () => {
      const requestedUrls: string[] = [];
      let capturedBody: any;
      const mockFetcher = vi.fn().mockImplementation((url: string, init: any) => {
        requestedUrls.push(url);
        capturedBody = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          // 官方 v1 成功时返回 Bug 对象（status 为 active）
          json: async () => ({
            id: 9999,
            product: 88,
            title: capturedBody.title,
            status: 'active',
            openedBy: 'admin',
          }),
        });
      });

      const client = new ZentaoClient({
        baseUrl: 'https://zentao.hbisscm.com',
        token: 'token-v1-secret',
        apiVersion: 'v1',
        productId: 88,
        openedBuild: ['trunk'],
      }, mockFetcher as any);

      const res = await client.createBug({
        title: 'V1 协议测试 Bug',
        severity: 'Critical',
        reproductionSteps: ['步骤 1：打开页面', '步骤 2：点击提交'],
        expectedResult: '提交成功',
        actualResult: '报 500 错误',
      }, {
        id: 'snap-v1',
        url: 'https://zentao.hbisscm.com/test',
        timestamp: Date.now(),
        screenshot: '',
        environment: 'Chrome',
        browserInfo: {
          userAgent: 'Chrome',
          language: 'zh-CN',
          platform: 'MacIntel',
          cookieEnabled: true,
          screenResolution: '1920x1080',
          viewportSize: '1200x800',
          browserName: 'Chrome',
          browserVersion: '120.0',
          os: 'macOS',
        },
      });

      expect(res.id).toBe(9999);
      expect(res.url).toBe('https://zentao.hbisscm.com/bug-view-9999.html');
      // 验证调用的确是官方 v1 的 /products/88/bugs，绝非 /bugs
      expect(requestedUrls[0]).toBe('https://zentao.hbisscm.com/api.php/v1/products/88/bugs');
      expect(capturedBody.title).toBe('V1 协议测试 Bug');

      // 验证 v1 错误拦截：当返回业务错误对象时抛出异常
      const mockFetcherError = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: '产品 #88 不存在' }),
      });
      const clientError = new ZentaoClient({
        baseUrl: 'https://zentao.hbisscm.com',
        token: 'token-v1-secret',
        apiVersion: 'v1',
        productId: 88,
        openedBuild: ['trunk'],
      }, mockFetcherError as any);

      await expect(clientError.createBug({
        title: '失败用例',
        severity: 'Minor',
        reproductionSteps: [],
        expectedResult: '',
        actualResult: '',
      }, {
        id: 'snap-err',
        url: 'https://example.com',
        timestamp: Date.now(),
        screenshot: '',
        environment: 'Chrome',
        browserInfo: {
          userAgent: 'Chrome',
          language: 'zh-CN',
          platform: 'MacIntel',
          cookieEnabled: true,
          screenResolution: '1920x1080',
          viewportSize: '1200x800',
          browserName: 'Chrome',
          browserVersion: '120.0',
          os: 'macOS',
        },
      })).rejects.toThrow('产品 #88 不存在');
    });

    describe('方案 2：基于网页登录态 Cookie 免 Token 模式', () => {
      it('authMode="cookie" 且无 Token 时: testConnection 发起 credentials="include" 且不携带 Token 头', async () => {
        let capturedUrl = '';
        let capturedInit: RequestInit | undefined;
        const mockFetcher = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          capturedUrl = url;
          capturedInit = init;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 66, name: '供应链物流中台' }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 66,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.testConnection();
        expect(res.success).toBe(true);
        expect(res.productName).toBe('供应链物流中台');
        expect(capturedUrl).toBe('https://zentao.hbisscm.com/api.php/v2/products/66');
        expect(capturedInit?.credentials).toBe('include');
        // 关键断言：免 Token 模式下绝不附带空的 Token 破坏服务端鉴权
        expect(capturedInit?.headers).not.toHaveProperty('Token');
      });

      it('authMode="cookie" 模式下遭遇登录态失效 (HTML 登录页或 401/403): 提供直观的用户登录引导', async () => {
        // 场景 1: 返回 HTML 登录页
        const mockHtmlFetcher = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
          },
          json: async () => ({}),
        });

        const clientHtml = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          openedBuild: ['trunk'],
        }, mockHtmlFetcher as any);

        const resHtml = await clientHtml.testConnection();
        expect(resHtml.success).toBe(false);
        expect(resHtml.errorType).toBe('PROTOCOL');
        expect(resHtml.error).toContain('当前浏览器未登录禅道或会话已过期');

        // 场景 2: 返回 HTTP 401 未授权
        const mock401Fetcher = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Session expired' }),
        });

        const client401 = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          openedBuild: ['trunk'],
        }, mock401Fetcher as any);

        const res401 = await client401.testConnection();
        expect(res401.success).toBe(false);
        expect(res401.errorType).toBe('AUTH');
        expect(res401.error).toContain('禅道登录态已失效或无权限');
      });

      it('authMode="cookie" 模式下拉取产品列表与版本无需 Token', async () => {
        const mockFetcher = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (url.includes('/builds')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ([{ id: 'v1.0.0', name: 'Release 1.0.0' }]),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              products: [
                { id: 1, name: 'WMS系统' },
                { id: 2, name: 'TMS系统' },
              ],
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 1,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const prods = await client.fetchProducts();
        expect(prods.success).toBe(true);
        expect(prods.products?.length).toBe(2);
        expect(prods.products?.[0].name).toBe('WMS系统');

        const builds = await client.fetchProductBuilds(1);
        expect(builds.success).toBe(true);
        expect(builds.builds?.length).toBe(2); // trunk + Release 1.0.0
        expect(builds.builds?.[1].name).toBe('Release 1.0.0');
      });

      it('authMode="cookie" 模式下创建 Bug 发送 credentials="include" 且不要求 Token', async () => {
        let capturedInit: RequestInit | undefined;
        const mockFetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
          capturedInit = init;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 8888, status: 'success' }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 5,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.createBug({
          title: '免 Token 模式创建 Bug',
          severity: 'Critical',
          reproductionSteps: ['1. 打开页面', '2. 点击触发'],
          expectedResult: '操作成功',
          actualResult: '响应异常',
        }, {
          id: 'snap-cookie',
          url: 'https://zentao.hbisscm.com',
          timestamp: Date.now(),
          screenshot: '',
          environment: 'Chrome',
          browserInfo: {
            userAgent: 'Chrome',
            language: 'zh-CN',
            platform: 'MacIntel',
            cookieEnabled: true,
            screenResolution: '1920x1080',
            viewportSize: '1200x800',
            browserName: 'Chrome',
            browserVersion: '120.0',
            os: 'macOS',
          },
        });

        expect(res.id).toBe(8888);
        expect(capturedInit?.credentials).toBe('include');
        expect(capturedInit?.headers).not.toHaveProperty('Token');
      });

      it('authMode="token" 显式指定时，若缺少 Token 则明确给出报错阻止盲目提交', async () => {
        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'token',
          token: '',
          productId: 5,
          openedBuild: ['trunk'],
        });

        const res = await client.testConnection();
        expect(res.success).toBe(false);
        expect(res.errorType).toBe('CONFIG');
        expect(res.error).toContain('Token');
      });

      it('默认未传入 fetcher 时: 正确绑定 globalThis 上下文，防止出现 Illegal invocation 崩溃', async () => {
        // 模拟真实浏览器环境：若 this 指向 ZentaoClient 实例而非 window/globalThis，抛出 Illegal invocation
        const originalFetch = globalThis.fetch;
        let invoked = false;
        globalThis.fetch = function (this: any, input: any, init: any) {
          if (this !== globalThis && this !== undefined) {
            throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
          }
          invoked = true;
          return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: '供应链产品' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        } as any;

        try {
          const client = new ZentaoClient({
            baseUrl: 'https://zentao.hbisscm.com',
            authMode: 'cookie',
            productId: 1,
            openedBuild: ['trunk'],
          });
          const res = await client.fetchProducts();
          expect(res.success).toBe(true);
          expect(invoked).toBe(true);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
      it('能够正确解析字典键值对格式的 products 和 builds (如 PHP 关联数组转出的 JSON)', async () => {
        const mockFetcher = vi.fn().mockImplementation((url: string) => {
          if (url.includes('/builds')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              // 模拟 PHP 关联数组转出的 builds 对象: { "101": { id: 101, name: "202609-build" } }
              json: async () => ({
                builds: {
                  '101': { id: 101, name: '202609-build' },
                  '102': { id: 102, name: '202610-preview' },
                },
              }),
            });
          }
          // 模拟 PHP 关联数组转出的 products 对象: { "1": { id: 1, name: "仓储物流" } }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              products: {
                '10': { id: 10, name: '仓储物流', code: 'WMS' },
                '20': { id: 20, name: '运输调度', code: 'TMS' },
              },
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const prodRes = await client.fetchProducts();
        expect(prodRes.success).toBe(true);
        expect(prodRes.products?.length).toBe(2);
        expect(prodRes.products?.[0].name).toBe('仓储物流');
        expect(prodRes.products?.[0].code).toBe('WMS');

        const buildRes = await client.fetchProductBuilds(10);
        expect(buildRes.success).toBe(true);
        // 包含 trunk 兜底 + 2 个提取到的实际构建
        expect(buildRes.builds?.length).toBe(3);
        expect(buildRes.builds?.[0].id).toBe('trunk');
        expect(buildRes.builds?.[1].name).toBe('202609-build');
        expect(buildRes.builds?.[2].name).toBe('202610-preview');
      });

      it('能够自动翻页并聚合多页产品列表，绝不遗漏后续页面产品', async () => {
        const requestedUrls: string[] = [];
        const mockFetcher = vi.fn().mockImplementation((url: string) => {
          requestedUrls.push(url);
          const u = new URL(url);
          const page = Number(u.searchParams.get('page') || '1');

          if (page === 1) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ({
                total: 5,
                page: 1,
                limit: 2,
                totalPage: 3,
                products: [
                  { id: 1, name: '供应链协同平台' },
                  { id: 2, name: '智慧仓储管理' },
                ],
              }),
            });
          }
          if (page === 2) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ({
                total: 5,
                page: 2,
                limit: 2,
                totalPage: 3,
                products: [
                  { id: 3, name: '数字物流运力' },
                  { id: 4, name: '财务结算中心' },
                ],
              }),
            });
          }
          if (page === 3) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ({
                total: 5,
                page: 3,
                limit: 2,
                totalPage: 3,
                products: [
                  { id: 5, name: '大数据风控分析' },
                ],
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ products: [] }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 1,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProducts();
        expect(res.success).toBe(true);
        // 验证 3 页全部 5 个产品全部被完整聚合，去重且一个不少
        expect(res.products?.length).toBe(5);
        expect(res.products?.map((p) => p.name)).toEqual([
          '供应链协同平台',
          '智慧仓储管理',
          '数字物流运力',
          '财务结算中心',
          '大数据风控分析',
        ]);
        // 验证确实请求了第 1、2、3 页
        expect(requestedUrls.length).toBe(3);
        expect(requestedUrls[0]).toContain('page=1');
        expect(requestedUrls[1]).toContain('page=2');
        expect(requestedUrls[2]).toContain('page=3');
      });

      it('当返回数据少于 20 条且无 total 时，精准判定已到底部，绝不多发无效请求', async () => {
        let callCount = 0;
        const mockFetcher = vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              products: [
                { id: 88, name: '独立产品A' },
                { id: 99, name: '独立产品B' },
              ],
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 88,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProducts();
        expect(res.success).toBe(true);
        expect(res.products?.length).toBe(2);
        // 单页少于 20 条直接判定为已查全，仅发 1 次请求
        expect(callCount).toBe(1);
      });

      it('当单页达到 20 条但服务端不支持翻页返回重复数据时，自动去重并安全停止，绝不死循环', async () => {
        let callCount = 0;
        const mockFetcher = vi.fn().mockImplementation(() => {
          callCount++;
          // 生成 20 个产品模拟满页
          const mockPage = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `产品 #${i + 1}` }));
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              products: mockPage,
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 1,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProducts();
        expect(res.success).toBe(true);
        expect(res.products?.length).toBe(20);
        // 第 1 页 20 条触发翻页探测；第 2 页发现 ID 全部重复（newAdded === 0），立即安全停止
        expect(callCount).toBe(2);
      });
    });

    describe('fetchProjects 项目拉取与平滑降级', () => {
      it('优先请求 /products/{id}/projects，若成功则返回项目列表', async () => {
        const requestedUrls: string[] = [];
        const mockFetcher = vi.fn().mockImplementation((url: string) => {
          requestedUrls.push(url);
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              projects: [
                { id: 101, name: '供应链二期重构项目', code: 'SCM-V2', status: 'doing' },
                { id: 102, name: '智慧仓储PDA升级', code: 'WMS-PDA', status: 'doing' },
              ],
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProjects(10);
        expect(res.success).toBe(true);
        expect(res.projects?.length).toBe(2);
        expect(res.projects?.[0].name).toBe('供应链二期重构项目');
        expect(requestedUrls[0]).toContain('/products/10/projects');
      });

      it('若产品专用项目接口 404，平滑回退至全局 /projects 接口获取', async () => {
        const requestedUrls: string[] = [];
        const mockFetcher = vi.fn().mockImplementation((url: string) => {
          requestedUrls.push(url);
          if (url.includes('/products/10/projects')) {
            return Promise.resolve({
              ok: false,
              status: 404,
              headers: { get: () => 'application/json' },
              json: async () => ({ status: 'fail', error: 'Not Found' }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              projects: [
                { id: 201, name: '全局财务结算项目', code: 'FIN-01' },
              ],
            }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProjects(10);
        expect(res.success).toBe(true);
        expect(res.projects?.length).toBe(1);
        expect(res.projects?.[0].id).toBe(201);
        // 验证先尝试了 /products/10/projects，失败后回退请求了 /projects
        expect(requestedUrls.some((u) => u.includes('/products/10/projects'))).toBe(true);
        expect(requestedUrls.some((u) => u.includes('/projects'))).toBe(true);
      });
    });

    describe('fetchProductBuilds 多源并发聚合与 404 容灾', () => {
      it('多源聚合：同时拉取项目构建、产品发布与 trunk 兜底，单源 404 不中断', async () => {
        const requestedUrls: string[] = [];
        const mockFetcher = vi.fn().mockImplementation((url: string) => {
          requestedUrls.push(url);
          // 模拟项目构建正常返回
          if (url.includes('/projects/101/builds')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ({
                builds: [
                  { id: 'b-001', name: 'v1.0.0-rc1' },
                ],
              }),
            });
          }
          // 模拟产品发布正常返回
          if (url.includes('/products/10/releases')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: { get: () => 'application/json' },
              json: async () => ({
                releases: [
                  { id: 'rel-01', name: '2026Q3正式发版' },
                ],
              }),
            });
          }
          // 模拟以前常报 404 的 /products/10/builds
          if (url.includes('/products/10/builds')) {
            return Promise.resolve({
              ok: false,
              status: 404,
              headers: { get: () => 'application/json' },
              json: async () => ({ error: 'Not Found' }),
            });
          }
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Not Found' }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 10,
          projectId: 101,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProductBuilds(10, 101);
        expect(res.success).toBe(true);
        expect(res.builds).toBeDefined();
        // 必须包含：trunk 置顶 + 项目构建 + 产品发布，共 3 个版本
        expect(res.builds?.length).toBe(3);
        expect(res.builds?.[0].id).toBe('trunk');
        expect(res.builds?.[0].name).toBe('trunk (主干)');

        const names = res.builds?.map((b) => b.name) || [];
        expect(names.includes('v1.0.0-rc1')).toBe(true);
        expect(names.includes('2026Q3正式发版')).toBe(true);
      });

      it('当所有远程版本接口都 404 或无数据时，始终保证返回 trunk (主干)，绝不报错或返回空', async () => {
        const mockFetcher = vi.fn().mockImplementation(() => {
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Not Found' }),
          });
        });

        const client = new ZentaoClient({
          baseUrl: 'https://zentao.hbisscm.com',
          authMode: 'cookie',
          productId: 99,
          openedBuild: ['trunk'],
        }, mockFetcher as any);

        const res = await client.fetchProductBuilds(99);
        expect(res.success).toBe(true);
        expect(res.builds?.length).toBe(1);
        expect(res.builds?.[0]).toEqual({ id: 'trunk', name: 'trunk (主干)' });
      });
    });
  });
});


