# QA Copilot Chrome 插件 V1.0 产品需求文档

## 1. 产品名称

暂定：**QA Copilot**

中文名可选：

- 测试助手
- QA 助手
- TestPilot
- BugPilot
- QMate

建议开发阶段先使用 **QA Copilot**。

---

# 2. 产品定位

QA Copilot 是一款面向 Web QA 工程师的 Chrome 浏览器插件。

核心目标不是替代 Selenium、Playwright、Postman 等专业工具，而是减少 QA 在日常测试中的重复劳动。

产品围绕以下流程展开：

**开始测试 → 自动记录 → 发现异常 → 收集证据 → AI 整理 → 提交 Bug → 开发修复 → QA 回归**

产品核心价值：

> 让 QA 不再手工整理测试证据。

---

# 3. V1.0 核心目标

V1.0 暂时不追求“大而全”，重点完成四个能力。

### 1. 测试过程自动记录

自动记录：

- 页面访问
- 页面跳转
- 点击
- 输入
- 页面截图
- API 请求
- API Response
- HTTP 4xx / 5xx
- 慢接口
- Console Error
- JS Exception
- 浏览器环境

---

### 2. 一键生成 Bug

QA 发现问题后点击：

**「发现问题」**

系统自动整理：

- Bug 标题
- 测试环境
- URL
- 浏览器信息
- 复现步骤
- 预期结果
- 实际结果
- 异常接口
- Console Error
- 截图
- 操作记录

---

### 3. 自动关联异常

插件自动分析：

**用户做了什么**

和

**系统随后发生了什么**

例如：

点击：

> 提交订单

500ms 后：

> POST /api/order/create → HTTP 500

同时：

> Console TypeError

系统自动形成关联：

**点击提交订单 → 创建订单接口 500 → 页面报错**

---

### 4. AI 测试助手

AI 根据：

- 当前页面
- DOM
- 表单字段
- 控件类型
- required
- maxlength
- min/max
- pattern
- API

生成：

- 正常场景
- 异常场景
- 边界测试
- 空值测试
- 格式测试
- 权限测试
- 重复数据测试

---

# 4. 用户角色

V1 只考虑一个角色：

## QA 工程师

后期可以增加：

### QA Leader

查看：

- 测试 Session
- Bug 数量
- 高频异常
- 测试覆盖情况
- QA 工作量

### Developer

查看 QA 提交的问题上下文：

- Request
- Response
- Console
- 操作步骤
- DOM 状态

---

# 5. Chrome 插件整体结构

插件采用：

## Side Panel + DevTools Panel

---

# 6. Side Panel

Side Panel 是核心入口。

结构：

```text
QA Copilot

当前项目
商城系统

当前环境
TEST

━━━━━━━━━━━━━━

● 正在测试

12:35

操作     18
API      42
异常      3

━━━━━━━━━━━━━━

🚨 发现问题

📸 截图

🧪 测试用例

🎲 测试数据

━━━━━━━━━━━━━━

最近异常

POST /order
500

GET /user
3.2s

Console
TypeError
```

---

# 7. 首页

首页主要显示当前测试状态。

## 顶部

显示：

项目

```text
商城系统
```

环境：

```text
DEV
TEST
UAT
PROD
```

当前页面：

```text
/order/create
```

---

# 8. 测试 Session

QA 点击：

## 开始测试

创建 Session。

例如：

```text
Session

2026-09-03
订单创建测试

开始时间
09:32

环境
TEST

URL
test.xxx.com
```

开始记录。

---

# 9. Session 时间线

插件形成 Timeline。

例如：

```text
09:32:01
打开
/order/create

09:32:04
点击
客户选择

09:32:06
点击
河北钢铁集团

09:32:09
输入
数量 = 99

09:32:12
点击
提交订单

09:32:12
POST
/api/order/create

09:32:13
HTTP 500

09:32:13
Console Error
TypeError
```

这是整个系统非常重要的数据结构。

因为以后 AI 分析、Bug 生成、回归都依赖 Timeline。

---

# 10. 操作记录

默认记录：

### 点击

记录：

```json
{
  "type": "click",
  "text": "提交订单",
  "tag": "button",
  "selector": "#submit-order"
}
```

---

### 输入

记录：

```text
字段：
商品数量

值：
99
```

密码字段不记录。

支持配置敏感字段：

```text
password
token
secret
身份证
银行卡
手机号
```

可以：

不记录

或者：

```text
138****1234
```

---

# 11. Network 记录

记录当前页面请求。

字段：

```text
Method

URL

Status

Duration

Request Header

Request Body

Response Header

Response Body
```

接口列表：

```text
全部 43

成功 39

4XX 1

5XX 2

慢接口 1
```

---

# 12. 异常检测

默认识别：

## HTTP 异常

```text
400
401
403
404
500
502
503
```

---

## 慢接口

默认：

```text
> 2000ms
```

允许配置。

---

## Console

捕获：

```text
console.error
```

以及：

```text
Uncaught Error

Unhandled Promise

TypeError

ReferenceError
```

---

# 13. 异常中心

页面：

```text
异常

━━━━━━━━━━━━━━

高

POST /api/order
HTTP 500

发生时间
09:32:13

关联操作
点击「提交订单」

━━━━━━━━━━━━━━

中

GET /api/customer
耗时 4200ms

关联操作
选择客户

━━━━━━━━━━━━━━

高

TypeError

Cannot read properties
of undefined
```

---

# 14. 发现问题

QA 一旦发现页面有问题，点击：

# 🚨 发现问题

系统立即保存：

问题发生前：

**30～60 秒上下文**

包含：

- 操作
- Network
- Console
- 页面
- 截图

形成：

# Bug Snapshot

这样 QA 即使继续测试，也不会丢失现场。

---

# 15. Bug 编辑页面

页面顶部：

```text
BUG-20260903-001
```

---

## Bug 标题

AI 自动生成：

```text
【订单创建】商品数量为99时提交订单出现系统异常
```

允许 QA 修改。

---

## 严重程度

AI 推荐：

```text
Blocker

Critical

Major

Minor

Suggestion
```

---

# 16. AI 自动生成复现步骤

根据 Timeline：

```text
1. 登录测试环境

2. 进入订单创建页面

3. 选择客户“河北钢铁集团”

4. 输入商品数量 99

5. 点击“提交订单”

6. 页面提示“系统异常”
```

---

# 17. 预期结果

AI 自动生成：

```text
系统应成功创建订单。

若商品库存不足，应提示明确的库存不足信息。
```

---

# 18. 实际结果

```text
点击提交订单后页面提示“系统异常”，订单创建失败。
```

---

# 19. 技术信息

自动添加：

```text
Environment

TEST

Browser

Chrome 152

OS

macOS

Viewport

1920×1080
```

---

# 20. 关联接口

自动识别最可能相关的请求。

例如：

```text
POST

/api/order/create

HTTP

500

Duration

438ms
```

Request：

```json
{
  "productId": 10028,
  "quantity": 99
}
```

Response：

```json
{
  "code": 50001,
  "message": "stock calculation error"
}
```

---

# 21. Console 信息

例如：

```text
TypeError:

Cannot read properties
of undefined

OrderCreate.js:328
```

---

# 22. AI 初步判断

AI 可以给出：

```text
疑似原因

后端订单创建接口返回
stock calculation error。

前端没有正确处理该异常，
最终向用户显示了通用
“系统异常”。

建议优先检查：

1. order/create 接口库存计算逻辑

2. 前端错误码映射逻辑
```

明确标记：

**AI 分析，仅供参考**

不能把 AI 推测当成 Bug 事实。

---

# 23. Bug 附件

默认：

```text
✓ Screenshot

✓ Session Timeline

✓ Network

✓ Console

✓ Request

✓ Response

✓ Environment
```

可选：

```text
HAR

DOM Snapshot

录像
```

录像可以放到 V1.1。

---

# 24. 提交 Bug

V1 第一阶段支持：

## Copy Markdown

生成：

```text
标题

环境

复现步骤

预期结果

实际结果

接口

Console

附件
```

QA 可以粘贴到任何 Bug 系统。

---

第二阶段支持：

```text
Jira

禅道

TAPD

飞书

Azure DevOps
```

通过 API 直接提交。

---

# 25. AI 测试用例

QA 点击：

## 🧪 生成测试用例

插件读取当前页面。

例如：

```text
创建用户

姓名 *

手机号 *

年龄

部门

用户类型

状态
```

识别 DOM：

```text
姓名

type=text
required
maxlength=50
```

手机号：

```text
required
pattern
```

年龄：

```text
type=number
min=0
max=120
```

---

# 26. AI 输出测试点

```text
正常测试

✓ 正常创建用户


必填验证

✓ 姓名为空

✓ 手机号为空


边界测试

✓ 姓名49字符

✓ 姓名50字符

✓ 姓名51字符


年龄

✓ -1

✓ 0

✓ 1

✓ 119

✓ 120

✓ 121


格式

✓ 非法手机号

✓ 含字母手机号

✓ 特殊字符


业务规则

✓ 重复手机号

✓ 无效部门


权限

✓ 普通用户创建

✓ 无权限用户创建
```

---

# 27. 测试数据生成器

点击输入框或者右键。

菜单：

```text
QA Copilot

正常值

空值

边界值

超长文本

随机中文

随机英文

特殊字符

Emoji

手机号

邮箱

日期

UUID

JSON
```

---

# 28. 智能边界值

插件读取：

```html
<input
 type="number"
 min="1"
 max="100"
/>
```

自动提供：

```text
0

1

2

99

100

101
```

这个功能非常实用。

---

# 29. 页面元素 Inspector

按：

```text
Alt + 鼠标点击
```

查看：

```text
Element

button

Text

提交订单

ID

submit-order

CSS

#submit-order

XPath

//*[@id="submit-order"]
```

自动生成：

### Playwright

```javascript
page.getByRole(
  'button',
  {
    name: '提交订单'
  }
)
```

### Selenium

```text
By.id("submit-order")
```

---

# 30. 环境管理

设置：

```text
商城项目

DEV
dev.xxx.com

TEST
test.xxx.com

UAT
uat.xxx.com

PROD
www.xxx.com
```

当前：

```text
https://test.xxx.com/order/123
```

点击：

## UAT

转换：

```text
https://uat.xxx.com/order/123
```

---

# 31. Bug 回归

历史 Bug：

```text
BUG-001

订单创建失败

状态：

待回归
```

点击：

## 回归

显示历史步骤：

```text
✓ 打开订单页面

✓ 选择商品

✓ 数量 99

→ 点击提交
```

插件记录新的测试结果。

Before：

```text
POST /order

500
```

After：

```text
POST /order

200
```

系统提示：

```text
异常已经不存在。

接口：

500 → 200

建议结果：

PASS
```

QA 最终人工确认：

```text
通过

不通过
```

---

# 32. V1 主菜单

保持非常简单：

```text
QA Copilot

首页

测试

Bug

API

AI助手

工具箱

设置
```

---

# 33. 首页

首页只展示：

```text
当前 Session

异常数量

最近异常

发现问题

结束测试
```

不要把首页做复杂。

---

# 34. 测试

```text
当前测试

历史 Session
```

---

# 35. Bug

```text
我的 Bug

待回归
```

---

# 36. API

```text
全部请求

异常请求

慢请求
```

Mock 暂时放 V1.1。

---

# 37. AI 助手

```text
生成测试用例

分析当前页面

分析异常
```

---

# 38. 工具箱

```text
测试数据

Locator

JSON

时间戳

编码转换
```

---

# 39. 设置

```text
项目

环境

AI 模型

敏感信息

Bug 平台

接口阈值
```

---

# 40. 数据模型

最核心有五个实体。

## Project

```text
Project
```

---

## Environment

```text
Environment
```

---

## TestSession

```text
TestSession
```

---

## Event

所有测试行为统一保存为 Event：

```text
click

input

navigation

network

console

error

screenshot
```

---

## Bug

Bug 引用 Session 中的一段 Event。

关系：

```text
Project

 └─ Environment

     └─ TestSession

         └─ Event

             └─ Bug
```

---

# 41. 技术方案

Chrome Extension：

```text
Manifest V3
```

前端建议：

```text
React

TypeScript

Vite
```

UI：

```text
Tailwind CSS

shadcn/ui
```

状态：

```text
Zustand
```

本地数据：

```text
IndexedDB

Dexie.js
```

---

# 42. Chrome 模块

主要包括：

```text
Background Service Worker

Content Script

Side Panel

DevTools Panel

Injected Script
```

---

# 43. Content Script

主要负责：

```text
DOM

Click

Input

Navigation

Element Selector
```

---

# 44. DevTools

负责：

```text
Network

HAR

Response

Performance
```

---

# 45. Background

负责：

```text
Session

消息通信

数据持久化

AI API

插件生命周期
```

---

# 46. AI 层

不要让 AI 直接处理所有原始数据。

应该先把信息结构化。

例如：

```json
{
  "action": {
    "type": "click",
    "element": "提交订单"
  },
  "request": {
    "method": "POST",
    "url": "/order",
    "status": 500
  },
  "console": [
    "TypeError..."
  ]
}
```

再传给 AI。

这样：

- Token 少
- 成本低
- 速度快
- AI 更稳定

---

# 47. 隐私设计

这是插件必须重点考虑的问题。

默认禁止发送：

```text
Password

Authorization

Cookie

Token

银行卡

身份证

敏感字段
```

到 AI。

提供：

## 数据脱敏层

例如：

```text
Authorization:

Bearer ********
```

手机号：

```text
138****1234
```

---

# 48. V1 暂时不做

以下功能先不要做：

```text
完整自动化测试

完整 API 测试平台

测试管理平台

录制转 Playwright

多人协作

Dashboard

性能测试

安全扫描

接口自动化

AI Agent 自动操作网页

大型知识库
```

这些东西非常容易把项目拖死。

---

# 49. V1 成功标准

核心指标不是功能数量。

而是：

## Bug 创建时间

传统：

```text
5～10分钟
```

目标：

```text
< 1分钟
```

---

## QA 手工操作

减少：

```text
截图

复制接口

复制 Response

复制 Console

写复现步骤

整理浏览器信息
```

---

# 50. 最核心用户体验

整个产品最重要的一个按钮：

# 「发现问题」

理想状态：

QA 测试过程中看到页面异常。

只需要：

```text
发现问题
```

系统就已经知道：

```text
QA之前做了什么

点击了什么

输入了什么

调用了什么API

API返回什么

Console报了什么

页面发生了什么
```

最终形成一个开发拿到以后：

> **不用再问 QA “怎么复现？”**

的高质量 Bug。

这就是 QA Copilot 第一版真正需要解决的问题。