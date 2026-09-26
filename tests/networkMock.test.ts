import { describe, expect, it } from 'vitest';
import { matchesNetworkMockRule } from '../src/shared/tools/networkMock';
import { NetworkMockRule } from '../src/shared/types/mock';

const rule: NetworkMockRule = {
  id: 'mock-1', name: '订单失败', enabled: true, method: 'POST',
  urlPattern: 'https://test.example.com/api/orders/*', status: 500, delayMs: 300,
  responseBody: '{"message":"mock"}', contentType: 'application/json',
};

describe('Network Mock 规则匹配', () => {
  it('支持 method 和 URL 通配符', () => {
    expect(matchesNetworkMockRule(rule, 'post', 'https://test.example.com/api/orders/100')).toBe(true);
    expect(matchesNetworkMockRule(rule, 'GET', 'https://test.example.com/api/orders/100')).toBe(false);
    expect(matchesNetworkMockRule(rule, 'POST', 'https://test.example.com/api/users/100')).toBe(false);
  });

  it('禁用规则不生效', () => {
    expect(matchesNetworkMockRule({ ...rule, enabled: false }, 'POST', 'https://test.example.com/api/orders/100')).toBe(false);
  });
});
