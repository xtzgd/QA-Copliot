import { NetworkMockRule } from '../types/mock';

export function matchesNetworkMockRule(rule: NetworkMockRule, method: string, url: string): boolean {
  if (!rule.enabled || (rule.method !== '*' && rule.method.toUpperCase() !== method.toUpperCase())) return false;
  const expression = rule.urlPattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  try {
    return new RegExp(`^${expression}$`, 'i').test(url);
  } catch {
    return false;
  }
}
