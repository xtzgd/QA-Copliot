/**
 * API 请求执行器与参数解析工具
 * 支持 URL Query 参数双向同步与无跨域限制的真实接口重发调试
 */

export interface QueryParamItem {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HeaderParamItem {
  name: string;
  value: string;
  enabled: boolean;
}

export interface ApiExecutionResult {
  status: number;
  statusText: string;
  duration: number;
  headers: Array<{ name: string; value: string }>;
  body: string;
  size: number;
  isError: boolean;
  error?: string;
}

/**
 * 解析 URL 中的 Query String 成为键值对列表
 */
export function parseQueryParams(url: string): QueryParamItem[] {
  try {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return [];
    const search = url.slice(qIndex + 1);
    const hashIndex = search.indexOf('#');
    const queryString = hashIndex === -1 ? search : search.slice(0, hashIndex);
    if (!queryString.trim()) return [];

    const pairs = queryString.split('&');
    const items: QueryParamItem[] = [];
    for (const pair of pairs) {
      if (!pair) continue;
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        items.push({ key: decodeURIComponent(pair), value: '', enabled: true });
      } else {
        const k = decodeURIComponent(pair.slice(0, eqIndex));
        const v = decodeURIComponent(pair.slice(eqIndex + 1));
        items.push({ key: k, value: v, enabled: true });
      }
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * 将键值对列表合并回 URL 中
 */
export function stringifyQueryParams(rawUrl: string, params: QueryParamItem[]): string {
  try {
    const qIndex = rawUrl.indexOf('?');
    const hashIndex = rawUrl.indexOf('#');
    const baseUrl = qIndex !== -1 ? rawUrl.slice(0, qIndex) : hashIndex !== -1 ? rawUrl.slice(0, hashIndex) : rawUrl;
    const hash = hashIndex !== -1 ? rawUrl.slice(hashIndex) : '';

    const active = params.filter((p) => p.enabled && p.key.trim() !== '');
    if (active.length === 0) {
      return `${baseUrl}${hash}`;
    }

    const query = active
      .map((p) => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`)
      .join('&');

    return `${baseUrl}?${query}${hash}`;
  } catch {
    return rawUrl;
  }
}

/**
 * 发起实际的 HTTP 请求并记录耗时、响应头和响应体
 */
export async function executeApiRequest(config: {
  method: string;
  url: string;
  headers?: Array<{ name: string; value: string; enabled?: boolean }>;
  body?: string;
}): Promise<ApiExecutionResult> {
  const method = (config.method || 'GET').toUpperCase();
  const url = config.url.trim();
  const startTime = performance.now();

  const reqHeaders: Record<string, string> = {};
  if (config.headers) {
    for (const h of config.headers) {
      if (h.enabled !== false && h.name && h.name.trim()) {
        reqHeaders[h.name.trim()] = h.value;
      }
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const init: RequestInit = {
    method,
    headers: reqHeaders,
    body: hasBody && config.body !== undefined && config.body !== '' ? config.body : undefined,
  };

  try {
    const response = await fetch(url, init);
    const duration = Math.round(performance.now() - startTime);
    const textBody = await response.text();
    const size = new Blob([textBody]).size;

    const resHeaders: Array<{ name: string; value: string }> = [];
    response.headers.forEach((val, key) => {
      resHeaders.push({ name: key, value: val });
    });

    return {
      status: response.status,
      statusText: response.statusText || (response.status === 200 ? 'OK' : ''),
      duration,
      headers: resHeaders,
      body: textBody,
      size,
      isError: response.status >= 400,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const errMsg = (error as Error).message || '网络请求失败';
    return {
      status: 0,
      statusText: 'Network Error',
      duration,
      headers: [],
      body: '',
      size: 0,
      isError: true,
      error: errMsg,
    };
  }
}
