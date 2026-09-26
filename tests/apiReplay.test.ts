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

  it('网络异常时能够捕获错误并返回友好的失败信息', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await executeApiRequest({
      method: 'GET',
      url: 'https://invalid-domain.test/error',
    });

    expect(result.status).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.error).toBe('Failed to fetch');

    fetchSpy.mockRestore();
  });
});
