import { describe, expect, it, vi } from 'vitest';
import {
  executeApiRequest,
  parseQueryParams,
  stringifyQueryParams,
} from '../src/shared/tools/apiRequestExecutor';

describe('API 请求执行与参数调试工具 (ApiReplay)', () => {
  it('能够正确解析 URL 中的 Query 参数', () => {
    const url = 'https://api.example.com/goods/list?page=1&pageSize=20&keyword=%E6%89%8B%E6%9C%BA#tab1';
    const params = parseQueryParams(url);

    expect(params).toHaveLength(3);
    expect(params[0]).toEqual({ key: 'page', value: '1', enabled: true });
    expect(params[1]).toEqual({ key: 'pageSize', value: '20', enabled: true });
    expect(params[2]).toEqual({ key: 'keyword', value: '手机', enabled: true });
  });

  it('无 Query 参数时返回空数组', () => {
    expect(parseQueryParams('https://api.example.com/goods/list')).toEqual([]);
    expect(parseQueryParams('https://api.example.com/goods/list#hash')).toEqual([]);
  });

  it('能够将修改后的参数键值对同步回 URL', () => {
    const rawUrl = 'https://api.example.com/goods/list?page=1&pageSize=20#hash1';
    const modified = [
      { key: 'page', value: '2', enabled: true },
      { key: 'pageSize', value: '50', enabled: true },
      { key: 'disabledParam', value: 'skip', enabled: false },
      { key: 'sort', value: 'desc', enabled: true },
    ];

    const newUrl = stringifyQueryParams(rawUrl, modified);
    expect(newUrl).toBe('https://api.example.com/goods/list?page=2&pageSize=50&sort=desc#hash1');
  });

  it('能够正常执行 API 请求并记录耗时与响应头', async () => {
    const fakeHeaders = new Headers();
    fakeHeaders.set('content-type', 'application/json');
    fakeHeaders.set('x-custom-res', 'ok');

    const fakeResponse = new Response('{"code":0,"data":{"id":101}}', {
      status: 200,
      statusText: 'OK',
      headers: fakeHeaders,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(fakeResponse);

    const result = await executeApiRequest({
      method: 'POST',
      url: 'https://api.example.com/order/create',
      headers: [
        { name: 'Authorization', value: 'Bearer token_123', enabled: true },
        { name: 'Content-Type', value: 'application/json', enabled: true },
        { name: 'X-Ignored', value: 'test', enabled: false },
      ],
      body: '{"goodsId":101,"count":2}',
    });

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/order/create', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token_123',
        'Content-Type': 'application/json',
      },
      body: '{"goodsId":101,"count":2}',
    });

    expect(result.status).toBe(200);
    expect(result.statusText).toBe('OK');
    expect(result.isError).toBe(false);
    expect(result.body).toContain('"code":0');
    expect(result.headers.some((h) => h.name === 'x-custom-res' && h.value === 'ok')).toBe(true);

    fetchSpy.mockRestore();
  });

  it('能够安全解析与同步包含 Object 对象的 Query 参数，且不因特殊字符丢弃整条链接', () => {
    // 包含 JSON 对象的 query 参数及可能含有的未转义百分号
    const url = 'https://api.example.com/search?filter=%7B%22status%22%3A1%2C%22category%22%3A%22qa%22%7D&discount=100%OFF&user={"id":99}';
    const params = parseQueryParams(url);

    expect(params).toHaveLength(3);
    expect(params[0].key).toBe('filter');
    expect(params[0].value).toBe('{"status":1,"category":"qa"}');
    expect(params[1].key).toBe('discount');
    expect(params[1].value).toBe('100%OFF');
    expect(params[2].key).toBe('user');
    expect(params[2].value).toBe('{"id":99}');

    // 同步包含 object 对象的参数到新 URL
    const updated = [
      { key: 'filter', value: '{"status":2,"category":"prod"}', enabled: true },
      { key: 'user', value: { id: 101, role: 'admin' } as any, enabled: true },
    ];
    const newUrl = stringifyQueryParams('https://api.example.com/search', updated);
    expect(newUrl).toContain('filter=%7B%22status%22%3A2%2C%22category%22%3A%22prod%22%7D');
    expect(newUrl).toContain('user=%7B%22id%22%3A101%2C%22role%22%3A%22admin%22%7D');
  });

  it('入参为 Object 对象时 executeApiRequest 能自动 JSON 序列化并智能补全 Content-Type', async () => {
    const fakeHeaders = new Headers();
    const fakeResponse = new Response('{"success":true}', {
      status: 200,
      statusText: 'OK',
      headers: fakeHeaders,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(fakeResponse);

    const result = await executeApiRequest({
      method: 'POST',
      url: 'https://api.example.com/user/update',
      body: {
        userId: 1001,
        profile: {
          nickname: 'QA-Leader',
          tags: ['test', 'automation'],
        },
      },
    });

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/user/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 1001,
        profile: {
          nickname: 'QA-Leader',
          tags: ['test', 'automation'],
        },
      }),
    });

    expect(result.status).toBe(200);
    expect(result.isError).toBe(false);

    fetchSpy.mockRestore();
  });

  it('captureText 能够无损序列化 Object 对象，不将包含 name/message 的普通业务对象误转为 Error，且空对象不转为 [object Object]', async () => {
    const { captureText } = await import('../src/shared/utils/captureText');

    // 1. 普通空对象应保留为 "{}"，而不是 "[object Object]"
    expect(captureText({})).toBe('{}');

    // 2. 含有 name 与 message 的正常业务入参，不能被误识别为系统 Error
    const bizPayload = { name: '自动化发布任务', message: '发布已排期', count: 5 };
    const serializedBiz = captureText(bizPayload);
    expect(serializedBiz).toBe(JSON.stringify(bizPayload));
    expect(serializedBiz).toContain('自动化发布任务');
    expect(serializedBiz).not.toBe('自动化发布任务: 发布已排期');

    // 3. 真实系统 Error 仍能正常提取详细错误信息
    const realError = new Error('数据库网络超时');
    expect(captureText(realError)).toContain('数据库网络超时');
  });
});

