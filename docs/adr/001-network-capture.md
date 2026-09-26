# ADR-001：V1 Network 采集路径

- 状态：已采用，待真实 Chrome 兼容性回归
- 日期：2026-09-03
- 对应任务：TASK-201

## 决策

V1 使用 Manifest V3 `MAIN` world Injected Script 包装 `window.fetch` 与
`XMLHttpRequest`，通过 `window.postMessage` 交给 isolated Content Script，再由统一消息协议
发送至 Background 持久化。

不把 `chrome.devtools.network` 作为 V1 主采集通道。DevTools API 只有打开 DevTools 后才有
稳定生命周期，不满足“QA 开始 Session 后无需保持 DevTools 打开”的产品目标。V1 也暂不申请
`debugger` 权限，以避免高风险权限提示和与用户 DevTools 调试会话冲突。

## 当前能力

- Fetch / XHR method、URL、status、duration。
- Request / Response Headers，按原文采集。
- Request / Response Body，最大保存 20,000 字符。
- 4XX、5XX、慢请求识别以及与最近操作的时间窗口关联。
- DevTools 未打开时仍可工作。

## 已知限制

- 无法覆盖页面加载产生的 document、CSS、图片以及浏览器内部请求。
- 无法覆盖 Service Worker 自己发起、绕过页面 `window.fetch` 的请求。
- 流式、二进制或受浏览器限制的 Response Body 可能为空。
- 网站若在插件注入前缓存原始 Fetch/XHR 引用，相关请求可能无法捕获。
- 暂不支持 HAR、精细 Resource Timing、Request Replay。

## 后续升级条件

若真实 QA 试用证明上述限制影响核心 Bug 证据，应新增 `NetworkCaptureAdapter`，同时提供：

1. `InjectedNetworkAdapter`：默认、低权限；
2. `DevToolsNetworkAdapter`：DevTools 打开时增强 Response/Timing；
3. 可选 `DebuggerNetworkAdapter`：仅在用户明确授权的高级模式启用。

升级时必须保持 `NetworkRequest` 数据模型和上层 Timeline/Bug Snapshot 不变。
