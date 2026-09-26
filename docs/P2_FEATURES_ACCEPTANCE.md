# P2 增强功能使用与验收

## 1. 禅道直接提交

1. 在设置页填写禅道站点、产品 ID、影响版本和 API Token。
2. 创建 Snapshot 并打开 Bug 编辑器。
3. 确认内容后点击“提交到禅道”。
4. 验证禅道 Bug 包含标题、严重级别、步骤、实际/预期结果、环境和截图。

Token 仅保存在 Chrome Session Storage，不保存禅道账号密码。截图上传使用禅道 v22+ 的 v2 files 接口；旧版禅道可以创建 Bug，但可能无法上传截图，插件会明确提示。

## 2. Session 录屏

1. 在 Chrome 116+ 中开始测试 Session。
2. 点击首页“录屏”，在 Chrome 弹窗中选择当前被测标签页；页面中途导航后录制应继续。
3. 再次点击“停止录屏”，验证 `.webm` 自动下载。
4. 打开该 Session 的 Bug 编辑器，验证录屏证据可再次下载。

录屏使用 Chrome 标签页共享选择器获取用户明确授权，避免依赖 `activeTab` 的临时授权。当前优先保证视频采集稳定，不请求标签页音轨。录屏 Blob 单独保存在 IndexedDB，不经过扩展消息总线传输。Chrome 内部页面不能作为测试 Session 页面。

## 3. Network Mock

1. 在 API 页面新建 Mock 规则，配置 Method、URL 通配模式、HTTP 状态、延迟和响应体。
2. 规则保存后立即影响后续 Fetch/XHR，无需刷新页面。
3. 验证页面收到配置响应，API 列表展示 `MOCK` 标记。
4. 关闭规则后，后续请求恢复真实网络调用。

URL 使用完整地址匹配，`*` 代表任意字符，例如 `https://test.example.com/api/orders/*`。

## 4. Playwright 导出

1. 打开当前或历史 Session 时间线。
2. 点击右上角“Playwright”，下载 `.spec.ts`。
3. 检查导航、输入和点击顺序，语义定位优先使用 role/label/text。
4. 补充业务断言后放入 Playwright 项目运行。

输入值会按采集原文直接写入 `.fill()`，包括密码、Token 等字段。生成器不会猜测业务断言。

## 通过标准

- [ ] 禅道 Bug 和截图建立正确关联，失败时不会重复建 Bug。
- [ ] 连续录制 10 分钟无中断，下载视频可正常播放。
- [ ] Fetch/XHR 的正常、异常、慢响应 Mock 均符合规则。
- [ ] 导出脚本通过 `npx playwright test`，采集到的输入值可直接回放。
