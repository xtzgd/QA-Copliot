# QA Copilot 企业 AI 网关协议

插件不直接保存或使用模型 API Key。远程 Provider 将采集到的完整结构化上下文发送到企业自有网关，由网关在服务端调用 OpenAI、Claude、Gemini、DeepSeek 或内部模型。上下文中的表单值、请求头、请求体和响应体均保持原文。

## 请求

```json
{
  "version": 1,
  "task": "generate_bug | analyze_issue | plan_form_fill",
  "context": {}
}
```

网关地址必须使用 HTTPS；本地开发时允许 `http://localhost`。插件使用 `credentials: omit`，不会附带页面 Cookie。

## 响应

成功时返回 `{ "data": ... }`。

- `generate_bug`：`data` 包含 `title`、`severity`、`reproductionSteps`、`expectedResult`、`actualResult`、`aiAnalysis`。
- `analyze_issue`：`data` 为 `{ "analysis": "..." }`。
- `plan_form_fill`：`data` 为 `{ "snapshotId": "...", "assignments": [...], "unresolved": [...] }`，每项 assignment 指定 `fieldId`、`action`、`value`、`optionIds` 等。

非 2xx、超时或 Schema 不合法都会转换为统一 `AIProviderError`，不会阻断 Snapshot、Bug 草稿或 Markdown 导出。
