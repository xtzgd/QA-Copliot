import { describe, expect, it } from 'vitest';
import { buildCurlCommand } from '../src/shared/formatters/curl';
import { NetworkRequest } from '../src/shared/types/network';

describe('cURL 请求导出', () => {
  it('对 URL、Header 和含单引号的 Body 进行 POSIX shell 安全引用', () => {
    const request: NetworkRequest = {
      id: 'req-1', sessionId: 'sess-1', method: 'post',
      url: 'https://example.test/api?q=$HOME&name=a b', pathname: '/api', status: 500,
      startedAt: 1, duration: 20, isError: true, isSlow: false,
      requestHeaders: [{ name: 'X-Name', value: 'QA "team"' }],
      requestBody: `{"name":"O'Reilly"}`,
    };

    const command = buildCurlCommand(request);
    expect(command).toContain("-X POST 'https://example.test/api?q=$HOME&name=a b'");
    expect(command).toContain("-H 'X-Name: QA \"team\"'");
    expect(command).toContain(`--data-raw '{"name":"O'"'"'Reilly"}'`);
  });
});
