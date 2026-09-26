# M2 Chrome 人工验收清单

> 自动化浏览器环境不可用时，使用 Chrome 开发者模式加载仓库 `dist/` 目录执行。
> 每次源码修改后先运行 `npm run build`。

运行 `npm run smoke`，然后在 Chrome 打开 `http://127.0.0.1:4173`。该页面提供覆盖
表单、SPA、Fetch/XHR、HTTP 异常、慢请求和 Console 的固定验收场景。

## 1. 安装与生命周期

- [ ] `chrome://extensions` 能成功加载 `dist/`，无 manifest 错误。
- [ ] 点击插件图标能打开 Side Panel。
- [ ] Service Worker 控制台无未处理异常。
- [ ] 刷新被测页面、关闭并重新打开 Side Panel 后，进行中的 Session 可以恢复。

## 2. Session 与操作采集

- [ ] 开始测试后生成首次 Navigation，URL、浏览器和 Viewport 正确。
- [ ] 在 `chrome://extensions` 等 Chrome 内部页面点击开始测试时明确拒绝，不创建空 Session。
- [ ] 点击按钮内部的图标或文字时，只产生一条语义化 Click。
- [ ] 连续输入只保留最终值；同时编辑两个字段时互不丢失。
- [ ] Select、Checkbox、Radio 能记录最终值。
- [ ] `pushState`、`replaceState`、浏览器前进后退、hash 跳转均进入 Timeline。
- [ ] 结束测试后状态和结束时间正确，历史 Session 可以重新打开。

## 3. Network 与异常

- [ ] Fetch 和 XHR 均展示 method、URL、status、duration、headers 和 body。
- [ ] 表单值、URL、Headers、Request Body 和 Response Body 按原文保存与展示。
- [ ] 4XX、5XX、Slow、Fetch、XHR 过滤数量正确。
- [ ] 修改慢请求阈值并保存后，后续请求按新阈值分类。
- [ ] `console.error`、运行时异常、未处理 Promise 均进入 Timeline。
- [ ] 点击后 0–5 秒内发生的接口/JS 异常能展示关联操作。

## 4. Snapshot 与 Bug

- [ ] “发现问题”立即保存前 30 秒事件、接口、Console 和截图，不等待生成内容。
- [ ] 截图失败不影响其他 Snapshot 数据保存。
- [ ] Snapshot 页面可以预览并重新截图。
- [ ] Snapshot 页面显示操作、接口、Console、截图的实际数量，并能展开查看保存的数据。
- [ ] Bug 字段可编辑并保存草稿。
- [ ] 关闭再打开 Side Panel 后，Bug 列表可重新打开草稿，人工编辑内容不被覆盖。
- [ ] Markdown 包含真实环境、步骤、异常接口和 Console 原始数据。

## 5. AI 与 QA 工具

- [ ] 本地规则、企业 AI 网关、关闭三种 Provider 可切换。
- [ ] 关闭 Provider 后 Snapshot、Bug 编辑、草稿和 Markdown 导出仍正常。
- [ ] 企业网关收到完整 Context，但网关请求本身不携带页面 Cookie。
- [ ] 分析当前页面可识别可见表单字段、按钮和 min/max/maxlength/pattern 约束。
- [ ] 生成用例包含正常、必填、边界、格式、业务、权限场景，且可编辑、勾选、复制和导出。
- [ ] 被测页面 Alt + Click 元素后，可查看 CSS、XPath 和语义化 Playwright Locator。

## 6. 通过标准

- 主闭环连续执行 10 次，不允许出现数据串 Session、Snapshot 丢失或草稿被覆盖。
- 允许单次截图失败，但必须有明确提示且不阻塞 Bug 创建。
