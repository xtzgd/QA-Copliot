/**
 * 页面网络请求拦截器 (Injected Script) - TASK-201
 * 拦截 window.fetch 与 XMLHttpRequest，无损采集接口请求与耗时
 */

import { captureHeaders, captureText } from '../shared/utils/captureText';
import { NetworkMockRule } from '../shared/types/mock';
import { matchesNetworkMockRule } from '../shared/tools/networkMock';

(function () {
  if ((window as unknown as { __QA_COPILOT_INTERCEPTED__?: boolean }).__QA_COPILOT_INTERCEPTED__) {
    return;
  }
  (window as unknown as { __QA_COPILOT_INTERCEPTED__?: boolean }).__QA_COPILOT_INTERCEPTED__ = true;

  function serializeData(data: unknown): string {
    return captureText(data, 20_000);
  }

  function createRequestId(): string {
    return 'req-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now();
  }

  function toHeaderList(headers?: HeadersInit): Array<{ name: string; value: string }> {
    if (!headers) return [];
    try {
      return captureHeaders(Array.from(new Headers(headers).entries()).map(([name, value]) => ({ name, value })));
    } catch {
      return [];
    }
  }

  type BridgeMessage = { source: string; type: string; data: Record<string, unknown> };
  let bridgeReady = false;
  const pendingMessages: BridgeMessage[] = [];

  function postToContentScript(payload: Record<string, unknown>, type = 'NETWORK_CAPTURE') {
    const message = { source: 'QA_COPILOT_INJECTED', type, data: payload };
    if (!bridgeReady) {
      pendingMessages.push(message);
      if (pendingMessages.length > 200) pendingMessages.shift();
      return;
    }
    window.postMessage(message, '*');
  }

  let mockRules: NetworkMockRule[] = [];
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'QA_COPILOT_CONTENT') return;
    if (event.data?.type === 'BRIDGE_READY' || event.data?.type === 'PING_INTERCEPTOR') {
      bridgeReady = true;
      postToContentScript({ ready: true, version: '1.0.9' }, 'INTERCEPTOR_READY');
      while (pendingMessages.length > 0) {
        const message = pendingMessages.shift();
        if (message) window.postMessage(message, '*');
      }
    } else if (event.data?.type === 'MOCK_CONFIG') {
      mockRules = Array.isArray(event.data.data) ? event.data.data : [];
    }
  });
  window.postMessage({ source: 'QA_COPILOT_INJECTED', type: 'INTERCEPTOR_HELLO', data: {} }, '*');

  function findMock(method: string, url: string): NetworkMockRule | undefined {
    const resolved = new URL(url, window.location.href).href;
    return mockRules.find((rule) => matchesNetworkMockRule(rule, method, resolved));
  }

  const wait = (delayMs: number, signal?: AbortSignal | null) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, Math.min(delayMs, 30_000)));

      function onAbort() {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

  // 1. 拦截 window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const startTime = Date.now();
    const requestId = createRequestId();
    let method = 'GET';
    let url = '';
    let requestHeaders: Array<{ name: string; value: string }> = [];
    let requestBody = '';
    const signal = (args[1] as RequestInit | undefined)?.signal || (args[0] instanceof Request ? args[0].signal : undefined);

    try {
      if (typeof args[0] === 'string') {
        url = args[0];
      } else if (args[0] instanceof Request) {
        url = args[0].url;
        method = args[0].method || 'GET';
        requestHeaders = toHeaderList(args[0].headers);
        try {
          requestBody = serializeData(await args[0].clone().text());
        } catch {}
      } else if (args[0] instanceof URL) {
        url = args[0].toString();
      }

      if (args[1] && typeof args[1] === 'object') {
        if (args[1].method) method = args[1].method.toUpperCase();
        if (args[1].headers) requestHeaders = toHeaderList(args[1].headers);
      }

      // 请求体
      if (args[1]?.body) {
        requestBody = serializeData(args[1].body);
      }

      // IMP-03: 发送网络请求发起事件，通知采集侧与后台建立在途上下文
      postToContentScript({
        requestId,
        method,
        url: serializeData(url),
        startedAt: startTime,
      }, 'NETWORK_START');

      const mock = findMock(method, url);
      if (mock) {
        // QA-020：Mock 请求支持 AbortSignal 取消
        await wait(mock.delayMs, signal);
        const duration = Date.now() - startTime;
        const resolvedUrl = new URL(url, window.location.href).href;
        const responseBody = serializeData(mock.responseBody);
        const response = new Response(responseBody, {
          status: mock.status,
          headers: { 'Content-Type': mock.contentType || 'application/json', 'X-QA-Copilot-Mock': mock.id },
        });
        postToContentScript({
          requestId,
          method, initiatorType: 'fetch', url: serializeData(resolvedUrl), pathname: new URL(resolvedUrl).pathname,
          status: mock.status, statusText: 'Mocked', startedAt: startTime, duration, requestHeaders, requestBody,
          responseHeaders: toHeaderList(response.headers), responseBody, mimeType: mock.contentType,
          isError: mock.status >= 400, isSlow: false, isMocked: true, mockRuleId: mock.id,
        });
        return response;
      }

      const response = await originalFetch.apply(this, args);
      const duration = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || '';
      const isStream = contentType.includes('text/event-stream') || contentType.includes('application/stream+json');

      // QA-002：API 监控不能阻塞页面 Fetch。及时返回原 Response，异步在后台采集副本
      void (async () => {
        let responseBody = '';
        if (isStream) {
          responseBody = '[Stream/EventStream Active]';
        } else {
          try {
            const cloned = response.clone();
            const readPromise = cloned.text();
            const timeoutPromise = new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Response read timeout')), 3000)
            );
            const text = await Promise.race([readPromise, timeoutPromise]);
            responseBody = serializeData(text.length > 1_000_000 ? `${text.slice(0, 1_000_000)}...[截断]` : text);
          } catch {
            // 无法读取、已消费或超时
          }
        }

        let resolvedUrl = url;
        let pathname = url;
        try {
          const parsedUrl = new URL(url, window.location.href);
          resolvedUrl = parsedUrl.href;
          pathname = parsedUrl.pathname;
        } catch {}

        postToContentScript({
          requestId,
          method,
          initiatorType: 'fetch',
          url: serializeData(resolvedUrl),
          pathname,
          status: response.status,
          statusText: response.statusText,
          startedAt: startTime,
          duration,
          requestHeaders,
          requestBody,
          responseHeaders: toHeaderList(response.headers),
          responseBody,
          mimeType: contentType || undefined,
          isError: response.status >= 400,
          isSlow: duration > 2000,
        });
      })();

      return response;
    } catch (err) {
      const duration = Date.now() - startTime;
      const isAborted = (err as DOMException)?.name === 'AbortError';
      postToContentScript({
        requestId,
        method,
        initiatorType: 'fetch',
        url: serializeData(url),
        pathname: url,
        status: 0,
        statusText: isAborted ? 'Aborted' : 'Network Error',
        startedAt: startTime,
        duration,
        error: (err as Error).message,
        isError: !isAborted,
        isSlow: false,
      });
      throw err;
    }
  };

  // 2. 拦截 XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const originalXhrAbort = XMLHttpRequest.prototype.abort;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: [boolean?, string?, string?]
  ) {
    const xhr = this as unknown as {
      _qaMethod?: string;
      _qaUrl?: string;
      _qaStartTime?: number;
      _qaHeaders?: Array<{ name: string; value: string }>;
      _qaMockTimer?: ReturnType<typeof setTimeout>;
      _qaAborted?: boolean;
      _qaRequestId?: string;
    };
    if (xhr._qaMockTimer) {
      clearTimeout(xhr._qaMockTimer);
      xhr._qaMockTimer = undefined;
    }
    xhr._qaAborted = false;
    xhr._qaMethod = method.toUpperCase();
    xhr._qaUrl = url.toString();
    xhr._qaStartTime = Date.now();
    xhr._qaHeaders = [];
    xhr._qaRequestId = undefined;
    return originalXhrOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalXhrOpen>);
  };

  XMLHttpRequest.prototype.abort = function () {
    const xhr = this as unknown as {
      _qaMockTimer?: ReturnType<typeof setTimeout>;
      _qaAborted?: boolean;
      _qaMethod?: string;
      _qaUrl?: string;
      _qaStartTime?: number;
      _qaRequestId?: string;
    };
    xhr._qaAborted = true;
    if (xhr._qaMockTimer) {
      clearTimeout(xhr._qaMockTimer);
      xhr._qaMockTimer = undefined;
      const method = xhr._qaMethod || 'GET';
      const url = xhr._qaUrl || '';
      const startTime = xhr._qaStartTime || Date.now();
      postToContentScript({
        requestId: xhr._qaRequestId,
        method,
        initiatorType: 'xhr',
        url: serializeData(url),
        pathname: url,
        status: 0,
        statusText: 'Aborted',
        startedAt: startTime,
        duration: Date.now() - startTime,
        error: 'The request was aborted',
        isError: false,
        isSlow: false,
      });
      this.dispatchEvent(new ProgressEvent('abort'));
      this.dispatchEvent(new ProgressEvent('loadend'));
      return;
    }
    return originalXhrAbort.apply(this);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    const xhr = this as unknown as { _qaHeaders?: Array<{ name: string; value: string }> };
    xhr._qaHeaders ||= [];
    xhr._qaHeaders.push({ name, value });
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this as unknown as {
      _qaMethod?: string;
      _qaUrl?: string;
      _qaStartTime?: number;
      _qaHeaders?: Array<{ name: string; value: string }>;
      _qaRequestId?: string;
    };
    const method = xhr._qaMethod || 'GET';
    const url = xhr._qaUrl || '';
    const startTime = Date.now(); // QA-018: send 时记录实际开始时间，不从 open 开始计算
    const requestId = createRequestId(); // 每次 send 生成独立的 requestId，确保单次请求对应唯一生命周期
    xhr._qaRequestId = requestId;
    const requestBody = serializeData(body);

    // IMP-03: 发送网络请求发起事件，通知后台记录发起上下文
    postToContentScript({
      requestId,
      method,
      url: serializeData(url),
      startedAt: startTime,
    }, 'NETWORK_START');

    const mock = findMock(method, url);

    if (mock) {
      const xhrInstance = this as unknown as {
        _qaMockTimer?: ReturnType<typeof setTimeout>;
        _qaAborted?: boolean;
        responseType: XMLHttpRequestResponseType;
        dispatchEvent: (event: Event) => boolean;
      };
      xhrInstance._qaAborted = false;
      // QA-020：保存定时器并支持被 abort() 取消
      xhrInstance._qaMockTimer = setTimeout(() => {
        if (xhrInstance._qaAborted) return;
        xhrInstance._qaMockTimer = undefined;

        const responseBody = serializeData(mock.responseBody);
        let resolvedUrl = url;
        try {
          resolvedUrl = new URL(url, window.location.href).href;
        } catch {}

        let mockResponse: unknown = responseBody;
        if (xhrInstance.responseType === 'json') {
          try { mockResponse = JSON.parse(responseBody); } catch { mockResponse = null; }
        }
        const values: Record<string, unknown> = {
          readyState: 4,
          status: mock.status,
          statusText: 'Mocked',
          responseText: responseBody,
          response: mockResponse,
          responseURL: resolvedUrl,
        };
        Object.entries(values).forEach(([key, value]) => {
          try { Object.defineProperty(xhrInstance, key, { configurable: true, value }); } catch {}
        });
        try {
          Object.defineProperty(xhrInstance, 'getAllResponseHeaders', {
            configurable: true,
            value: () => `content-type: ${mock.contentType || 'application/json'}\r\nx-qa-copilot-mock: ${mock.id}\r\n`,
          });
          Object.defineProperty(xhrInstance, 'getResponseHeader', {
            configurable: true,
            value: (name: string) => name.toLowerCase() === 'content-type' ? (mock.contentType || 'application/json') : null,
          });
        } catch {}
        postToContentScript({
          requestId,
          method, initiatorType: 'xhr', url: serializeData(resolvedUrl), pathname: new URL(resolvedUrl).pathname,
          status: mock.status, statusText: 'Mocked', startedAt: startTime, duration: Date.now() - startTime,
          requestHeaders: xhr._qaHeaders || [], requestBody, responseHeaders: [{ name: 'X-QA-Copilot-Mock', value: mock.id }],
          responseBody, mimeType: mock.contentType, isError: mock.status >= 400, isSlow: false,
          isMocked: true, mockRuleId: mock.id,
        });

        if (!xhrInstance._qaAborted) {
          xhrInstance.dispatchEvent(new Event('readystatechange'));
          xhrInstance.dispatchEvent(new ProgressEvent('load'));
          xhrInstance.dispatchEvent(new ProgressEvent('loadend'));
        }
      }, Math.max(0, Math.min(mock.delayMs, 30_000)));
      return;
    }

    const currentXhr = this;
    const requestHeaders = (xhr._qaHeaders || []).slice(); // QA-018: 快照当前请求头

    const onLoadEnd = () => {
      const duration = Date.now() - startTime;
      let resolvedUrl = url;
      let pathname = url;
      try {
        const parsedUrl = new URL(url, window.location.href);
        resolvedUrl = parsedUrl.href;
        pathname = parsedUrl.pathname;
      } catch {}

      // QA-019: 根据 responseType 读取响应体，避免 responseType 为 json 时访问 responseText 报错导致漏采
      let responseBody = '';
      try {
        if (currentXhr.responseType === 'json') {
          responseBody = serializeData(currentXhr.response);
        } else if (currentXhr.responseType === '' || currentXhr.responseType === 'text') {
          responseBody = serializeData(currentXhr.responseText);
        } else {
          responseBody = `[${currentXhr.responseType || 'binary'}]`;
        }
      } catch {}

      const isStatusError = currentXhr.status >= 400;
      const isZeroFail = currentXhr.status === 0;
      const isError = isStatusError || isZeroFail;
      const statusText = currentXhr.statusText || (isZeroFail ? 'Network Failed / Aborted' : '');

      postToContentScript({
        requestId,
        method,
        initiatorType: 'xhr',
        url: serializeData(resolvedUrl),
        pathname,
        status: currentXhr.status,
        statusText,
        startedAt: startTime,
        duration,
        requestHeaders,
        requestBody,
        responseHeaders: captureHeaders(
          (currentXhr.getAllResponseHeaders() || '')
            .trim()
            .split(/[\r\n]+/)
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf(':');
              return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
            })
        ),
        responseBody,
        mimeType: currentXhr.getResponseHeader('content-type') || undefined,
        isError,
        isSlow: duration > 2000,
      });
    };

    // QA-018: 使用 { once: true } 确保单次请求生命周期，避免同一个 XHR 实例多次 send 导致监听器累积
    this.addEventListener('loadend', onLoadEnd, { once: true });

    return originalXhrSend.apply(this, [body] as Parameters<typeof originalXhrSend>);
  };

  // console.error 本身不一定触发 window.onerror，需要独立采集。
  const originalConsoleError = console.error;
  console.error = function (...args: unknown[]) {
    try {
      postToContentScript(
        {
          message: args.map((arg) => serializeData(arg)).join(' '),
          timestamp: Date.now(),
          url: serializeData(window.location.href),
        },
        'CONSOLE_CAPTURE'
      );
    } catch {}
    originalConsoleError.apply(console, args);
  };

  postToContentScript({ ready: true, version: '1.0.4' }, 'INTERCEPTOR_READY');
  console.log('[QA Copilot Injected] 网络拦截层已就绪');
})();
