import { describe, expect, it } from 'vitest';
import { ZentaoClient } from '../src/shared/integrations/zentao';
import { BugSnapshot } from '../src/shared/types/snapshot';

describe('禅道 v2 Bug 集成', () => {
  it('按官方 v2 Schema 提交并保留原始数据', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8,
      openedBuild: ['trunk'], projectId: 2,
    }, async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({ status: 'success', id: 101 }), { status: 201 });
    });
    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com/order',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;
    const result = await client.createBug({
      title: '手机号 13812345678 提交失败', severity: 'Critical',
      reproductionSteps: ['输入手机号 13812345678', '点击提交'], expectedResult: '成功', actualResult: '返回 500',
    }, snapshot);

    expect(requestedUrl).toBe('https://zentao.example.com/api.php/v2/bugs');
    expect(requestedInit?.credentials).toBe('include');
    expect(requestedInit?.headers).toEqual(expect.objectContaining({ Token: 'session-token' }));
    const body = JSON.parse(String(requestedInit?.body));
    expect(body).toEqual(expect.objectContaining({ productID: 8, openedBuild: ['trunk'], severity: 2, project: 2 }));
    expect(JSON.stringify(body)).toContain('13812345678');
    expect(result.id).toBe(101);
  });

  it('创建 Bug 后通过 v2 files 接口关联上传截图', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
    }, async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ status: 'success', id: requests.length === 1 ? 102 : 9 }), { status: 200 });
    });
    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com', screenshotUrl: 'data:image/png;base64,eA==',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;
    const result = await client.createBug({
      title: '截图异常', severity: 'Major', reproductionSteps: [], expectedResult: '正常', actualResult: '异常',
    }, snapshot);

    expect(requests[1].url).toBe('https://zentao.example.com/api.php/v2/files');
    const form = requests[1].init?.body as FormData;
    expect(form.get('objectType')).toBe('bug');
    expect(form.get('objectID')).toBe('102');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(result.attachmentUploaded).toBe(true);
  });

  it('当附件上传返回 not allowed 时，主单成功但明确提示权限受限', async () => {
    const requests: Array<{ url: string }> = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
    }, async (input) => {
      const url = String(input);
      requests.push({ url });
      if (url.includes('/bugs') && !url.includes('/files')) {
        return new Response(JSON.stringify({ status: 'success', id: 205 }), { status: 201 });
      }
      // 模拟所有文件接口均被禅道权限组拒绝 not allowed
      return new Response(JSON.stringify({ status: 'failed', error: 'not allowed' }), { status: 403 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com', screenshotUrl: 'data:image/png;base64,eA==',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    const result = await client.createBug({
      title: '权限受限提单', severity: 'Major', reproductionSteps: [], expectedResult: '正常', actualResult: '异常',
    }, snapshot);

    expect(result.id).toBe(205);
    expect(result.attachmentUploaded).toBe(false);
    expect(result.attachmentError).toContain('not allowed');
    expect(result.attachmentError).toContain('权限');
  });

  it('uploadScreenshot 首选端点被拒时自动尝试备用端点', async () => {
    const requestedUrls: string[] = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
    }, async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === 'https://zentao.example.com/api.php/v2/files') {
        // 首选端点 403
        return new Response(JSON.stringify({ error: 'not allowed' }), { status: 403 });
      }
      if (url.includes('/bugs/301/files')) {
        // 备用端点成功
        return new Response(JSON.stringify({ status: 'success', id: 88 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    await expect(client.uploadScreenshot(301, 'data:image/png;base64,eA==')).resolves.not.toThrow();
    expect(requestedUrls).toEqual([
      'https://zentao.example.com/api.php/v2/files',
      'https://zentao.example.com/api.php/v2/bugs/301/files',
    ]);
  });

  it('提交 Bug 时按必填规范传递 assignedTo 字段到请求体', async () => {
    let capturedBody: any;
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8,
      openedBuild: ['trunk'], projectId: 2,
    }, async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: 'success', id: 108 }), { status: 201 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    await client.createBug({
      title: '指定指派人提单', severity: 'Major',
      reproductionSteps: ['步骤1'], expectedResult: '正常', actualResult: '异常',
      assignedTo: 'zhangsan',
    }, snapshot);

    expect(capturedBody).toEqual(expect.objectContaining({
      assignedTo: 'zhangsan',
      productID: 8,
      project: 2,
    }));
  });

  it('fetchUsers 支持从项目团队、全局列表与字典结构中多源解析用户', async () => {
    const urls: string[] = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, projectId: 20,
    }, async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/projects/20/team')) {
        return new Response(JSON.stringify([
          { id: 1, account: 'dev_lead', realname: '研发主管' },
          { id: 2, account: 'tester01', realname: '测试员小李' },
        ]), { status: 200 });
      }
      if (url.includes('/users')) {
        return new Response(JSON.stringify({
          users: [
            { account: 'admin', realname: '系统管理员' },
            { account: 'tester01', realname: '测试员小李' },
          ],
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const res = await client.fetchUsers({ projectId: 20 });
    expect(res.success).toBe(true);
    expect(res.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: 'dev_lead', realname: '研发主管' }),
      expect.objectContaining({ account: 'tester01', realname: '测试员小李' }),
      expect.objectContaining({ account: 'admin', realname: '系统管理员' }),
    ]));
    // 验证去重
    const testerCount = res.users?.filter((u) => u.account === 'tester01').length;
    expect(testerCount).toBe(1);
  });

  it('支持指定 1~4 级的严重程度 (severityLevel) 与优先级 (pri) 分别独立提交', async () => {
    let capturedBody: any;
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8,
      openedBuild: ['trunk'], projectId: 2,
    }, async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: 'success', id: 109 }), { status: 201 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    await client.createBug({
      title: '独立严重度与优先级测试',
      severity: 'Major', // 旧枚举
      severityLevel: 1,  // 显式指定 1 级 (致命)
      pri: 2,            // 显式指定 2 级 (高)
      reproductionSteps: ['操作1'], expectedResult: '成功', actualResult: '失败',
      assignedTo: 'lisi',
    }, snapshot);

    expect(capturedBody).toEqual(expect.objectContaining({
      severity: 1,
      pri: 2,
      assignedTo: 'lisi',
      productID: 8,
    }));
  });

  it('当提供 aiAnalysis 时，自动将疑似根因分析与排查建议写入 steps 描述中', async () => {
    let capturedBody: any;
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8,
      openedBuild: ['trunk'], projectId: 2,
    }, async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: 'success', id: 110 }), { status: 201 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    await client.createBug({
      title: 'AI 介入根因分析测试',
      severity: 'Critical',
      severityLevel: 2,
      pri: 2,
      aiAnalysis: '- 疑似原因: /api/pay 接口返回 500，订单状态冲突\n- 排查建议: 检查库存服务与分布式事务状态',
      reproductionSteps: ['点击支付按钮'],
      expectedResult: '支付成功',
      actualResult: '提示支付异常',
      assignedTo: 'wangwu',
    }, snapshot);

    expect(capturedBody.steps).toContain('[疑似根因分析与排查建议]');
    expect(capturedBody.steps).toContain('疑似原因: /api/pay 接口返回 500');
    expect(capturedBody.steps).toContain('排查建议: 检查库存服务与分布式事务状态');
  });

  it('当未提供 aiAnalysis 时，steps 描述中不包含 AI 分析区块', async () => {
    let capturedBody: any;
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8,
      openedBuild: ['trunk'], projectId: 2,
    }, async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: 'success', id: 111 }), { status: 201 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    await client.createBug({
      title: '普通 Bug 提单',
      severity: 'Major',
      reproductionSteps: ['进入页面'],
      expectedResult: '正常',
      actualResult: '失败',
    }, snapshot);

    expect(capturedBody.steps).not.toContain('[疑似根因分析与排查建议]');
  });

  it('创建 Bug 后通过 v2 files 接口关联上传录像附件', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
    }, async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ status: 'success', id: requests.length === 1 ? 112 : 10 }), { status: 200 });
    });
    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;
    const fakeRecordingBlob = new Blob(['fake-webm-data'], { type: 'video/webm' });

    const result = await client.createBug({
      title: '附带录像提交 Bug', severity: 'Major', reproductionSteps: ['步骤1'], expectedResult: '正常', actualResult: '异常',
      recordingBlob: fakeRecordingBlob,
      recordingFileName: 'test-session-recording.webm',
    }, snapshot);

    expect(result.id).toBe(112);
    expect(result.recordingUploaded).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe('https://zentao.example.com/api.php/v2/files');
    const form = requests[1].init?.body as FormData;
    expect(form.get('objectType')).toBe('bug');
    expect(form.get('objectID')).toBe('112');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('当录屏附件上传失败时，主单成功创建并返回 recordingError 提示', async () => {
    const requests: Array<{ url: string }> = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
    }, async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/bugs') && !url.includes('/files')) {
        return new Response(JSON.stringify({ status: 'success', id: 113 }), { status: 201 });
      }
      return new Response(JSON.stringify({ status: 'failed', error: 'not allowed' }), { status: 403 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;
    const fakeRecordingBlob = new Blob(['fake-webm-data'], { type: 'video/webm' });

    const result = await client.createBug({
      title: '录像附件受限提单', severity: 'Major', reproductionSteps: ['步骤1'], expectedResult: '正常', actualResult: '异常',
      recordingBlob: fakeRecordingBlob,
    }, snapshot);

    expect(result.id).toBe(113);
    expect(result.recordingUploaded).toBe(false);
    expect(result.recordingError).toContain('not allowed');
  });

  it('当创建 Bug 请求因 project 权限返回 not allowed 时，自动剔除 project 降级重试并成功创建', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
      projectId: 99, // 模拟无权限或已归档的 project
    }, async (input, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      requests.push({ url: String(input), body });
      if (body.project === 99) {
        // 模拟带 project 99 被禅道拒绝 not allowed
        return new Response(JSON.stringify({ status: 'failed', error: 'not allowed' }), { status: 403 });
      }
      return new Response(JSON.stringify({ status: 'success', id: 888 }), { status: 201 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    const result = await client.createBug({
      title: '项目越权自动降级提单', severity: 'Major', reproductionSteps: ['步骤1'], expectedResult: '正常', actualResult: '异常',
    }, snapshot);

    expect(result.id).toBe(888);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    // 第一次带了 project
    expect(requests[0].body.project).toBe(99);
    // 降级重试剔除了 project，成功建单
    expect(requests[1].body.project).toBeUndefined();
  });

  it('当首选 v2 接口返回 not allowed 时，自动尝试备用 v1 接口重试并成功创建', async () => {
    const requestedUrls: string[] = [];
    const client = new ZentaoClient({
      baseUrl: 'https://zentao.example.com', token: 'session-token', productId: 8, openedBuild: ['trunk'],
      apiVersion: 'v2',
    }, async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/api.php/v2/bugs')) {
        // v2 返回 not allowed
        return new Response(JSON.stringify({ status: 'failed', error: 'not allowed' }), { status: 403 });
      }
      if (url.includes('/api.php/v1/products/8/bugs')) {
        // v1 备选成功
        return new Response(JSON.stringify({ id: 999, status: 'active' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });

    const snapshot = {
      environment: 'TEST', url: 'https://test.example.com',
      browserInfo: { browserName: 'Chrome', browserVersion: '120', os: 'macOS' },
    } as BugSnapshot;

    const result = await client.createBug({
      title: 'v2 转 v1 备选重试提单', severity: 'Major', reproductionSteps: ['步骤1'], expectedResult: '正常', actualResult: '异常',
    }, snapshot);

    expect(result.id).toBe(999);
    expect(requestedUrls).toContain('https://zentao.example.com/api.php/v2/bugs');
    expect(requestedUrls).toContain('https://zentao.example.com/api.php/v1/products/8/bugs');
  });
});
