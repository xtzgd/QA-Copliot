(function() {
  "use strict";
  function captureText(value, maxLength = 2e4) {
    if (value === void 0 || value === null) return "";
    if (typeof value === "string") return value.slice(0, maxLength);
    if (value instanceof Error || typeof value === "object" && value !== null && "message" in value && "name" in value) {
      const err = value;
      const text = err.stack || `${err.name || "Error"}: ${err.message || ""}`;
      return text.slice(0, maxLength);
    }
    try {
      const json = JSON.stringify(value);
      if (json === "{}" && typeof value === "object") {
        return String(value).slice(0, maxLength);
      }
      return json.slice(0, maxLength);
    } catch {
      return String(value).slice(0, maxLength);
    }
  }
  function captureHeaders(headers = []) {
    return headers.map(({ name, value }) => ({ name, value }));
  }
  function matchesNetworkMockRule(rule, method, url) {
    if (!rule.enabled || rule.method !== "*" && rule.method.toUpperCase() !== method.toUpperCase()) return false;
    const expression = rule.urlPattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    try {
      return new RegExp(`^${expression}$`, "i").test(url);
    } catch {
      return false;
    }
  }
  (function() {
    if (window.__QA_COPILOT_INTERCEPTED__) {
      return;
    }
    window.__QA_COPILOT_INTERCEPTED__ = true;
    function serializeData(data) {
      return captureText(data, 2e4);
    }
    function createRequestId() {
      return "req-" + Math.random().toString(36).slice(2, 9) + "-" + Date.now();
    }
    function toHeaderList(headers) {
      if (!headers) return [];
      try {
        return captureHeaders(Array.from(new Headers(headers).entries()).map(([name, value]) => ({ name, value })));
      } catch {
        return [];
      }
    }
    let bridgeReady = false;
    const pendingMessages = [];
    function postToContentScript(payload, type = "NETWORK_CAPTURE") {
      const message = { source: "QA_COPILOT_INJECTED", type, data: payload };
      if (!bridgeReady) {
        pendingMessages.push(message);
        if (pendingMessages.length > 200) pendingMessages.shift();
        return;
      }
      window.postMessage(message, "*");
    }
    let mockRules = [];
    window.addEventListener("message", (event) => {
      var _a, _b, _c, _d;
      if (event.source !== window || ((_a = event.data) == null ? void 0 : _a.source) !== "QA_COPILOT_CONTENT") return;
      if (((_b = event.data) == null ? void 0 : _b.type) === "BRIDGE_READY" || ((_c = event.data) == null ? void 0 : _c.type) === "PING_INTERCEPTOR") {
        bridgeReady = true;
        postToContentScript({ ready: true, version: "1.0.9" }, "INTERCEPTOR_READY");
        while (pendingMessages.length > 0) {
          const message = pendingMessages.shift();
          if (message) window.postMessage(message, "*");
        }
      } else if (((_d = event.data) == null ? void 0 : _d.type) === "MOCK_CONFIG") {
        mockRules = Array.isArray(event.data.data) ? event.data.data : [];
      }
    });
    window.postMessage({ source: "QA_COPILOT_INJECTED", type: "INTERCEPTOR_HELLO", data: {} }, "*");
    function findMock(method, url) {
      const resolved = new URL(url, window.location.href).href;
      return mockRules.find((rule) => matchesNetworkMockRule(rule, method, resolved));
    }
    const wait = (delayMs, signal) => new Promise((resolve, reject) => {
      if (signal == null ? void 0 : signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, Math.max(0, Math.min(delayMs, 3e4)));
      function onAbort() {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      var _a, _b;
      const startTime = Date.now();
      const requestId = createRequestId();
      let method = "GET";
      let url = "";
      let requestHeaders = [];
      let requestBody = "";
      const signal = ((_a = args[1]) == null ? void 0 : _a.signal) || (args[0] instanceof Request ? args[0].signal : void 0);
      try {
        if (typeof args[0] === "string") {
          url = args[0];
        } else if (args[0] instanceof Request) {
          url = args[0].url;
          method = args[0].method || "GET";
          requestHeaders = toHeaderList(args[0].headers);
          try {
            requestBody = serializeData(await args[0].clone().text());
          } catch {
          }
        } else if (args[0] instanceof URL) {
          url = args[0].toString();
        }
        if (args[1] && typeof args[1] === "object") {
          if (args[1].method) method = args[1].method.toUpperCase();
          if (args[1].headers) requestHeaders = toHeaderList(args[1].headers);
        }
        if ((_b = args[1]) == null ? void 0 : _b.body) {
          requestBody = serializeData(args[1].body);
        }
        postToContentScript({
          requestId,
          method,
          url: serializeData(url),
          startedAt: startTime
        }, "NETWORK_START");
        const mock = findMock(method, url);
        if (mock) {
          await wait(mock.delayMs, signal);
          const duration2 = Date.now() - startTime;
          const resolvedUrl = new URL(url, window.location.href).href;
          const responseBody = serializeData(mock.responseBody);
          const response2 = new Response(responseBody, {
            status: mock.status,
            headers: { "Content-Type": mock.contentType || "application/json", "X-QA-Copilot-Mock": mock.id }
          });
          postToContentScript({
            requestId,
            method,
            initiatorType: "fetch",
            url: serializeData(resolvedUrl),
            pathname: new URL(resolvedUrl).pathname,
            status: mock.status,
            statusText: "Mocked",
            startedAt: startTime,
            duration: duration2,
            requestHeaders,
            requestBody,
            responseHeaders: toHeaderList(response2.headers),
            responseBody,
            mimeType: mock.contentType,
            isError: mock.status >= 400,
            isSlow: false,
            isMocked: true,
            mockRuleId: mock.id
          });
          return response2;
        }
        const response = await originalFetch.apply(this, args);
        const duration = Date.now() - startTime;
        const contentType = response.headers.get("content-type") || "";
        const isStream = contentType.includes("text/event-stream") || contentType.includes("application/stream+json");
        void (async () => {
          let responseBody = "";
          if (isStream) {
            responseBody = "[Stream/EventStream Active]";
          } else {
            try {
              const cloned = response.clone();
              const readPromise = cloned.text();
              const timeoutPromise = new Promise(
                (_, reject) => setTimeout(() => reject(new Error("Response read timeout")), 3e3)
              );
              const text = await Promise.race([readPromise, timeoutPromise]);
              responseBody = serializeData(text.length > 1e6 ? `${text.slice(0, 1e6)}...[截断]` : text);
            } catch {
            }
          }
          let resolvedUrl = url;
          let pathname = url;
          try {
            const parsedUrl = new URL(url, window.location.href);
            resolvedUrl = parsedUrl.href;
            pathname = parsedUrl.pathname;
          } catch {
          }
          postToContentScript({
            requestId,
            method,
            initiatorType: "fetch",
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
            mimeType: contentType || void 0,
            isError: response.status >= 400,
            isSlow: duration > 2e3
          });
        })();
        return response;
      } catch (err) {
        const duration = Date.now() - startTime;
        const isAborted = (err == null ? void 0 : err.name) === "AbortError";
        postToContentScript({
          requestId,
          method,
          initiatorType: "fetch",
          url: serializeData(url),
          pathname: url,
          status: 0,
          statusText: isAborted ? "Aborted" : "Network Error",
          startedAt: startTime,
          duration,
          error: err.message,
          isError: !isAborted,
          isSlow: false
        });
        throw err;
      }
    };
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const originalXhrAbort = XMLHttpRequest.prototype.abort;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const xhr = this;
      if (xhr._qaMockTimer) {
        clearTimeout(xhr._qaMockTimer);
        xhr._qaMockTimer = void 0;
      }
      xhr._qaAborted = false;
      xhr._qaMethod = method.toUpperCase();
      xhr._qaUrl = url.toString();
      xhr._qaStartTime = Date.now();
      xhr._qaHeaders = [];
      xhr._qaRequestId = void 0;
      return originalXhrOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.abort = function() {
      const xhr = this;
      xhr._qaAborted = true;
      if (xhr._qaMockTimer) {
        clearTimeout(xhr._qaMockTimer);
        xhr._qaMockTimer = void 0;
        const method = xhr._qaMethod || "GET";
        const url = xhr._qaUrl || "";
        const startTime = xhr._qaStartTime || Date.now();
        postToContentScript({
          requestId: xhr._qaRequestId,
          method,
          initiatorType: "xhr",
          url: serializeData(url),
          pathname: url,
          status: 0,
          statusText: "Aborted",
          startedAt: startTime,
          duration: Date.now() - startTime,
          error: "The request was aborted",
          isError: false,
          isSlow: false
        });
        this.dispatchEvent(new ProgressEvent("abort"));
        this.dispatchEvent(new ProgressEvent("loadend"));
        return;
      }
      return originalXhrAbort.apply(this);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      const xhr = this;
      xhr._qaHeaders || (xhr._qaHeaders = []);
      xhr._qaHeaders.push({ name, value });
      return originalSetRequestHeader.call(this, name, value);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const xhr = this;
      const method = xhr._qaMethod || "GET";
      const url = xhr._qaUrl || "";
      const startTime = Date.now();
      const requestId = createRequestId();
      xhr._qaRequestId = requestId;
      const requestBody = serializeData(body);
      postToContentScript({
        requestId,
        method,
        url: serializeData(url),
        startedAt: startTime
      }, "NETWORK_START");
      const mock = findMock(method, url);
      if (mock) {
        const xhrInstance = this;
        xhrInstance._qaAborted = false;
        xhrInstance._qaMockTimer = setTimeout(() => {
          if (xhrInstance._qaAborted) return;
          xhrInstance._qaMockTimer = void 0;
          const responseBody = serializeData(mock.responseBody);
          let resolvedUrl = url;
          try {
            resolvedUrl = new URL(url, window.location.href).href;
          } catch {
          }
          let mockResponse = responseBody;
          if (xhrInstance.responseType === "json") {
            try {
              mockResponse = JSON.parse(responseBody);
            } catch {
              mockResponse = null;
            }
          }
          const values = {
            readyState: 4,
            status: mock.status,
            statusText: "Mocked",
            responseText: responseBody,
            response: mockResponse,
            responseURL: resolvedUrl
          };
          Object.entries(values).forEach(([key, value]) => {
            try {
              Object.defineProperty(xhrInstance, key, { configurable: true, value });
            } catch {
            }
          });
          try {
            Object.defineProperty(xhrInstance, "getAllResponseHeaders", {
              configurable: true,
              value: () => `content-type: ${mock.contentType || "application/json"}\r
x-qa-copilot-mock: ${mock.id}\r
`
            });
            Object.defineProperty(xhrInstance, "getResponseHeader", {
              configurable: true,
              value: (name) => name.toLowerCase() === "content-type" ? mock.contentType || "application/json" : null
            });
          } catch {
          }
          postToContentScript({
            requestId,
            method,
            initiatorType: "xhr",
            url: serializeData(resolvedUrl),
            pathname: new URL(resolvedUrl).pathname,
            status: mock.status,
            statusText: "Mocked",
            startedAt: startTime,
            duration: Date.now() - startTime,
            requestHeaders: xhr._qaHeaders || [],
            requestBody,
            responseHeaders: [{ name: "X-QA-Copilot-Mock", value: mock.id }],
            responseBody,
            mimeType: mock.contentType,
            isError: mock.status >= 400,
            isSlow: false,
            isMocked: true,
            mockRuleId: mock.id
          });
          if (!xhrInstance._qaAborted) {
            xhrInstance.dispatchEvent(new Event("readystatechange"));
            xhrInstance.dispatchEvent(new ProgressEvent("load"));
            xhrInstance.dispatchEvent(new ProgressEvent("loadend"));
          }
        }, Math.max(0, Math.min(mock.delayMs, 3e4)));
        return;
      }
      const currentXhr = this;
      const requestHeaders = (xhr._qaHeaders || []).slice();
      const onLoadEnd = () => {
        const duration = Date.now() - startTime;
        let resolvedUrl = url;
        let pathname = url;
        try {
          const parsedUrl = new URL(url, window.location.href);
          resolvedUrl = parsedUrl.href;
          pathname = parsedUrl.pathname;
        } catch {
        }
        let responseBody = "";
        try {
          if (currentXhr.responseType === "json") {
            responseBody = serializeData(currentXhr.response);
          } else if (currentXhr.responseType === "" || currentXhr.responseType === "text") {
            responseBody = serializeData(currentXhr.responseText);
          } else {
            responseBody = `[${currentXhr.responseType || "binary"}]`;
          }
        } catch {
        }
        const isStatusError = currentXhr.status >= 400;
        const isZeroFail = currentXhr.status === 0;
        const isError = isStatusError || isZeroFail;
        const statusText = currentXhr.statusText || (isZeroFail ? "Network Failed / Aborted" : "");
        postToContentScript({
          requestId,
          method,
          initiatorType: "xhr",
          url: serializeData(resolvedUrl),
          pathname,
          status: currentXhr.status,
          statusText,
          startedAt: startTime,
          duration,
          requestHeaders,
          requestBody,
          responseHeaders: captureHeaders(
            (currentXhr.getAllResponseHeaders() || "").trim().split(/[\r\n]+/).filter(Boolean).map((line) => {
              const separator = line.indexOf(":");
              return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
            })
          ),
          responseBody,
          mimeType: currentXhr.getResponseHeader("content-type") || void 0,
          isError,
          isSlow: duration > 2e3
        });
      };
      this.addEventListener("loadend", onLoadEnd, { once: true });
      return originalXhrSend.apply(this, [body]);
    };
    const originalConsoleError = console.error;
    console.error = function(...args) {
      try {
        postToContentScript(
          {
            message: args.map((arg) => serializeData(arg)).join(" "),
            timestamp: Date.now(),
            url: serializeData(window.location.href)
          },
          "CONSOLE_CAPTURE"
        );
      } catch {
      }
      originalConsoleError.apply(console, args);
    };
    postToContentScript({ ready: true, version: "1.0.4" }, "INTERCEPTOR_READY");
    console.log("[QA Copilot Injected] 网络拦截层已就绪");
  })();
})();
