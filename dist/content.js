var QACopilotContent = (function(exports) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  async function sendToBackground(message) {
    var _a, _b;
    try {
      if (typeof chrome === "undefined" || !((_a = chrome.runtime) == null ? void 0 : _a.id) || !((_b = chrome.runtime) == null ? void 0 : _b.sendMessage)) {
        return null;
      }
      return await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
              resolve(null);
            } else {
              resolve(response ?? null);
            }
          });
        } catch {
          resolve(null);
        }
      });
    } catch {
      return null;
    }
  }
  class LocatorGenerator {
    static quote(value) {
      return JSON.stringify(value);
    }
    static cssEscape(value) {
      var _a;
      const cssEscape = (_a = globalThis.CSS) == null ? void 0 : _a.escape;
      if (cssEscape) return cssEscape(value);
      return Array.from(value).map((char, index) => {
        const code = char.codePointAt(0) || 0;
        if (code === 0) return "\\fffd ";
        if (code >= 1 && code <= 31 || code === 127 || index === 0 && code >= 48 && code <= 57 || index === 1 && value[0] === "-" && code >= 48 && code <= 57) {
          return `\\${code.toString(16)} `;
        }
        if (code >= 128 || char === "-" || char === "_" || /[a-zA-Z0-9]/.test(char)) return char;
        return `\\${char}`;
      }).join("");
    }
    static generate(el) {
      const tag = el.tag.toLowerCase();
      const text = (el.text || el.ariaLabel || "").trim();
      const safeText = this.quote(text);
      const alternatives = [];
      const page = (el.frameCssPath || []).length > 0 ? `page${(el.frameCssPath || []).map((selector) => `.frameLocator(${this.quote(selector)})`).join("")}` : el.isChildFrame && el.frameUrl ? `page.frame({ url: new URL(${this.quote(el.frameUrl)}) })!` : "page";
      const cssId = el.id ? `#${this.cssEscape(el.id)}` : void 0;
      const effectiveRole = el.role || (tag === "button" ? "button" : tag === "a" ? "link" : void 0);
      if (effectiveRole && text) {
        const loc = `${page}.getByRole(${this.quote(effectiveRole)}, { name: ${safeText} })`;
        if (cssId) alternatives.push(`${page}.locator(${this.quote(cssId)})`);
        alternatives.push(`${page}.getByText(${safeText})`);
        return { recommended: loc, strategy: "role", alternatives };
      }
      if (el.label) {
        const loc = `${page}.getByLabel(${this.quote(el.label)})`;
        if (el.testId) alternatives.push(`${page}.getByTestId(${this.quote(el.testId)})`);
        return { recommended: loc, strategy: "label", alternatives };
      }
      if (text && text.length < 80 && !["input", "select", "textarea"].includes(tag)) {
        const loc = `${page}.getByText(${safeText})`;
        if (el.testId) alternatives.push(`${page}.getByTestId(${this.quote(el.testId)})`);
        if (cssId) alternatives.push(`${page}.locator(${this.quote(cssId)})`);
        return { recommended: loc, strategy: "text", alternatives };
      }
      if (el.testId) {
        return { recommended: `${page}.getByTestId(${this.quote(el.testId)})`, strategy: "testid", alternatives };
      }
      if (el.placeholder) {
        const loc = `${page}.getByPlaceholder(${this.quote(el.placeholder)})`;
        return { recommended: loc, strategy: "label", alternatives };
      }
      const css = cssId || (el.name ? `${tag}[name=${this.quote(el.name)}]` : tag);
      return {
        recommended: `${page}.locator(${this.quote(css)})`,
        strategy: "css",
        alternatives
      };
    }
  }
  const FRAME_GEOMETRY_SOURCE = "QA_COPILOT_FRAME_GEOMETRY";
  const pendingFramePointRequests = /* @__PURE__ */ new Map();
  let frameGeometryListenerInstalled = false;
  function parseCSSZoom(style) {
    const zoom = Number.parseFloat(style.zoom ?? "1");
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }
  function xpathLiteral$1(value) {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat(${value.split("'").map((part, index) => `${index ? `,"'",` : ""}'${part}'`).join("")})`;
  }
  function getFrameXPath(frame) {
    if (frame.id) {
      try {
        if (frame.ownerDocument.querySelectorAll(`#${escapeCssIdentifier(frame.id)}`).length === 1) {
          return `//*[@id=${xpathLiteral$1(frame.id)}]`;
        }
      } catch {
      }
    }
    const name = frame.getAttribute("name");
    if (name && Array.from(frame.ownerDocument.querySelectorAll("iframe,frame")).filter((candidate) => candidate.getAttribute("name") === name).length === 1) {
      return `//${frame.tagName.toLowerCase()}[@name=${xpathLiteral$1(name)}]`;
    }
    const parts = [];
    let current = frame;
    while (current && current !== frame.ownerDocument.documentElement) {
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === (current == null ? void 0 : current.tagName)) : [];
      const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : "";
      parts.unshift(`${current.tagName.toLowerCase()}${index}`);
      current = current.parentElement;
    }
    return `/html/${parts.join("/")}`;
  }
  function escapeCssIdentifier(value) {
    var _a;
    const cssEscape = (_a = globalThis.CSS) == null ? void 0 : _a.escape;
    if (cssEscape) return cssEscape(value);
    return Array.from(value).map((char, index) => {
      const code = char.codePointAt(0) || 0;
      if (code === 0) return "\\fffd ";
      if (code >= 1 && code <= 31 || code === 127 || index === 0 && code >= 48 && code <= 57 || index === 1 && value[0] === "-" && code >= 48 && code <= 57) {
        return `\\${code.toString(16)} `;
      }
      if (code >= 128 || char === "-" || char === "_" || /[a-zA-Z0-9]/.test(char)) return char;
      return `\\${char}`;
    }).join("");
  }
  function getFrameCssSelector(frame) {
    const path = [];
    let current = frame;
    while (current && current !== frame.ownerDocument.documentElement) {
      const tag = current.tagName.toLowerCase();
      const name = current === frame ? current.getAttribute("name") : null;
      let segment = current.id ? `${tag}#${escapeCssIdentifier(current.id)}` : name ? `${tag}[name=${JSON.stringify(name)}]` : tag;
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter((item) => item.tagName === (current == null ? void 0 : current.tagName));
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      path.unshift(segment);
      current = current.parentElement;
    }
    path.unshift("html");
    return path.join(" > ");
  }
  function calculateIframeOffset(nodeOwnerDoc, rootDoc) {
    let left = 0;
    let top = 0;
    let accumulatedZoom = 1;
    let iterDoc = nodeOwnerDoc;
    const frameXPath = [];
    const frameCssPath = [];
    let complete = true;
    while (iterDoc && true) {
      const childWindow = iterDoc.defaultView;
      if (!childWindow || childWindow === childWindow.top) break;
      try {
        const frameElement = childWindow.frameElement;
        if (!frameElement) {
          complete = false;
          break;
        }
        const parentWindow = frameElement.ownerDocument.defaultView;
        if (!parentWindow) {
          complete = false;
          break;
        }
        const style = parentWindow.getComputedStyle(frameElement);
        const zoom = parseCSSZoom(style);
        const mappedPoint = mapChildPointIntoParent(frameElement, { x: left, y: top });
        left = mappedPoint.x;
        top = mappedPoint.y;
        accumulatedZoom *= zoom;
        frameXPath.unshift(getFrameXPath(frameElement));
        frameCssPath.unshift(getFrameCssSelector(frameElement));
        iterDoc = frameElement.ownerDocument;
      } catch {
        complete = false;
        break;
      }
    }
    if ((iterDoc == null ? void 0 : iterDoc.defaultView) && iterDoc.defaultView !== iterDoc.defaultView.top && true) {
      complete = false;
    }
    return { left, top, zoom: accumulatedZoom, frameXPath, frameCssPath, complete };
  }
  function mapChildPointIntoParent(frameElement, point) {
    var _a, _b, _c;
    const style = (_a = frameElement.ownerDocument.defaultView) == null ? void 0 : _a.getComputedStyle(frameElement);
    if (!style) throw new Error("读取 iframe 样式失败");
    const frame = frameElement;
    let contentQuad;
    try {
      contentQuad = (_c = (_b = frame.getBoxQuads) == null ? void 0 : _b.call(frame, { box: "content" })) == null ? void 0 : _c[0];
    } catch {
    }
    if (contentQuad) {
      const paddingLeft2 = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      const paddingTop2 = Number.parseFloat(style.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
      const width = Math.max(1, frameElement.clientWidth - paddingLeft2 - paddingRight);
      const height = Math.max(1, frameElement.clientHeight - paddingTop2 - paddingBottom);
      const u = point.x / width;
      const v = point.y / height;
      return {
        x: contentQuad.p1.x + u * (contentQuad.p2.x - contentQuad.p1.x) + v * (contentQuad.p4.x - contentQuad.p1.x),
        y: contentQuad.p1.y + u * (contentQuad.p2.y - contentQuad.p1.y) + v * (contentQuad.p4.y - contentQuad.p1.y)
      };
    }
    const rect = frameElement.getBoundingClientRect();
    const frameMetrics = frameElement;
    const zoom = parseCSSZoom(style);
    const scaleX = frameMetrics.offsetWidth > 0 ? rect.width / frameMetrics.offsetWidth : zoom;
    const scaleY = frameMetrics.offsetHeight > 0 ? rect.height / frameMetrics.offsetHeight : zoom;
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    return {
      x: rect.left + (borderLeft + paddingLeft) * scaleX + point.x * scaleX,
      y: rect.top + (borderTop + paddingTop) * scaleY + point.y * scaleY
    };
  }
  function installFrameGeometryListener() {
    if (frameGeometryListenerInstalled || typeof window === "undefined") return;
    frameGeometryListenerInstalled = true;
    window.addEventListener("message", (event) => {
      var _a;
      const data = event.data;
      if (!data || data.source !== FRAME_GEOMETRY_SOURCE || typeof data.requestId !== "string") return;
      if (data.type === "response") {
        if (event.source !== window.parent) return;
        const pending = pendingFramePointRequests.get(data.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingFramePointRequests.delete(data.requestId);
        const point = Number.isFinite(data.x) && Number.isFinite(data.y) ? {
          x: Number(data.x),
          y: Number(data.y),
          frameCssPath: Array.isArray(data.frameCssPath) ? data.frameCssPath.filter((item) => typeof item === "string") : [],
          frameXPath: Array.isArray(data.frameXPath) ? data.frameXPath.filter((item) => typeof item === "string") : [],
          zoom: Number.isFinite(data.zoom) && Number(data.zoom) > 0 ? Number(data.zoom) : 1
        } : null;
        pending.resolve(point);
        return;
      }
      if (data.type !== "request" || !event.source || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      const source = event.source;
      const frame = Array.from(document.querySelectorAll("iframe,frame")).find((candidate) => candidate.contentWindow === source);
      if (!frame) return;
      let parentPoint;
      try {
        parentPoint = mapChildPointIntoParent(frame, { x: Number(data.x), y: Number(data.y) });
      } catch {
        return;
      }
      const respond = (point) => {
        try {
          source.postMessage({
            source: FRAME_GEOMETRY_SOURCE,
            type: "response",
            requestId: data.requestId,
            x: point == null ? void 0 : point.x,
            y: point == null ? void 0 : point.y,
            frameCssPath: point == null ? void 0 : point.frameCssPath,
            frameXPath: point == null ? void 0 : point.frameXPath,
            zoom: point == null ? void 0 : point.zoom
          }, event.origin === "null" ? "*" : event.origin);
        } catch {
        }
      };
      const frameCssSelector = getFrameCssSelector(frame);
      const frameXPath = getFrameXPath(frame);
      const style = (_a = frame.ownerDocument.defaultView) == null ? void 0 : _a.getComputedStyle(frame);
      const localZoom = style ? parseCSSZoom(style) : 1;
      if (window === window.top) {
        respond({
          ...parentPoint,
          frameCssPath: [frameCssSelector],
          frameXPath: [frameXPath],
          zoom: localZoom
        });
        return;
      }
      mapPointToTopFrame(parentPoint.x, parentPoint.y).then((topPoint) => respond(topPoint && {
        x: topPoint.x,
        y: topPoint.y,
        frameCssPath: [...topPoint.frameCssPath || [], frameCssSelector],
        frameXPath: [...topPoint.frameXPath || [], frameXPath],
        zoom: (topPoint.zoom || 1) * localZoom
      })).catch(() => respond(null));
    }, true);
  }
  function initializeFrameGeometryRelay() {
    installFrameGeometryListener();
  }
  function mapPointToTopFrame(x, y, timeoutMs = 2e3) {
    if (typeof window === "undefined" || window === window.top) {
      return Promise.resolve({ x, y, frameCssPath: [], frameXPath: [], zoom: 1 });
    }
    installFrameGeometryListener();
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingFramePointRequests.delete(requestId);
        resolve(null);
      }, timeoutMs);
      pendingFramePointRequests.set(requestId, { resolve, timer });
      try {
        window.parent.postMessage({ source: FRAME_GEOMETRY_SOURCE, type: "request", requestId, x, y }, "*");
      } catch {
        clearTimeout(timer);
        pendingFramePointRequests.delete(requestId);
        resolve(null);
      }
    });
  }
  function getCurrentFrameGeometry() {
    return calculateIframeOffset(document);
  }
  class DomAnalyzer {
    static isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    static parsePageFields(root = document) {
      const fields = [];
      root.querySelectorAll("input, select, textarea").forEach((element) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const input = element;
        if (input.type === "hidden" || input.type === "submit" || input.type === "button") return;
        if (!this.isVisible(input)) return;
        let label = ((_c = (_b = (_a = input.labels) == null ? void 0 : _a[0]) == null ? void 0 : _b.textContent) == null ? void 0 : _c.trim()) || "";
        if (!label && input.id) label = ((_e = (_d = root.querySelector(`label[for="${CSS.escape(input.id)}"]`)) == null ? void 0 : _d.textContent) == null ? void 0 : _e.trim()) || "";
        if (!label) label = ((_g = (_f = input.closest("label")) == null ? void 0 : _f.textContent) == null ? void 0 : _g.replace(input.value || "", "").trim()) || "";
        if (!label) label = input.name || input.placeholder || "未命名字段";
        const min = input.min === "" ? void 0 : Number(input.min);
        const max = input.max === "" ? void 0 : Number(input.max);
        fields.push({
          tag: input.tagName.toLowerCase(),
          name: input.name || input.id || "",
          label,
          type: input.type || input.tagName.toLowerCase(),
          required: input.required || input.hasAttribute("required"),
          maxLength: input.maxLength > 0 ? input.maxLength : void 0,
          min: min !== void 0 && Number.isFinite(min) ? min : void 0,
          max: max !== void 0 && Number.isFinite(max) ? max : void 0,
          pattern: input.pattern || void 0,
          placeholder: input.placeholder || void 0
        });
      });
      return fields;
    }
    static parsePageActions(root = document) {
      const actions = [];
      root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((element) => {
        const control = element;
        if (!this.isVisible(control)) return;
        const label = (control.getAttribute("aria-label") || control.textContent || control.value || control.title || "").trim();
        if (!label) return;
        actions.push({
          tag: control.tagName.toLowerCase(),
          type: control.getAttribute("type") || control.getAttribute("role") || "button",
          label: label.slice(0, 120),
          name: control.getAttribute("name") || control.id || void 0
        });
      });
      return actions.slice(0, 50);
    }
    static parsePageContext(root = document) {
      return {
        fields: this.parsePageFields(root),
        actions: this.parsePageActions(root),
        formCount: root.querySelectorAll("form").length
      };
    }
  }
  function isDomElement(el) {
    if (!el || typeof el !== "object") return false;
    if (typeof Element !== "undefined") {
      return el instanceof Element;
    }
    return typeof el.tagName === "string";
  }
  function isInputLike(el) {
    if (!isDomElement(el)) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function safeEscapeCss$1(id) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(id);
    }
    return id.replace(/["\\]/g, "\\$&");
  }
  function cleanLabelText(text) {
    return text.replace(/^[\s*：:·•\-—]+/, "").replace(/[\s*：:·•\-—]+$/, "").replace(/\s+/g, " ").trim();
  }
  function stripActionPrefix(text) {
    if (!text) return "";
    let s = cleanLabelText(text);
    const prefixes = [
      /^请选择[\/或与及并]?输入\s*/i,
      /^请选择[\/或与及并]?填写\s*/i,
      /^请选择[\/或与及并]?搜索\s*/i,
      /^请选择\s*/i,
      /^请挑选\s*/i,
      /^请指定\s*/i,
      /^请设置\s*/i,
      /^请勾选\s*/i,
      /^请录入\s*/i,
      /^请输入\s*/i,
      /^请填写\s*/i,
      /^请搜索\s*/i,
      /^请点击选择\s*/i,
      /^please\s+select[\s\/or]+enter\s*/i,
      /^please\s+select\s*/i,
      /^please\s+choose\s*/i,
      /^please\s+enter\s*/i,
      /^please\s+input\s*/i,
      /^select\s*/i,
      /^choose\s*/i,
      /^search\s*/i,
      /^enter\s*/i,
      /^input\s*/i
    ];
    for (const re of prefixes) {
      if (re.test(s)) {
        s = s.replace(re, "").trim();
        break;
      }
    }
    s = cleanLabelText(s);
    if (!s || s === "请选择" || s === "选择" || s === "请输入" || s === "输入" || s === "搜索" || s === "--" || s === "---" || s === "暂无" || s.toLowerCase() === "select" || s.toLowerCase() === "choose") {
      return "";
    }
    return s;
  }
  const COMMON_FIELD_SEMANTICS = {
    name: "姓名",
    username: "用户名",
    user: "用户",
    nickname: "昵称",
    realname: "真实姓名",
    account: "账号",
    password: "密码",
    pwd: "密码",
    email: "电子邮箱",
    mail: "邮箱",
    phone: "手机号码",
    mobile: "手机号",
    tel: "联系电话",
    telephone: "电话",
    role: "角色",
    roleid: "角色",
    roles: "角色",
    dept: "所属部门",
    deptid: "所属部门",
    department: "所属部门",
    departmentid: "所属部门",
    company: "所属公司",
    corp: "企业名称",
    org: "所属组织",
    organization: "所属机构",
    gender: "性别",
    sex: "性别",
    age: "年龄",
    birthday: "出生日期",
    birth: "出生日期",
    status: "状态",
    state: "状态",
    type: "类型",
    category: "分类",
    class: "类别",
    level: "级别",
    grade: "等级",
    title: "标题",
    subject: "主题",
    desc: "描述",
    description: "详细描述",
    remark: "备注",
    content: "内容",
    address: "地址",
    addr: "地址",
    city: "城市",
    province: "省份",
    area: "地区",
    region: "区域",
    country: "国家",
    date: "日期",
    time: "时间",
    createdat: "创建时间",
    amount: "金额",
    price: "价格",
    money: "费用",
    code: "编码",
    orderno: "订单编号",
    idcard: "身份证号",
    postcode: "邮政编码",
    zipcode: "邮编"
  };
  function findAssociatedInput(el) {
    if (!isDomElement(el)) return null;
    if (isInputLike(el)) {
      return el;
    }
    try {
      const isWrapper = Boolean(
        el.className && typeof el.className === "string" && /input[-_]?wrapper|input[-_]?affix|select[-_]?wrapper|el-input|ant-input|n-input|arco-input|el-select|ant-select|n-select|arco-select/i.test(el.className) || typeof el.matches === "function" && el.matches('.el-input, .el-input__wrapper, .el-textarea, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, .el-select, .ant-select, .arco-select, .n-select, [class*="input-wrapper"], [class*="select-trigger"], [class*="select__wrapper"], [class*="select-selector"]')
      );
      if (isWrapper && typeof el.querySelector === "function") {
        const inside = el.querySelector(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
        );
        if (inside) return inside;
      }
    } catch {
    }
    try {
      if (typeof el.closest === "function") {
        const wrapper = el.closest(
          '.el-input, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, .el-select, .ant-select, .arco-select, .n-select, [class*="input-wrapper"], [class*="select-trigger"], [class*="select__wrapper"]'
        );
        if (wrapper && wrapper !== el && typeof wrapper.querySelector === "function") {
          const input = wrapper.querySelector(
            'input:not([type="hidden"]), textarea, select'
          );
          if (input) return input;
        }
      }
    } catch {
    }
    return null;
  }
  function findComponentWrapper(el) {
    if (!isDomElement(el)) return el;
    try {
      if (typeof el.closest === "function") {
        const wrapper = el.closest(
          '.el-select, .el-select-v2, .el-cascader, .el-tree-select, .ant-select, .ant-cascader, .ant-tree-select, .arco-select, .arco-cascader, .arco-tree-select, .n-select, .n-base-selection, .t-select, .semi-select, .ivu-select, .layui-form-select, .v-select, .custom-select, [class*="select-container"], [class*="selectBox"], [class*="select-box"], [class*="dropdown-select"]'
        );
        if (wrapper) return wrapper;
      }
    } catch {
    }
    return el;
  }
  function getVisualSpatialLabel(el, searchContainer) {
    var _a, _b, _c;
    if (!isDomElement(el)) return "";
    if (typeof el.getBoundingClientRect !== "function") return "";
    let targetRect = el.getBoundingClientRect();
    if ((!targetRect || targetRect.width <= 0 || targetRect.height <= 0) && typeof el.closest === "function") {
      const parentComp = el.closest(".el-select, .ant-select, .vue-treeselect, .el-radio-group, .el-input, .el-textarea");
      if (parentComp && typeof parentComp.getBoundingClientRect === "function") {
        targetRect = parentComp.getBoundingClientRect();
      }
    }
    if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) return "";
    const container = (typeof el.closest === "function" ? el.closest('.el-dialog, .el-drawer, .ant-modal, .arco-modal, form, .el-form, .ant-form, [class*="row"], [class*="form"], body') : null) || (el.parentElement && typeof el.parentElement.querySelectorAll === "function" ? el.parentElement : null) || (typeof document !== "undefined" && typeof document.querySelectorAll === "function" ? document : null);
    if (!container || typeof container.querySelectorAll !== "function") return "";
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const targetLeft = targetRect.left;
    const targetTop = targetRect.top;
    const candidates = Array.from(
      container.querySelectorAll('label, .el-form-item__label, .ant-form-item-label, .arco-form-item-label, [class*="label"], [class*="title"], dt, th, span, div, p')
    );
    let bestMatchText = "";
    let bestScore = Infinity;
    for (const cand of candidates) {
      if (!cand || cand === el) continue;
      if ((_a = cand.closest) == null ? void 0 : _a.call(cand, '.el-message, .el-notification, .ant-message, .ant-notification, [role="alert"], [role="status"], [class*="toast"]')) continue;
      if (typeof cand.contains === "function" && cand.contains(el) || typeof el.contains === "function" && el.contains(cand)) continue;
      if ((_b = cand.querySelector) == null ? void 0 : _b.call(cand, 'input, select, textarea, [role="combobox"]')) continue;
      if ((_c = cand.closest) == null ? void 0 : _c.call(cand, '.el-radio, .ant-radio, .arco-radio, .n-radio, .el-checkbox, .ant-checkbox, .el-radio-group, .ant-radio-group, [role="radiogroup"]')) continue;
      const candRect = typeof cand.getBoundingClientRect === "function" ? cand.getBoundingClientRect() : null;
      if (!candRect || candRect.width <= 0 || candRect.height <= 0) continue;
      const candCenterY = candRect.top + candRect.height / 2;
      const candRight = candRect.right;
      const candBottom = candRect.bottom;
      const text = (cand.innerText || cand.textContent || "").trim();
      if (!text || text.length > 30 || text.includes("\n")) continue;
      const cleaned = cleanLabelText(text);
      if (!cleaned) continue;
      const isToLeft = candRight <= targetLeft + 15 && candRight >= targetLeft - 320;
      const isSameRow = Math.abs(candCenterY - targetCenterY) <= Math.max(targetRect.height, candRect.height, 32);
      if (isToLeft && isSameRow) {
        const horizontalDist = Math.max(0, targetLeft - candRight);
        const verticalOffset = Math.abs(candCenterY - targetCenterY);
        const score = horizontalDist + verticalOffset * 2.5;
        if (score < bestScore) {
          bestScore = score;
          bestMatchText = cleaned;
        }
        continue;
      }
      const isAbove = candBottom <= targetTop + 10 && candBottom >= targetTop - 90;
      const isHorizAligned = Math.abs(candRect.left + candRect.width / 2 - (targetLeft + targetRect.width / 2)) <= Math.max(targetRect.width, 120);
      if (isAbove && isHorizAligned) {
        const verticalDist = Math.max(0, targetTop - candBottom);
        const horizontalOffset = Math.abs(candRect.left + candRect.width / 2 - (targetLeft + targetRect.width / 2));
        const score = verticalDist * 1.5 + horizontalOffset + 50;
        if (score < bestScore) {
          bestScore = score;
          bestMatchText = cleaned;
        }
      }
    }
    if (bestMatchText) {
      const stripped = stripActionPrefix(bestMatchText);
      return stripped || bestMatchText;
    }
    return "";
  }
  function getElementLabel(el) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    if (!isDomElement(el)) return "";
    const targetInput = isInputLike(el) ? el : findAssociatedInput(el) || el;
    const componentWrapper = findComponentWrapper(el);
    const spatialLabel = getVisualSpatialLabel(componentWrapper || targetInput);
    if (spatialLabel && spatialLabel !== "未命名字段") {
      return spatialLabel;
    }
    let rawCandidate = "";
    if (targetInput.labels && targetInput.labels.length > 0) {
      rawCandidate = targetInput.labels[0].textContent || "";
    }
    if (!rawCandidate && typeof document !== "undefined" && typeof document.querySelector === "function") {
      try {
        const idToFind = targetInput.id || (componentWrapper !== targetInput ? componentWrapper.id : null);
        if (idToFind) {
          const forLabel = document.querySelector(`label[for="${safeEscapeCss$1(idToFind)}"]`);
          if (forLabel) rawCandidate = forLabel.textContent || "";
        }
      } catch {
      }
    }
    if (!rawCandidate) {
      try {
        const parentLabel = (typeof componentWrapper.closest === "function" ? componentWrapper.closest("label") : null) || (typeof targetInput.closest === "function" ? targetInput.closest("label") : null);
        if (parentLabel) {
          const isRadioOptionWrapper = targetInput.type === "radio" && Boolean(
            ((_b = (_a = parentLabel.classList) == null ? void 0 : _a.contains) == null ? void 0 : _b.call(_a, "el-radio")) || ((_d = (_c = parentLabel.classList) == null ? void 0 : _c.contains) == null ? void 0 : _d.call(_c, "ant-radio")) || ((_f = (_e = parentLabel.classList) == null ? void 0 : _e.contains) == null ? void 0 : _f.call(_e, "arco-radio")) || ((_h = (_g = parentLabel.classList) == null ? void 0 : _g.contains) == null ? void 0 : _h.call(_g, "n-radio")) || ((_i = parentLabel.closest) == null ? void 0 : _i.call(parentLabel, '.el-form-item, .ant-form-item, .arco-form-item, [role="radiogroup"]'))
          );
          if (!isRadioOptionWrapper) {
            let labelText = parentLabel.textContent || "";
            if (targetInput.value) {
              labelText = labelText.replace(String(targetInput.value), "");
            }
            rawCandidate = labelText;
          }
        }
      } catch {
      }
    }
    if (!rawCandidate) {
      try {
        const formItemSelector = [
          ".el-form-item",
          ".ant-form-item",
          ".arco-form-item",
          ".n-form-item",
          ".t-form-item",
          ".semi-form-item",
          ".ivu-form-item",
          ".layui-form-item",
          ".form-group",
          ".form-item",
          ".form-row",
          ".form-line",
          ".field-row",
          ".field-item",
          '[class*="form-item"]',
          '[class*="formItem"]',
          '[class*="form-group"]',
          "fieldset"
        ].join(", ");
        const formItem = (typeof componentWrapper.closest === "function" ? componentWrapper.closest(formItemSelector) : null) || (typeof targetInput.closest === "function" ? targetInput.closest(formItemSelector) : null);
        if (formItem && typeof formItem.querySelector === "function") {
          const labelSelector = [
            ".el-form-item__label",
            ".ant-form-item-label",
            ".arco-form-item-label",
            ".n-form-item-label",
            '[class*="form-item__label"]',
            '[class*="form-label"]',
            '[class*="item-label"]',
            '[class*="field-label"]',
            '[class*="field-title"]',
            '[class*="item-title"]',
            "legend",
            "dt",
            "th",
            "label"
          ].join(", ");
          const candidateLabels = typeof formItem.querySelectorAll === "function" ? Array.from(formItem.querySelectorAll(labelSelector)) : typeof formItem.querySelector === "function" ? [formItem.querySelector(labelSelector)].filter(Boolean) : [];
          for (const labelEl of candidateLabels) {
            const isSelf = labelEl === targetInput || labelEl === componentWrapper;
            const containsTarget = typeof labelEl.contains === "function" && (labelEl.contains(targetInput) || labelEl.contains(componentWrapper));
            const isInsideTarget = typeof targetInput.contains === "function" && targetInput.contains(labelEl) || typeof componentWrapper.contains === "function" && componentWrapper.contains(labelEl);
            const isOptionLabel = Boolean(
              (_j = labelEl.closest) == null ? void 0 : _j.call(
                labelEl,
                '.el-radio, .ant-radio, .arco-radio, .n-radio, .el-checkbox, .ant-checkbox, .el-radio-group, .ant-radio-group, [role="radiogroup"]'
              )
            );
            if (!isSelf && !containsTarget && !isInsideTarget && !isOptionLabel) {
              const txt = (labelEl.textContent || "").trim();
              if (txt) {
                rawCandidate = txt;
                break;
              }
            }
          }
        }
      } catch {
      }
    }
    if (!rawCandidate) {
      try {
        const probeNodes = [componentWrapper, targetInput];
        for (const node of probeNodes) {
          if (!node) continue;
          const prev = node.previousElementSibling || (node.parentElement && node.parentElement.children && node.parentElement.children.length === 1 ? node.parentElement.previousElementSibling : null);
          if (prev && typeof prev.tagName === "string") {
            const tag = prev.tagName.toUpperCase();
            if (["LABEL", "SPAN", "DIV", "P", "TD", "TH", "B", "STRONG"].includes(tag)) {
              const prevText = (prev.textContent || prev.innerText || "").trim();
              if (prevText && prevText.length <= 35 && !prevText.includes("\n")) {
                rawCandidate = prevText;
                break;
              }
            }
          }
        }
      } catch {
      }
    }
    if (!rawCandidate) {
      try {
        const td = (typeof componentWrapper.closest === "function" ? componentWrapper.closest("td") : null) || (typeof targetInput.closest === "function" ? targetInput.closest("td") : null);
        if (td && td.previousElementSibling) {
          const prevTdText = (td.previousElementSibling.textContent || td.previousElementSibling.innerText || "").trim();
          if (prevTdText && prevTdText.length <= 35) {
            rawCandidate = prevTdText;
          }
        }
      } catch {
      }
    }
    if (!rawCandidate) {
      const probeNodes = [componentWrapper, targetInput];
      for (const node of probeNodes) {
        if (!node || typeof node.getAttribute !== "function") continue;
        const labelledby = node.getAttribute("aria-labelledby");
        if (labelledby && typeof document !== "undefined" && typeof document.getElementById === "function") {
          try {
            const refEl = document.getElementById(labelledby);
            if (refEl && refEl.textContent) {
              rawCandidate = refEl.textContent.trim();
              break;
            }
          } catch {
          }
        }
        const ariaLabel = node.getAttribute("aria-label");
        if (ariaLabel) {
          rawCandidate = ariaLabel.trim();
          break;
        }
        const titleAttr = node.getAttribute("title");
        if (titleAttr) {
          rawCandidate = titleAttr.trim();
          break;
        }
      }
    }
    let strippedPlaceholder = "";
    try {
      let ph = targetInput.placeholder || (typeof targetInput.getAttribute === "function" ? targetInput.getAttribute("placeholder") : "") || (typeof componentWrapper.getAttribute === "function" ? componentWrapper.getAttribute("placeholder") : "") || "";
      if (!ph && typeof componentWrapper.querySelector === "function") {
        const phEl = componentWrapper.querySelector(
          '.el-select__placeholder, .ant-select-selection-placeholder, .arco-select-view-placeholder, [class*="placeholder"]'
        );
        if (phEl && phEl.textContent) {
          ph = phEl.textContent.trim();
        }
      }
      if (ph) {
        strippedPlaceholder = stripActionPrefix(ph);
      }
    } catch {
    }
    const cleanedRaw = cleanLabelText(rawCandidate);
    if (cleanedRaw && cleanedRaw.length <= 40) {
      const stripped = stripActionPrefix(cleanedRaw);
      return stripped || cleanedRaw;
    }
    if (strippedPlaceholder && strippedPlaceholder.length <= 40) {
      return strippedPlaceholder;
    }
    const fallbackPh = targetInput.placeholder || (typeof componentWrapper.getAttribute === "function" ? componentWrapper.getAttribute("placeholder") : "");
    if (fallbackPh && !fallbackPh.startsWith("请选择") && !fallbackPh.startsWith("请输入") && fallbackPh !== "请选择") {
      const cleanedPh = cleanLabelText(fallbackPh);
      if (cleanedPh && cleanedPh.length <= 40) {
        return cleanedPh;
      }
    }
    const rawName = targetInput.name || (typeof componentWrapper.getAttribute === "function" ? componentWrapper.getAttribute("name") : "");
    if (rawName && typeof rawName === "string") {
      const cleanKey = rawName.toLowerCase().replace(/[-_]/g, "");
      if (COMMON_FIELD_SEMANTICS[cleanKey]) {
        return COMMON_FIELD_SEMANTICS[cleanKey];
      }
      if (!/^(el-id|ant-select|rc_select|form_|input_|\d+)/i.test(rawName)) {
        return rawName.replace(/([A-Z])/g, " $1").replace(/[-_]/g, " ").trim();
      }
    }
    return "";
  }
  function describeClickElement(target) {
    var _a, _b, _c, _d, _e;
    const associatedInput = findAssociatedInput(target);
    const effectiveTarget = associatedInput || target;
    const tag = (effectiveTarget.tagName || "").toUpperCase();
    const isInput = Boolean(
      associatedInput || ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || ((_a = effectiveTarget.getAttribute) == null ? void 0 : _a.call(effectiveTarget, "contenteditable")) === "true" || ["textbox", "combobox", "searchbox"].includes(((_b = effectiveTarget.getAttribute) == null ? void 0 : _b.call(effectiveTarget, "role")) || "")
    );
    const fieldLabel = getElementLabel(effectiveTarget);
    const rawText = (effectiveTarget.innerText || effectiveTarget.textContent || ((_c = effectiveTarget.getAttribute) == null ? void 0 : _c.call(effectiveTarget, "aria-label")) || ((_d = effectiveTarget.getAttribute) == null ? void 0 : _d.call(effectiveTarget, "title")) || "").trim();
    let text = rawText;
    if (!isInput && rawText.includes("\n")) {
      const firstLine = rawText.split("\n").map((l) => l.trim()).filter(Boolean)[0];
      if (firstLine) {
        text = firstLine;
      }
    }
    text = text.slice(0, 40).trim();
    if (isInput && fieldLabel) {
      text = fieldLabel;
    } else if (!text && fieldLabel) {
      text = fieldLabel;
    }
    let title = "";
    let description = "";
    if (isInput && fieldLabel) {
      const isSelect = tag === "SELECT" || ((_e = effectiveTarget.getAttribute) == null ? void 0 : _e.call(effectiveTarget, "role")) === "combobox";
      title = `点击「${fieldLabel}」`;
      description = isSelect ? `点击「${fieldLabel}」下拉选择框` : `点击「${fieldLabel}」输入框`;
    } else if (text) {
      title = `点击 ${text}`;
      description = `点击「${text}」`;
    } else {
      title = `点击 ${tag}`;
      description = "";
    }
    return {
      title,
      description,
      fieldLabel: fieldLabel || void 0,
      text,
      isInput,
      effectiveTarget
    };
  }
  class FormDOMRegistry {
    static register(fieldId, element, snapshotId, optionElements) {
      this.registry.set(fieldId, { element, snapshotId, optionElements });
    }
    static get(fieldId, expectedSnapshotId) {
      const item = this.registry.get(fieldId);
      if (!item) return null;
      if (expectedSnapshotId && item.snapshotId !== expectedSnapshotId) return null;
      if (typeof document !== "undefined" && document.contains && !document.contains(item.element)) return null;
      return item.element;
    }
    static getOptionElement(fieldId, valOrLabel, expectedSnapshotId) {
      const item = this.registry.get(fieldId);
      if (!item || !item.optionElements) return null;
      if (expectedSnapshotId && item.snapshotId !== expectedSnapshotId) return null;
      return item.optionElements.get(valOrLabel) || null;
    }
    static readRadioGroupValue(element) {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const entry = [...this.registry.values()].find((item) => item.element === element && item.optionElements);
      if (!entry) return void 0;
      for (const [label, node] of entry.optionElements) {
        const radio = node.tagName === "INPUT" ? node : (_a = node.querySelector) == null ? void 0 : _a.call(node, 'input[type="radio"]');
        const isChecked = (radio == null ? void 0 : radio.checked) || Boolean(
          ((_c = (_b = node.classList) == null ? void 0 : _b.contains) == null ? void 0 : _c.call(_b, "is-checked")) || ((_e = (_d = node.classList) == null ? void 0 : _d.contains) == null ? void 0 : _e.call(_d, "ant-radio-checked")) || ((_g = (_f = node.classList) == null ? void 0 : _f.contains) == null ? void 0 : _g.call(_f, "arco-radio-checked")) || ((_h = node.getAttribute) == null ? void 0 : _h.call(node, "aria-checked")) === "true"
        );
        if (isChecked) return label;
      }
      return "";
    }
    static clearSnapshot(snapshotId) {
      for (const [key, val] of this.registry.entries()) {
        if (val.snapshotId === snapshotId) {
          this.registry.delete(key);
        }
      }
    }
    static clearAll() {
      this.registry.clear();
    }
  }
  __publicField(FormDOMRegistry, "registry", /* @__PURE__ */ new Map());
  const _FormScanner = class _FormScanner {
    /**
     * 元素可见性检测：增强支持被 Element Plus/AntD 隐藏原生 input 的 Radio/Checkbox
     */
    static isVisible(element) {
      var _a, _b, _c;
      for (let node = element; node; node = node.parentElement) {
        const computed = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(node) : node.style;
        if (node.hidden || ((_a = node.getAttribute) == null ? void 0 : _a.call(node, "aria-hidden")) === "true" || (computed == null ? void 0 : computed.display) === "none" || (computed == null ? void 0 : computed.visibility) === "hidden") return false;
      }
      const rect = element.getBoundingClientRect();
      const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(element) : element.style;
      if ((style == null ? void 0 : style.display) === "none" || (style == null ? void 0 : style.visibility) === "hidden") {
        return false;
      }
      const hasSize = rect.width > 0 && rect.height > 0 || element.offsetParent !== null || element.getClientRects && element.getClientRects().length > 0;
      if (hasSize) return true;
      if (element.type === "radio" || element.type === "checkbox") {
        const parentWrapper = ((_b = element.parentElement) == null ? void 0 : _b.closest("label, .el-radio, .ant-radio, .el-checkbox, .ant-checkbox")) || element.closest("label, .el-radio, .ant-radio, .el-checkbox, .ant-checkbox");
        if (parentWrapper) {
          const parentRect = typeof parentWrapper.getBoundingClientRect === "function" ? parentWrapper.getBoundingClientRect() : null;
          return Boolean(
            parentRect && parentRect.width > 0 && parentRect.height > 0 || parentWrapper.offsetParent !== null || ((_c = parentWrapper.style) == null ? void 0 : _c.display) !== "none"
          );
        }
      }
      return false;
    }
    static isElementNode(node) {
      if (!node) return false;
      if (typeof HTMLElement !== "undefined" && node instanceof HTMLElement) return true;
      return Boolean(node.tagName || node.nodeType === 1);
    }
    /**
     * 优先探测当前页面顶层可见弹窗/抽屉/模态框范围 (消除背景无关表单干扰)
     */
    static findTopmostActiveScope(root) {
      var _a, _b;
      if (!root || typeof root.querySelectorAll !== "function") return null;
      const dialogSelectors = [
        ".el-dialog",
        ".el-drawer",
        ".ant-modal",
        ".ant-modal-content",
        ".ant-drawer",
        ".arco-modal",
        ".n-modal",
        '[role="dialog"]',
        "dialog[open]"
      ];
      const candidates = [];
      for (const sel of dialogSelectors) {
        try {
          const list = Array.from(root.querySelectorAll(sel));
          for (const item of list) {
            if (this.isElementNode(item)) {
              const role = (_a = item.getAttribute) == null ? void 0 : _a.call(item, "role");
              if (role === "combobox" || role === "listbox" || role === "option") {
                continue;
              }
              if (typeof item.querySelectorAll !== "function") {
                continue;
              }
              if (this.isVisible(item)) {
                candidates.push(item);
              }
            }
          }
        } catch {
        }
      }
      if (candidates.length === 0) return null;
      const unique = [...new Set(candidates)];
      const stack = (node) => {
        const levels = [];
        for (let current = node; current; current = current.parentElement) {
          const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(current) : current.style;
          const z = Number.parseInt((style == null ? void 0 : style.zIndex) || "", 10);
          if (Number.isFinite(z)) levels.unshift(z);
        }
        return levels;
      };
      unique.sort((a, b) => {
        var _a2;
        const left = stack(a), right = stack(b);
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
          const delta = (left[i] || 0) - (right[i] || 0);
          if (delta) return delta;
        }
        const position = ((_a2 = a.compareDocumentPosition) == null ? void 0 : _a2.call(a, b)) || 0;
        return position & 4 ? -1 : position & 2 ? 1 : 0;
      });
      const topDialog = unique[unique.length - 1];
      let formTitle = "";
      const titleEl = topDialog && typeof topDialog.querySelector === "function" ? topDialog.querySelector(
        '.el-dialog__title, .ant-modal-title, .arco-modal-title, [class*="dialog__title"], [class*="modal-title"], [class*="modal__title"], [class*="drawer__title"], [role="heading"], h1, h2, h3'
      ) : null;
      if (titleEl && titleEl.textContent) {
        formTitle = titleEl.textContent.trim();
      }
      if (!formTitle) {
        formTitle = ((_b = topDialog.getAttribute) == null ? void 0 : _b.call(topDialog, "aria-label")) || "顶层弹窗表单";
      }
      const formId = topDialog.id || "active_dialog_form";
      return {
        scopeElement: topDialog,
        formTitle,
        formId
      };
    }
    /**
     * 查找元素所属的最外层现代 UI 下拉组件根容器 (Select Component Root)
     */
    static findDropdownRoot(element) {
      var _a, _b, _c;
      if (!element || typeof element.closest !== "function") return null;
      const rootSelectors = [
        ".el-select",
        ".el-select-v2",
        ".el-cascader",
        ".el-tree-select",
        ".ant-select",
        ".ant-cascader",
        ".ant-tree-select",
        ".arco-select",
        ".arco-cascader",
        ".arco-tree-select",
        ".n-select",
        ".n-base-selection",
        ".n-tree-select",
        ".n-cascader",
        ".t-select",
        ".t-cascader",
        ".t-tree-select",
        ".semi-select",
        ".semi-tree-select",
        ".semi-cascader",
        ".ivu-select",
        ".ivu-cascader",
        ".layui-form-select",
        ".v-select",
        ".custom-select",
        ".selectpicker",
        ".bootstrap-select",
        ".vue-treeselect",
        ".select2",
        '[class*="treeselect"]',
        '[class*="cascader"]',
        '[class*="dropdown-select"]',
        '[class*="select-container"]',
        '[class*="selectBox"]',
        '[class*="select-box"]'
      ].join(", ");
      const matched = (_a = element.closest) == null ? void 0 : _a.call(element, rootSelectors);
      if (!matched) return null;
      const outer = (_c = (_b = matched.parentElement) == null ? void 0 : _b.closest) == null ? void 0 : _c.call(_b, rootSelectors);
      return outer || matched;
    }
    /**
     * 判断元素是否属于下拉框 (原生 Select / 组件库自定义下拉 / 启发式模拟下拉框)
     * 彻底避免下拉框被误识别为 text 文本框
     */
    static isDropdownComponent(element, dropdownRoot) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
      const tag = element.tagName.toLowerCase();
      if (tag === "select") return true;
      const input = element;
      if (input.type === "radio" || input.type === "checkbox") return false;
      if (dropdownRoot) return true;
      if (tag !== "input") {
        return false;
      }
      const role = (_a = element.getAttribute) == null ? void 0 : _a.call(element, "role");
      if (role === "combobox") return true;
      const ariaHasPopup = (_b = element.getAttribute) == null ? void 0 : _b.call(element, "aria-haspopup");
      if (ariaHasPopup === "listbox" || ariaHasPopup === "tree" || ariaHasPopup === "menu" || ariaHasPopup === "true") {
        return true;
      }
      const isReadOnly = Boolean(input.readOnly || ((_c = input.hasAttribute) == null ? void 0 : _c.call(input, "readonly")) || ((_d = input.getAttribute) == null ? void 0 : _d.call(input, "aria-readonly")) === "true");
      const placeholder = (input.placeholder || ((_e = input.getAttribute) == null ? void 0 : _e.call(input, "placeholder")) || "").trim();
      const hasSelectPlaceholder = placeholder.includes("请选择") || placeholder.includes("选择") || placeholder.toLowerCase().includes("select") || placeholder.toLowerCase().includes("choose") || placeholder === "--请选择--";
      if (isReadOnly && hasSelectPlaceholder) {
        return true;
      }
      if (placeholder.startsWith("请选择") || placeholder.startsWith("请挑选") || placeholder === "请选择" || placeholder === "--请选择--") {
        return true;
      }
      const parent = element.parentElement;
      if (parent) {
        const hasArrowIcon = Boolean(
          (_f = parent.querySelector) == null ? void 0 : _f.call(
            parent,
            '.el-select__caret, .el-icon-arrow-down, .ant-select-arrow, .arco-select-view-icon, .n-base-selection-suffix, [class*="caret"], [class*="arrow-down"], [class*="chevron-down"], [class*="icon-down"], [class*="down-arrow"], svg[data-icon="down"]'
          )
        );
        if (hasArrowIcon && (isReadOnly || hasSelectPlaceholder)) {
          return true;
        }
      }
      if (((_g = element.getAttribute) == null ? void 0 : _g.call(element, "data-toggle")) === "dropdown" || ((_h = element.getAttribute) == null ? void 0 : _h.call(element, "data-bs-toggle")) === "dropdown" || ((_i = parent == null ? void 0 : parent.getAttribute) == null ? void 0 : _i.call(parent, "data-toggle")) === "dropdown" || ((_j = parent == null ? void 0 : parent.getAttribute) == null ? void 0 : _j.call(parent, "data-bs-toggle")) === "dropdown") {
        return true;
      }
      const cls = (element.className || "").toLowerCase();
      if (cls.includes("select__input") || cls.includes("selection-search") || cls.includes("dropdown-input")) {
        return true;
      }
      return false;
    }
    static getFieldLabel(element, wrapperOrTrigger) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i;
      const formItem = (_a = element.closest) == null ? void 0 : _a.call(element, ".el-form-item, .ant-form-item, .arco-form-item, .n-form-item");
      const explicit = ((_b = element.getAttribute) == null ? void 0 : _b.call(element, "aria-label")) || ((_d = (_c = element.labels) == null ? void 0 : _c[0]) == null ? void 0 : _d.textContent) || ((_f = (_e = formItem == null ? void 0 : formItem.querySelector) == null ? void 0 : _e.call(formItem, ".el-form-item__label, .ant-form-item-label, .arco-form-item-label, .n-form-item-label")) == null ? void 0 : _f.textContent);
      if (explicit == null ? void 0 : explicit.trim()) return cleanLabelText(explicit);
      const spatial = getVisualSpatialLabel(wrapperOrTrigger || element);
      if (spatial && spatial !== "未命名字段") return spatial;
      let intelligent = getElementLabel(element);
      if (intelligent && intelligent !== "未命名字段") return intelligent;
      if (wrapperOrTrigger && wrapperOrTrigger !== element) {
        intelligent = getElementLabel(wrapperOrTrigger);
        if (intelligent && intelligent !== "未命名字段") return intelligent;
      }
      const input = element.tagName.toLowerCase() === "input" ? element : ((_g = wrapperOrTrigger == null ? void 0 : wrapperOrTrigger.querySelector) == null ? void 0 : _g.call(wrapperOrTrigger, "input")) || ((_h = element.querySelector) == null ? void 0 : _h.call(element, "input"));
      if (input == null ? void 0 : input.placeholder) {
        const stripped = stripActionPrefix(input.placeholder);
        if (stripped) return stripped;
        if (!input.placeholder.includes("请选择") && !input.placeholder.includes("请输入")) {
          return input.placeholder.trim();
        }
      }
      if (wrapperOrTrigger) {
        const phEl = (_i = wrapperOrTrigger.querySelector) == null ? void 0 : _i.call(
          wrapperOrTrigger,
          '.el-select__placeholder, .ant-select-selection-placeholder, .arco-select-view-placeholder, [class*="placeholder"]'
        );
        if (phEl == null ? void 0 : phEl.textContent) {
          const stripped = stripActionPrefix(phEl.textContent.trim());
          if (stripped) return stripped;
        }
      }
      if ((input == null ? void 0 : input.name) || (input == null ? void 0 : input.id)) return input.name || input.id;
      if (element.id) return element.id;
      return "未命名字段";
    }
    static isCaptchaField(element) {
      const str = `${element.id || ""} ${element.name || ""} ${element.placeholder || ""}`.toLowerCase();
      return str.includes("captcha") || str.includes("verify") || str.includes("验证码");
    }
    static scan(root = document) {
      const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const forms = [];
      const fields = [];
      const topScope = this.findTopmostActiveScope(root);
      const searchRoot = topScope && topScope.scopeElement && typeof topScope.scopeElement.querySelectorAll === "function" ? topScope.scopeElement : root;
      const formMap = /* @__PURE__ */ new Map();
      const defaultFormId = "default_form";
      let hasDefaultFormFields = false;
      if (topScope) {
        forms.push({
          formId: topScope.formId,
          title: topScope.formTitle,
          fieldCount: 0
        });
        formMap.set(topScope.scopeElement, topScope.formId);
      } else {
        const domForms = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("form, .el-form, .ant-form, .arco-form")) : [];
        domForms.forEach((formElem, index) => {
          const formId = formElem.id || `form_${index + 1}`;
          formMap.set(formElem, formId);
          const title = formElem.getAttribute("name") || formElem.getAttribute("aria-label") || formElem.id || `表单 ${index + 1}`;
          forms.push({
            formId,
            title,
            fieldCount: 0
          });
        });
      }
      const selectTriggerSelectors = [
        "input",
        "select",
        "textarea",
        '[role="combobox"]',
        ".el-select",
        ".el-select-v2",
        ".el-cascader",
        ".el-tree-select",
        ".ant-select",
        ".ant-cascader",
        ".ant-tree-select",
        ".arco-select",
        ".arco-cascader",
        ".arco-tree-select",
        ".n-select",
        ".n-base-selection",
        ".n-tree-select",
        ".n-cascader",
        ".t-select",
        ".t-cascader",
        ".t-tree-select",
        ".semi-select",
        ".semi-tree-select",
        ".semi-cascader",
        ".ivu-select",
        ".ivu-cascader",
        ".layui-form-select",
        ".v-select",
        ".custom-select",
        ".selectpicker",
        ".bootstrap-select",
        ".vue-treeselect",
        ".select2"
      ].join(", ");
      const rawElements = searchRoot && typeof searchRoot.querySelectorAll === "function" ? Array.from(searchRoot.querySelectorAll(selectTriggerSelectors)) : [];
      const radioInputs = [];
      const processedDropdownRoots = /* @__PURE__ */ new Set();
      rawElements.forEach((elem, index) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M, _N, _O;
        const element = elem;
        const tag = element.tagName.toLowerCase();
        const input = element;
        if (input.type === "hidden" || input.type === "submit" || input.type === "button" || input.type === "reset") {
          return;
        }
        if (!this.isVisible(element)) {
          return;
        }
        const dropdownRoot = this.findDropdownRoot(element);
        const isDropdown = this.isDropdownComponent(element, dropdownRoot);
        if (isDropdown && tag !== "select") {
          const canonicalRoot = dropdownRoot || element;
          if (processedDropdownRoots.has(canonicalRoot) || Array.from(processedDropdownRoots).some((root2) => root2 === element || root2.contains(element) || element.contains(root2))) {
            return;
          }
          processedDropdownRoots.add(canonicalRoot);
        }
        if (input.type === "radio") {
          radioInputs.push(input);
          return;
        }
        const parentForm = element.closest("form, .el-form, .ant-form, .arco-form");
        const formId = topScope ? topScope.formId : parentForm ? formMap.get(parentForm) || defaultFormId : defaultFormId;
        if (formId === defaultFormId) {
          hasDefaultFormFields = true;
        }
        const canonicalWrapper = dropdownRoot || element;
        const innerInput = tag === "input" ? element : ((_a = canonicalWrapper.querySelector) == null ? void 0 : _a.call(canonicalWrapper, "input")) || ((_b = element.querySelector) == null ? void 0 : _b.call(element, "input"));
        const fieldId = `field_${snapshotId}_${index + 1}_${input.name || input.id || canonicalWrapper.id || tag}`;
        const label = this.getFieldLabel(innerInput || element, canonicalWrapper);
        const sensitive = tag === "input" && input.type === "password";
        const disabled = input.disabled || Boolean((_c = input.hasAttribute) == null ? void 0 : _c.call(input, "disabled")) || ((_d = input.getAttribute) == null ? void 0 : _d.call(input, "aria-disabled")) === "true" || Boolean((_e = canonicalWrapper.hasAttribute) == null ? void 0 : _e.call(canonicalWrapper, "disabled"));
        let readOnly = input.readOnly || Boolean((_f = input.hasAttribute) == null ? void 0 : _f.call(input, "readonly")) || ((_g = input.getAttribute) == null ? void 0 : _g.call(input, "aria-readonly")) === "true";
        const required = input.required || Boolean((_h = input.hasAttribute) == null ? void 0 : _h.call(input, "required")) || ((_i = input.getAttribute) == null ? void 0 : _i.call(input, "aria-required")) === "true" || Boolean((_j = canonicalWrapper.hasAttribute) == null ? void 0 : _j.call(canonicalWrapper, "required"));
        let kind = "text";
        let currentValue = input.value ?? "";
        let isEmpty = false;
        let unsupportedReason;
        let options;
        let optionsState = "none";
        let isMultiple = false;
        let groupName;
        if (input.type === "file") {
          kind = "unsupported";
          unsupportedReason = "第一期暂不支持文件上传";
        } else if (this.isCaptchaField(element)) {
          kind = "unsupported";
          unsupportedReason = "验证码需人工输入";
        } else if (tag !== "select" && tag !== "input" && ((_k = element.getAttribute) == null ? void 0 : _k.call(element, "role")) === "combobox" && !dropdownRoot) {
          kind = "unsupported";
          unsupportedReason = "自定义 ARIA 控件尚未接入专用点击展开交互适配器";
          optionsState = "partial";
          currentValue = ((_l = element.textContent) == null ? void 0 : _l.trim()) || "";
          isEmpty = !currentValue || currentValue.includes("请选择");
        } else if (isDropdown) {
          kind = "select";
          readOnly = false;
          if (tag === "select") {
            const select = element;
            isMultiple = select.multiple;
            optionsState = "complete";
            options = Array.from(select.options).map((opt, optIdx) => {
              var _a2;
              return {
                optionId: opt.id || `opt_${optIdx}_${opt.value}`,
                value: opt.value,
                label: ((_a2 = opt.text) == null ? void 0 : _a2.trim()) || opt.value,
                disabled: opt.disabled
              };
            });
            currentValue = select.value ?? "";
            const selectedText = ((_o = (_n = (_m = select.selectedOptions) == null ? void 0 : _m[0]) == null ? void 0 : _n.text) == null ? void 0 : _o.trim()) || "";
            isEmpty = !currentValue || selectedText.includes("请选择") || selectedText.toLowerCase().includes("select") || selectedText === "--请选择--";
          } else {
            const selectWrapper = canonicalWrapper;
            isMultiple = Boolean(
              ((_q = (_p = canonicalWrapper.classList) == null ? void 0 : _p.contains) == null ? void 0 : _q.call(_p, "is-multiple")) || ((_s = (_r = canonicalWrapper.classList) == null ? void 0 : _r.contains) == null ? void 0 : _s.call(_r, "el-select--multiple")) || ((_u = (_t = canonicalWrapper.classList) == null ? void 0 : _t.contains) == null ? void 0 : _u.call(_t, "ant-select-multiple")) || ((_w = (_v = canonicalWrapper.classList) == null ? void 0 : _v.contains) == null ? void 0 : _w.call(_v, "ant-tree-select-multiple")) || ((_y = (_x = canonicalWrapper.classList) == null ? void 0 : _x.contains) == null ? void 0 : _y.call(_x, "arco-select-multiple")) || ((_A = (_z = canonicalWrapper.classList) == null ? void 0 : _z.contains) == null ? void 0 : _A.call(_z, "n-base-selection--multiple")) || ((_B = canonicalWrapper.querySelector) == null ? void 0 : _B.call(canonicalWrapper, ".el-select__tags, .ant-select-selection-overflow, .vue-treeselect__multi-value")) || ((_C = canonicalWrapper.getAttribute) == null ? void 0 : _C.call(canonicalWrapper, "aria-multiselectable")) === "true" || ((_D = element.getAttribute) == null ? void 0 : _D.call(element, "aria-multiselectable")) === "true"
            );
            const trigger = ((_E = selectWrapper.querySelector) == null ? void 0 : _E.call(selectWrapper, ".el-select__wrapper, .select-trigger, .ant-select-selector, .arco-select-view, .n-base-selection, input")) || element || selectWrapper;
            const tagNodes = (_F = selectWrapper.querySelectorAll) == null ? void 0 : _F.call(
              selectWrapper,
              ".el-select__tags-text, .ant-select-selection-item-content, .vue-treeselect__multi-value-item, .arco-tag"
            );
            const selectedItemEl = (_G = selectWrapper.querySelector) == null ? void 0 : _G.call(
              selectWrapper,
              '.el-select__selected-item:not(.is-transparent), .el-select__tags-text, .ant-select-selection-item, .ant-select-selection-selected-value, .arco-select-view-value, .n-base-selection-label, .el-select-dropdown__item.is-selected, .vue-treeselect__single-value, [class*="single-value"]'
            );
            const placeholder = (innerInput == null ? void 0 : innerInput.placeholder) || ((_H = selectWrapper.getAttribute) == null ? void 0 : _H.call(selectWrapper, "placeholder")) || ((_K = (_J = (_I = selectWrapper.querySelector) == null ? void 0 : _I.call(selectWrapper, '.el-select__placeholder, .ant-select-selection-placeholder, .vue-treeselect__placeholder, [class*="placeholder"]')) == null ? void 0 : _J.textContent) == null ? void 0 : _K.trim()) || "";
            let displayVal = "";
            if (tagNodes && tagNodes.length > 0) {
              const tagTexts = Array.from(tagNodes).map((n) => {
                var _a2;
                return ((_a2 = n.textContent) == null ? void 0 : _a2.trim()) || "";
              }).filter(Boolean);
              if (tagTexts.length > 0) {
                displayVal = tagTexts.join(", ");
              }
            }
            if (!displayVal && selectedItemEl && ((_L = selectedItemEl.textContent) == null ? void 0 : _L.trim())) {
              displayVal = selectedItemEl.textContent.trim();
            } else if (!displayVal && innerInput && innerInput.value && innerInput.value !== placeholder && !innerInput.value.includes("请选择") && !((_N = (_M = innerInput.classList) == null ? void 0 : _M.contains) == null ? void 0 : _N.call(_M, "vue-treeselect__input")) && ((_O = innerInput.getAttribute) == null ? void 0 : _O.call(innerInput, "role")) !== "searchbox") {
              displayVal = innerInput.value.trim();
            }
            currentValue = displayVal;
            isEmpty = !displayVal || displayVal === placeholder || displayVal.includes("请选择") || displayVal.toLowerCase().includes("select") || displayVal === "--请选择--";
            const probedOptions = _FormScanner.extractDropdownOptionsFromDom(element, selectWrapper, root, label);
            if (probedOptions.length > 0) {
              options = probedOptions;
              optionsState = "complete";
            } else {
              optionsState = "unloaded";
            }
            FormDOMRegistry.register(fieldId, trigger, snapshotId);
          }
        } else if (tag === "textarea") {
          kind = "textarea";
          currentValue = element.value ?? "";
          isEmpty = typeof currentValue === "string" && currentValue.trim() === "";
        } else if (input.type === "checkbox") {
          kind = "checkbox";
          groupName = input.name || void 0;
          currentValue = input.checked;
          isEmpty = false;
        } else if (input.type === "number" || input.type === "range") {
          kind = "number";
          if (input.value === "" || input.value === null || input.value === void 0) {
            currentValue = "";
            isEmpty = true;
          } else {
            currentValue = Number(input.value);
            isEmpty = false;
          }
        } else if (input.type === "date" || input.type === "datetime-local" || input.type === "time" || input.type === "month") {
          kind = "date";
          currentValue = input.value || "";
          isEmpty = !input.value;
        } else {
          kind = "text";
          currentValue = input.value || "";
          isEmpty = typeof currentValue === "string" && currentValue.trim() === "";
        }
        const min = input.min === "" || input.min === void 0 ? void 0 : Number(input.min);
        const max = input.max === "" || input.max === void 0 ? void 0 : Number(input.max);
        const step = input.step === "" || input.step === void 0 ? void 0 : Number(input.step);
        const fieldItem = {
          fieldId,
          formId,
          tag,
          kind,
          sensitive,
          name: input.name || input.id || "",
          label,
          placeholder: input.placeholder || void 0,
          currentValue,
          isEmpty,
          required,
          disabled,
          readOnly,
          isVisible: true,
          constraints: {
            min: min !== void 0 && Number.isFinite(min) ? min : void 0,
            max: max !== void 0 && Number.isFinite(max) ? max : void 0,
            maxLength: input.maxLength > 0 ? input.maxLength : void 0,
            pattern: input.pattern || void 0,
            step: step !== void 0 && Number.isFinite(step) ? step : void 0
          },
          optionsState,
          options,
          isMultiple: isDropdown ? isMultiple : void 0,
          groupName,
          unsupportedReason
        };
        fields.push(fieldItem);
        if (!FormDOMRegistry.get(fieldId, snapshotId)) {
          FormDOMRegistry.register(fieldId, element, snapshotId);
        }
      });
      const radioGroups = /* @__PURE__ */ new Map();
      radioInputs.forEach((radio) => {
        const radioGroupContainer = radio.closest('.el-radio-group, .ant-radio-group, [role="radiogroup"]');
        const formItemParent = radio.closest(".el-form-item, .ant-form-item, .arco-form-item, .n-form-item, fieldset");
        const groupKey = radio.name || radioGroupContainer || formItemParent || "default_radio_group";
        if (!radioGroups.has(groupKey)) {
          radioGroups.set(groupKey, []);
        }
        radioGroups.get(groupKey).push(radio);
      });
      let radioGroupIndex = 0;
      radioGroups.forEach((radios, groupKeyRef) => {
        var _a, _b, _c, _d;
        radioGroupIndex += 1;
        const firstRadio = radios[0];
        const parentForm = firstRadio.closest("form, .el-form, .ant-form, .arco-form");
        const formId = topScope ? topScope.formId : parentForm ? formMap.get(parentForm) || defaultFormId : defaultFormId;
        const formItemParent = (_a = firstRadio.closest) == null ? void 0 : _a.call(
          firstRadio,
          '.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, .t-form-item, .semi-form-item, .form-group, .form-item, [class*="form-item"], fieldset'
        );
        let formItemLabel = "";
        if (formItemParent) {
          const titleEl = (_b = formItemParent.querySelector) == null ? void 0 : _b.call(
            formItemParent,
            '.el-form-item__label, .ant-form-item-label, .arco-form-item-label, .n-form-item-label, [class*="form-item__label"], [class*="form-label"], [class*="item-label"], [class*="field-label"], legend'
          );
          if (titleEl && ((_c = titleEl.textContent) == null ? void 0 : _c.trim())) {
            formItemLabel = cleanLabelText(titleEl.textContent.trim());
          }
        }
        const radioContainer = ((_d = firstRadio.closest) == null ? void 0 : _d.call(firstRadio, '.el-radio-group, .ant-radio-group, [role="radiogroup"]')) || formItemParent || firstRadio;
        const spatialRadioLabel = getVisualSpatialLabel(radioContainer);
        const intelligentLabel = getElementLabel(firstRadio) || getElementLabel(radioContainer);
        const mainLabel = formItemLabel || spatialRadioLabel || intelligentLabel || firstRadio.name || `单选组 ${radioGroupIndex}`;
        const optionElements = /* @__PURE__ */ new Map();
        const options = [];
        let checkedLabel = "";
        const groupKeyName = typeof groupKeyRef === "string" ? groupKeyRef : firstRadio.name || (groupKeyRef.id ? groupKeyRef.id : `group_${radioGroupIndex}`);
        radios.forEach((radio, rIdx) => {
          var _a2, _b2, _c2, _d2, _e, _f, _g, _h, _i, _j;
          const parentNode = radio.parentElement;
          const labelWrapper = parentNode ? parentNode.closest("label, .el-radio, .ant-radio, .arco-radio, .n-radio, .t-radio, .semi-radio") || parentNode : radio.closest("label, .el-radio, .ant-radio, .arco-radio, .n-radio, .t-radio, .semi-radio");
          let optLabel = "";
          if (labelWrapper) {
            const radioTextSpan = labelWrapper.querySelector(".el-radio__label, .ant-radio-wrapper, .arco-radio-text, span");
            if (radioTextSpan && radioTextSpan.textContent && radioTextSpan.textContent.trim()) {
              optLabel = radioTextSpan.textContent.trim();
            } else {
              optLabel = (labelWrapper.textContent || "").trim();
              if (radio.value && optLabel.startsWith(radio.value)) {
                optLabel = optLabel.slice(radio.value.length).trim() || radio.value;
              }
            }
          }
          if (!optLabel) {
            optLabel = radio.value || `选项${rIdx + 1}`;
          }
          const optVal = radio.value || optLabel;
          const optId = radio.id || `radio_${groupKeyName}_${rIdx}_${optVal}`;
          options.push({
            optionId: optId,
            value: optVal,
            label: optLabel,
            disabled: radio.disabled
          });
          const clickTarget = labelWrapper || radio;
          optionElements.set(optLabel, clickTarget);
          optionElements.set(optVal, clickTarget);
          optionElements.set(optId, clickTarget);
          const isChecked = Boolean(
            radio.checked || ((_b2 = (_a2 = labelWrapper == null ? void 0 : labelWrapper.classList) == null ? void 0 : _a2.contains) == null ? void 0 : _b2.call(_a2, "is-checked")) || ((_d2 = (_c2 = labelWrapper == null ? void 0 : labelWrapper.classList) == null ? void 0 : _c2.contains) == null ? void 0 : _d2.call(_c2, "ant-radio-checked")) || ((_f = (_e = labelWrapper == null ? void 0 : labelWrapper.classList) == null ? void 0 : _e.contains) == null ? void 0 : _f.call(_e, "arco-radio-checked")) || ((_h = (_g = labelWrapper == null ? void 0 : labelWrapper.classList) == null ? void 0 : _g.contains) == null ? void 0 : _h.call(_g, "n-radio--checked")) || ((_i = radio.getAttribute) == null ? void 0 : _i.call(radio, "aria-checked")) === "true" || ((_j = labelWrapper == null ? void 0 : labelWrapper.getAttribute) == null ? void 0 : _j.call(labelWrapper, "aria-checked")) === "true"
          );
          if (isChecked) {
            checkedLabel = optLabel;
          }
        });
        const fieldId = `field_${snapshotId}_radiogroup_${groupKeyName}`;
        const radioGroupItem = {
          fieldId,
          formId,
          tag: "input",
          kind: "radio",
          name: firstRadio.name || groupKeyName,
          label: mainLabel,
          currentValue: checkedLabel,
          isEmpty: checkedLabel === "",
          required: radios.some((r) => r.required),
          disabled: radios.every((r) => r.disabled),
          readOnly: false,
          isVisible: true,
          optionsState: "complete",
          options,
          groupName: firstRadio.name || groupKeyName
        };
        fields.push(radioGroupItem);
        FormDOMRegistry.register(fieldId, firstRadio, snapshotId, optionElements);
      });
      if (hasDefaultFormFields && !forms.some((f) => f.formId === defaultFormId)) {
        forms.unshift({
          formId: defaultFormId,
          title: "页面主要表单",
          fieldCount: 0
        });
      }
      forms.forEach((form) => {
        form.fieldCount = fields.filter((f) => f.formId === form.formId).length;
      });
      return {
        snapshotId,
        url: root.location ? root.location.href : "",
        title: root.title || "",
        forms,
        fields,
        timestamp: Date.now()
      };
    }
    static dispatchFullClick(el) {
      var _a;
      if (!el) return;
      try {
        const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, view: typeof window !== "undefined" ? window : void 0, clientX, clientY };
        if (typeof PointerEvent !== "undefined") el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        if (typeof MouseEvent !== "undefined") el.dispatchEvent(new MouseEvent("mousedown", eventInit));
        if (typeof el.focus === "function") el.focus();
        if (typeof PointerEvent !== "undefined") el.dispatchEvent(new PointerEvent("pointerup", eventInit));
        if (typeof MouseEvent !== "undefined") {
          el.dispatchEvent(new MouseEvent("mouseup", eventInit));
          el.dispatchEvent(new MouseEvent("click", eventInit));
        } else if (typeof el.click === "function") {
          el.click();
        }
      } catch {
        try {
          (_a = el.click) == null ? void 0 : _a.call(el);
        } catch {
        }
      }
    }
    static extractOptionsFromContainer(container, allowSidebarTree = false) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      if (!container || typeof container.querySelectorAll !== "function") return [];
      try {
        const raw = Array.from(container.querySelectorAll(this.DROPDOWN_OPTION_SELECTORS));
        const validNodes = raw.filter((el) => {
          var _a2, _b2;
          if (!el) return false;
          if (!allowSidebarTree && ((_a2 = el.closest) == null ? void 0 : _a2.call(el, 'aside, nav, .sidebar, .org-tree, [class*="sidebar"]'))) return false;
          if ((_b2 = el.querySelector) == null ? void 0 : _b2.call(el, '.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__option, [role="option"], [role="treeitem"]')) return false;
          return true;
        });
        const options = [];
        const seenLabels = /* @__PURE__ */ new Set();
        for (let idx = 0; idx < validNodes.length; idx++) {
          const el = validNodes[idx];
          const rawText = (((_b = (_a = el.querySelector) == null ? void 0 : _a.call(el, ".vue-treeselect__label, .el-tree-node__label, .el-cascader-node__label")) == null ? void 0 : _b.textContent) || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
          if (!rawText || rawText.includes("请选择") || rawText.toLowerCase().includes("select") || rawText === "--请选择--") continue;
          let cleanText = rawText.replace(/[\(（]\d+[\)）]/g, "").trim();
          if (!cleanText) continue;
          if (seenLabels.has(cleanText)) continue;
          seenLabels.add(cleanText);
          const val = ((_c = el.getAttribute) == null ? void 0 : _c.call(el, "data-value")) || ((_d = el.getAttribute) == null ? void 0 : _d.call(el, "value")) || cleanText;
          const disabled = Boolean(
            ((_f = (_e = el.classList) == null ? void 0 : _e.contains) == null ? void 0 : _f.call(_e, "is-disabled")) || ((_h = (_g = el.classList) == null ? void 0 : _g.contains) == null ? void 0 : _h.call(_g, "ant-select-item-option-disabled")) || ((_j = (_i = el.classList) == null ? void 0 : _i.contains) == null ? void 0 : _j.call(_i, "vue-treeselect__option--disabled")) || ((_l = (_k = el.classList) == null ? void 0 : _k.contains) == null ? void 0 : _l.call(_k, "vue-treeselect__label--disabled")) || ((_m = el.getAttribute) == null ? void 0 : _m.call(el, "aria-disabled")) === "true"
          );
          options.push({
            optionId: el.id || `opt_${idx}_${cleanText}`,
            value: val,
            label: cleanText,
            disabled
          });
        }
        return options;
      } catch {
        return [];
      }
    }
    /**
     * 依据 DOM 层级与 Midscene 屏幕视觉空间几何定位，精确查找属于当前下拉框的真实弹出浮层容器
     * 杜绝跨下拉框选项串扰（如将用户性别的选项挂到归属部门下）
     */
    static findAssociatedDropdownContainer(element, selectWrapper, root = document) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      const docContext = element.ownerDocument || root;
      const innerInput = element.tagName.toLowerCase() === "input" ? element : (_a = selectWrapper.querySelector) == null ? void 0 : _a.call(selectWrapper, "input");
      const internalMenu = (_b = selectWrapper.querySelector) == null ? void 0 : _b.call(
        selectWrapper,
        '.vue-treeselect__menu, .vue-treeselect__menu-container, [class*="treeselect"][class*="menu"], .el-select-dropdown'
      );
      if (internalMenu && (((_c = internalMenu.style) == null ? void 0 : _c.display) !== "none" || ((_d = internalMenu.querySelector) == null ? void 0 : _d.call(internalMenu, this.DROPDOWN_OPTION_SELECTORS)))) {
        return internalMenu;
      }
      const linkedNodes = [element, innerInput, selectWrapper, (_e = selectWrapper.querySelector) == null ? void 0 : _e.call(selectWrapper, "[aria-controls], [aria-owns]")].filter(Boolean);
      for (const node of linkedNodes) {
        const ids = [(_f = node.getAttribute) == null ? void 0 : _f.call(node, "aria-controls"), (_g = node.getAttribute) == null ? void 0 : _g.call(node, "aria-owns")].filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const linked = (_h = docContext.getElementById) == null ? void 0 : _h.call(docContext, id);
          if (!linked) continue;
          const menu = ((_i = linked.closest) == null ? void 0 : _i.call(linked, ".el-select-dropdown, .el-tree-select__popper, .ant-select-dropdown, .el-cascader__dropdown, .ant-cascader-dropdown, .arco-select-popup, .arco-cascader-popup")) || linked;
          let hidden = false;
          for (let current = menu; current; current = current.parentElement) {
            const style = ((_k = (_j = current.ownerDocument) == null ? void 0 : _j.defaultView) == null ? void 0 : _k.getComputedStyle(current)) || current.style;
            if (current.hidden || (style == null ? void 0 : style.display) === "none" || (style == null ? void 0 : style.visibility) === "hidden") {
              hidden = true;
              break;
            }
          }
          if (!hidden) return menu;
        }
      }
      if (docContext && typeof docContext.querySelectorAll === "function") {
        const poppers = Array.from(docContext.querySelectorAll(
          '.el-select-dropdown, .el-tree-select__popper, .el-cascader__dropdown, .el-cascader-panel, .ant-cascader-dropdown, .arco-cascader-popup, .n-cascader-menu, .ant-select-dropdown, .arco-select-popup, .vue-treeselect__portal-container, .vue-treeselect__menu, [class*="select-dropdown"]'
        ));
        const wRect = typeof selectWrapper.getBoundingClientRect === "function" ? selectWrapper.getBoundingClientRect() : null;
        const visiblePoppers = poppers.filter((popper) => {
          var _a2, _b2, _c2, _d2, _e2;
          if (!popper) return false;
          if (popper.hidden || ((_a2 = popper.style) == null ? void 0 : _a2.display) === "none" || ((_b2 = popper.style) == null ? void 0 : _b2.visibility) === "hidden") return false;
          const comp = (_e2 = (_d2 = (_c2 = popper.ownerDocument) == null ? void 0 : _c2.defaultView) == null ? void 0 : _d2.getComputedStyle) == null ? void 0 : _e2.call(_d2, popper);
          if (comp && (comp.display === "none" || comp.visibility === "hidden")) return false;
          return true;
        });
        if (visiblePoppers.length === 1) {
          return visiblePoppers[0];
        }
        let bestPopper = null;
        let minDistance = Infinity;
        for (const popper of visiblePoppers) {
          if (wRect && wRect.width > 0 && wRect.height > 0 && typeof popper.getBoundingClientRect === "function") {
            const pRect = popper.getBoundingClientRect();
            if (pRect.width > 0 && pRect.height > 0) {
              const xOverlap = pRect.left < wRect.right + 60 && pRect.right > wRect.left - 60;
              const yDist = Math.min(Math.abs(pRect.top - wRect.bottom), Math.abs(pRect.bottom - wRect.top));
              if (xOverlap && yDist < 80) {
                if (yDist < minDistance) {
                  minDistance = yDist;
                  bestPopper = popper;
                }
              }
            }
          }
        }
        if (bestPopper) return bestPopper;
        if (visiblePoppers.length > 0) return visiblePoppers[visiblePoppers.length - 1];
      }
      if (internalMenu) return internalMenu;
      return null;
    }
    /**
     * 优先从前端框架受控组件（如 Vue / Vue-Treeselect / Element UI）挂载的内部 ViewModel 中直接提取选项
     * 优势：零 DOM 点击、零弹层闪烁、无侵入性、绝对安全（绝不会触发遮罩关闭或全局弹窗消失）
     */
    static extractOptionsFromVueInstance(element, selectWrapper) {
      var _a, _b;
      try {
        const vueInst = (selectWrapper == null ? void 0 : selectWrapper.__vue__) || (element == null ? void 0 : element.__vue__);
        if (!vueInst) return [];
        if (((_a = vueInst.forest) == null ? void 0 : _a.nodeList) && Array.isArray(vueInst.forest.nodeList)) {
          const options = [];
          const seen = /* @__PURE__ */ new Set();
          for (const node of vueInst.forest.nodeList) {
            if (!node) continue;
            const rawLabel = String(node.label || node.name || node.id || "").trim();
            const cleanLabel = rawLabel.replace(/[\(（]\d+[\)）]/g, "").trim();
            if (!cleanLabel || seen.has(cleanLabel)) continue;
            seen.add(cleanLabel);
            options.push({
              optionId: String(node.id || cleanLabel),
              value: String(node.id ?? cleanLabel),
              label: cleanLabel,
              disabled: Boolean(node.isDisabled)
            });
          }
          if (options.length > 0) return options;
        }
        const rawOptions = vueInst.options || vueInst.normalizedOptions || ((_b = vueInst.$props) == null ? void 0 : _b.options);
        if (Array.isArray(rawOptions)) {
          const options = [];
          const seen = /* @__PURE__ */ new Set();
          const traverse = (items) => {
            for (const item of items) {
              if (!item) continue;
              const rawLabel = String(item.currentLabel ?? item.label ?? item.name ?? item.value ?? "").trim();
              const cleanLabel = rawLabel.replace(/[\(（]\d+[\)）]/g, "").trim();
              if (cleanLabel && !cleanLabel.includes("请选择") && !seen.has(cleanLabel)) {
                seen.add(cleanLabel);
                const val = String(item.value ?? item.id ?? cleanLabel);
                options.push({
                  optionId: String(item.id || item.value || cleanLabel),
                  value: val,
                  label: cleanLabel,
                  disabled: Boolean(item.isDisabled || item.disabled)
                });
              }
              if (Array.isArray(item.children)) traverse(item.children);
            }
          };
          traverse(rawOptions);
          if (options.length > 0) return options;
        }
      } catch {
      }
      return [];
    }
    static extractDropdownOptionsFromDom(element, selectWrapper, root = document, fieldLabel = "") {
      const vueOpts = this.extractOptionsFromVueInstance(element, selectWrapper);
      if (vueOpts.length > 0) return vueOpts;
      const container = this.findAssociatedDropdownContainer(element, selectWrapper, root);
      if (container) {
        const opts = this.extractOptionsFromContainer(container);
        if (opts.length > 0) return opts;
      }
      try {
        const combinedLabel = (fieldLabel + " " + (element.getAttribute("aria-label") || element.getAttribute("placeholder") || selectWrapper.textContent || "")).toLowerCase();
        const isOrgOrDept = combinedLabel.includes("部门") || combinedLabel.includes("dept") || combinedLabel.includes("组织") || combinedLabel.includes("机构") || combinedLabel.includes("company") || combinedLabel.includes("org");
        if (isOrgOrDept) {
          const docCtx = element.ownerDocument || root;
          const pageTrees = Array.from(docCtx.querySelectorAll(
            '.head-container .el-tree, .tree-container .el-tree, .dept-tree, .org-tree, aside .el-tree, [class*="tree"] .el-tree, .el-tree'
          ));
          for (const tree of pageTrees) {
            const nodes = Array.from(tree.querySelectorAll('.el-tree-node__content, .el-tree-node__label, [role="treeitem"]'));
            if (nodes.length > 0) {
              const orgOpts = this.extractOptionsFromContainer(tree, true);
              if (orgOpts.length > 0) {
                return orgOpts.slice(0, 20);
              }
            }
          }
        }
      } catch {
      }
      return [];
    }
    /** 扫描保持只读，兼容旧入口。 */
    static async scanWithProbe(root = document) {
      return this.scan(root);
    }
  };
  __publicField(_FormScanner, "DROPDOWN_OPTION_SELECTORS", [
    ".el-cascader-node, .ant-cascader-menu-item, .arco-cascader-list-item",
    ".el-select-dropdown__item",
    ".el-select-dropdown__option-item",
    ".ant-select-item-option",
    ".ant-select-dropdown-menu-item",
    ".arco-select-option",
    ".n-base-select-option",
    ".t-select-option",
    ".semi-select-option",
    ".ivu-select-item",
    ".vue-treeselect__option",
    ".vue-treeselect__label",
    ".el-tree-node__content",
    ".ant-select-tree-title",
    ".ant-select-tree-node-content-wrapper",
    ".arco-tree-select-node",
    ".layui-form-select dl dd:not(.layui-select-tips)",
    '[role="option"]',
    '[role="treeitem"]'
  ].join(", "));
  let FormScanner = _FormScanner;
  const _FormExecutor = class _FormExecutor {
    static cancel(runId) {
      if (!runId || !this.activeRunId || runId === this.activeRunId) {
        this.isCancelled = true;
      }
    }
    static resetCancel() {
      this.isCancelled = false;
    }
    static clearHistory() {
      this.runHistory.clear();
    }
    static getActiveRunId() {
      return this.activeRunId;
    }
    static getRunRecord(runId) {
      return this.runHistory.get(runId);
    }
    /**
     * 严格布尔值类型转换 (IMP-09)
     * 杜绝 JavaScript 原生 Boolean("false") === true 的误判，防止字符串 'false'/'0'/'no' 被错误识别为真值
     */
    static toStrictBoolean(val) {
      if (typeof val === "boolean") return val;
      if (typeof val === "number") return val !== 0;
      if (typeof val === "string") {
        const s = val.trim().toLowerCase();
        return s !== "false" && s !== "0" && s !== "off" && s !== "no" && s !== "";
      }
      return Boolean(val);
    }
    /**
     * 判断当前 DOM 控件的值是否视为空值 (QA-023)
     */
    static isDomValueEmpty(element, val) {
      var _a, _b, _c, _d, _e;
      const tag = element.tagName.toLowerCase();
      const input = element;
      if (input.type === "checkbox") {
        return false;
      }
      if (input.type === "radio") {
        return val === "" || val === false;
      }
      if (input.type === "number") {
        return val === "" || val === null || val === void 0;
      }
      if (tag === "select") {
        const select = element;
        const selectedText = ((_c = (_b = (_a = select.selectedOptions) == null ? void 0 : _a[0]) == null ? void 0 : _b.text) == null ? void 0 : _c.trim()) || "";
        return !val || selectedText.includes("请选择") || selectedText.toLowerCase().includes("select") || selectedText === "--请选择--";
      }
      const dropdownRoot = FormScanner.findDropdownRoot(element);
      const isCustomSelect = FormScanner.isDropdownComponent(element, dropdownRoot);
      if (isCustomSelect) {
        if (!val) return true;
        const strVal = String(val).trim();
        const selectWrapper = dropdownRoot || element;
        const placeholder = input.placeholder || ((_d = element.getAttribute) == null ? void 0 : _d.call(element, "placeholder")) || ((_e = selectWrapper.getAttribute) == null ? void 0 : _e.call(selectWrapper, "placeholder")) || "";
        return !strVal || strVal === placeholder || strVal.includes("请选择") || strVal.toLowerCase().includes("select") || strVal === "--请选择--";
      }
      return typeof val === "string" && val.trim() === "";
    }
    /**
     * 采用原生原型 setter 赋值，兼容 React/Vue 等前端框架受控组件
     */
    static setNativeValue(element, value) {
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (prototypeValueDescriptor && prototypeValueDescriptor.set) {
        prototypeValueDescriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    }
    /**
     * 派发完整的 DOM 事件流
     */
    static dispatchInputEvents(element) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    /**
     * 辅助方法：模拟派发完整的手势与点击事件流 (触发 React rc-select / Vue Element Plus 的事件监听)
     */
    static dispatchFullClick(el) {
      var _a;
      try {
        const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, composed: true, button: 0, view: typeof window !== "undefined" ? window : void 0, clientX, clientY };
        if (typeof PointerEvent !== "undefined") {
          el.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, buttons: 1, pointerType: "mouse", isPrimary: true }));
        }
        if (typeof MouseEvent !== "undefined") {
          el.dispatchEvent(new MouseEvent("mousedown", { ...eventInit, buttons: 1 }));
        }
        if (typeof el.focus === "function") {
          el.focus();
        }
        if (typeof PointerEvent !== "undefined") {
          el.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, buttons: 0, pointerType: "mouse", isPrimary: true }));
        }
        if (typeof MouseEvent !== "undefined") {
          el.dispatchEvent(new MouseEvent("mouseup", eventInit));
          el.dispatchEvent(new MouseEvent("click", eventInit));
        } else if (typeof el.click === "function") {
          el.click();
        } else if (typeof el.dispatchEvent === "function") {
          el.dispatchEvent(new Event("click", { bubbles: true }));
        }
      } catch {
        try {
          (_a = el.click) == null ? void 0 : _a.call(el);
        } catch {
        }
      }
    }
    /**
     * 读取当前 DOM 的实际值
     */
    static readElementValue(element) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      const tag = element.tagName.toLowerCase();
      const input = element;
      if (input.type === "radio") {
        return FormDOMRegistry.readRadioGroupValue(element) ?? input.checked;
      }
      if (input.type === "checkbox") {
        return input.checked;
      }
      if (input.type === "number") {
        return input.value === "" ? "" : Number(input.value);
      }
      if (tag === "select") {
        return element.value;
      }
      const dropdownRoot = FormScanner.findDropdownRoot(element);
      const isCustomSelect = FormScanner.isDropdownComponent(element, dropdownRoot);
      if (isCustomSelect) {
        const selectWrapper = dropdownRoot || element;
        const tags = (_a = selectWrapper.querySelectorAll) == null ? void 0 : _a.call(
          selectWrapper,
          ".el-select__tags-text, .ant-select-selection-item-content, .vue-treeselect__multi-value-item, .arco-tag"
        );
        if (tags && tags.length > 0) {
          const tagTexts = Array.from(tags).map((n) => {
            var _a2;
            return ((_a2 = n.textContent) == null ? void 0 : _a2.trim()) || "";
          }).filter(Boolean);
          if (tagTexts.length > 0) {
            return tagTexts.join(", ");
          }
        }
        const selectedItem = (_b = selectWrapper.querySelector) == null ? void 0 : _b.call(
          selectWrapper,
          '.vue-treeselect__single-value, .vue-treeselect__value-container, .el-select__selected-item:not(.is-transparent), .el-select__tags-text, .ant-select-selection-item, .ant-select-selection-selected-value, .arco-select-view-value, .n-base-selection-label, .el-select-dropdown__item.is-selected, [class*="single-value"]'
        );
        if ((_c = selectedItem == null ? void 0 : selectedItem.textContent) == null ? void 0 : _c.trim()) {
          const text = selectedItem.textContent.trim();
          if (!text.includes("请选择") && !text.toLowerCase().includes("select")) {
            return text;
          }
        }
        const displayInput = element.tagName.toLowerCase() === "input" ? element : (_d = selectWrapper.querySelector) == null ? void 0 : _d.call(selectWrapper, "input");
        const placeholder = (displayInput == null ? void 0 : displayInput.placeholder) || ((_e = selectWrapper.getAttribute) == null ? void 0 : _e.call(selectWrapper, "placeholder")) || ((_h = (_g = (_f = selectWrapper.querySelector) == null ? void 0 : _f.call(selectWrapper, '.el-select__placeholder, .ant-select-selection-placeholder, .vue-treeselect__placeholder, [class*="placeholder"]')) == null ? void 0 : _g.textContent) == null ? void 0 : _h.trim()) || "";
        if ((displayInput == null ? void 0 : displayInput.value) && displayInput.value !== placeholder && !displayInput.value.includes("请选择") && !((_j = (_i = displayInput.classList) == null ? void 0 : _i.contains) == null ? void 0 : _j.call(_i, "vue-treeselect__input")) && !((_l = (_k = displayInput.classList) == null ? void 0 : _k.contains) == null ? void 0 : _l.call(_k, "ant-select-selection-search-input")) && ((_m = displayInput.getAttribute) == null ? void 0 : _m.call(displayInput, "role")) !== "searchbox") {
          return displayInput.value.trim();
        }
        return "";
      }
      return input.value ?? "";
    }
    /**
     * 执行单步填充
     */
    static async executeAssignment(assignment, snapshotId, mode = "empty_only") {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E;
      const { fieldId, action, value, optionIds } = assignment;
      const element = FormDOMRegistry.get(fieldId, snapshotId);
      if (!element) {
        return {
          fieldId,
          beforeValue: "",
          plannedValue: value ?? optionIds,
          status: "failed",
          error: "找不到目标表单控件（快照可能已失效或页面已刷新）"
        };
      }
      const input = element;
      const tag = element.tagName.toLowerCase();
      const dropdownRoot = FormScanner.findDropdownRoot(element);
      const selectWrapper = dropdownRoot || ((_a = element.closest) == null ? void 0 : _a.call(element, '.custom-select, [role="combobox"]')) || element;
      const isRadio = input.type === "radio" || fieldId.includes("_radiogroup_");
      const isCheckbox = input.type === "checkbox";
      const isComponentSelect = FormScanner.isDropdownComponent(element, dropdownRoot);
      const isCustomSelect = !isRadio && !isCheckbox && tag !== "select" && (action === "select" && isComponentSelect);
      const isActuallyReadOnly = Boolean(input.readOnly && !isCustomSelect);
      if (input.disabled || isActuallyReadOnly) {
        return {
          fieldId,
          beforeValue: this.readElementValue(element),
          plannedValue: value ?? optionIds,
          status: "skipped",
          error: input.disabled ? "控件处于禁用 (disabled) 状态" : "控件处于只读 (readOnly) 状态",
          skippedReason: input.disabled ? "控件处于禁用 (disabled) 状态" : "控件处于只读 (readOnly) 状态"
        };
      }
      const beforeValue = this.readElementValue(element);
      const isCurrentlyEmpty = this.isDomValueEmpty(element, beforeValue);
      if (mode === "empty_only" && !isCurrentlyEmpty) {
        const wasModifiedByUser = assignment.expectedBeforeValue !== void 0 && String(beforeValue) !== String(assignment.expectedBeforeValue);
        return {
          fieldId,
          beforeValue,
          plannedValue: value ?? optionIds,
          appliedValue: beforeValue,
          status: "skipped",
          error: "当前控件已有内容，仅填空白模式禁止覆盖",
          skippedReason: wasModifiedByUser ? "字段已被用户修改为非空内容，仅填空白模式自动跳过以保护人工输入" : "当前控件已有值，仅填空白模式自动跳过"
        };
      }
      if (action === "skip") {
        return {
          fieldId,
          beforeValue,
          plannedValue: "skip",
          status: "skipped",
          error: "模型或用户标记跳过此字段",
          skippedReason: "模型或用户标记跳过此字段"
        };
      }
      let targetSelectVal = "";
      let targetRadio = null;
      try {
        if (tag === "select") {
          const select = element;
          targetSelectVal = "";
          if (value !== void 0 && value !== null && String(value).trim() !== "") {
            const strVal = String(value).trim();
            const matchedOpt = Array.from(select.options).find(
              (o) => {
                var _a2, _b2;
                return o.value === strVal || ((_a2 = o.text) == null ? void 0 : _a2.trim()) === strVal || o.id === strVal || strVal && ((_b2 = o.text) == null ? void 0 : _b2.trim().includes(strVal));
              }
            );
            if (matchedOpt) {
              targetSelectVal = matchedOpt.value;
            } else {
              return {
                fieldId,
                beforeValue,
                plannedValue: value ?? optionIds,
                appliedValue: beforeValue,
                status: "failed",
                error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`
              };
            }
          }
          if (!targetSelectVal && optionIds && optionIds.length > 0) {
            const opt = Array.from(select.options).find(
              (o) => o.id === optionIds[0] || `opt_${o.index}_${o.value}` === optionIds[0] || o.value === optionIds[0]
            );
            if (opt) {
              targetSelectVal = opt.value;
            } else {
              return {
                fieldId,
                beforeValue,
                plannedValue: value ?? optionIds,
                appliedValue: beforeValue,
                status: "failed",
                error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`
              };
            }
          }
          if (!targetSelectVal && select.options.length > 0) {
            const firstValid = Array.from(select.options).find((o) => !o.disabled && o.value !== "" && !o.text.includes("请选择"));
            if (firstValid) {
              targetSelectVal = firstValid.value;
            }
          }
          if (!targetSelectVal && select.options.length > 0) {
            targetSelectVal = select.options[0].value;
          }
          if (!targetSelectVal) {
            return {
              fieldId,
              beforeValue,
              plannedValue: value ?? optionIds,
              appliedValue: beforeValue,
              status: "failed",
              error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`
            };
          }
          const proto = Object.getPrototypeOf(select);
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) {
            desc.set.call(select, targetSelectVal);
          } else {
            select.value = targetSelectVal;
          }
          this.dispatchInputEvents(select);
        } else if (isCustomSelect) {
          const rawTargets = [];
          if (assignment.values && Array.isArray(assignment.values) && assignment.values.length > 0) {
            rawTargets.push(...assignment.values.map(String).filter(Boolean));
          } else if (Array.isArray(value) && value.length > 0) {
            rawTargets.push(...value.map(String).filter(Boolean));
          } else if (typeof value === "string" && value.trim()) {
            const strVal = value.trim();
            if (strVal.includes(",") || strVal.includes("，") || strVal.includes("、")) {
              rawTargets.push(...strVal.split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
            } else {
              rawTargets.push(strVal);
            }
          } else if (optionIds && optionIds.length > 0) {
            rawTargets.push(...optionIds.map(String).filter(Boolean));
          }
          if (rawTargets.length === 0) {
            rawTargets.push("");
          }
          let docCtx = element.ownerDocument;
          let rootNode = element;
          while (rootNode && (rootNode.parentElement || rootNode.parentNode)) {
            rootNode = rootNode.parentElement || rootNode.parentNode;
          }
          if (!docCtx || typeof docCtx.querySelectorAll !== "function") {
            docCtx = typeof document !== "undefined" ? document : rootNode;
          }
          const trigger = ((_b = selectWrapper.querySelector) == null ? void 0 : _b.call(
            selectWrapper,
            ".el-select__wrapper, .vue-treeselect__control, .ant-select-selector, .arco-select-view, .n-base-selection, .select-trigger"
          )) || ((_c = selectWrapper.querySelector) == null ? void 0 : _c.call(selectWrapper, "input")) || selectWrapper;
          if (((_d = trigger.getAttribute) == null ? void 0 : _d.call(trigger, "aria-expanded")) !== "true" && ((_e = selectWrapper.getAttribute) == null ? void 0 : _e.call(selectWrapper, "aria-expanded")) !== "true") {
            _FormExecutor.dispatchFullClick(trigger);
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
          const optionSelectors = [
            ".el-select-dropdown__item:not(.is-disabled)",
            ".el-select-dropdown__option-item:not(.is-disabled)",
            ".el-cascader-node:not(.is-disabled)",
            ".vue-treeselect__option",
            ".vue-treeselect__label",
            ".el-tree-node__content",
            ".ant-select-item-option:not(.ant-select-item-option-disabled)",
            ".ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled)",
            ".ant-select-tree-title",
            ".ant-select-tree-node-content-wrapper",
            ".ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled)",
            ".arco-select-option:not(.arco-select-option-disabled)",
            ".arco-cascader-list-item:not(.arco-cascader-list-item-disabled)",
            ".arco-tree-select-node",
            ".n-base-select-option:not(.n-base-select-option--disabled)",
            ".t-select-option:not(.t-is-disabled)",
            ".semi-select-option:not(.semi-select-option-disabled)",
            ".ivu-select-item:not(.ivu-select-item-disabled)",
            ".layui-form-select dl dd:not(.layui-select-tips):not(.layui-disabled)",
            '[role="option"]:not([aria-disabled="true"])',
            '[role="treeitem"]:not([aria-disabled="true"])',
            '[role="menuitem"]:not([aria-disabled="true"])',
            "option:not([disabled])"
          ].join(", ");
          const normalize = (text) => text.replace(/[\(（]\d+[\)）]/g, "").replace(/\s+/g, " ").trim();
          const hierarchySelectors = '.vue-treeselect, .el-tree-select, .el-cascader, .ant-tree-select, .ant-cascader, .arco-tree-select, .arco-cascader, .n-tree-select, .n-cascader, [aria-haspopup="tree"]';
          const usable = (node) => {
            var _a2, _b2, _c2, _d2, _e2, _f2, _g2, _h2, _i2, _j2, _k2, _l2, _m2, _n2;
            if (!node) return false;
            if (((_a2 = node.getAttribute) == null ? void 0 : _a2.call(node, "aria-disabled")) === "true" || ((_c2 = (_b2 = node.classList) == null ? void 0 : _b2.contains) == null ? void 0 : _c2.call(_b2, "is-disabled")) || ((_e2 = (_d2 = node.classList) == null ? void 0 : _d2.contains) == null ? void 0 : _e2.call(_d2, "ant-select-item-option-disabled")) || ((_g2 = (_f2 = node.classList) == null ? void 0 : _f2.contains) == null ? void 0 : _g2.call(_f2, "vue-treeselect__option--disabled")) || ((_i2 = (_h2 = node.classList) == null ? void 0 : _h2.contains) == null ? void 0 : _i2.call(_h2, "vue-treeselect__label--disabled")) || ((_j2 = node.hasAttribute) == null ? void 0 : _j2.call(node, "disabled"))) {
              return false;
            }
            for (let current = node; current && current !== ((_k2 = current.ownerDocument) == null ? void 0 : _k2.body); current = current.parentElement) {
              if (current.hidden) return false;
              const style = ((_n2 = (_m2 = (_l2 = current.ownerDocument) == null ? void 0 : _l2.defaultView) == null ? void 0 : _m2.getComputedStyle) == null ? void 0 : _n2.call(_m2, current)) || current.style;
              if ((style == null ? void 0 : style.display) === "none" || (style == null ? void 0 : style.visibility) === "hidden") return false;
            }
            return true;
          };
          const label = (node) => {
            var _a2, _b2;
            return (((_b2 = (_a2 = node.querySelector) == null ? void 0 : _a2.call(node, ".el-cascader-node__label, .ant-cascader-menu-item-content, .vue-treeselect__label, .el-tree-node__label, .ant-select-item-option-content")) == null ? void 0 : _b2.textContent) || node.textContent || "").trim();
          };
          const chosenLabels = [];
          let associatedMenuFound = false;
          let visibleOptionCount = 0;
          for (const targetOptionText of rawTargets) {
            const path = targetOptionText.split(/\s*(?:\/|>|→|\|)\s*/).filter(Boolean);
            let level = 0;
            let selected = false;
            let searched = false;
            let searchInputUsed = null;
            let previousSearch = "";
            let clearedTreeSearch = false;
            const expanded = /* @__PURE__ */ new WeakSet();
            const deadline = Date.now() + 3500;
            const isHierarchical = (container) => {
              var _a2, _b2, _c2, _d2;
              return path.length > 1 || Boolean(((_a2 = selectWrapper.matches) == null ? void 0 : _a2.call(selectWrapper, hierarchySelectors)) || ((_b2 = selectWrapper.closest) == null ? void 0 : _b2.call(selectWrapper, hierarchySelectors)) || ((_c2 = selectWrapper.querySelector) == null ? void 0 : _c2.call(selectWrapper, "input.vue-treeselect__input")) || ((_d2 = container.querySelector) == null ? void 0 : _d2.call(container, '[role="tree"], [role="treeitem"], .el-tree-node, .vue-treeselect__option, .el-cascader-node, .ant-cascader-menu-item')));
            };
            while (Date.now() < deadline && !this.isCancelled) {
              let associated = FormScanner.findAssociatedDropdownContainer(element, selectWrapper, docCtx);
              if (!associated && (docCtx == null ? void 0 : docCtx.querySelectorAll)) {
                const allVisible = Array.from(docCtx.querySelectorAll('.el-select-dropdown, .vue-treeselect__menu, .ant-select-dropdown, [class*="select-dropdown"]'));
                associated = allVisible.find((p) => {
                  var _a2, _b2;
                  return p && !p.hidden && ((_a2 = p.style) == null ? void 0 : _a2.display) !== "none" && ((_b2 = p.style) == null ? void 0 : _b2.visibility) !== "hidden";
                }) || null;
              }
              associatedMenuFound || (associatedMenuFound = Boolean(associated));
              const container = associated || selectWrapper;
              if (!clearedTreeSearch && isHierarchical(container)) {
                clearedTreeSearch = true;
                const treeSearch = (_f = selectWrapper.querySelector) == null ? void 0 : _f.call(selectWrapper, "input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input");
                if ((treeSearch == null ? void 0 : treeSearch.value) && !treeSearch.readOnly) {
                  this.setNativeValue(treeSearch, "");
                  this.dispatchInputEvents(treeSearch);
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  continue;
                }
              }
              let options = Array.from(((_g = container.querySelectorAll) == null ? void 0 : _g.call(container, optionSelectors)) || []).filter(
                (node) => {
                  var _a2;
                  return usable(node) && !((_a2 = node.querySelector) == null ? void 0 : _a2.call(node, '.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__option, [role="option"], [role="treeitem"]'));
                }
              );
              visibleOptionCount = options.length;
              if (searched && searchInputUsed && searchInputUsed.value && (options.length === 0 || Boolean((_h = container.querySelector) == null ? void 0 : _h.call(container, ".vue-treeselect__tip--no-results, .vue-treeselect__tip--empty, .el-select-dropdown__empty, .ant-empty")))) {
                this.setNativeValue(searchInputUsed, "");
                this.dispatchInputEvents(searchInputUsed);
                await new Promise((resolve) => setTimeout(resolve, 100));
                options = Array.from(((_i = container.querySelectorAll) == null ? void 0 : _i.call(container, optionSelectors)) || []).filter(
                  (node) => {
                    var _a2;
                    return usable(node) && !((_a2 = node.querySelector) == null ? void 0 : _a2.call(node, '.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__option, [role="option"], [role="treeitem"]'));
                  }
                );
                visibleOptionCount = options.length;
              }
              const target = path[level] || targetOptionText;
              let matched = options.find((node) => {
                var _a2, _b2;
                const val = ((_a2 = node.getAttribute) == null ? void 0 : _a2.call(node, "data-value")) ?? ((_b2 = node.getAttribute) == null ? void 0 : _b2.call(node, "value"));
                return path.length <= 1 && (optionIds == null ? void 0 : optionIds.includes(node.id)) || val === target || label(node) === target;
              });
              if (!matched && target) {
                matched = options.find((node) => normalize(label(node)) === normalize(target));
              }
              if (!matched && target) {
                matched = options.find((node) => {
                  const l = normalize(label(node));
                  const t = normalize(target);
                  return l && t && (l.includes(t) || t.includes(l));
                });
              }
              if (!matched && target) {
                if (target.includes("男")) {
                  matched = options.find((node) => label(node).includes("男"));
                } else if (target.includes("女")) {
                  matched = options.find((node) => label(node).includes("女"));
                }
              }
              if (!matched && (!target || Date.now() > deadline - 800) && options.length > 0) {
                matched = options.find((node) => {
                  const l = label(node);
                  return l && !l.includes("请选择") && !l.toLowerCase().includes("select") && l !== "--请选择--";
                });
              }
              if (matched) {
                (_j = matched.scrollIntoView) == null ? void 0 : _j.call(matched, { block: "nearest" });
                const clickTarget = ((_k = matched.querySelector) == null ? void 0 : _k.call(
                  matched,
                  ".vue-treeselect__label-container, .vue-treeselect__label, .el-tree-node__content, .el-tree-node__label, .el-cascader-node__label, .ant-select-item-option-content, .ant-select-tree-node-content-wrapper, .ant-select-tree-title"
                )) || matched;
                _FormExecutor.dispatchFullClick(clickTarget);
                if (clickTarget !== matched) {
                  _FormExecutor.dispatchFullClick(matched);
                }
                if (level < path.length - 1) {
                  level++;
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  continue;
                }
                const chosen = label(matched);
                chosenLabels.push(chosen);
                selected = true;
                break;
              }
              const arrows = Array.from(
                ((_l = container.querySelectorAll) == null ? void 0 : _l.call(
                  container,
                  '.el-tree-node__expand-icon:not(.is-leaf):not(.expanded), .ant-select-tree-switcher_close, .vue-treeselect__option-arrow-container, [aria-expanded="false"] > .vue-treeselect__option-arrow'
                )) || []
              );
              if (path.length <= 1) {
                for (const node of options) {
                  if ((_m = node.querySelector) == null ? void 0 : _m.call(node, ".el-cascader-node__postfix, .ant-cascader-menu-item-expand-icon, .arco-cascader-list-item-expand-icon")) {
                    arrows.push(node);
                  }
                }
              }
              const arrow = arrows.find(
                (node) => {
                  var _a2, _b2;
                  return usable(node) && !expanded.has(node) && !((_a2 = node.closest) == null ? void 0 : _a2.call(node, ".vue-treeselect__option--expanded")) && !((_b2 = node.querySelector) == null ? void 0 : _b2.call(node, ".vue-treeselect__option-arrow--rotated"));
                }
              );
              if (arrow) {
                expanded.add(arrow);
                _FormExecutor.dispatchFullClick(arrow);
                let waitLoading = 0;
                while (waitLoading < 1500) {
                  const isLoading = Boolean(
                    (_n = container.querySelector) == null ? void 0 : _n.call(container, '.el-tree-node__loading-icon, .is-loading, .ant-select-tree-switcher-loading-icon, .arco-icon-loading, [aria-busy="true"]')
                  );
                  if (!isLoading && waitLoading > 100) break;
                  await new Promise((r) => setTimeout(r, 60));
                  waitLoading += 60;
                }
              } else if (!searched && target && value !== void 0 && !/^\d+$/.test(target)) {
                const search = (_o = selectWrapper.querySelector) == null ? void 0 : _o.call(
                  selectWrapper,
                  "input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input"
                );
                if (search && !search.readOnly) {
                  searchInputUsed = search;
                  previousSearch = search.value;
                  this.setNativeValue(search, target);
                  this.dispatchInputEvents(search);
                }
                searched = true;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!selected && searchInputUsed && searchInputUsed.value !== previousSearch) {
              this.setNativeValue(searchInputUsed, previousSearch);
              this.dispatchInputEvents(searchInputUsed);
            }
            if (!selected) {
              throw new Error(
                `下拉选择失败：${associatedMenuFound ? "已找到浮层" : "未找到关联浮层"}；可用选项 ${visibleOptionCount} 项；目标「${targetOptionText}」未匹配。`
              );
            }
            if (rawTargets.length > 1) {
              await new Promise((r) => setTimeout(r, 80));
            }
          }
          if (rawTargets.length > 1 || ((_q = (_p = selectWrapper.classList) == null ? void 0 : _p.contains) == null ? void 0 : _q.call(_p, "is-multiple")) || ((_r = selectWrapper.querySelector) == null ? void 0 : _r.call(selectWrapper, ".el-select__tags"))) {
            try {
              const innerInput = element.tagName.toLowerCase() === "input" ? element : (_s = selectWrapper.querySelector) == null ? void 0 : _s.call(selectWrapper, "input");
              if (typeof (innerInput == null ? void 0 : innerInput.blur) === "function") {
                innerInput.blur();
              }
            } catch {
            }
            await new Promise((r) => setTimeout(r, 60));
          }
          targetSelectVal = chosenLabels.join(", ");
          const verifyUntil = Date.now() + 1500;
          const expected = normalize(targetSelectVal);
          while (Date.now() < verifyUntil) {
            const actual = String(this.readElementValue(element)).trim();
            const parts = actual.split(/\s*(?:\/|>|→|,|，)\s*/);
            if (normalize(actual) === expected || rawTargets.every((t) => normalize(actual).includes(normalize(t))) || rawTargets.length === 1 && normalize(actual).includes(expected) || parts.some((part) => normalize(part) === expected)) {
              targetSelectVal = actual;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } else if (input.type === "radio" || fieldId.includes("_radiogroup_")) {
          const targetVal = String(value ?? (optionIds == null ? void 0 : optionIds[0]) ?? "").trim();
          let optionNode = FormDOMRegistry.getOptionElement(fieldId, targetVal, snapshotId) || ((optionIds == null ? void 0 : optionIds[0]) ? FormDOMRegistry.getOptionElement(fieldId, optionIds[0], snapshotId) : null);
          if (!optionNode || typeof optionNode.isConnected === "boolean" && !optionNode.isConnected) {
            const radioContainer = ((_t = element.closest) == null ? void 0 : _t.call(element, '.el-radio-group, .ant-radio-group, [role="radiogroup"], .el-form-item, .ant-form-item, form')) || element.parentElement || element;
            const labels = Array.from(((_u = radioContainer.querySelectorAll) == null ? void 0 : _u.call(radioContainer, 'label, .el-radio, .ant-radio, .arco-radio, [role="radio"]')) || []);
            optionNode = labels.find((l) => {
              var _a2;
              return (((_a2 = l.textContent) == null ? void 0 : _a2.trim()) || "").includes(targetVal);
            }) || null;
          }
          if (!optionNode) {
            throw new Error(`单选目标「${targetVal}」不存在、已失效或被禁用`);
          }
          targetRadio = ((_v = optionNode.querySelector) == null ? void 0 : _v.call(optionNode, 'input[type="radio"], input')) || (optionNode.tagName === "INPUT" ? optionNode : null);
          if (targetRadio && targetRadio.disabled) {
            throw new Error(`单选目标「${targetVal}」处于禁用状态`);
          }
          _FormExecutor.dispatchFullClick(optionNode);
          if (targetRadio && !targetRadio.checked) {
            targetRadio.checked = true;
            this.dispatchInputEvents(targetRadio);
          }
        } else if (input.type === "checkbox") {
          const targetChecked = this.toStrictBoolean(value);
          if (input.checked !== targetChecked) {
            input.click();
            if (input.checked !== targetChecked) {
              input.checked = targetChecked;
              this.dispatchInputEvents(input);
            }
          }
        } else if (tag === "input" || tag === "textarea") {
          const strVal = value !== void 0 && value !== null ? String(value) : "";
          this.setNativeValue(element, strVal);
          this.dispatchInputEvents(element);
        } else {
          return {
            fieldId,
            beforeValue,
            plannedValue: value ?? optionIds,
            appliedValue: beforeValue,
            status: "failed",
            error: `不支持向非原生表单控件 <${tag}> 写入数据，需接入专用交互适配器`
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        const currentElementValue = this.readElementValue(element);
        const appliedValue = currentElementValue;
        let isMatched = false;
        if (tag === "select") {
          isMatched = String(appliedValue) === targetSelectVal;
        } else if (isCustomSelect) {
          const actualStr = String(appliedValue).trim();
          const expectedStr = String(targetSelectVal).trim();
          const normalize = (text) => text.replace(/[\(（]\d+[\)）]/g, "").replace(/\s+/g, " ").trim();
          const rawTargets = Array.isArray(value) ? value.map(String) : String(value ?? (optionIds == null ? void 0 : optionIds[0]) ?? "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
          isMatched = Boolean(targetSelectVal) && Boolean(actualStr) && (actualStr === expectedStr || normalize(actualStr) === normalize(expectedStr) || actualStr.includes(expectedStr) || expectedStr.includes(actualStr) || normalize(actualStr).includes(normalize(expectedStr)) || normalize(expectedStr).includes(normalize(actualStr)) || rawTargets.length > 0 && rawTargets.every((t) => normalize(actualStr).includes(normalize(t))));
        } else if (input.type === "radio" || fieldId.includes("_radiogroup_")) {
          isMatched = (targetRadio == null ? void 0 : targetRadio.checked) === true || Boolean(
            ((_x = (_w = element == null ? void 0 : element.classList) == null ? void 0 : _w.contains) == null ? void 0 : _x.call(_w, "is-checked")) || ((_A = (_z = (_y = targetRadio == null ? void 0 : targetRadio.parentElement) == null ? void 0 : _y.classList) == null ? void 0 : _z.contains) == null ? void 0 : _A.call(_z, "is-checked")) || ((_E = (_D = (_C = (_B = targetRadio == null ? void 0 : targetRadio.closest) == null ? void 0 : _B.call(targetRadio, "label, .el-radio, .ant-radio")) == null ? void 0 : _C.classList) == null ? void 0 : _D.contains) == null ? void 0 : _E.call(_D, "is-checked"))
          );
        } else if (input.type === "checkbox") {
          isMatched = appliedValue === this.toStrictBoolean(value);
        } else if (input.type === "number") {
          isMatched = String(appliedValue) === String(value);
        } else {
          isMatched = String(appliedValue) === String(value ?? "");
        }
        if (!isMatched) {
          const expectedText = tag === "select" || isCustomSelect ? targetSelectVal : value;
          return {
            fieldId,
            beforeValue,
            plannedValue: value ?? optionIds,
            appliedValue,
            status: "failed",
            error: `回读值校验失败：期望写入 "${expectedText}"，但实际 DOM 值为 "${appliedValue}"`
          };
        }
        return {
          fieldId,
          beforeValue,
          plannedValue: value ?? optionIds,
          appliedValue: isCustomSelect ? targetSelectVal || appliedValue : appliedValue,
          status: "success"
        };
      } catch (err) {
        return {
          fieldId,
          beforeValue,
          plannedValue: value ?? optionIds,
          status: "failed",
          error: `填充执行异常：${err.message}`
        };
      }
    }
    /**
     * 执行完整的表单填表计划
     */
    static async executePlan(snapshotId, assignments, mode = "empty_only", customRunId) {
      var _a, _b, _c;
      const runId = customRunId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.activeRunId = runId;
      const runRecord = {
        runId,
        snapshotId,
        status: "running",
        createdAt: Date.now(),
        steps: []
      };
      if (this.isCancelled) {
        runRecord.status = "cancelled";
        runRecord.finishedAt = Date.now();
        this.isCancelled = false;
        this.activeRunId = null;
        this.runHistory.set(runId, runRecord);
        return runRecord;
      }
      try {
        let stepIndex = 0;
        for (const assignment of assignments) {
          if (this.isCancelled) {
            runRecord.status = "cancelled";
            break;
          }
          const stepResult = await this.executeAssignment(assignment, snapshotId, mode);
          runRecord.steps.push(stepResult);
          if (typeof chrome !== "undefined" && ((_a = chrome.runtime) == null ? void 0 : _a.sendMessage)) {
            try {
              const sendPromise = chrome.runtime.sendMessage({
                type: "UPDATE_TASK_STEP",
                payload: {
                  runId,
                  stepIndex,
                  update: {
                    status: stepResult.status === "success" ? "success" : stepResult.status === "skipped" ? "skipped" : "failed",
                    actionSent: true,
                    verified: stepResult.status === "success",
                    error: stepResult.error
                  }
                }
              });
              if (sendPromise && typeof sendPromise.catch === "function") {
                sendPromise.catch(() => {
                });
              }
            } catch {
            }
          }
          stepIndex += 1;
        }
      } finally {
        this.isCancelled = false;
        this.activeRunId = null;
      }
      runRecord.finishedAt = Date.now();
      if (runRecord.status === "running") {
        const hasFailed = runRecord.steps.some((s) => s.status === "failed");
        const hasSuccess = runRecord.steps.some((s) => s.status === "success");
        if (hasFailed && hasSuccess) {
          runRecord.status = "partial";
        } else if (hasFailed) {
          runRecord.status = "failed";
        } else {
          runRecord.status = "completed";
        }
      }
      this.runHistory.set(runId, runRecord);
      this.activeRunId = null;
      if (typeof chrome !== "undefined" && ((_b = chrome.runtime) == null ? void 0 : _b.sendMessage)) {
        try {
          const sendFinish = chrome.runtime.sendMessage({
            type: "FINISH_TASK",
            payload: {
              runId,
              status: runRecord.status,
              error: (_c = runRecord.steps.find((s) => s.status === "failed")) == null ? void 0 : _c.error
            }
          });
          if (sendFinish && typeof sendFinish.catch === "function") {
            sendFinish.catch(() => {
            });
          }
        } catch {
        }
      }
      return runRecord;
    }
    /**
     * 撤销指定填表任务 (Undo)
     * 缺陷 7: 支持从外部持久化数据恢复 steps，刷新页面也能成功撤销
     */
    static async undo(runId, fallbackRecord) {
      const record = this.runHistory.get(runId) || ((fallbackRecord == null ? void 0 : fallbackRecord.steps) ? {
        snapshotId: fallbackRecord.snapshotId || "",
        status: "completed",
        steps: fallbackRecord.steps
      } : void 0);
      if (!record) {
        return {
          success: false,
          restoredCount: 0,
          conflictCount: 0,
          error: `找不到填表运行记录: ${runId}`
        };
      }
      let restoredCount = 0;
      let conflictCount = 0;
      const steps = [...record.steps].reverse();
      const successfulSteps = steps.filter((s) => s.status === "success" && s.appliedValue !== void 0);
      if (successfulSteps.length === 0) {
        return {
          success: true,
          restoredCount: 0,
          conflictCount: 0
        };
      }
      let missingElementCount = 0;
      for (const step of successfulSteps) {
        const element = FormDOMRegistry.get(step.fieldId, record.snapshotId);
        if (!element || typeof document !== "undefined" && document.contains && !document.contains(element)) {
          missingElementCount++;
        }
      }
      if (missingElementCount === successfulSteps.length) {
        return {
          success: false,
          restoredCount: 0,
          conflictCount: missingElementCount,
          error: "当前网页已被刷新或重新加载，表单快照与控件映射已失效，无法在已刷新的页面上执行撤销恢复。"
        };
      }
      for (const step of steps) {
        if (step.status !== "success" || step.appliedValue === void 0) {
          continue;
        }
        const element = FormDOMRegistry.get(step.fieldId, record.snapshotId);
        if (!element || typeof document !== "undefined" && document.contains && !document.contains(element)) {
          conflictCount++;
          continue;
        }
        const currentVal = this.readElementValue(element);
        if (String(currentVal) !== String(step.appliedValue)) {
          conflictCount++;
          continue;
        }
        const tag = element.tagName.toLowerCase();
        const input = element;
        if (input.type === "radio" || tag !== "select" && FormScanner.isDropdownComponent(element, FormScanner.findDropdownRoot(element))) {
          if (step.beforeValue === "") {
            conflictCount++;
            continue;
          }
          const restored = await this.executeAssignment({ fieldId: step.fieldId, action: input.type === "radio" ? "check" : "select", value: step.beforeValue, source: "instruction" }, record.snapshotId, "allow_overwrite");
          if (restored.status !== "success") {
            conflictCount++;
            continue;
          }
        } else if (input.type === "checkbox") {
          const targetBool = this.toStrictBoolean(step.beforeValue);
          if (input.checked !== targetBool) {
            input.checked = targetBool;
            this.dispatchInputEvents(input);
          }
        } else if (tag === "select") {
          element.value = String(step.beforeValue);
          this.dispatchInputEvents(element);
        } else {
          this.setNativeValue(element, String(step.beforeValue));
          this.dispatchInputEvents(element);
        }
        restoredCount++;
      }
      record.status = "undone";
      return {
        success: true,
        restoredCount,
        conflictCount
      };
    }
  };
  __publicField(_FormExecutor, "isCancelled", false);
  __publicField(_FormExecutor, "activeRunId", null);
  // 历史运行记录缓存（用于撤销）
  __publicField(_FormExecutor, "runHistory", /* @__PURE__ */ new Map());
  let FormExecutor = _FormExecutor;
  class QuickLoginExecutor {
    /**
     * 判断元素是否在页面中可见
     */
    static isElementVisible(el) {
      if (!el || !el.isConnected) return false;
      if (el.offsetParent === null && el.tagName.toLowerCase() !== "body") {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      return true;
    }
    /**
     * 查找可见的密码输入框
     */
    static findVisiblePasswordInput() {
      const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
      for (const input of inputs) {
        if (this.isElementVisible(input) && !input.disabled && !input.readOnly) {
          return input;
        }
      }
      return null;
    }
    /**
     * 查找弹窗登录触发按钮（优先使用自定义选择器，否则采用多维智能嗅探）
     */
    static findLoginTriggerButton(customSelector) {
      if (customSelector && customSelector.trim()) {
        try {
          const customEl = document.querySelector(customSelector.trim());
          if (customEl && this.isElementVisible(customEl)) return customEl;
        } catch (err) {
          console.warn("[QuickLogin] 自定义选择器解析失败:", err);
        }
      }
      const candidates = Array.from(
        document.querySelectorAll(
          'button, a, input[type="button"], [role="button"], [class*="login"], [id*="login"]'
        )
      );
      for (const el of candidates) {
        if (!this.isElementVisible(el)) continue;
        const text = (el.innerText || el.textContent || el.value || "").trim();
        if (/^(登\s*录|sign\s*in|log\s*in|login)$/i.test(text)) {
          return el;
        }
      }
      for (const el of candidates) {
        if (!this.isElementVisible(el)) continue;
        const text = (el.innerText || el.textContent || "").trim();
        if (text.length <= 8 && /(登\s*录|Sign In|Log In)/i.test(text)) {
          return el;
        }
      }
      return null;
    }
    /**
     * 等待可见密码框出现（支持弹窗挂载异步动画）
     */
    static async waitForPasswordInput(timeoutMs = 5e3) {
      const existing = this.findVisiblePasswordInput();
      if (existing) return existing;
      return new Promise((resolve, reject) => {
        let timer = null;
        let pollTimer = null;
        let observer = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          if (pollTimer) clearInterval(pollTimer);
          if (observer) observer.disconnect();
        };
        const check = () => {
          const found = QuickLoginExecutor.findVisiblePasswordInput();
          if (found) {
            cleanup();
            resolve(found);
            return true;
          }
          return false;
        };
        if (typeof MutationObserver !== "undefined") {
          observer = new MutationObserver(() => {
            check();
          });
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          }
        }
        pollTimer = setInterval(check, 100);
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`未在 ${timeoutMs}ms 内检测到登录密码框`));
        }, timeoutMs);
      });
    }
    /**
     * 定位用户名输入框（根据与密码框的关联关系与语义属性探查）
     */
    static findUsernameInput(passwordInput) {
      const form = passwordInput.closest("form");
      if (form) {
        const formInputs = Array.from(form.querySelectorAll("input"));
        const textInputs = formInputs.filter(
          (i) => i !== passwordInput && this.isElementVisible(i) && !i.disabled && !i.readOnly && ["text", "email", "tel", "number", ""].includes((i.type || "text").toLowerCase())
        );
        if (textInputs.length > 0) {
          const matched = textInputs.find(
            (i) => /(user|account|name|phone|email|账号|用户|手机)/i.test((i.name || "") + (i.placeholder || "") + (i.id || ""))
          );
          return matched || textInputs[textInputs.length - 1];
        }
      }
      const allInputs = Array.from(document.querySelectorAll("input"));
      const pIndex = allInputs.indexOf(passwordInput);
      const priorInputs = (pIndex > 0 ? allInputs.slice(0, pIndex) : allInputs).filter(
        (i) => i !== passwordInput && this.isElementVisible(i) && !i.disabled && !i.readOnly && ["text", "email", "tel", "number", ""].includes((i.type || "text").toLowerCase())
      );
      if (priorInputs.length > 0) {
        const matched = priorInputs.find(
          (i) => /(user|account|name|phone|email|账号|用户|手机)/i.test((i.name || "") + (i.placeholder || "") + (i.id || ""))
        );
        return matched || priorInputs[priorInputs.length - 1];
      }
      return null;
    }
    /**
     * 原生原型 setter 赋值，保证 Vue / React 受控组件正常响应
     */
    static setInputValue(input, value) {
      input.focus();
      const proto = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      input.blur();
    }
    /**
     * 尝试自动提交登录表单
     */
    static async trySubmit(passwordInput) {
      await new Promise((r) => setTimeout(r, 200));
      const form = passwordInput.closest("form");
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn && this.isElementVisible(submitBtn)) {
          submitBtn.click();
          return true;
        }
      }
      const container = form || passwordInput.closest('.modal, .dialog, .el-dialog, .ant-modal, [role="dialog"]') || document.body;
      const buttons = Array.from(
        container.querySelectorAll('button, a, input[type="button"], [role="button"]')
      );
      for (const btn of buttons) {
        if (!this.isElementVisible(btn)) continue;
        const text = (btn.innerText || btn.textContent || btn.value || "").trim();
        if (/^(登\s*录|sign\s*in|log\s*in|确定|进入系统)$/i.test(text)) {
          btn.click();
          return true;
        }
      }
      passwordInput.focus();
      passwordInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      passwordInput.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      passwordInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      return true;
    }
    /**
     * 执行完整的快捷登录流程
     */
    static async execute(params) {
      try {
        let passwordInput = this.findVisiblePasswordInput();
        if (!passwordInput) {
          const triggerBtn = this.findLoginTriggerButton(params.loginTriggerSelector);
          if (triggerBtn) {
            triggerBtn.click();
            passwordInput = await this.waitForPasswordInput(5e3);
          } else {
            try {
              passwordInput = await this.waitForPasswordInput(1500);
            } catch {
              return {
                success: false,
                message: "未在页面中找到登录密码框，也未探查到登录弹窗触发按钮。"
              };
            }
          }
        }
        if (!passwordInput) {
          return { success: false, message: "未找到登录密码框。" };
        }
        const usernameInput = this.findUsernameInput(passwordInput);
        if (!usernameInput) {
          return { success: false, message: "已找到密码框，但未定位到对应的用户名输入框。" };
        }
        this.setInputValue(usernameInput, params.username);
        this.setInputValue(passwordInput, params.password);
        if (params.autoSubmit) {
          await this.trySubmit(passwordInput);
          return {
            success: true,
            message: `账号 [${params.username}] 已自动填写并提交登录`
          };
        }
        passwordInput.focus();
        return {
          success: true,
          message: `账号 [${params.username}] 凭据已自动填写完毕`
        };
      } catch (error) {
        return {
          success: false,
          message: error.message || "快捷登录执行异常"
        };
      }
    }
  }
  let hudContainer = null;
  let dismissTimer = null;
  function getOrCreateHudContainer() {
    if (hudContainer && document.documentElement.contains(hudContainer)) {
      return hudContainer;
    }
    hudContainer = document.createElement("div");
    hudContainer.dataset.qaCopilotRoot = "true";
    hudContainer.dataset.qaCopilotHud = "true";
    Object.assign(hudContainer.style, {
      position: "fixed",
      top: "20px",
      right: "24px",
      zIndex: "2147483646",
      maxWidth: "420px",
      minWidth: "280px",
      boxSizing: "border-box",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: "13px",
      lineHeight: "1.4",
      pointerEvents: "auto",
      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      transform: "translateY(-10px)",
      opacity: "0"
    });
    document.documentElement.appendChild(hudContainer);
    requestAnimationFrame(() => {
      if (hudContainer) {
        hudContainer.style.transform = "translateY(0)";
        hudContainer.style.opacity = "1";
      }
    });
    return hudContainer;
  }
  function dismissTestHud(instant = false) {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (!hudContainer) return;
    if (instant) {
      hudContainer.remove();
      hudContainer = null;
      return;
    }
    hudContainer.style.transform = "translateY(-10px)";
    hudContainer.style.opacity = "0";
    setTimeout(() => {
      hudContainer == null ? void 0 : hudContainer.remove();
      hudContainer = null;
    }, 250);
  }
  function updateTestHud(payload) {
    if (window !== window.top) return;
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    const container = getOrCreateHudContainer();
    const { status, title, stepTitle, stepIndex, totalSteps, detail, reason, error } = payload;
    let theme = {
      bg: "#ffffff",
      border: "#e2e8f0",
      titleColor: "#0f172a",
      iconHtml: "",
      badgeHtml: ""
    };
    if (status === "running") {
      theme = {
        bg: "rgba(255, 255, 255, 0.95)",
        border: "#c7d2fe",
        titleColor: "#312e81",
        badgeBg: "#e0e7ff",
        badgeText: "#4338ca",
        iconHtml: `
        <svg style="width: 18px; height: 18px; animation: spin 1s linear infinite; color: #4f46e5; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
      `,
        badgeHtml: `<span style="background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 9999px;">执行中${totalSteps ? ` · ${Math.min((stepIndex ?? 0) + 1, totalSteps)}/${totalSteps}步` : ""}</span>`
      };
    } else if (status === "passed") {
      theme = {
        bg: "#f0fdf4",
        border: "#86efac",
        titleColor: "#14532d",
        badgeBg: "#dcfce7",
        badgeText: "#15803d",
        iconHtml: `
        <svg style="width: 20px; height: 20px; color: #16a34a; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      `,
        badgeHtml: `<span style="background: #22c55e; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; letter-spacing: 0.5px;">✓ PASS 测试通过</span>`
      };
      dismissTimer = setTimeout(() => dismissTestHud(), 7e3);
    } else if (status === "failed") {
      theme = {
        bg: "#fff1f2",
        border: "#fca5a5",
        titleColor: "#881337",
        badgeBg: "#fee2e2",
        badgeText: "#b91c1c",
        iconHtml: `
        <svg style="width: 20px; height: 20px; color: #e11d48; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      `,
        badgeHtml: `<span style="background: #e11d48; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; letter-spacing: 0.5px;">✕ FAIL 测试未通过</span>`
      };
      dismissTimer = setTimeout(() => dismissTestHud(), 12e3);
    } else if (status === "cancelled") {
      theme = {
        bg: "#f8fafc",
        border: "#cbd5e1",
        titleColor: "#334155",
        badgeBg: "#f1f5f9",
        badgeText: "#64748b",
        iconHtml: `
        <svg style="width: 18px; height: 18px; color: #64748b; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
      `,
        badgeHtml: `<span style="background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 9999px;">已取消</span>`
      };
      dismissTimer = setTimeout(() => dismissTestHud(), 3500);
    }
    const heading = title || (status === "passed" ? "测试通过" : status === "failed" ? "测试失败" : "自然语言自动化测试");
    const mainReason = reason || error || "";
    const currentStepInfo = stepTitle ? `<div style="font-size: 12px; color: #475569; margin-top: 4px; word-break: break-all;"><strong>当前步骤：</strong>${stepTitle}</div>` : "";
    const detailInfo = detail ? `<div style="font-size: 11px; color: #64748b; margin-top: 3px; word-break: break-all; opacity: 0.9;">${detail}</div>` : "";
    const reasonInfo = mainReason ? `
    <div style="margin-top: 6px; padding: 6px 9px; background: rgba(0, 0, 0, 0.04); border-radius: 6px; font-size: 11px; line-height: 1.45; color: ${status === "failed" ? "#9f1239" : status === "passed" ? "#166534" : "#334155"}; word-break: break-all;">
      <strong>${status === "failed" ? "原因说明：" : status === "passed" ? "验证依据：" : "说明："}</strong>${mainReason}
    </div>
  ` : "";
    container.innerHTML = `
    <style>
      @keyframes spin { 100% { transform: rotate(360deg); } }
    </style>
    <div style="background: ${theme.bg}; border: 1px solid ${theme.border}; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08); padding: 12px 14px; backdrop-filter: blur(8px);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          ${theme.iconHtml}
          <span style="font-size: 13px; font-weight: 700; color: ${theme.titleColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${heading}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${theme.badgeHtml}
          <button id="qa-copilot-hud-close" style="background: none; border: none; padding: 2px 4px; cursor: pointer; color: #94a3b8; font-size: 14px; line-height: 1; border-radius: 4px;">✕</button>
        </div>
      </div>
      ${currentStepInfo}
      ${detailInfo}
      ${reasonInfo}
    </div>
  `;
    const closeBtn = container.querySelector("#qa-copilot-hud-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissTestHud();
      });
    }
  }
  const ZENTAO_AUTOFILL_STORAGE_KEY = "zentao_pending_autofill";
  const ZENTAO_PENDING_ATTACHMENT_KEY = "zentao_pending_attachment";
  function dataUrlToFile(dataUrl, fileName) {
    try {
      const [header, base64] = dataUrl.split(",", 2);
      if (!base64) return null;
      const mimeMatch = header.match(/^data:([^;]+)/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      const binary = atob(base64);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
      }
      return new File([array], fileName, { type: mimeType });
    } catch {
      return null;
    }
  }
  class ZentaoFillExecutor {
    static resetStateForTesting() {
      var _a;
      this.hasFilled = false;
      (_a = this.observer) == null ? void 0 : _a.disconnect();
      this.observer = null;
    }
    /**
     * 检查当前页面是否为 Bug 详情页
     */
    static isZentaoBugViewPage() {
      if (typeof window === "undefined" || !window.location) return false;
      const url = window.location.href || "";
      const isUrlMatch = url.includes("bug-view") || url.includes("m=bug") && url.includes("f=view") || /bug.*view/i.test(url) || /\/bug\/(?:view|detail)\/\d+/i.test(url);
      if (isUrlMatch) return true;
      if (typeof document !== "undefined" && typeof document.querySelector === "function") {
        try {
          const hasDetailLayout = Boolean(
            document.querySelector(".detail-title, .bug-title, #mainContent .detail, #legendBasicInfo, #mainContent .main-col")
          );
          if (hasDetailLayout && this.getBugIdFromViewPage() !== null) {
            return true;
          }
        } catch {
        }
      }
      return false;
    }
    /**
     * 从详情页 URL 或 DOM 提取 Bug ID
     */
    static getBugIdFromViewPage() {
      if (typeof window === "undefined" || !window.location) return null;
      const url = window.location.href || "";
      const m1 = url.match(/bug-view-(\d+)/i);
      if (m1) return Number(m1[1]);
      const m2 = url.match(/[?&](?:bugID|id|bug)=(\d+)/i);
      if (m2) return Number(m2[1]);
      const m3 = url.match(/\/bug\/(?:view|detail)\/(\d+)/i);
      if (m3) return Number(m3[1]);
      const m4 = url.match(/bug-(\d+)\.html/i);
      if (m4) return Number(m4[1]);
      if (typeof document !== "undefined" && typeof document.querySelector === "function") {
        try {
          const idInput = document.querySelector('input[name="bugID"], input[name="bug"], input[name="id"]');
          if (idInput && idInput.value && /^\d+$/.test(idInput.value)) {
            return Number(idInput.value);
          }
          const labelId = document.querySelector(".label-id, .prefix, .bug-id, span[data-id]");
          if (labelId && labelId.textContent) {
            const match = labelId.textContent.match(/#?(\d+)/);
            if (match) return Number(match[1]);
          }
        } catch {
        }
      }
      return null;
    }
    /**
     * 检查当前环境是否包含禅道提 Bug 表单
     */
    static isZentaoCreateBugPage() {
      if (typeof window === "undefined" || !window.location) return false;
      const url = window.location.href || "";
      const isUrlMatch = url.includes("bug-create") || url.includes("m=bug&f=create") || /bug.*create/i.test(url);
      if (isUrlMatch) return true;
      if (typeof document !== "undefined" && typeof document.querySelector === "function") {
        try {
          const hasBugForm = Boolean(
            document.querySelector("form#dataform") || document.querySelector('form[action*="bug-create"]') || document.querySelector('form[action*="f=create"]')
          );
          const hasTitleAndSteps = Boolean(
            document.querySelector('input#title, input[name="title"]') && (document.querySelector('textarea#steps, textarea[name="steps"]') || document.querySelector(".ke-container, .editor, iframe.ke-edit-iframe"))
          );
          return hasBugForm || hasTitleAndSteps;
        } catch {
        }
      }
      return false;
    }
    /**
     * 检查并执行自动填写或附件挂载
     */
    static async checkAndExecute() {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return false;
      }
      if (this.hasFilled) {
        return false;
      }
      if (this.isZentaoBugViewPage()) {
        return this.checkAndAttachOnBugViewPage();
      }
      let pendingData;
      try {
        const getRes = chrome.storage.local.get(ZENTAO_AUTOFILL_STORAGE_KEY);
        const res = typeof (getRes == null ? void 0 : getRes.then) === "function" ? await getRes : await new Promise((resolve) => chrome.storage.local.get(ZENTAO_AUTOFILL_STORAGE_KEY, resolve));
        pendingData = res == null ? void 0 : res[ZENTAO_AUTOFILL_STORAGE_KEY];
      } catch {
        return false;
      }
      if (!pendingData) {
        return false;
      }
      if (Date.now() - pendingData.createdAt > 10 * 60 * 1e3) {
        try {
          chrome.storage.local.remove(ZENTAO_AUTOFILL_STORAGE_KEY);
        } catch {
        }
        return false;
      }
      console.log("[QA Copilot] 探测到待填写的禅道 Bug 任务:", pendingData.title);
      if (this.isZentaoCreateBugPage()) {
        return this.fillFormWithRetry(pendingData);
      }
      if (this.isLikelyZentaoSite()) {
        this.showFloatingHelper(pendingData);
        this.setupDomWatcher(pendingData);
      }
      return false;
    }
    /**
     * 外部或消息主动触发填写
     */
    static async executeWithData(data) {
      if (!data) return false;
      console.log("[QA Copilot] 接收到主动触发的禅道填单指令:", data.title);
      return this.fillFormWithRetry(data);
    }
    /**
     * 判断是否属于禅道相关页面
     */
    static isLikelyZentaoSite() {
      var _a;
      if (typeof window === "undefined" || !window.location) return false;
      const url = window.location.href || "";
      const title = typeof document !== "undefined" && typeof document.title === "string" ? document.title : "";
      if (url.includes("zentao") || title.includes("禅道") || ((_a = window.config) == null ? void 0 : _a.version)) {
        return true;
      }
      if (typeof document !== "undefined" && typeof document.querySelector === "function") {
        try {
          return Boolean(document.querySelector("#mainMenu, #navbar, .navbar-nav, #userNav, .user-name"));
        } catch {
        }
      }
      return false;
    }
    /**
     * 监听 DOM 树变化，针对 SPA 路由延迟加载提单表单场景进行自愈补填
     */
    static setupDomWatcher(data) {
      if (this.observer) return;
      let elapsedMs = 0;
      const interval = 500;
      const timer = setInterval(() => {
        var _a, _b;
        elapsedMs += interval;
        if (this.hasFilled || elapsedMs >= 2e4) {
          clearInterval(timer);
          (_a = this.observer) == null ? void 0 : _a.disconnect();
          this.observer = null;
          return;
        }
        if (this.isZentaoCreateBugPage()) {
          clearInterval(timer);
          (_b = this.observer) == null ? void 0 : _b.disconnect();
          this.observer = null;
          void this.fillFormWithRetry(data);
        }
      }, interval);
      try {
        this.observer = new MutationObserver(() => {
          var _a;
          if (!this.hasFilled && this.isZentaoCreateBugPage()) {
            clearInterval(timer);
            (_a = this.observer) == null ? void 0 : _a.disconnect();
            this.observer = null;
            void this.fillFormWithRetry(data);
          }
        });
        this.observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true
        });
      } catch {
      }
    }
    /**
     * 轮询重试直到富文本编辑器和各字段就绪并成功注入
     */
    static fillFormWithRetry(data) {
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 30;
        const timer = setInterval(async () => {
          var _a, _b, _c, _d, _e, _f;
          attempts++;
          const titleInput = this.findTitleInput();
          const hasEditor = this.hasEditorReady();
          if (titleInput && hasEditor || attempts >= maxAttempts) {
            clearInterval(timer);
            const success = this.applyFields(data);
            if (success) {
              this.hasFilled = true;
              try {
                (_c = (_b = (_a = chrome.storage) == null ? void 0 : _a.local) == null ? void 0 : _b.remove) == null ? void 0 : _c.call(_b, ZENTAO_AUTOFILL_STORAGE_KEY);
              } catch {
              }
              this.showSuccessBanner(data);
              this.removeFloatingHelper();
              resolve(true);
              return;
            }
            if (window === window.top) {
              const childSuccess = this.tryFillChildIframes(data);
              if (childSuccess) {
                this.hasFilled = true;
                try {
                  (_f = (_e = (_d = chrome.storage) == null ? void 0 : _d.local) == null ? void 0 : _e.remove) == null ? void 0 : _f.call(_e, ZENTAO_AUTOFILL_STORAGE_KEY);
                } catch {
                }
                this.showSuccessBanner(data);
                this.removeFloatingHelper();
                resolve(true);
                return;
              }
            }
            this.showFloatingHelper(data);
            resolve(false);
          }
        }, 200);
      });
    }
    /**
     * 寻找标题输入框
     */
    static findTitleInput(doc = document) {
      return doc.querySelector(
        'input#title, input[name="title"], input[id*="title"], [name*="title"] input'
      );
    }
    /**
     * 检查编辑器是否就绪
     */
    static hasEditorReady(doc = document) {
      var _a, _b;
      return Boolean(
        doc.querySelector("iframe.ke-edit-iframe") || ((_b = (_a = window.KindEditor) == null ? void 0 : _a.instances) == null ? void 0 : _b.length) > 0 || doc.querySelector('textarea#steps, textarea[name="steps"]') || doc.querySelector(".ke-container, .editor")
      );
    }
    /**
     * 穿透子 iframe 尝试注入
     */
    static tryFillChildIframes(data) {
      var _a;
      try {
        const iframes = Array.from(document.querySelectorAll("iframe"));
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || ((_a = iframe.contentWindow) == null ? void 0 : _a.document);
            if (doc) {
              const titleInput = this.findTitleInput(doc);
              if (titleInput) {
                return this.applyFields(data, doc, iframe.contentWindow);
              }
            }
          } catch {
          }
        }
      } catch {
      }
      return false;
    }
    /**
     * 填充具体表单项
     */
    static applyFields(data, doc = document, win = window) {
      let filledCount = 0;
      const titleInput = this.findTitleInput(doc);
      if (titleInput && data.title) {
        titleInput.value = data.title;
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
        titleInput.dispatchEvent(new Event("change", { bubbles: true }));
        filledCount++;
      }
      const severitySelect = doc.querySelector('select#severity, select[name="severity"]');
      if (severitySelect && data.severity) {
        severitySelect.value = String(data.severity);
        severitySelect.dispatchEvent(new Event("change", { bubbles: true }));
        this.triggerChosenUpdate(severitySelect, win);
        filledCount++;
      }
      const priSelect = doc.querySelector('select#pri, select[name="pri"]');
      if (priSelect && data.pri) {
        priSelect.value = String(data.pri);
        priSelect.dispatchEvent(new Event("change", { bubbles: true }));
        this.triggerChosenUpdate(priSelect, win);
        filledCount++;
      }
      if (data.assignedTo) {
        const assignedSelect = doc.querySelector('select#assignedTo, select[name="assignedTo"]');
        if (assignedSelect) {
          const targetVal = data.assignedTo.trim();
          const matchedOpt = Array.from(assignedSelect.options).find(
            (opt) => opt.value === targetVal || opt.text.toLowerCase().includes(targetVal.toLowerCase())
          );
          if (matchedOpt) {
            assignedSelect.value = matchedOpt.value;
            assignedSelect.dispatchEvent(new Event("change", { bubbles: true }));
            this.triggerChosenUpdate(assignedSelect, win);
            filledCount++;
          }
        }
      }
      if (data.openedBuild) {
        const buildSelect = doc.querySelector('select#openedBuild, select[name="openedBuild[]"]');
        if (buildSelect) {
          const matched = Array.from(buildSelect.options).find((opt) => opt.value === data.openedBuild);
          if (matched) {
            buildSelect.value = matched.value;
            buildSelect.dispatchEvent(new Event("change", { bubbles: true }));
            this.triggerChosenUpdate(buildSelect, win);
          }
        }
      }
      const injectedRich = this.injectRichText(data.stepsHtml, doc, win);
      if (injectedRich) filledCount++;
      if (data.screenshotUrl) {
        this.attachScreenshotFile(data.screenshotUrl, data.bugId, doc);
      }
      return filledCount > 0;
    }
    /**
     * 向富文本编辑器注入 HTML
     */
    static injectRichText(htmlContent, doc = document, win = window) {
      let success = false;
      try {
        if (win.KindEditor && Array.isArray(win.KindEditor.instances)) {
          win.KindEditor.instances.forEach((inst) => {
            if (inst && typeof inst.html === "function") {
              inst.html(htmlContent);
              if (typeof inst.sync === "function") inst.sync();
              success = true;
            }
          });
        }
        if (win.editor && typeof win.editor.html === "function") {
          win.editor.html(htmlContent);
          if (typeof win.editor.sync === "function") win.editor.sync();
          success = true;
        }
      } catch {
      }
      const iframes = Array.from(doc.querySelectorAll('iframe.ke-edit-iframe, iframe[class*="editor"]'));
      iframes.forEach((iframe) => {
        var _a;
        try {
          const iframeDoc = iframe.contentDocument || ((_a = iframe.contentWindow) == null ? void 0 : _a.document);
          if (iframeDoc && iframeDoc.body) {
            iframeDoc.body.innerHTML = htmlContent;
            iframeDoc.body.dispatchEvent(new Event("input", { bubbles: true }));
            success = true;
          }
        } catch {
        }
      });
      const textareas = Array.from(doc.querySelectorAll('textarea#steps, textarea[name="steps"]'));
      textareas.forEach((ta) => {
        ta.value = htmlContent;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        success = true;
      });
      return success;
    }
    /**
     * 自动将 Base64 截图装配到页面的文件上传域
     */
    static attachScreenshotFile(dataUrl, bugId, doc = document) {
      const file = dataUrlToFile(dataUrl, `qa-screenshot-${bugId || Date.now()}.png`);
      if (!file) return;
      const fileInputs = Array.from(
        doc.querySelectorAll('input[type="file"][name*="files"], input[type="file"][name*="file"], input[type="file"]')
      );
      if (fileInputs.length === 0) return;
      for (const input of fileInputs) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          console.log("[QA Copilot] 已成功通过 DataTransfer 装配截图附件:", file.name);
          break;
        } catch (err) {
          console.warn("[QA Copilot] 装配截图附件出现异常:", err);
        }
      }
    }
    /**
     * 触发 Chosen 下拉刷新
     */
    static triggerChosenUpdate(selectEl, win = window) {
      try {
        if (win.$ && typeof win.$(selectEl).trigger === "function") {
          win.$(selectEl).trigger("chosen:updated");
        }
      } catch {
      }
    }
    /**
     * 在页面顶部展示美观的操作横幅
     */
    static showSuccessBanner(data) {
      var _a, _b;
      const existing = document.getElementById("qa-copilot-zentao-banner");
      if (existing) existing.remove();
      const banner = document.createElement("div");
      banner.id = "qa-copilot-zentao-banner";
      banner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      animation: qaSlideDown 0.3s ease-out;
    `;
      const hasScreenshot = Boolean(data.screenshotUrl);
      banner.innerHTML = `
      <style>
        @keyframes qaSlideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      </style>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">🎉</span>
        <div>
          <strong style="font-weight: 700;">QA Copilot 自动化填单完成！</strong>
          <span style="opacity: 0.95; font-size: 12px; margin-left: 4px;">
            标题、排版步骤${hasScreenshot ? "与现场截图附件" : ""}已全部自动就位。
          </span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="qa-zentao-auto-submit" style="
          background: #ffffff;
          color: #065f46;
          border: none;
          padding: 5px 12px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          transition: all 0.2s;
        ">立刻帮我提交</button>
        <button id="qa-zentao-banner-close" style="
          background: rgba(255,255,255,0.2);
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">我来核对</button>
      </div>
    `;
      document.body.appendChild(banner);
      const submitBtn = (_a = banner.querySelector) == null ? void 0 : _a.call(banner, "#qa-zentao-auto-submit");
      submitBtn == null ? void 0 : submitBtn.addEventListener("click", () => {
        this.injectRichText(data.stepsHtml);
        const pageSubmit = document.querySelector(
          '#submit, button#submit, input#submit, form#dataform button[type="submit"], form#dataform input[type="submit"]'
        );
        if (pageSubmit) {
          pageSubmit.click();
          banner.remove();
        } else {
          alert("未找到页面的保存按钮，请手动点击页面下方的“保存”提交");
        }
      });
      const closeBtn = (_b = banner.querySelector) == null ? void 0 : _b.call(banner, "#qa-zentao-banner-close");
      closeBtn == null ? void 0 : closeBtn.addEventListener("click", () => {
        banner.remove();
      });
    }
    /**
     * 在页面右下角显示常驻的悬浮助手胶囊，确保用户任何情况下都能一键填入
     */
    static showFloatingHelper(data) {
      if (this.hasFilled) return;
      const existing = document.getElementById("qa-copilot-floating-helper");
      if (existing) return;
      const widget = document.createElement("div");
      widget.id = "qa-copilot-floating-helper";
      widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999998;
      background: #1e293b;
      color: #ffffff;
      padding: 10px 14px;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      max-width: 380px;
      cursor: default;
    `;
      const cleanTitle = data.title.length > 20 ? `${data.title.slice(0, 20)}…` : data.title;
      widget.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">🚀</span>
        <div>
          <div style="font-weight: 700; color: #38bdf8;">QA Copilot 待填 Bug</div>
          <div style="color: #cbd5e1; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${cleanTitle}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button id="qa-btn-manual-fill" style="
          background: #2563eb;
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 11px;
          cursor: pointer;
          white-space: nowrap;
        ">一键填入</button>
        <button id="qa-btn-floating-dismiss" style="
          background: transparent;
          color: #94a3b8;
          border: none;
          padding: 4px;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
        ">✕</button>
      </div>
    `;
      document.body.appendChild(widget);
      const fillBtn = widget.querySelector("#qa-btn-manual-fill");
      fillBtn == null ? void 0 : fillBtn.addEventListener("click", async () => {
        const ok = await this.fillFormWithRetry(data);
        if (!ok) {
          alert("未在当前可视区域探测到 Bug 表单。若您在首页或列表页，请先点击页面上的“提 Bug”按钮进入提单页，插件将自动完成填单。");
        }
      });
      const dismissBtn = widget.querySelector("#qa-btn-floating-dismiss");
      dismissBtn == null ? void 0 : dismissBtn.addEventListener("click", () => {
        widget.remove();
      });
    }
    static removeFloatingHelper() {
      const helper = document.getElementById("qa-copilot-floating-helper");
      if (helper) helper.remove();
    }
    /**
     * 检查并在 Bug 详情页自动挂载现场截图 (方案 A)
     */
    static async checkAndAttachOnBugViewPage() {
      var _a, _b, _c;
      if (typeof window !== "undefined" && window !== window.top) {
        return false;
      }
      const bugId = this.getBugIdFromViewPage();
      if (!bugId) return false;
      let pending;
      try {
        const getRes = chrome.storage.local.get(ZENTAO_PENDING_ATTACHMENT_KEY);
        const res = typeof (getRes == null ? void 0 : getRes.then) === "function" ? await getRes : await new Promise((resolve) => chrome.storage.local.get(ZENTAO_PENDING_ATTACHMENT_KEY, resolve));
        pending = res == null ? void 0 : res[ZENTAO_PENDING_ATTACHMENT_KEY];
      } catch {
        return false;
      }
      if (!pending || String(pending.bugId) !== String(bugId)) {
        return false;
      }
      if (Date.now() - pending.createdAt > 10 * 60 * 1e3) {
        try {
          (_c = (_b = (_a = chrome.storage) == null ? void 0 : _a.local) == null ? void 0 : _b.remove) == null ? void 0 : _c.call(_b, ZENTAO_PENDING_ATTACHMENT_KEY);
        } catch {
        }
        return false;
      }
      console.log(`[QA Copilot] 探测到 Bug #${bugId} 待同步截图附件，正在通过网页端同源会话上传…`);
      if (typeof document !== "undefined" && document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          void this.uploadAttachmentInViewPage(pending);
        }, { once: true });
        return true;
      }
      return this.uploadAttachmentInViewPage(pending);
    }
    /**
     * 确保详情页正文末尾显示高清截图（如果正文尚未显示图片）
     */
    static ensureScreenshotRenderedInViewPage(screenshotUrl) {
      if (typeof document === "undefined") return;
      try {
        const detailContainer = document.querySelector(
          ".detail-content, .article-content, #mainContent .detail, #legendLife, fieldset, .main-col"
        );
        if (!detailContainer) return;
        const existingImg = detailContainer.querySelector('img[src^="data:image"], img[alt*="截图"], img[src*="qa-"]');
        if (existingImg) return;
        const card = document.createElement("div");
        card.id = "qa-copilot-view-screenshot-card";
        card.style.cssText = `
        margin-top: 20px;
        padding: 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      `;
        card.innerHTML = `
        <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 10px; border-left: 4px solid #2563eb; padding-left: 8px;">
          📷 [问题现场截图 (QA Copilot 自动呈现)]
        </div>
        <div style="text-align: center;">
          <img src="${screenshotUrl}" alt="问题现场截图" style="max-width: 100%; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #cbd5e1;" />
        </div>
      `;
        detailContainer.appendChild(card);
      } catch {
      }
    }
    /**
     * 在 Bug 详情页通过同源网络请求直接上传附件并关联到该 Bug
     */
    static async uploadAttachmentInViewPage(pending) {
      var _a, _b, _c, _d;
      const filesToUpload = [];
      if (pending.screenshotUrl) {
        const imgFile = dataUrlToFile(pending.screenshotUrl, pending.fileName || `qa-screenshot-bug-${pending.bugId}.png`);
        if (imgFile) filesToUpload.push(imgFile);
        this.ensureScreenshotRenderedInViewPage(pending.screenshotUrl);
      }
      if (pending.recordingDataUrl) {
        const recFile = dataUrlToFile(pending.recordingDataUrl, pending.recordingFileName || `qa-recording-bug-${pending.bugId}.webm`);
        if (recFile) filesToUpload.push(recFile);
      }
      if (filesToUpload.length === 0) return false;
      let uploaded = false;
      let pathname = "/";
      if (typeof window !== "undefined" && window.location) {
        if (typeof window.location.pathname === "string") {
          pathname = window.location.pathname;
        } else if (typeof window.location.href === "string") {
          try {
            pathname = new URL(window.location.href).pathname;
          } catch {
            pathname = "/";
          }
        }
      }
      const dirPath = pathname.substring(0, pathname.lastIndexOf("/") + 1) || "/";
      const commentEndpoints = [
        `${dirPath}action-comment-bug-${pending.bugId}.html`,
        `${dirPath}index.php?m=action&f=comment&objectType=bug&objectID=${pending.bugId}`,
        `/action-comment-bug-${pending.bugId}.html`,
        `/index.php?m=action&f=comment&objectType=bug&objectID=${pending.bugId}`
      ];
      for (const ep of commentEndpoints) {
        try {
          const formData = new FormData();
          formData.append("comment", `<p>【QA Copilot 自动同步现场附件：${filesToUpload.map((f) => f.name).join(", ")}】</p>`);
          formData.append("objectType", "bug");
          formData.append("objectID", String(pending.bugId));
          for (const file of filesToUpload) {
            formData.append("files[]", file, file.name);
            formData.append("labels[]", file.name);
          }
          const resp = await fetch(ep, {
            method: "POST",
            credentials: "include",
            body: formData
          });
          if (resp.ok || resp.status === 302 || resp.redirected) {
            const text = await resp.text().catch(() => "");
            if (!text.toLowerCase().includes("user-login") && !text.toLowerCase().includes("m=user&f=login")) {
              uploaded = true;
              console.log("[QA Copilot] 网页端通过 action-comment 成功挂载附件:", ep);
              break;
            }
          }
        } catch {
        }
      }
      if (!uploaded) {
        const uploadEndpoints = [
          `${dirPath}file-ajaxUpload-bug-${pending.bugId}.html`,
          `${dirPath}index.php?m=file&f=ajaxUpload&objectType=bug&objectID=${pending.bugId}`,
          `/file-ajaxUpload-bug-${pending.bugId}.html`,
          `${dirPath}file-ajaxUpload.html?objectType=bug&objectID=${pending.bugId}`,
          `/file-ajaxUpload.html?objectType=bug&objectID=${pending.bugId}`,
          `index.php?m=file&f=ajaxUpload&objectType=bug&objectID=${pending.bugId}`,
          `${dirPath}file-upload-bug-${pending.bugId}.html`,
          `${dirPath}index.php?m=file&f=upload&objectType=bug&objectID=${pending.bugId}`
        ];
        for (const ep of uploadEndpoints) {
          try {
            let allSuccess = true;
            for (const file of filesToUpload) {
              const formData = new FormData();
              formData.append("file", file, file.name);
              formData.append("files[]", file, file.name);
              formData.append("files", file, file.name);
              formData.append("imgFile", file, file.name);
              formData.append("upfile", file, file.name);
              formData.append("objectType", "bug");
              formData.append("objectID", String(pending.bugId));
              formData.append("comment", `【QA Copilot 自动同步现场附件：${file.name}】`);
              const resp = await fetch(ep, {
                method: "POST",
                credentials: "include",
                body: formData
              });
              if (resp.ok) {
                const text = await resp.text().catch(() => "");
                let isSuccess = false;
                const isHtmlDoc = text.includes("<!DOCTYPE") || text.includes("<html") && !text.includes("afterUpload") && !text.includes("parent.location");
                if (!isHtmlDoc) {
                  try {
                    const data = JSON.parse(text);
                    if (data.result === "success" || data.status === "success" || data.status === "ok" || data.id || data.url || data.files || !data.error && !((_a = data.message) == null ? void 0 : _a.toLowerCase().includes("fail"))) {
                      isSuccess = true;
                    }
                  } catch {
                    if (text.includes("afterUpload") || text.includes("loadFiles") || resp.redirected) {
                      isSuccess = true;
                    }
                  }
                }
                if (!isSuccess) {
                  allSuccess = false;
                  break;
                }
              } else {
                allSuccess = false;
                break;
              }
            }
            if (allSuccess) {
              uploaded = true;
              console.log("[QA Copilot] 网页端通过 file-ajaxUpload 接口成功上传附件:", ep);
              break;
            }
          } catch {
          }
        }
      }
      if (!uploaded) {
        uploaded = await this.tryAttachViaCommentForm(filesToUpload, pending.bugId);
      }
      if (uploaded) {
        try {
          (_d = (_c = (_b = chrome.storage) == null ? void 0 : _b.local) == null ? void 0 : _c.remove) == null ? void 0 : _d.call(_c, ZENTAO_PENDING_ATTACHMENT_KEY);
        } catch {
        }
      }
      this.showAttachmentSuccessBanner(pending.bugId, uploaded, Boolean(pending.recordingDataUrl));
      if (uploaded && typeof window !== "undefined" && window.location) {
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
      return uploaded;
    }
    /**
     * 兜底：通过详情页的备注与附件表单自动挂载提交
     */
    static async tryAttachViaCommentForm(files, bugId) {
      try {
        const fileInputs = Array.from(
          document.querySelectorAll(
            'form input[type="file"][name*="files"], form input[type="file"][name*="file"], input[type="file"]'
          )
        );
        if (fileInputs.length === 0) return false;
        for (const input of fileInputs) {
          try {
            const dt = new DataTransfer();
            files.forEach((f) => dt.items.add(f));
            input.files = dt.files;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const form = input.closest("form");
            if (form) {
              const commentBox = form.querySelector('textarea#comment, textarea[name="comment"]');
              if (commentBox && !commentBox.value) {
                commentBox.value = `【QA Copilot 自动补充 Bug #${bugId} 现场截图与录屏附件】`;
                commentBox.dispatchEvent(new Event("input", { bubbles: true }));
              }
              const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], #submit');
              if (submitBtn) {
                submitBtn.click();
                console.log("[QA Copilot] 已通过详情页备注表单提交附件");
                return true;
              }
            }
          } catch {
          }
        }
      } catch {
      }
      return false;
    }
    /**
     * 在详情页顶部展示附件关联成功的操作横幅
     */
    static showAttachmentSuccessBanner(bugId, success, hasRecording = false) {
      var _a, _b;
      const existing = document.getElementById("qa-copilot-attachment-banner");
      if (existing) existing.remove();
      const banner = document.createElement("div");
      banner.id = "qa-copilot-attachment-banner";
      banner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      background: ${success ? "linear-gradient(135deg, #059669 0%, #10b981 100%)" : "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)"};
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 10px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      animation: qaSlideDown 0.3s ease-out;
    `;
      const labelText = hasRecording ? "现场截图与录屏附件" : "现场截图附件";
      banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 18px;">${success ? "🎉" : "⚠️"}</span>
        <div>
          <strong style="font-weight: 700;">
            ${success ? `Bug #${bugId} ${labelText}已自动同步至附件列表！` : `Bug #${bugId} 已创建，附件已就绪`}
          </strong>
          <span style="opacity: 0.95; font-size: 12px; margin-left: 4px;">
            ${success ? "利用网页端同源合法会话挂载完成，免去 API 权限限制。" : "如附件区未出现，可点击编辑直接 Ctrl+V / Cmd+V 粘贴。"}
          </span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="qa-zentao-banner-refresh" style="
          background: #ffffff;
          color: ${success ? "#065f46" : "#92400e"};
          border: none;
          padding: 5px 12px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        ">刷新查看附件</button>
        <button id="qa-zentao-banner-close" style="
          background: rgba(255,255,255,0.2);
          color: #ffffff;
          border: none;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        ">✕</button>
      </div>
    `;
      const mountNode = document.body || document.documentElement;
      if (mountNode) {
        mountNode.appendChild(banner);
      }
      (_a = banner.querySelector("#qa-zentao-banner-refresh")) == null ? void 0 : _a.addEventListener("click", () => {
        window.location.reload();
      });
      (_b = banner.querySelector("#qa-zentao-banner-close")) == null ? void 0 : _b.addEventListener("click", () => {
        banner.remove();
      });
      if (success) {
        setTimeout(() => {
          banner.remove();
        }, 5e3);
      }
    }
  }
  __publicField(ZentaoFillExecutor, "hasFilled", false);
  __publicField(ZentaoFillExecutor, "observer", null);
  console.log("[QA Copilot] Content Script 注入页面:", window.location.href);
  initializeFrameGeometryRelay();
  void ZentaoFillExecutor.checkAndExecute();
  function publishMockRules(rules) {
    window.postMessage({ source: "QA_COPILOT_CONTENT", type: "MOCK_CONFIG", data: Array.isArray(rules) ? rules : [] }, "*");
  }
  let networkInterceptorReady = false;
  let inspectionMode = false;
  let inspectionOverlay = null;
  let lastLabelForwardClick = null;
  let replayCdpPending = false;
  const pendingRecordMessages = /* @__PURE__ */ new Set();
  function sendFlushableRecord(message) {
    const pending = sendToBackground(message).then(() => void 0, () => void 0);
    pendingRecordMessages.add(pending);
    void pending.finally(() => pendingRecordMessages.delete(pending));
  }
  async function waitForFlushableRecords() {
    await Promise.all(Array.from(pendingRecordMessages));
  }
  function stopInspection() {
    inspectionMode = false;
    inspectionOverlay == null ? void 0 : inspectionOverlay.remove();
    inspectionOverlay = null;
  }
  function startInspection() {
    stopInspection();
    inspectionMode = true;
    inspectionOverlay = document.createElement("div");
    inspectionOverlay.dataset.qaCopilotRoot = "true";
    Object.assign(inspectionOverlay.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      border: "2px solid #2563eb",
      background: "rgba(37, 99, 235, 0.12)",
      borderRadius: "3px",
      display: "none"
    });
    document.documentElement.appendChild(inspectionOverlay);
  }
  chrome.storage.local.get({ networkMockRules: [] }, (result) => publishMockRules(result.networkMockRules));
  window.postMessage({ source: "QA_COPILOT_CONTENT", type: "PING_INTERCEPTOR" }, "*");
  let activeContentReplayId = null;
  sendToBackground({
    type: "RECORD_EVENT",
    payload: {
      event: {
        type: "navigation",
        timestamp: Date.now(),
        title: "页面加载",
        description: `加载 ${window.location.pathname}`,
        url: window.location.href,
        payload: {
          timestamp: Date.now(),
          url: window.location.href,
          fromUrl: document.referrer || "",
          toUrl: window.location.href,
          pageTitle: document.title || "",
          navigationType: "reload"
        }
      }
    }
  }).catch(() => {
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const isTopFrame = window === window.top;
    if ((message == null ? void 0 : message.type) === "CAPTURE_PING") {
      sendResponse({ ready: true, networkReady: networkInterceptorReady, url: window.location.href, title: document.title, isTopFrame });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "TRIGGER_ZENTAO_FILL") {
      ZentaoFillExecutor.executeWithData(message.payload).then((success) => sendResponse({ success })).catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if ((message == null ? void 0 : message.type) === "START_ELEMENT_INSPECTION") {
      startInspection();
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "STOP_ELEMENT_INSPECTION") {
      stopInspection();
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "UPDATE_TEST_HUD") {
      updateTestHud(message.payload);
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "DISMISS_TEST_HUD") {
      dismissTestHud((_a = message.payload) == null ? void 0 : _a.instant);
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "FLUSH_PENDING_RECORDS") {
      flushPendingInputRecords();
      flushPendingScrollRecords();
      waitForFlushableRecords().then(() => sendResponse({ success: true }));
      return true;
    }
    if ((message == null ? void 0 : message.type) === "STOP_CONTENT_REPLAY") {
      activeContentReplayId = null;
      replayCdpPending = false;
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "REPLAY_ACTION_COMPLETE") {
      if (((_b = message.payload) == null ? void 0 : _b.replayId) === activeContentReplayId) {
        activeContentReplayId = null;
        replayCdpPending = false;
      }
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "REPLAY_ACTION") {
      const targetFrameId = (_c = message.payload) == null ? void 0 : _c.targetFrameId;
      if (targetFrameId !== void 0 && targetFrameId !== null) {
        if (targetFrameId === 0 && !isTopFrame) return false;
      } else if (!isTopFrame) {
        return false;
      }
      activeContentReplayId = ((_d = message.payload) == null ? void 0 : _d.replayId) || `replay-${Date.now()}`;
      replayCdpPending = false;
      replayAction((_e = message.payload) == null ? void 0 : _e.event, activeContentReplayId, Boolean((_f = message.payload) == null ? void 0 : _f.useCdp)).then((res) => {
        if (res.cdpInput) replayCdpPending = true;
        else activeContentReplayId = null;
        sendResponse(res);
      }).catch((error) => {
        activeContentReplayId = null;
        replayCdpPending = false;
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    if ((message == null ? void 0 : message.type) === "PING_TASK_STATUS") {
      if (!isTopFrame) return false;
      const activeFormRunId = FormExecutor.getActiveRunId();
      const isFormRunning = Boolean(activeFormRunId && activeFormRunId === ((_g = message.payload) == null ? void 0 : _g.runId));
      const isReplayRunning = Boolean(activeContentReplayId && activeContentReplayId === ((_h = message.payload) == null ? void 0 : _h.runId));
      const isRunning = isFormRunning || isReplayRunning;
      const activeRunId = isFormRunning ? activeFormRunId : isReplayRunning ? activeContentReplayId : null;
      sendResponse({ isRunning, activeRunId });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "SCAN_FORM_SNAPSHOT") {
      if (!isTopFrame) return false;
      FormScanner.scanWithProbe(document).then((snapshot) => {
        snapshot.frameId = 0;
        sendResponse({ snapshot });
      }).catch((error) => {
        sendResponse({ error: `表单扫描失败: ${error.message}` });
      });
      return true;
    }
    if ((message == null ? void 0 : message.type) === "EXECUTE_FORM_FILL") {
      if (!isTopFrame) return false;
      FormExecutor.executePlan(
        message.payload.snapshotId,
        message.payload.assignments,
        message.payload.mode,
        message.payload.runId
      ).then((runRecord) => sendResponse({ runRecord })).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if ((message == null ? void 0 : message.type) === "CANCEL_FORM_FILL") {
      if (!isTopFrame) return false;
      FormExecutor.cancel((_i = message.payload) == null ? void 0 : _i.runId);
      sendResponse({ success: true });
      return false;
    }
    if ((message == null ? void 0 : message.type) === "UNDO_FORM_FILL") {
      if (!isTopFrame) return false;
      const fallback = ((_j = message.payload) == null ? void 0 : _j.steps) ? { snapshotId: message.payload.snapshotId, steps: message.payload.steps } : void 0;
      FormExecutor.undo(message.payload.runId, fallback).then((result) => sendResponse(result)).catch((error) => sendResponse({ success: false, restoredCount: 0, conflictCount: 0, error: error.message }));
      return true;
    }
    if ((message == null ? void 0 : message.type) === "COLLECT_AI_OBSERVATION") {
      if (!isTopFrame && ((_k = message.payload) == null ? void 0 : _k.allFrames) === false) return false;
      try {
        sendResponse(collectAiObservation());
      } catch (error) {
        sendResponse({ error: error.message });
      }
      return false;
    }
    if ((message == null ? void 0 : message.type) === "EXECUTE_QUICK_LOGIN") {
      if (!isTopFrame) return false;
      QuickLoginExecutor.execute({
        username: message.payload.username,
        password: message.payload.password,
        loginTriggerSelector: message.payload.loginTriggerSelector,
        autoSubmit: message.payload.autoSubmit
      }).then((result) => sendResponse(result)).catch((err) => sendResponse({ success: false, message: err.message }));
      return true;
    }
    if ((message == null ? void 0 : message.type) === "GET_PAGE_CONTEXT") {
      if (!isTopFrame) return false;
      sendResponse({
        currentUser: detectCurrentUserFromPage(),
        url: window.location.href,
        title: document.title
      });
      return true;
    }
    if ((message == null ? void 0 : message.type) !== "ANALYZE_PAGE") return false;
    try {
      sendResponse({ ...DomAnalyzer.parsePageContext(document), url: window.location.href, title: document.title });
    } catch (error) {
      sendResponse({ fields: [], actions: [], formCount: 0, url: window.location.href, title: document.title, error: error.message });
    }
    return false;
  });
  function detectCurrentUserFromPage() {
    var _a, _b;
    try {
      const domSelectors = [
        ".avatar-wrapper .user-nickname",
        ".avatar-wrapper span",
        ".user-name",
        ".username",
        ".user-profile span",
        ".user-info .name",
        ".nickname",
        '[class*="user-name"]',
        '[class*="avatar-wrapper"]',
        '[class*="user-profile"]',
        ".right-menu .avatar-container",
        ".el-dropdown-link .user-name",
        ".ant-dropdown-trigger .username",
        ".arco-dropdown-open .username"
      ];
      for (const sel of domSelectors) {
        const el = document.querySelector(sel);
        const text = (_a = el == null ? void 0 : el.textContent) == null ? void 0 : _a.trim();
        if (text && text.length >= 2 && text.length <= 30 && !/^(登录|退出|注销|设置|修改密码)$/.test(text)) {
          return text;
        }
      }
      const directKeys = ["username", "userName", "nickName", "user_name", "current_user", "login_user"];
      for (const k of directKeys) {
        const v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v && typeof v === "string" && v.trim().length >= 2 && v.trim().length <= 30) {
          return v.trim();
        }
      }
      const jsonKeys = ["user", "userInfo", "USER_INFO", "currentUser", "loginUser", "admin_user", "vuex"];
      for (const k of jsonKeys) {
        const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const userObj = ((_b = parsed == null ? void 0 : parsed.user) == null ? void 0 : _b.user) || (parsed == null ? void 0 : parsed.user) || (parsed == null ? void 0 : parsed.userInfo) || parsed;
            const candidate = (userObj == null ? void 0 : userObj.nickName) || (userObj == null ? void 0 : userObj.nickname) || (userObj == null ? void 0 : userObj.userName) || (userObj == null ? void 0 : userObj.username) || (userObj == null ? void 0 : userObj.name) || (userObj == null ? void 0 : userObj.realName);
            if (candidate && typeof candidate === "string" && candidate.trim().length >= 2 && candidate.trim().length <= 30) {
              return candidate.trim();
            }
          } catch {
          }
        }
      }
    } catch {
    }
    return void 0;
  }
  window.addEventListener("message", (event) => {
    var _a;
    try {
      if (event.source !== window || !event.data || event.data.source !== "QA_COPILOT_INJECTED") {
        return;
      }
      if (event.data.type === "INTERCEPTOR_HELLO") {
        window.postMessage({ source: "QA_COPILOT_CONTENT", type: "BRIDGE_READY" }, "*");
      } else if (event.data.type === "NETWORK_START") {
        const data = event.data.data;
        sendToBackground({
          type: "NETWORK_START",
          payload: {
            requestId: data.requestId,
            method: data.method,
            url: data.url,
            startedAt: data.startedAt
          }
        }).catch(() => {
        });
      } else if (event.data.type === "NETWORK_CAPTURE") {
        sendToBackground({
          type: "RECORD_NETWORK",
          payload: {
            request: event.data.data
          }
        }).catch(() => {
        });
      } else if (event.data.type === "INTERCEPTOR_READY") {
        networkInterceptorReady = Boolean((_a = event.data.data) == null ? void 0 : _a.ready);
      } else if (event.data.type === "CONSOLE_CAPTURE") {
        const captured = event.data.data;
        sendToBackground({
          type: "RECORD_EVENT",
          payload: {
            event: {
              type: "console",
              timestamp: captured.timestamp || Date.now(),
              title: "Console Error",
              description: captured.message || "console.error",
              url: captured.url || window.location.href,
              payload: {
                timestamp: captured.timestamp || Date.now(),
                url: captured.url || window.location.href,
                level: "error",
                message: captured.message || "console.error"
              }
            }
          }
        }).catch(() => {
        });
      }
    } catch {
    }
  });
  window.postMessage({ source: "QA_COPILOT_CONTENT", type: "BRIDGE_READY" }, "*");
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.networkMockRules) publishMockRules(changes.networkMockRules.newValue);
  });
  function safeEscapeCss(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }
  function getActiveModalContainers() {
    const modalSelectors = [
      "dialog[open]",
      '.el-overlay:not([style*="display: none"]):not([style*="display:none"]) .el-dialog',
      '.el-dialog:not([style*="display: none"]):not([style*="display:none"])',
      '.el-drawer:not([style*="display: none"]):not([style*="display:none"])',
      '.el-message-box:not([style*="display: none"]):not([style*="display:none"])',
      '.ant-modal:not([style*="display: none"]):not([style*="display:none"])',
      ".ant-modal-content",
      ".ant-drawer:not(.ant-drawer-hidden)",
      ".arco-modal",
      ".arco-drawer",
      ".t-dialog",
      ".t-drawer",
      ".n-modal",
      ".n-drawer",
      ".modal.show",
      ".modal.in",
      '[class*="modal"][class*="open"]',
      '[class*="dialog"][class*="open"]',
      '[class*="drawer"][class*="open"]',
      '[role="dialog"]:not([role="tooltip"]):not(.el-popper):not([class*="popper"]):not([class*="tooltip"])',
      '[role="alertdialog"]'
    ];
    const containers = [];
    try {
      const rawElements = Array.from(document.querySelectorAll(modalSelectors.join(",")));
      for (const el of rawElements) {
        if (!(el instanceof HTMLElement)) continue;
        if (!isElementVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 50 || rect.height <= 50) continue;
        if (!containers.some((c) => c.contains(el))) {
          containers.push(el);
        }
      }
    } catch {
    }
    return containers;
  }
  function getActiveDropdownPoppers() {
    var _a;
    const popperSelectors = [
      // Element Plus / Element UI
      '.el-select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '.el-cascader__dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '.el-tree-select__popper:not([style*="display: none"]):not([style*="display:none"])',
      '.el-select__popper:not([style*="display: none"]):not([style*="display:none"])',
      '.el-popper:not(.el-tooltip__popper):not([role="tooltip"]):not([style*="display: none"]):not([style*="display:none"])',
      'div[x-placement]:not([style*="display: none"]):not(.el-tooltip__popper)',
      'div[data-popper-placement]:not([style*="display: none"]):not(.el-tooltip__popper)',
      // @riophae/vue-treeselect (若依等管理后台常见组件)
      '.vue-treeselect__menu-container:not([style*="display: none"])',
      ".vue-treeselect__portal-container",
      '.vue-treeselect__menu:not([style*="display: none"])',
      '[class*="treeselect"][class*="menu"]:not([style*="display: none"])',
      '[class*="tree-select"][class*="popper"]:not([style*="display: none"])',
      '[class*="tree-select"][class*="dropdown"]:not([style*="display: none"])',
      // Ant Design
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ".ant-select-tree-dropdown:not(.ant-select-tree-dropdown-hidden):not(.ant-select-dropdown-hidden)",
      ".ant-tree-select-dropdown:not(.ant-select-dropdown-hidden)",
      ".ant-cascader-menus:not(.ant-cascader-menus-hidden)",
      // Arco Design
      '.arco-select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
      '.arco-tree-select-popup:not([style*="display: none"])',
      '.arco-trigger-popup:not([style*="display: none"])',
      // Naive UI / TDesign / Semi
      '.n-select-menu:not([style*="display: none"])',
      '.t-select__dropdown:not([style*="display: none"])',
      '.semi-select-option-list:not([style*="display: none"])',
      // ARIA Listbox
      '[role="listbox"]:not([style*="display: none"]):not([style*="display:none"])'
    ];
    const poppers = [];
    try {
      const raw = Array.from(document.querySelectorAll(popperSelectors.join(",")));
      for (const el of raw) {
        if (!el || !isElementVisible(el)) continue;
        if (typeof el.getAttribute === "function" && el.getAttribute("aria-hidden") === "true") continue;
        const rect = ((_a = el.getBoundingClientRect) == null ? void 0 : _a.call(el)) || typeof el.getClientRects === "function" && el.getClientRects()[0] || { width: 100, height: 100 };
        if (rect.width <= 20 || rect.height <= 20) continue;
        if (!poppers.some((p) => {
          var _a2;
          return (_a2 = p.contains) == null ? void 0 : _a2.call(p, el);
        })) poppers.push(el);
      }
    } catch {
    }
    return poppers;
  }
  function safeCloseDropdownPopper(optionEl) {
    var _a;
    try {
      const activePoppers = getActiveDropdownPoppers();
      if (activePoppers.length === 0) return;
      if (optionEl) {
        const parentPopper = (_a = optionEl.closest) == null ? void 0 : _a.call(
          optionEl,
          '.el-select-dropdown, .ant-select-dropdown, .arco-select-dropdown, .vue-treeselect__menu, [class*="select-dropdown"]'
        );
        if (parentPopper == null ? void 0 : parentPopper.id) {
          const associatedTrigger = document.querySelector(
            `[aria-controls="${parentPopper.id}"], [aria-owns="${parentPopper.id}"], [data-popper-id="${parentPopper.id}"]`
          );
          const input = associatedTrigger == null ? void 0 : associatedTrigger.querySelector("input, .el-select__input");
          if (input && typeof input.blur === "function") {
            input.blur();
          }
        }
      }
      const activeSelects = Array.from(document.querySelectorAll(
        '.el-select.is-focus, .el-select__wrapper.is-focused, .ant-select-open, .arco-select-open, .n-select--active, .vue-treeselect--is-open, [role="combobox"][aria-expanded="true"]'
      ));
      for (const select of activeSelects) {
        const input = select.querySelector("input, .el-select__input, [tabindex]");
        if (input && typeof input.blur === "function") {
          input.blur();
        }
      }
      const activeModals = getActiveModalContainers();
      if (activeModals.length > 0) {
        const topModal = activeModals[activeModals.length - 1];
        let safeTarget = topModal.querySelector(
          ".el-dialog__title, .el-drawer__title, .ant-modal-title, .ant-drawer-title, .modal-title, .arco-modal-title"
        );
        if (!safeTarget) {
          const header = topModal.querySelector(
            ".el-dialog__header, .el-drawer__header, .ant-modal-header, .modal-header, .arco-modal-header"
          );
          if (header) {
            safeTarget = header.querySelector(
              'span, p, h1, h2, h3, h4, h5, div:not([role="button"]):not([class*="close"])'
            ) || header;
          }
        }
        if (!safeTarget) {
          const body = topModal.querySelector(
            ".el-dialog__body, .el-drawer__body, .ant-modal-body, .modal-body, .arco-modal-body"
          );
          if (body) {
            safeTarget = body;
          } else {
            safeTarget = topModal;
          }
        }
        const mouseOpts = { bubbles: true, cancelable: true, view: window };
        try {
          if (typeof PointerEvent !== "undefined") {
            safeTarget.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
          }
        } catch {
        }
        try {
          if (typeof MouseEvent !== "undefined") {
            safeTarget.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
            safeTarget.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
            safeTarget.dispatchEvent(new MouseEvent("click", mouseOpts));
          } else if (typeof CustomEvent !== "undefined") {
            safeTarget.dispatchEvent(new CustomEvent("click", mouseOpts));
          }
        } catch {
        }
      } else {
        const mouseOpts = { bubbles: true, cancelable: true, view: window };
        try {
          if (typeof PointerEvent !== "undefined") {
            document.body.dispatchEvent(new PointerEvent("pointerdown", mouseOpts));
          }
        } catch {
        }
        try {
          if (typeof MouseEvent !== "undefined") {
            document.body.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
            document.body.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
            document.body.dispatchEvent(new MouseEvent("click", mouseOpts));
          } else if (typeof CustomEvent !== "undefined") {
            document.body.dispatchEvent(new CustomEvent("click", mouseOpts));
          }
        } catch {
        }
      }
    } catch (e) {
      console.warn("[QA Copilot] 安全收起下拉浮层异常:", e);
    }
  }
  function getActiveDatePickerPoppers() {
    var _a;
    const popperSelectors = [
      // Element Plus / Element UI
      '.el-picker__popper:not([style*="display: none"]):not([style*="display:none"])',
      '.el-picker-panel:not([style*="display: none"]):not([style*="display:none"])',
      '.el-date-picker:not([style*="display: none"]):not([style*="display:none"])',
      '.el-date-range-picker:not([style*="display: none"]):not([style*="display:none"])',
      // Ant Design
      ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
      ".ant-picker-panel-container",
      ".ant-picker-panel",
      // Arco Design
      '.arco-picker-popup:not([style*="display: none"]):not([style*="display:none"])',
      ".arco-picker-panel",
      // Naive UI
      '.n-date-panel:not([style*="display: none"]):not([style*="display:none"])',
      // TDesign
      '.t-date-picker__panel:not([style*="display: none"]):not([style*="display:none"])',
      // 通用与常见类名
      '[class*="date-picker-dropdown"]:not([style*="display: none"])',
      '[class*="picker-panel"]:not([style*="display: none"])',
      '[class*="date-table"]:not([style*="display: none"])'
    ];
    const poppers = [];
    try {
      const raw = Array.from(document.querySelectorAll(popperSelectors.join(",")));
      for (const el of raw) {
        if (!el || !isElementVisible(el)) continue;
        const rect = ((_a = el.getBoundingClientRect) == null ? void 0 : _a.call(el)) || { width: 100, height: 100 };
        if (rect.width <= 30 || rect.height <= 30) continue;
        if (!poppers.some((p) => p.contains(el))) poppers.push(el);
      }
    } catch {
    }
    return poppers;
  }
  const observationElementCache = /* @__PURE__ */ new Map();
  function collectAiObservation() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    const selector = [
      "button",
      "a[href]",
      'input:not([type="hidden"])',
      "textarea",
      "select",
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="combobox"]',
      '[role="option"]',
      '[role="treeitem"]',
      '[role="menuitem"]',
      // 现代 UI 库下拉框组件触发器容器 (Element Plus, Ant Design, Arco, Naive, vue-treeselect 等)
      ".el-select",
      ".el-select__wrapper",
      ".el-cascader",
      ".el-tree-select",
      ".ant-select",
      ".ant-select-selector",
      ".arco-select",
      ".n-select",
      ".vue-treeselect",
      ".vue-treeselect__control",
      '[class*="select-trigger"]',
      '[class*="select__wrapper"]',
      // 现代 UI 库下拉选项、树节点、级联节点与菜单项
      ".el-select-dropdown__item",
      ".ant-select-item-option",
      ".arco-select-option",
      ".n-select-option",
      ".t-select-option",
      ".vue-treeselect__option",
      ".vue-treeselect__label",
      ".ant-select-tree-node-content-wrapper",
      ".ant-select-tree-title",
      ".el-tree-node__content",
      ".el-tree-node",
      ".el-cascader-node",
      ".el-select-dropdown li",
      '[class*="select-dropdown"] li'
    ].join(",");
    const activeModals = getActiveModalContainers();
    const hasActiveModal = activeModals.length > 0;
    const activePoppers = getActiveDropdownPoppers();
    const hasActivePopper = activePoppers.length > 0;
    const allRaw = Array.from(document.querySelectorAll(selector));
    const isQaCopilotElement = (el) => {
      var _a2;
      return Boolean(
        (_a2 = el.closest) == null ? void 0 : _a2.call(el, "[data-qa-copilot-root], [data-qa-copilot-hud]")
      );
    };
    const isHeaderEl = (el) => {
      var _a2;
      return Boolean(
        (_a2 = el.closest) == null ? void 0 : _a2.call(el, "header, .navbar, .top-bar, .topbar, .right-menu, .header-tools, .header-right, #screenfull, #size-select, .global-header, .ant-layout-header, .el-header")
      );
    };
    const isSidebarEl = (el) => {
      var _a2;
      return Boolean(
        (_a2 = el.closest) == null ? void 0 : _a2.call(el, "aside, nav, .sidebar, .sidebar-container, .left-aside, .ant-layout-sider, .el-aside")
      );
    };
    const isTreeSideEl = (el) => {
      var _a2;
      return Boolean(
        (_a2 = el.closest) == null ? void 0 : _a2.call(el, ".org-tree, .dept-tree, .left-tree, .tree-container, .aside-tree")
      );
    };
    const isMainActionOrContent = (el) => {
      var _a2;
      return Boolean(
        (_a2 = el.closest) == null ? void 0 : _a2.call(el, 'main, [role="main"], .app-main, .main-content, #app-main, .content-container, .page-container, .ant-layout-content, .el-main, .table-toolbar, .action-bar, .handle-box, .crud-opts, .toolbar')
      );
    };
    let orderedCandidates;
    if (hasActiveModal || hasActivePopper) {
      const popperCandidates = [];
      const modalCandidates = [];
      const mainCandidates = [];
      const backgroundCandidates = [];
      for (const el of allRaw) {
        if (!el || isQaCopilotElement(el)) continue;
        const inPopper = hasActivePopper && activePoppers.some((p) => {
          var _a2;
          return (_a2 = p.contains) == null ? void 0 : _a2.call(p, el);
        });
        const inModal = hasActiveModal && activeModals.some((m) => {
          var _a2;
          return (_a2 = m.contains) == null ? void 0 : _a2.call(m, el);
        });
        if (inPopper) {
          popperCandidates.push(el);
        } else if (inModal) {
          modalCandidates.push(el);
        } else if (isMainActionOrContent(el)) {
          mainCandidates.push(el);
        } else {
          backgroundCandidates.push(el);
        }
      }
      orderedCandidates = [...popperCandidates, ...modalCandidates, ...mainCandidates, ...backgroundCandidates];
    } else {
      const mainCandidates = [];
      const treeCandidates = [];
      const sidebarCandidates = [];
      const headerCandidates = [];
      const otherCandidates = [];
      for (const el of allRaw) {
        if (!el || isQaCopilotElement(el)) continue;
        if (isHeaderEl(el)) {
          headerCandidates.push(el);
        } else if (isSidebarEl(el)) {
          sidebarCandidates.push(el);
        } else if (isTreeSideEl(el)) {
          treeCandidates.push(el);
        } else if (isMainActionOrContent(el)) {
          mainCandidates.push(el);
        } else {
          otherCandidates.push(el);
        }
      }
      orderedCandidates = [
        ...mainCandidates,
        ...otherCandidates,
        ...treeCandidates.slice(0, 15),
        ...sidebarCandidates,
        ...headerCandidates
      ];
    }
    observationElementCache.clear();
    const elements = [];
    for (const [index, element] of orderedCandidates.entries()) {
      if (!isElementVisible(element)) continue;
      if (element.matches(':disabled, [aria-disabled="true"]')) continue;
      const tag = element.tagName.toLowerCase();
      const isDropdownTrigger = Boolean(
        element.closest('.el-select, .ant-select, .arco-select, .n-select, .el-cascader, .el-tree-select, .vue-treeselect, [class*="select-trigger"], [class*="select__wrapper"]') || element.getAttribute("role") === "combobox" || ((_a = element.classList) == null ? void 0 : _a.contains("el-select__wrapper")) || ((_b = element.classList) == null ? void 0 : _b.contains("ant-select-selector"))
      );
      if (tag === "input") {
        const inputEl = element;
        if (inputEl.type === "hidden" || inputEl.type === "file") continue;
        if (inputEl.readOnly && !isDropdownTrigger) continue;
      }
      if (tag === "textarea" && element.readOnly) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const inPopper = hasActivePopper && activePoppers.some((p) => p.contains(element));
      const inModal = activeModals.some((m) => m.contains(element));
      const isInSidebar = Boolean(
        element.closest('aside, nav, .sidebar, .sidebar-container, .left-aside, .org-tree, [class*="sidebar"]')
      );
      const isDropdownOption = !isInSidebar && (inPopper || Boolean(
        element.closest('.el-select-dropdown, .ant-select-dropdown, .arco-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, .vue-treeselect__portal-container, .el-tree-select__popper, .el-select__popper, .el-popper, .el-cascader__dropdown, [class*="select-dropdown"], [class*="treeselect__menu"], [class*="tree-select"]') || ((_c = element.classList) == null ? void 0 : _c.contains("el-select-dropdown__item")) || ((_d = element.classList) == null ? void 0 : _d.contains("ant-select-item-option")) || ((_e = element.classList) == null ? void 0 : _e.contains("arco-select-option")) || ((_f = element.classList) == null ? void 0 : _f.contains("vue-treeselect__option")) || ((_g = element.classList) == null ? void 0 : _g.contains("vue-treeselect__label")) || ((_h = element.classList) == null ? void 0 : _h.contains("el-tree-node__content")) || ((_i = element.classList) == null ? void 0 : _i.contains("el-tree-node")) || ((_j = element.classList) == null ? void 0 : _j.contains("el-cascader-node")) || element.getAttribute("role") === "option" && !element.closest("aside, .sidebar")
      ));
      if (isDropdownOption && element.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"], [role="treeitem"]')) {
        continue;
      }
      const obsId = `el-${index + 1}`;
      observationElementCache.set(obsId, element);
      try {
        element.setAttribute("data-qa-obs-id", obsId);
      } catch {
      }
      const isClickableAction = tag === "button" || tag === "a" || element.getAttribute("role") === "button" || element.getAttribute("role") === "link" || element.getAttribute("role") === "tab";
      const rawText = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120);
      const ariaLabel = element.getAttribute("aria-label") || void 0;
      const title = element.getAttribute("title") || void 0;
      const inHeader = isHeaderEl(element);
      const placeholder = element.getAttribute("placeholder") || ((_k = element.querySelector("input")) == null ? void 0 : _k.getAttribute("placeholder")) || ((_m = (_l = element.querySelector('.el-select__placeholder, .ant-select-selection-placeholder, [class*="placeholder"]')) == null ? void 0 : _l.textContent) == null ? void 0 : _m.trim()) || void 0;
      let name;
      if (isClickableAction && rawText) {
        name = rawText;
      } else {
        const intelligentLabel = getElementLabel(element);
        const labels = "labels" in element ? Array.from(element.labels || []).map((label) => label.innerText.trim()).filter(Boolean).join(" ") : "";
        name = intelligentLabel || ariaLabel || labels || placeholder || element.getAttribute("name") || title || void 0;
      }
      if (inHeader) {
        const headerTitle = title || ariaLabel || rawText || "系统辅助设置";
        name = `[顶部工具栏] ${headerTitle}`;
      } else if (isClickableAction && !name && !rawText) {
        name = "[图标按钮]";
      }
      let val;
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const isPassword = tag === "input" && element.type === "password";
        if (!isPassword) {
          val = ((_n = element.value) == null ? void 0 : _n.trim()) || void 0;
        } else {
          val = element.value ? "******" : void 0;
        }
      }
      const isMultiple = Boolean(
        ((_o = element.classList) == null ? void 0 : _o.contains("is-multiple")) || ((_p = element.classList) == null ? void 0 : _p.contains("el-select--multiple")) || ((_q = element.classList) == null ? void 0 : _q.contains("ant-select-multiple")) || element.querySelector(".el-select__tags, .ant-select-selection-overflow, .vue-treeselect__multi-value")
      );
      if (isDropdownTrigger) {
        if (!val) {
          const selectedItemEl = element.querySelector(
            '.el-select__selected-item, .ant-select-selection-item, .arco-select-view-value, .vue-treeselect__single-value, [class*="selected-item"]'
          );
          if (selectedItemEl) {
            const selText = (_r = selectedItemEl.textContent) == null ? void 0 : _r.trim();
            if (selText && !selText.startsWith("请选择")) {
              val = selText;
            }
          }
        }
        if (!val || isMultiple) {
          const tagEls = Array.from(element.querySelectorAll(
            '.el-select__tags .el-tag, .el-select__tags-text, .ant-select-selection-overflow-item, .vue-treeselect__multi-value-item, .arco-tag, [class*="select__tags"] [class*="tag"]'
          ));
          const tags = Array.from(new Set(tagEls.map((t) => {
            var _a2;
            return (_a2 = t.textContent) == null ? void 0 : _a2.trim();
          }).filter(Boolean)));
          if (tags.length > 0) {
            val = tags.join(", ");
          }
        }
      }
      let text;
      let inferredRole = element.getAttribute("role") || void 0;
      if (isDropdownOption) {
        inferredRole = "option";
        const isTreeOption = Boolean(
          ((_s = element.classList) == null ? void 0 : _s.contains("el-tree-node__content")) || ((_t = element.classList) == null ? void 0 : _t.contains("vue-treeselect__label")) || ((_u = element.classList) == null ? void 0 : _u.contains("el-tree-node")) || element.closest(".vue-treeselect__menu, .el-tree-select__popper, .ant-tree-select-dropdown, .el-tree")
        );
        const isSelected = Boolean(
          ((_v = element.classList) == null ? void 0 : _v.contains("is-selected")) || ((_w = element.classList) == null ? void 0 : _w.contains("selected")) || element.getAttribute("aria-selected") === "true" || element.closest(".vue-treeselect__option--selected, .el-select-dropdown__item.is-selected")
        );
        const selectedFlag = isSelected ? " [已勾选]" : "";
        const optionPrefix = isTreeOption ? "[当前树节点选项]" : "[当前下拉选项]";
        name = `${optionPrefix} ${rawText || name || "选项"}${selectedFlag}`;
        text = `${optionPrefix} ${rawText || name || "选项"}${selectedFlag}`;
      } else if (isDropdownTrigger) {
        inferredRole = "combobox";
        const cleanName = (name || "").replace(/\[(?:多选)?下拉框\]\s*/g, "");
        const valInfo = val ? ` (当前已选: ${val})` : "";
        if (isMultiple) {
          name = `[多选下拉框] ${cleanName}${valInfo}`;
        } else {
          name = `[下拉框] ${cleanName}${valInfo}`;
        }
        text = rawText ? inModal ? `[弹窗内] ${rawText}` : rawText : void 0;
      } else {
        text = rawText ? inModal ? `[弹窗内] ${rawText}` : rawText : void 0;
        if (!inferredRole) {
          inferredRole = tag === "button" ? "button" : tag === "a" ? "link" : tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "input" ? ["checkbox", "radio", "button", "submit"].includes(element.type) ? element.type : "textbox" : void 0;
        }
      }
      if (inModal && name && !name.startsWith("[弹窗内]") && !name.startsWith("[当前下拉选项]")) {
        name = `[弹窗内] ${name}`;
      } else if (!inModal && !inPopper && (hasActiveModal || hasActivePopper) && name) {
        if (!name.startsWith("[背景页面]")) {
          name = `[背景页面] ${name}`;
        }
        if (text && !text.startsWith("[背景页面]")) {
          text = `[背景页面] ${text}`;
        }
      }
      elements.push({
        id: obsId,
        tag,
        role: inferredRole,
        name: name == null ? void 0 : name.slice(0, 120),
        text,
        placeholder: placeholder == null ? void 0 : placeholder.slice(0, 120),
        value: val == null ? void 0 : val.slice(0, 100),
        testId: ((_x = element.getAttribute("data-testid")) == null ? void 0 : _x.slice(0, 100)) || void 0,
        ariaLabel: ariaLabel == null ? void 0 : ariaLabel.slice(0, 120),
        selector: getCssSelector(element),
        inputType: tag === "input" ? element.type : void 0,
        options: tag === "select" ? Array.from(element.options).slice(0, 20).map((option) => ({
          label: (option.label || option.textContent || "").trim().slice(0, 80),
          value: option.value.slice(0, 80)
        })) : void 0,
        disabled: false,
        inModal
      });
      if (elements.length >= 150) break;
    }
    let popperTextSection = "";
    if (hasActivePopper) {
      const popperSummaries = activePoppers.map((popper, idx) => {
        const text = (popper.innerText || popper.textContent || "").trim().replace(/\s+/g, " ").slice(0, 600);
        return `【当前展开的下拉/树选择浮层选项 ${idx + 1}】
${text}`;
      }).join("\n\n");
      popperTextSection = `${popperSummaries}
`;
    }
    let modalTextSection = "";
    if (hasActiveModal) {
      const modalSummaries = activeModals.map((modal, idx) => {
        var _a2;
        const titleEl = modal.querySelector(
          '.el-dialog__title, .ant-modal-title, .modal-title, [class*="title"], [class*="header"], h1, h2, h3, h4'
        );
        const title = ((_a2 = titleEl == null ? void 0 : titleEl.textContent) == null ? void 0 : _a2.trim()) || `活动弹窗/抽屉 ${idx + 1}`;
        const text = (modal.innerText || modal.textContent || "").trim().replace(/\s+/g, " ").slice(0, 1200);
        return `【当前活动弹窗: ${title}】
${text}`;
      }).join("\n\n");
      modalTextSection = `${modalSummaries}
--- 背景页面内容 ---
`;
    }
    const statusText = Array.from(document.querySelectorAll('h1,h2,h3,[role="alert"],[aria-live="polite"],[aria-live="assertive"]')).filter((element) => isElementVisible(element)).map((element) => element.innerText || element.textContent || "").join("\n");
    const bodyText = (((_y = document.body) == null ? void 0 : _y.innerText) || "").slice(0, 1500);
    return {
      url: window.location.href,
      title: document.title.slice(0, 160),
      text: `${popperTextSection}${modalTextSection}${statusText}
${bodyText}`.trim().slice(0, 4e3),
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      elements
    };
  }
  const DYNAMIC_STATE_CLASS_REGEX = /^(is-active|is-opened|is-focus|is-hover|is-expanded|active|open|opened|show|focused|hover|selected|ant-menu-submenu-open|ant-menu-submenu-active|ant-menu-item-selected|router-link-active|router-link-exact-active)$/i;
  function getCssSelector(el) {
    try {
      if (el.id) return `#${safeEscapeCss(el.id)}`;
      const tag = (el.tagName || "").toLowerCase();
      const testId = el.getAttribute("data-testid");
      if (testId) return `[data-testid="${safeEscapeCss(testId)}"]`;
      const name = el.getAttribute("name");
      if (name) return `${tag}[name="${safeEscapeCss(name)}"]`;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return `${tag}[aria-label="${safeEscapeCss(ariaLabel)}"]`;
      const parts = [];
      let current = el;
      while (current && current !== document.documentElement && parts.length < 5) {
        const currentTag = current.tagName.toLowerCase();
        const classes = typeof current.className === "string" ? current.className.trim().split(/\s+/).filter(Boolean).filter((item) => !DYNAMIC_STATE_CLASS_REGEX.test(item)).slice(0, 2).map((item) => `.${safeEscapeCss(item)}`).join("") : "";
        let part = `${currentTag}${classes}`;
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === (current == null ? void 0 : current.tagName)) : [];
        const isTopLevelOverlay = current.parentElement === document.body;
        if (siblings.length > 1 && !isTopLevelOverlay) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        const candidate = parts.join(" > ");
        if (document.querySelectorAll(candidate).length === 1) return candidate;
        current = current.parentElement;
      }
      return parts.join(" > ") || tag;
    } catch {
      return "element";
    }
  }
  function getXPath(el) {
    if (el.id) return `//*[@id=${xpathLiteral(el.id)}]`;
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === (current == null ? void 0 : current.tagName)) : [];
      const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : "";
      parts.unshift(`${tag}${index}`);
      current = current.parentElement;
    }
    return `/html/${parts.join("/")}`;
  }
  function xpathLiteral(value) {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat(${value.split("'").map((part, index) => `${index ? `,"'",` : ""}'${part}'`).join("")})`;
  }
  async function inspectElement(target) {
    const tag = target.tagName.toLowerCase();
    const text = (target.innerText || target.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const id = target.id || void 0;
    const name = target.getAttribute("name") || void 0;
    const role = target.getAttribute("role") || void 0;
    const testId = target.getAttribute("data-testid") || void 0;
    const placeholder = target.getAttribute("placeholder") || void 0;
    const ariaLabel = target.getAttribute("aria-label") || void 0;
    const label = getElementLabel(target) || void 0;
    const css = getCssSelector(target);
    const localXPath = getXPath(target);
    const frameGeometry = getCurrentFrameGeometry();
    const topFramePoint = await mapPointToTopFrame(0, 0);
    const frameXPath = (topFramePoint == null ? void 0 : topFramePoint.frameXPath) || frameGeometry.frameXPath;
    const frameCssPath = (topFramePoint == null ? void 0 : topFramePoint.frameCssPath) || frameGeometry.frameCssPath;
    const xpath = frameXPath.length ? `${frameXPath.join("|>>|")}|>>|${localXPath}` : localXPath;
    const playwright = LocatorGenerator.generate({
      tag,
      text,
      id,
      name,
      role,
      testId,
      placeholder,
      ariaLabel,
      label,
      frameCssPath,
      frameUrl: window.location.href,
      isChildFrame: window !== window.top
    });
    const result = {
      tag,
      text,
      id,
      name,
      role,
      testId,
      css,
      xpath,
      frame: {
        url: window.location.href,
        frameXPath,
        frameCssPath,
        offset: topFramePoint ? { left: topFramePoint.x, top: topFramePoint.y } : { left: frameGeometry.left, top: frameGeometry.top },
        zoom: (topFramePoint == null ? void 0 : topFramePoint.zoom) ?? frameGeometry.zoom,
        complete: Boolean(topFramePoint)
      },
      playwright
    };
    sendToBackground({ type: "ELEMENT_INSPECTED", payload: { element: result } }).catch(() => {
    });
  }
  function querySelectorSafe(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }
  function queryUniqueSelector(selector) {
    if (!selector) return null;
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
  }
  function findByXPath(xpath) {
    if (!xpath) return null;
    try {
      return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch {
      return null;
    }
  }
  function findByText(tags, text) {
    const expected = text == null ? void 0 : text.trim().replace(/\s+/g, " ");
    if (!expected) return null;
    const matches = Array.from(document.querySelectorAll(tags)).filter(
      (element) => (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ") === expected
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const visibleMatches = matches.filter((element) => {
        if (element instanceof HTMLElement) {
          return element.offsetParent !== null || element.getClientRects().length > 0;
        }
        return true;
      });
      if (visibleMatches.length === 1) return visibleMatches[0];
      if (visibleMatches.length > 1) {
        const activeContainers = [
          ...getActiveDropdownPoppers(),
          ...getActiveDatePickerPoppers(),
          ...getActiveModalContainers()
        ];
        for (const container of activeContainers) {
          const inContainer = visibleMatches.filter((el) => container.contains(el));
          if (inContainer.length === 1) return inContainer[0];
          if (inContainer.length > 1) {
            const leaf = inContainer.find((el) => !inContainer.some((other) => other !== el && el.contains(other)));
            if (leaf) return leaf;
            return inContainer[0];
          }
        }
      }
    }
    return null;
  }
  function isElementVisible(el) {
    if (!el) return false;
    const duck = el;
    if (duck.offsetParent !== void 0 || typeof duck.getClientRects === "function") {
      return duck.offsetParent !== null || typeof duck.getClientRects === "function" && duck.getClientRects().length > 0;
    }
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) {
      return el.offsetParent !== null || el.getClientRects().length > 0;
    }
    return false;
  }
  function findDatePickerTarget(payload) {
    const activePoppers = getActiveDatePickerPoppers();
    if (activePoppers.length === 0) return null;
    const expected = (payload.text || "").trim().replace(/\s+/g, " ");
    const isDayNumber = /^(?:[1-9]|[12]\d|3[01])$/.test(expected);
    for (const popper of activePoppers) {
      if (isDayNumber) {
        const preferRight = (payload.selector || "").includes("is-right") || (payload.xpath || "").includes("content[2]") || (payload.xpath || "").includes("is-right");
        const preferLeft = (payload.selector || "").includes("is-left") || (payload.xpath || "").includes("content[1]") || (payload.xpath || "").includes("is-left");
        const panels = Array.from(popper.querySelectorAll(
          ".el-date-range-picker__content, .el-picker-panel__content, .ant-picker-panel, .arco-picker-panel, table"
        ));
        let searchContainers = [];
        if (panels.length > 1) {
          if (preferRight) {
            searchContainers = [panels[panels.length - 1], ...panels];
          } else if (preferLeft) {
            searchContainers = [panels[0], ...panels];
          } else {
            searchContainers = panels;
          }
        } else if (panels.length === 1) {
          searchContainers = panels;
        } else {
          searchContainers = [popper];
        }
        for (const container of searchContainers) {
          const cells = Array.from(container.querySelectorAll(
            'td, [role="gridcell"], .ant-picker-cell, .arco-picker-cell, .n-date-panel-date, .el-date-table-cell'
          ));
          const validCells = cells.filter((cell) => {
            const classList = cell.className || "";
            if (typeof classList === "string") {
              if (/\b(?:disabled|is-disabled|ant-picker-cell-disabled)\b/.test(classList)) return false;
              if (/\b(?:prev-month|next-month|ant-picker-cell-out-view)\b/.test(classList)) return false;
            }
            return true;
          });
          const matchedValid = validCells.find((cell) => {
            const t = (cell.innerText || cell.textContent || "").trim().replace(/\s+/g, " ");
            return t === expected;
          });
          if (matchedValid) {
            const innerClickable = matchedValid.querySelector("span, div") || matchedValid;
            return innerClickable;
          }
          const fallbackCell = cells.find((cell) => {
            const classList = cell.className || "";
            if (typeof classList === "string" && /\b(?:disabled|is-disabled|ant-picker-cell-disabled)\b/.test(classList)) return false;
            const t = (cell.innerText || cell.textContent || "").trim().replace(/\s+/g, " ");
            return t === expected;
          });
          if (fallbackCell) {
            const innerClickable = fallbackCell.querySelector("span, div") || fallbackCell;
            return innerClickable;
          }
        }
      }
      if (expected) {
        const buttons = Array.from(popper.querySelectorAll(
          'button, a, .el-picker-panel__shortcut, [class*="shortcut"], [class*="footer"] button, [class*="btn"], [role="button"]'
        ));
        const matchedBtn = buttons.find((btn) => {
          const t = (btn.innerText || btn.textContent || "").trim().replace(/\s+/g, " ");
          return t === expected;
        });
        if (matchedBtn && isElementVisible(matchedBtn)) return matchedBtn;
      }
      if (payload.selector) {
        try {
          const bySel = popper.querySelector(payload.selector);
          if (bySel && isElementVisible(bySel)) return bySel;
        } catch {
        }
      }
    }
    return null;
  }
  function findDropdownOptionTarget(payload) {
    const activePoppers = getActiveDropdownPoppers();
    if (activePoppers.length === 0) return null;
    const expected = (payload.text || "").trim().replace(/\s+/g, " ");
    const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
    if (!cleanExpected) return null;
    for (const popper of activePoppers) {
      if (payload.obsId || payload.id) {
        const targetId = payload.obsId || payload.id;
        const byObs = popper.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetId)}"]`);
        if (byObs && isElementVisible(byObs)) return byObs;
      }
      if (payload.selector) {
        try {
          const bySel = popper.querySelector(payload.selector);
          if (bySel && isElementVisible(bySel)) return bySel;
        } catch {
        }
      }
      const optionCandidateSelectors = [
        ".el-select-dropdown__item",
        ".ant-select-item-option",
        ".arco-select-option",
        ".n-select-option",
        ".t-select-option",
        ".vue-treeselect__option",
        ".vue-treeselect__label",
        ".el-tree-node__content",
        ".el-cascader-node",
        ".ant-select-tree-node-content-wrapper",
        ".ant-select-tree-title",
        '[role="option"]',
        '[role="treeitem"]',
        "li",
        "span",
        "div"
      ].join(",");
      const candidates = Array.from(popper.querySelectorAll(optionCandidateSelectors)).filter((el) => Boolean(el && isElementVisible(el)));
      for (const el of candidates) {
        if (typeof el.querySelector === "function" && el.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]')) {
          continue;
        }
        const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
        if (text === cleanExpected || text === expected) {
          return el;
        }
      }
      for (const el of candidates) {
        if (typeof el.querySelector === "function" && el.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]')) {
          continue;
        }
        const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
        if (text && (text.startsWith(cleanExpected) || cleanExpected.startsWith(text) || text.includes(cleanExpected))) {
          return el;
        }
      }
    }
    return null;
  }
  function findClickTarget(payload) {
    var _a, _b;
    const isOption = payload.role === "option" || payload.tag === "OPTION" || Boolean(payload.text && /\[(?:当前下拉选项|下拉选项)\]/.test(payload.text)) || Boolean(payload.selector && /select-dropdown|ant-select-item|arco-select-option|vue-treeselect|tree-select/i.test(payload.selector));
    const isInputField = Boolean(payload.isInput || ["INPUT", "TEXTAREA", "SELECT"].includes(((_a = payload.tag) == null ? void 0 : _a.toUpperCase()) || ""));
    const expected = (payload.text || "").trim().replace(/\s+/g, " ");
    const expectedFirstLine = ((_b = (payload.text || "").split(/[\r\n]+/)[0]) == null ? void 0 : _b.trim().replace(/\s+/g, " ")) || "";
    const matchesText = (element, mode = "exact") => {
      if (!element) return false;
      if (isInputField) return true;
      if (!expected) return true;
      const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
      const actual = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
      const cleanActual = actual.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
      if (actual === expected || actual === cleanExpected || cleanActual === cleanExpected || cleanActual === expected) return true;
      if (mode === "exact") return false;
      if (actual && (expected || cleanExpected)) {
        if (cleanActual.includes(cleanExpected) || cleanExpected.includes(cleanActual)) return true;
        if (actual.includes(cleanExpected) || cleanExpected.includes(actual)) return true;
        if (cleanExpected.startsWith(cleanActual) || cleanActual.startsWith(cleanExpected)) return true;
        if (expectedFirstLine && (cleanActual === expectedFirstLine || cleanActual.includes(expectedFirstLine) || expectedFirstLine.includes(cleanActual))) {
          return true;
        }
      }
      return false;
    };
    const targetObsId = payload.obsId || payload.id;
    if (targetObsId) {
      const cached = observationElementCache.get(targetObsId);
      if (cached && document.contains(cached) && isElementVisible(cached)) {
        const activePoppers = getActiveDropdownPoppers();
        const inPopper = activePoppers.some((p) => p.contains(cached));
        if (isOption && activePoppers.length > 0 && !inPopper) {
          console.warn("[QA Copilot] 观察节点缓存命中了非浮层背景节点，转为下拉浮层精准匹配");
        } else {
          return cached;
        }
      }
      try {
        const byDataAttr = document.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetObsId)}"]`);
        if (byDataAttr && isElementVisible(byDataAttr)) {
          const activePoppers = getActiveDropdownPoppers();
          const inPopper = activePoppers.some((p) => p.contains(byDataAttr));
          if (isOption && activePoppers.length > 0 && !inPopper) {
          } else {
            return byDataAttr;
          }
        }
      } catch {
      }
    }
    const dropdownOptionTarget = findDropdownOptionTarget(payload);
    if (dropdownOptionTarget) return dropdownOptionTarget;
    const dateTarget = findDatePickerTarget(payload);
    if (dateTarget) return dateTarget;
    const activeModals = getActiveModalContainers();
    if (activeModals.length > 0) {
      const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
      for (const modal of activeModals) {
        if (payload.id) {
          const byId = modal.querySelector(`#${safeEscapeCss(payload.id)}`);
          if (byId && matchesText(byId, "partial")) return byId;
        }
        if (payload.testId) {
          const byTestId = modal.querySelector(`[data-testid="${safeEscapeCss(payload.testId)}"]`);
          if (byTestId && matchesText(byTestId, "partial")) return byTestId;
        }
        if (payload.name) {
          const cleanName = payload.name.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
          const byName = modal.querySelector(`[name="${safeEscapeCss(cleanName)}"], [name="${safeEscapeCss(payload.name)}"]`);
          if (byName && matchesText(byName, "partial")) return byName;
        }
        if (payload.ariaLabel) {
          const cleanAria = payload.ariaLabel.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, "");
          const byAriaLabel = modal.querySelector(`[aria-label="${safeEscapeCss(cleanAria)}"], [aria-label="${safeEscapeCss(payload.ariaLabel)}"]`);
          if (byAriaLabel && matchesText(byAriaLabel, "partial")) return byAriaLabel;
        }
        if (payload.selector) {
          try {
            const bySel = modal.querySelector(payload.selector);
            if (bySel && matchesText(bySel, "partial")) return bySel;
          } catch {
          }
        }
        if (cleanExpected) {
          const modalButtons = Array.from(modal.querySelectorAll('button, a, option, li, [role="button"], [role="option"], [role="menuitem"], input[type="button"], input[type="submit"]'));
          const matchedBtn = modalButtons.find((el) => {
            const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
            return t === cleanExpected || t === expected;
          });
          if (matchedBtn) return matchedBtn;
        }
      }
    }
    if (payload.id) {
      const byId = document.getElementById(payload.id);
      if (byId && matchesText(byId, "partial")) return byId;
    }
    if (payload.testId) {
      const byTestId = querySelectorSafe(`[data-testid="${safeEscapeCss(payload.testId)}"]`);
      if (byTestId && matchesText(byTestId, "partial")) return byTestId;
    }
    if (payload.name) {
      const byName = querySelectorSafe(`[name="${safeEscapeCss(payload.name)}"]`);
      if (byName && matchesText(byName, "partial")) return byName;
    }
    if (payload.ariaLabel) {
      const byAriaLabel = querySelectorSafe(`[aria-label="${safeEscapeCss(payload.ariaLabel)}"]`);
      if (byAriaLabel && matchesText(byAriaLabel, "partial")) return byAriaLabel;
    }
    if (payload.role && expected) {
      const byRole = findByText(`[role="${safeEscapeCss(payload.role)}"]`, expected);
      if (byRole) return byRole;
    }
    const byText = findByText('button, a, option, li, [role="button"], [role="option"], [role="menuitem"]', expected);
    if (byText) return byText;
    if (expected) {
      const byCellText = findByText('td, span, div, [role="gridcell"]', expected);
      if (byCellText) return byCellText;
    }
    if (expectedFirstLine && expectedFirstLine !== expected) {
      const byFirstLine = findByText('button, a, option, li, span, [role="button"], [role="menuitem"]', expectedFirstLine);
      if (byFirstLine) return byFirstLine;
    }
    const bySelector = queryUniqueSelector(payload.selector);
    const byXPath = findByXPath(payload.xpath);
    if (bySelector && matchesText(bySelector, "exact")) return bySelector;
    if (byXPath && matchesText(byXPath, "exact")) return byXPath;
    if (bySelector && matchesText(bySelector, "partial")) return bySelector;
    if (byXPath && matchesText(byXPath, "partial")) return byXPath;
    if (!isOption) {
      if (bySelector && isElementVisible(bySelector)) return bySelector;
      if (byXPath && isElementVisible(byXPath)) return byXPath;
    }
    if (!isOption && payload.x !== void 0 && payload.y !== void 0) {
      const byPoint = document.elementFromPoint(payload.x, payload.y);
      if (byPoint && (!payload.tag || byPoint.closest(payload.tag.toLowerCase()))) {
        const candidate = byPoint.closest(payload.tag.toLowerCase()) || byPoint;
        if (matchesText(candidate, "partial")) {
          return candidate;
        }
      }
    }
    return null;
  }
  function findScrollTarget(payload) {
    var _a;
    if (payload.target === "window") return window;
    if (!payload.selector) return null;
    const directMatch = querySelectorSafe(payload.selector);
    if (directMatch) return directMatch;
    if (payload.selector.includes(":nth-of-type")) {
      const cleanSelector = payload.selector.replace(/:nth-of-type\(\d+\)/g, "");
      try {
        const candidates = Array.from(document.querySelectorAll(cleanSelector));
        const visibleCandidate = candidates.find((el) => isElementVisible(el));
        if (visibleCandidate) return visibleCandidate;
        if (candidates.length > 0) return candidates[candidates.length - 1];
      } catch {
      }
    }
    const segments = payload.selector.split(">").map((s) => s.trim()).filter(Boolean);
    const lastSegment = (_a = segments[segments.length - 1]) == null ? void 0 : _a.replace(/:nth-of-type\(\d+\)/g, "");
    if (lastSegment) {
      try {
        const matched = Array.from(document.querySelectorAll(lastSegment));
        const visible = matched.find((el) => isElementVisible(el));
        if (visible) return visible;
        if (matched.length > 0) return matched[matched.length - 1];
      } catch {
      }
    }
    if (/el-select|el-scrollbar|dropdown|popper|rc-virtual-list|menu/i.test(payload.selector)) {
      try {
        const scrollWraps = Array.from(document.querySelectorAll(
          '.el-select-dropdown:not([style*="display: none"]) .el-scrollbar__wrap, .el-scrollbar__wrap, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .rc-virtual-list-holder, [class*="select-dropdown"] [class*="scrollbar__wrap"], [class*="dropdown__wrap"]'
        ));
        const visibleWrap = scrollWraps.find((el) => isElementVisible(el));
        if (visibleWrap) return visibleWrap;
      } catch {
      }
    }
    return null;
  }
  function findInputTarget(payload) {
    const isCheckable = payload.inputType === "radio" || payload.inputType === "checkbox";
    const name = payload.name || payload.fieldName;
    const targetOptionValue = payload.optionValue || (payload.value !== "已选中" && payload.value !== "未选中" ? payload.value : void 0);
    const targetObsId = payload.obsId || payload.id;
    if (targetObsId) {
      const cached = observationElementCache.get(targetObsId);
      if (cached && document.contains(cached) && isElementVisible(cached)) {
        if (cached instanceof HTMLInputElement || cached instanceof HTMLTextAreaElement || cached instanceof HTMLSelectElement) {
          return cached;
        }
        const nested = cached.querySelector("input, textarea, select");
        if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
          return nested;
        }
      }
      try {
        const byDataAttr = document.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetObsId)}"]`);
        if (byDataAttr && isElementVisible(byDataAttr)) {
          if (byDataAttr instanceof HTMLInputElement || byDataAttr instanceof HTMLTextAreaElement || byDataAttr instanceof HTMLSelectElement) {
            return byDataAttr;
          }
          const nested = byDataAttr.querySelector("input, textarea, select");
          if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
            return nested;
          }
        }
      } catch {
      }
    }
    const activeModals = getActiveModalContainers();
    if (activeModals.length > 0) {
      for (const modal of activeModals) {
        if (payload.id) {
          const byId = modal.querySelector(`#${safeEscapeCss(payload.id)}`);
          if (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement || byId instanceof HTMLSelectElement) {
            return byId;
          }
        }
        if (payload.placeholder) {
          const cleanPh = payload.placeholder.replace(/^\[弹窗内\]\s*/, "");
          const byPh = modal.querySelector(`[placeholder="${safeEscapeCss(cleanPh)}"], [placeholder="${safeEscapeCss(payload.placeholder)}"]`);
          if (byPh instanceof HTMLInputElement || byPh instanceof HTMLTextAreaElement || byPh instanceof HTMLSelectElement) {
            return byPh;
          }
        }
        if (name) {
          const cleanName = name.replace(/^\[弹窗内\]\s*/, "");
          const byName = modal.querySelector(`[name="${safeEscapeCss(cleanName)}"], [name="${safeEscapeCss(name)}"]`);
          if (byName instanceof HTMLInputElement || byName instanceof HTMLTextAreaElement || byName instanceof HTMLSelectElement) {
            return byName;
          }
        }
        if (payload.fieldLabel) {
          const cleanLabel = payload.fieldLabel.replace(/^\[弹窗内\]\s*/, "");
          const matchedLabel = Array.from(modal.querySelectorAll("label")).find((l) => {
            var _a;
            const t = (_a = l.textContent) == null ? void 0 : _a.trim();
            return t === cleanLabel || t === payload.fieldLabel;
          });
          if (matchedLabel) {
            if (matchedLabel.control && (matchedLabel.control instanceof HTMLInputElement || matchedLabel.control instanceof HTMLTextAreaElement || matchedLabel.control instanceof HTMLSelectElement)) {
              return matchedLabel.control;
            }
            const nested = matchedLabel.querySelector("input, textarea, select");
            if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
              return nested;
            }
          }
        }
        if (payload.selector) {
          try {
            const bySel = modal.querySelector(payload.selector);
            if (bySel instanceof HTMLInputElement || bySel instanceof HTMLTextAreaElement || bySel instanceof HTMLSelectElement) {
              return bySel;
            }
          } catch {
          }
        }
      }
    }
    if (payload.id) {
      const byId = document.getElementById(payload.id);
      if (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement || byId instanceof HTMLSelectElement) {
        return byId;
      }
    }
    if (isCheckable && name && targetOptionValue) {
      const escapedName = safeEscapeCss(name);
      const escapedVal = safeEscapeCss(targetOptionValue);
      const selector = `input[type="${payload.inputType || "radio"}"][name="${escapedName}"][value="${escapedVal}"]`;
      const byNameAndValue = querySelectorSafe(selector);
      if (byNameAndValue instanceof HTMLInputElement) return byNameAndValue;
    }
    if (payload.fieldLabel) {
      const matchedLabel = Array.from(document.querySelectorAll("label")).find((label) => {
        var _a;
        return ((_a = label.textContent) == null ? void 0 : _a.trim()) === payload.fieldLabel;
      });
      if (matchedLabel) {
        if (matchedLabel.control && (matchedLabel.control instanceof HTMLInputElement || matchedLabel.control instanceof HTMLTextAreaElement || matchedLabel.control instanceof HTMLSelectElement)) {
          return matchedLabel.control;
        }
        const nestedInput = matchedLabel.querySelector("input, textarea, select");
        if (nestedInput instanceof HTMLInputElement || nestedInput instanceof HTMLTextAreaElement || nestedInput instanceof HTMLSelectElement) {
          return nestedInput;
        }
      }
    }
    if (payload.selector) {
      const bySelector = querySelectorSafe(payload.selector);
      if (bySelector instanceof HTMLInputElement || bySelector instanceof HTMLTextAreaElement || bySelector instanceof HTMLSelectElement) {
        if (!isCheckable || !targetOptionValue || bySelector instanceof HTMLInputElement && bySelector.value === targetOptionValue) {
          return bySelector;
        }
      }
    }
    if (name) {
      const escapedName = safeEscapeCss(name);
      if (isCheckable) {
        const candidates = Array.from(document.querySelectorAll(`input[name="${escapedName}"]`)).filter(
          (el) => el instanceof HTMLInputElement
        );
        if (targetOptionValue) {
          const matched = candidates.find((el) => el.value === targetOptionValue);
          if (matched) return matched;
        }
        if (candidates.length === 1) return candidates[0];
      } else {
        const byName = querySelectorSafe(`[name="${escapedName}"]`);
        if (byName instanceof HTMLInputElement || byName instanceof HTMLTextAreaElement || byName instanceof HTMLSelectElement) {
          return byName;
        }
      }
    }
    if (payload.placeholder) {
      const byPlaceholder = querySelectorSafe(`[placeholder="${safeEscapeCss(payload.placeholder)}"]`);
      if (byPlaceholder instanceof HTMLInputElement || byPlaceholder instanceof HTMLTextAreaElement || byPlaceholder instanceof HTMLSelectElement) {
        return byPlaceholder;
      }
    }
    return null;
  }
  function setNativeValue(target, value) {
    var _a;
    if (target instanceof HTMLSelectElement) {
      target.value = value;
    } else {
      const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = (_a = Object.getOwnPropertyDescriptor(prototype, "value")) == null ? void 0 : _a.set;
      if (setter) setter.call(target, value);
      else target.value = value;
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function expandDropdownForElement(el) {
    var _a, _b;
    try {
      const dropdown = (_a = el.closest) == null ? void 0 : _a.call(el, '.el-select-dropdown, .ant-select-dropdown, [class*="select-dropdown"], [class*="select__popper"]');
      if (!dropdown) return false;
      if (dropdown.offsetParent === null || dropdown.style.display === "none" || dropdown.classList.contains("is-hidden")) {
        if (dropdown.id) {
          const trigger = document.querySelector(`[aria-controls="${dropdown.id}"], [aria-owns="${dropdown.id}"], [aria-describedby*="${dropdown.id}"]`);
          if (trigger instanceof HTMLElement && isElementVisible(trigger)) {
            dispatchClick(trigger);
            return true;
          }
        }
        const selects = Array.from(document.querySelectorAll('.el-select, .ant-select, [role="combobox"], .n-select, .arco-select'));
        for (const sel of selects) {
          if (isElementVisible(sel)) {
            const trigger = ((_b = sel.querySelector) == null ? void 0 : _b.call(sel, ".el-input__inner, .ant-select-selector, .el-select__caret, input")) || sel;
            dispatchClick(trigger);
            return true;
          }
        }
      }
    } catch {
    }
    return false;
  }
  function autoExpandAncestors(el) {
    var _a, _b, _c;
    try {
      if (expandDropdownForElement(el)) {
        return;
      }
      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (((_a = parent.classList) == null ? void 0 : _a.contains("el-submenu")) && !parent.classList.contains("is-opened")) {
          const title = parent.querySelector(".el-submenu__title");
          if (title) {
            dispatchClick(title);
            return;
          }
        }
        if (((_b = parent.classList) == null ? void 0 : _b.contains("ant-menu-submenu")) && !parent.classList.contains("ant-menu-submenu-open")) {
          const title = parent.querySelector(".ant-menu-submenu-title");
          if (title) {
            dispatchClick(title);
            return;
          }
        }
        if (((_c = parent.classList) == null ? void 0 : _c.contains("el-collapse-item")) && !parent.classList.contains("is-active")) {
          const header = parent.querySelector(".el-collapse-item__header");
          if (header) {
            dispatchClick(header);
            return;
          }
        }
        if (parent.getAttribute("aria-expanded") === "false") {
          const toggle = parent.querySelector('[aria-expanded="false"], button, a') || parent;
          dispatchClick(toggle);
          return;
        }
        if (parent.tagName === "DETAILS" && !parent.open) {
          parent.open = true;
          return;
        }
        parent = parent.parentElement;
      }
    } catch {
    }
  }
  function isOptionEvent(event) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (event.type !== "click") return false;
    const p = event.payload;
    return Boolean(
      (p == null ? void 0 : p.role) === "option" || (p == null ? void 0 : p.tag) === "OPTION" || ((_a = p == null ? void 0 : p.selector) == null ? void 0 : _a.includes("select-dropdown")) || ((_b = p == null ? void 0 : p.selector) == null ? void 0 : _b.includes("el-select-dropdown")) || ((_c = p == null ? void 0 : p.selector) == null ? void 0 : _c.includes("ant-select-dropdown")) || ((_d = p == null ? void 0 : p.selector) == null ? void 0 : _d.includes("select-item")) || ((_e = p == null ? void 0 : p.selector) == null ? void 0 : _e.includes("dropdown-menu")) || ((_f = p == null ? void 0 : p.selector) == null ? void 0 : _f.includes("vue-treeselect")) || ((_g = p == null ? void 0 : p.selector) == null ? void 0 : _g.includes("tree-select")) || Boolean((p == null ? void 0 : p.text) && /\[(?:当前下拉选项|下拉选项)\]/.test(p.text))
    );
  }
  function tryHealAndOpenDropdown(event) {
    try {
      const p = event.payload;
      if (p == null ? void 0 : p.fieldLabel) {
        const formItems = Array.from(document.querySelectorAll('.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, [class*="form-item"]'));
        for (const item of formItems) {
          const text = (item.textContent || "").trim();
          if (text.includes(p.fieldLabel)) {
            const selectTrigger = item.querySelector(
              '.el-select, .ant-select, [role="combobox"], .el-select__wrapper, .select-trigger, .ant-select-selector, input'
            );
            if (selectTrigger && isElementVisible(selectTrigger)) {
              console.warn(`[QA Copilot Replay] 触发前置表单项「${p.fieldLabel}」下拉框自愈展开`);
              dispatchClick(selectTrigger);
              return true;
            }
          }
        }
      }
      const activeDropdown = document.querySelector(
        '.el-select-dropdown:not([style*="display: none"]), .ant-select-dropdown:not(.ant-select-dropdown-hidden), [class*="select-dropdown"]:not([style*="display: none"])'
      );
      if (!activeDropdown) {
        const candidates = Array.from(document.querySelectorAll('.el-select, .ant-select, [role="combobox"], .arco-select'));
        for (const cand of candidates) {
          if (isElementVisible(cand)) {
            const trigger = cand.querySelector(".el-select__wrapper, .select-trigger, .ant-select-selector, input") || cand;
            console.warn(`[QA Copilot Replay] 页面无展开浮层，触发候选下拉框自愈展开`);
            dispatchClick(trigger);
            return true;
          }
        }
      }
    } catch {
    }
    return false;
  }
  function isDatePickerEvent(event) {
    if (event.type !== "click") return false;
    const p = event.payload;
    if (!p) return false;
    const selector = (p.selector || "").toLowerCase();
    const xpath = (p.xpath || "").toLowerCase();
    const isDateSelector = /picker|date|calendar|month-table|year-table|time-panel|datetime|range-picker|el-date|ant-picker/i.test(selector) || /picker|date|calendar|month-table|year-table|time-panel|datetime|range-picker/i.test(xpath);
    const text = (p.text || "").trim();
    const desc = (event.description || "").toLowerCase();
    const title = (event.title || "").toLowerCase();
    const isDateLabel = Boolean(
      p.fieldLabel && /日期|时间|date|time/i.test(p.fieldLabel)
    );
    const isDateTextOrDesc = /日期|时间|date|time|开始日期|结束日期/i.test(desc) || /日期|时间|date|time/i.test(title);
    const isDayNumber = /^(?:[1-9]|[12]\d|3[01])$/.test(text);
    return Boolean(
      isDateSelector || p.isDatePicker || isDayNumber && (isDateLabel || isDateTextOrDesc || isDateSelector)
    );
  }
  function tryHealAndOpenDatePicker(event) {
    try {
      const p = event.payload;
      if (p == null ? void 0 : p.fieldLabel) {
        const formItems = Array.from(document.querySelectorAll(
          '.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, [class*="form-item"]'
        ));
        for (const item of formItems) {
          const text = (item.textContent || "").trim();
          if (text.includes(p.fieldLabel)) {
            const dateTrigger = item.querySelector(
              '.el-date-editor, .el-range-editor, .ant-picker, .arco-picker, input.el-range-input, input[placeholder*="日期"], input[placeholder*="时间"], [class*="picker"]'
            );
            if (dateTrigger && isElementVisible(dateTrigger)) {
              console.warn(`[QA Copilot Replay] 触发前置表单项「${p.fieldLabel}」日期选择器自愈展开`);
              dispatchClick(dateTrigger);
              return true;
            }
          }
        }
      }
      const activeDatePopper = document.querySelector(
        '.el-picker__popper:not([style*="display: none"]), .el-picker-panel:not([style*="display: none"]), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden), [class*="date-picker-dropdown"]:not([style*="display: none"])'
      );
      if (!activeDatePopper) {
        const candidates = Array.from(document.querySelectorAll(
          '.el-date-editor, .el-range-editor, .ant-picker, .arco-picker, input.el-range-input, input[placeholder*="开始日期"], input[placeholder*="日期"], input[placeholder*="时间"]'
        ));
        for (const cand of candidates) {
          if (isElementVisible(cand)) {
            const trigger = cand.querySelector("input") || cand;
            console.warn(`[QA Copilot Replay] 页面无展开日历浮层，触发候选日期组件自愈展开`);
            dispatchClick(trigger);
            return true;
          }
        }
      }
    } catch {
    }
    return false;
  }
  function dispatchClick(target) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const isOptionLike = Boolean(
      ((_a = target.getAttribute) == null ? void 0 : _a.call(target, "role")) === "option" || ((_b = target.getAttribute) == null ? void 0 : _b.call(target, "role")) === "treeitem" || ((_c = target.classList) == null ? void 0 : _c.contains("el-select-dropdown__item")) || ((_d = target.classList) == null ? void 0 : _d.contains("ant-select-item-option")) || ((_e = target.classList) == null ? void 0 : _e.contains("arco-select-option")) || ((_f = target.classList) == null ? void 0 : _f.contains("vue-treeselect__option")) || ((_g = target.classList) == null ? void 0 : _g.contains("vue-treeselect__label")) || ((_h = target.classList) == null ? void 0 : _h.contains("vue-treeselect__option-arrow")) || ((_i = target.classList) == null ? void 0 : _i.contains("el-tree-node__content")) || ((_j = target.classList) == null ? void 0 : _j.contains("el-tree-node__label")) || ((_k = target.classList) == null ? void 0 : _k.contains("el-tree-node__expand-icon")) || ((_l = target.classList) == null ? void 0 : _l.contains("el-cascader-node")) || Boolean((_m = target.closest) == null ? void 0 : _m.call(target, '.el-select-dropdown, .ant-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, .vue-treeselect__portal-container, .el-tree-select__popper, .el-select__popper, .el-cascader__dropdown, [class*="select-dropdown"], [class*="treeselect__menu"]'))
    );
    let trigger = null;
    if (!isOptionLike) {
      trigger = (_n = target.querySelector) == null ? void 0 : _n.call(
        target,
        '.el-submenu__title, .ant-menu-submenu-title, .arco-menu-inline-header, [class*="submenu__title"], [class*="submenu-title"], [class*="collapse-item__header"], [class*="collapse-header"]'
      );
      const selectContainer = (_o = target.closest) == null ? void 0 : _o.call(
        target,
        '.el-select, .ant-select, [role="combobox"], .n-select, .arco-select, [class*="select-trigger"]'
      );
      if (!trigger && selectContainer) {
        trigger = ((_p = selectContainer.querySelector) == null ? void 0 : _p.call(
          selectContainer,
          ".el-select__wrapper, .select-trigger, .ant-select-selector, .arco-select-view, .el-input__inner, input"
        )) || selectContainer;
      } else if (!trigger && (((_q = target.classList) == null ? void 0 : _q.contains("el-select")) || ((_r = target.classList) == null ? void 0 : _r.contains("ant-select")) || ((_s = target.getAttribute) == null ? void 0 : _s.call(target, "role")) === "combobox")) {
        trigger = (_t = target.querySelector) == null ? void 0 : _t.call(
          target,
          ".el-select__wrapper, .select-trigger, .ant-select-selector, .el-input__inner, input"
        );
      }
    }
    const clickNode = trigger || target;
    try {
      const focusable = ((_u = clickNode.querySelector) == null ? void 0 : _u.call(clickNode, "input")) || clickNode;
      (_v = focusable.focus) == null ? void 0 : _v.call(focusable, { preventScroll: true });
    } catch {
    }
    let clientX = 0;
    let clientY = 0;
    try {
      const rect = (_w = clickNode.getBoundingClientRect) == null ? void 0 : _w.call(clickNode);
      if (rect && (rect.width > 0 || rect.height > 0)) {
        clientX = Math.round(rect.left + rect.width / 2);
        clientY = Math.round(rect.top + rect.height / 2);
      }
    } catch {
    }
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      buttons: 1,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY
    };
    const preEvents = ["pointerdown", "mousedown", "pointerup", "mouseup"];
    for (const evName of preEvents) {
      try {
        let ev;
        if (typeof PointerEvent !== "undefined" && evName.startsWith("pointer")) {
          ev = new PointerEvent(evName, { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true });
        } else {
          ev = new MouseEvent(evName, eventInit);
        }
        clickNode.dispatchEvent(ev);
      } catch {
      }
    }
    try {
      clickNode.click();
    } catch {
      try {
        clickNode.dispatchEvent(new MouseEvent("click", eventInit));
      } catch {
      }
    }
  }
  async function waitForReplayTarget(event, replayId) {
    let lastFoundHiddenTarget = null;
    const isScrollEvent = event.type === "scroll";
    const isOption = isOptionEvent(event);
    const isDate = isDatePickerEvent(event);
    const maxAttempts = isScrollEvent ? 15 : 80;
    let hiddenFoundCount = 0;
    let attemptedHeal = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (replayId && activeContentReplayId !== replayId) {
        return null;
      }
      const target = event.type === "click" ? findClickTarget(event.payload) : event.type === "input" ? findInputTarget(event.payload) : findScrollTarget(event.payload);
      if (target) {
        if (target === window) return window;
        const htmlEl = target;
        if (isElementVisible(htmlEl)) {
          return htmlEl;
        }
        lastFoundHiddenTarget = htmlEl;
        hiddenFoundCount += 1;
        if (attempt >= 2 && attempt % 3 === 0) {
          autoExpandAncestors(htmlEl);
        }
        if (hiddenFoundCount >= 15) {
          break;
        }
      } else if (isDate && !attemptedHeal && (attempt === 3 || attempt === 8)) {
        const healed = tryHealAndOpenDatePicker(event);
        if (healed) {
          attemptedHeal = true;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } else if (isOption && !attemptedHeal && (attempt === 3 || attempt === 8)) {
        const healed = tryHealAndOpenDropdown(event);
        if (healed) {
          attemptedHeal = true;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (lastFoundHiddenTarget) {
      autoExpandAncestors(lastFoundHiddenTarget);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return lastFoundHiddenTarget;
    }
    return null;
  }
  async function createCdpInputAction(target, kind, text) {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const localX = rect.left + rect.width / 2;
    const localY = rect.top + rect.height / 2;
    const topPoint = await mapPointToTopFrame(localX, localY);
    if (!topPoint) return null;
    return { kind, x: topPoint.x, y: topPoint.y, text };
  }
  let replayDispatching = false;
  let replaySuppressedUntil = 0;
  async function replayAction(event, replayId, useCdp = false) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    if (!event || event.type !== "click" && event.type !== "input" && event.type !== "scroll") {
      return { success: false, error: "不支持的回放步骤" };
    }
    if (event.type === "input" && event.payload.sensitive) {
      return { success: false, error: "该密码值已脱敏，请在回放时手动填写" };
    }
    if (replayId && activeContentReplayId !== replayId) {
      return { success: false, error: "回放已停止", stopped: true };
    }
    const target = await waitForReplayTarget(event, replayId);
    if (replayId && activeContentReplayId !== replayId) {
      return { success: false, error: "回放已停止", stopped: true };
    }
    if (!target) {
      if (event.type === "scroll") {
        console.warn(`[QA Copilot Replay] 滚动目标未就绪或已自动关闭，安全跳过该滚动步骤以保证主流程执行: ${event.description}`);
        return { success: true };
      }
      return { success: false, error: `找不到元素：${event.description}` };
    }
    if (event.type === "scroll") {
      const payload = event.payload;
      replaySuppressedUntil = Date.now() + 1500;
      try {
        if (target === window) {
          window.scrollTo({ top: payload.scrollTop, left: payload.scrollLeft, behavior: "auto" });
        } else {
          target.scrollTo({ top: payload.scrollTop, left: payload.scrollLeft, behavior: "auto" });
        }
      } catch (err) {
        console.warn("[QA Copilot Replay] 执行元素滚动失败，已安全放行:", err);
      }
      return { success: true };
    }
    const htmlTarget = target;
    if (htmlTarget.offsetParent === null && htmlTarget.getClientRects().length === 0) {
      autoExpandAncestors(htmlTarget);
      if (htmlTarget.offsetParent === null && htmlTarget.getClientRects().length === 0) {
        const isDropdownOption = Boolean(
          ((_a = event.payload) == null ? void 0 : _a.role) === "option" || htmlTarget.getAttribute("role") === "option" || ((_b = htmlTarget.classList) == null ? void 0 : _b.contains("el-select-dropdown__item")) || ((_c = htmlTarget.classList) == null ? void 0 : _c.contains("vue-treeselect__option")) || ((_d = htmlTarget.classList) == null ? void 0 : _d.contains("vue-treeselect__label")) || ((_e = htmlTarget.closest) == null ? void 0 : _e.call(htmlTarget, '.el-select-dropdown, .ant-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, .vue-treeselect__portal-container, .el-tree-select__popper, [class*="select-dropdown"], [class*="treeselect"]'))
        );
        const isDateCell = Boolean(
          isDatePickerEvent(event) || ((_f = htmlTarget.closest) == null ? void 0 : _f.call(htmlTarget, '.el-picker-panel, .el-date-picker, .el-date-range-picker, .ant-picker-dropdown, .arco-picker-popup, [class*="date-table"]'))
        );
        if (isDropdownOption || isDateCell) {
          console.warn(`[QA Copilot Replay] 日期选项/下拉选项处于特殊渲染层，执行穿透点击以触发组件选中: ${event.description}`);
          try {
            dispatchClick(htmlTarget);
            return { success: true };
          } catch {
          }
        }
        return { success: false, error: `元素当前处于隐藏或不可见状态：${event.description}` };
      }
    }
    (_g = htmlTarget.scrollIntoView) == null ? void 0 : _g.call(htmlTarget, { behavior: "auto", block: "center", inline: "center" });
    const previousOutline = ((_h = htmlTarget.style) == null ? void 0 : _h.outline) || "";
    if (htmlTarget.style) {
      htmlTarget.style.outline = "3px solid #22c55e";
    }
    replayDispatching = true;
    replaySuppressedUntil = Date.now() + 1e3;
    try {
      if (event.type === "click") {
        if ("disabled" in htmlTarget && Boolean(htmlTarget.disabled)) {
          return { success: false, error: `元素已禁用不可点击：${event.description}` };
        }
        const isOptionLike = Boolean(
          ((_i = htmlTarget.getAttribute) == null ? void 0 : _i.call(htmlTarget, "role")) === "option" || ((_j = htmlTarget.classList) == null ? void 0 : _j.contains("el-select-dropdown__item")) || ((_k = htmlTarget.classList) == null ? void 0 : _k.contains("ant-select-item-option")) || ((_l = htmlTarget.classList) == null ? void 0 : _l.contains("arco-select-option")) || ((_m = htmlTarget.classList) == null ? void 0 : _m.contains("vue-treeselect__option")) || ((_n = htmlTarget.classList) == null ? void 0 : _n.contains("vue-treeselect__label")) || ((_o = htmlTarget.closest) == null ? void 0 : _o.call(htmlTarget, '.el-select-dropdown, .ant-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, [class*="select-dropdown"]'))
        );
        if (!isOptionLike) {
          const activePoppers = getActiveDropdownPoppers();
          if (activePoppers.length > 0 && !activePoppers.some((p) => p.contains(htmlTarget))) {
            safeCloseDropdownPopper(htmlTarget);
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }
        if (useCdp) {
          const cdpInput = await createCdpInputAction(htmlTarget, "click");
          if (!cdpInput) return { success: false, error: "无法计算 iframe 内元素的顶层点击坐标" };
          if (isOptionLike) {
            window.setTimeout(() => {
              safeCloseDropdownPopper(htmlTarget);
            }, 180);
          }
          return { success: true, cdpInput };
        }
        dispatchClick(htmlTarget);
        if (isOptionLike) {
          window.setTimeout(() => {
            safeCloseDropdownPopper(htmlTarget);
          }, 120);
        }
      } else {
        const input = target;
        const payload = event.payload;
        if ("disabled" in input && input.disabled) {
          return { success: false, error: `输入控件处于禁用状态：${event.description}` };
        }
        if ("readOnly" in input && input.readOnly) {
          return { success: false, error: `输入控件处于只读状态：${event.description}` };
        }
        input.focus({ preventScroll: true });
        if (input instanceof HTMLInputElement && (input.type === "checkbox" || input.type === "radio")) {
          const shouldBeChecked = payload.checked !== void 0 ? payload.checked : payload.value !== "未选中";
          if (input.checked !== shouldBeChecked) {
            if (useCdp) {
              const cdpInput = await createCdpInputAction(input, "click");
              if (!cdpInput) return { success: false, error: "无法计算 iframe 内控件的顶层点击坐标" };
              return { success: true, cdpInput };
            }
            input.click();
          }
          if (input.checked !== shouldBeChecked) {
            input.checked = shouldBeChecked;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          if (input.checked !== shouldBeChecked) {
            return { success: false, error: `单选/复选框状态未成功更新: 期望 ${shouldBeChecked}` };
          }
        } else {
          const nativeTextInput = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement;
          const type = input instanceof HTMLInputElement ? input.type : "";
          if (useCdp && nativeTextInput && !["date", "datetime-local", "month", "time", "week"].includes(type)) {
            const cdpInput = await createCdpInputAction(input, "type", payload.value);
            if (!cdpInput) return { success: false, error: "无法计算 iframe 内输入框的顶层点击坐标" };
            return { success: true, cdpInput };
          }
          setNativeValue(input, payload.value);
          if (input.value !== payload.value && input.type !== "password") {
            return { success: false, error: `输入值回读不一致：期望 "${payload.value}"，实际 "${input.value}"` };
          }
        }
      }
      return { success: true };
    } finally {
      replayDispatching = false;
      window.setTimeout(() => {
        htmlTarget.style.outline = previousOutline;
      }, 350);
    }
  }
  const pendingScrollRecords = /* @__PURE__ */ new Map();
  function submitScrollRecord(target, event) {
    pendingScrollRecords.delete(target);
    sendFlushableRecord({ type: "RECORD_EVENT", payload: { event } });
  }
  function flushPendingScrollRecords() {
    for (const [target, record] of pendingScrollRecords) {
      clearTimeout(record.timer);
      submitScrollRecord(target, record.event);
    }
  }
  document.addEventListener("scroll", (event) => {
    var _a, _b, _c;
    if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
    const rawTarget = event.target;
    if (!rawTarget) return;
    const isWindowScroll = rawTarget === document || rawTarget === document.documentElement || rawTarget === document.body;
    const element = isWindowScroll ? document.scrollingElement : rawTarget instanceof Element ? rawTarget : null;
    if (!element) return;
    const timestamp = Date.now();
    const scrollTop = isWindowScroll ? window.scrollY : element.scrollTop;
    const scrollLeft = isWindowScroll ? window.scrollX : element.scrollLeft;
    const selector = isWindowScroll ? void 0 : getCssSelector(element);
    const pending = pendingScrollRecords.get(rawTarget);
    if (pending) clearTimeout(pending.timer);
    let readableTarget = "页面";
    if (!isWindowScroll) {
      const el = element;
      if ((_a = el.closest) == null ? void 0 : _a.call(el, '.el-select-dropdown, .ant-select-dropdown, [class*="select-dropdown"]')) {
        readableTarget = "下拉选项列表";
      } else if ((_b = el.closest) == null ? void 0 : _b.call(el, 'table, .el-table, .ant-table, [class*="table"]')) {
        readableTarget = "表格列表";
      } else if ((_c = el.getAttribute) == null ? void 0 : _c.call(el, "aria-label")) {
        readableTarget = `「${el.getAttribute("aria-label")}」`;
      } else {
        const nearbyLabel = getElementLabel(el);
        readableTarget = nearbyLabel ? `「${nearbyLabel}」列表` : "列表";
      }
    }
    const recordedEvent = {
      type: "scroll",
      timestamp,
      title: isWindowScroll ? "滚动页面" : "滚动列表",
      description: `${readableTarget} 滚动到 ${Math.round(scrollTop)}`,
      url: window.location.href,
      payload: {
        timestamp,
        url: window.location.href,
        target: isWindowScroll ? "window" : "element",
        selector,
        scrollTop,
        scrollLeft
      }
    };
    const timer = setTimeout(() => submitScrollRecord(rawTarget, recordedEvent), 160);
    pendingScrollRecords.set(rawTarget, { timer, event: recordedEvent });
  }, true);
  document.addEventListener("mousemove", (event) => {
    if (!inspectionMode || !inspectionOverlay) return;
    const target = event.target;
    if (!(target instanceof Element) || target === inspectionOverlay) return;
    const rect = target.getBoundingClientRect();
    Object.assign(inspectionOverlay.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  }, true);
  document.addEventListener("keydown", (event) => {
    if (inspectionMode && event.key === "Escape") {
      stopInspection();
      sendToBackground({ type: "STOP_ELEMENT_INSPECTION", payload: void 0 }).catch(() => {
      });
    }
  }, true);
  document.addEventListener(
    "click",
    (event) => {
      var _a, _b, _c, _d, _e, _f, _g;
      try {
        if (!replayDispatching && !replayCdpPending && Date.now() >= replaySuppressedUntil) flushPendingScrollRecords();
        const rawTarget = event.target;
        const element = rawTarget instanceof Element ? rawTarget : rawTarget == null ? void 0 : rawTarget.parentElement;
        const target = (element == null ? void 0 : element.closest("button, a, input, select, textarea, option, li, [role], [data-testid]")) || element;
        if (!target || !(target instanceof Element)) return;
        if (inspectionMode || event.altKey) {
          event.preventDefault();
          event.stopImmediatePropagation();
          stopInspection();
          inspectElement(target).catch(() => {
          });
          return;
        }
        if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
        const now = Date.now();
        if (lastLabelForwardClick) {
          const paired = now - lastLabelForwardClick.at <= 150 && (target === lastLabelForwardClick.control || lastLabelForwardClick.control.contains(target));
          lastLabelForwardClick = null;
          if (paired) return;
        }
        flushPendingInputRecords();
        if (typeof target.closest === "function" && target.closest("[data-qa-copilot-root]")) {
          return;
        }
        const label = element == null ? void 0 : element.closest("label");
        const associatedControl = label instanceof HTMLLabelElement ? label.control : null;
        const nestedAction = element == null ? void 0 : element.closest('a, button, [role="button"]');
        if (associatedControl && element && !nestedAction && associatedControl !== element && !associatedControl.contains(element)) {
          lastLabelForwardClick = { control: associatedControl, at: now };
        }
        const { title, description: customDesc, fieldLabel, text, isInput, effectiveTarget } = describeClickElement(target);
        const tag = (effectiveTarget.tagName || "").toUpperCase();
        const selector = getCssSelector(effectiveTarget);
        const description = customDesc || (text ? `点击「${text}」` : `点击 ${selector}`);
        const inDatePicker = Boolean(
          (_a = target.closest) == null ? void 0 : _a.call(
            target,
            '.el-picker__popper, .el-picker-panel, .el-date-picker, .el-date-range-picker, .ant-picker-dropdown, .arco-picker-popup, .n-date-panel, [class*="date-table"], [class*="picker-panel"]'
          )
        );
        let dateFieldLabel = fieldLabel;
        if (inDatePicker && !dateFieldLabel) {
          const activeDateTrigger = document.querySelector(
            '.el-date-editor.is-active, .el-range-editor.is-active, .el-input.is-focus, .ant-picker-focused, .arco-picker-focused, [class*="date"].is-active'
          );
          if (activeDateTrigger) {
            dateFieldLabel = getElementLabel(activeDateTrigger) || void 0;
          }
        }
        sendToBackground({
          type: "RECORD_EVENT",
          payload: {
            event: {
              type: "click",
              timestamp: Date.now(),
              title: title || (text ? `点击 ${text}` : `点击 ${tag}`),
              description,
              url: window.location.href,
              payload: {
                timestamp: Date.now(),
                url: window.location.href,
                tag,
                text,
                id: effectiveTarget.id || void 0,
                name: ((_b = effectiveTarget.getAttribute) == null ? void 0 : _b.call(effectiveTarget, "name")) || void 0,
                role: ((_c = effectiveTarget.getAttribute) == null ? void 0 : _c.call(effectiveTarget, "role")) || void 0,
                testId: ((_d = effectiveTarget.getAttribute) == null ? void 0 : _d.call(effectiveTarget, "data-testid")) || void 0,
                ariaLabel: ((_e = effectiveTarget.getAttribute) == null ? void 0 : _e.call(effectiveTarget, "aria-label")) || void 0,
                title: ((_f = effectiveTarget.getAttribute) == null ? void 0 : _f.call(effectiveTarget, "title")) || void 0,
                fieldLabel: dateFieldLabel || fieldLabel,
                placeholder: ((_g = effectiveTarget.getAttribute) == null ? void 0 : _g.call(effectiveTarget, "placeholder")) || void 0,
                isInput,
                isDatePicker: inDatePicker || void 0,
                selector,
                xpath: getXPath(effectiveTarget),
                x: event.clientX,
                y: event.clientY
              }
            }
          }
        }).catch(() => {
        });
      } catch {
      }
    },
    true
  );
  const inputTimers = /* @__PURE__ */ new Map();
  const composingInputs = /* @__PURE__ */ new WeakSet();
  function flushPendingInputRecord(target) {
    const timer = inputTimers.get(target);
    if (!timer) return;
    clearTimeout(timer);
    inputTimers.delete(target);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) recordFormValue(target);
  }
  function flushPendingInputRecords() {
    for (const target of inputTimers.keys()) flushPendingInputRecord(target);
  }
  function queueInputRecord(target) {
    const previous = inputTimers.get(target);
    if (previous) clearTimeout(previous);
    inputTimers.set(target, setTimeout(() => {
      inputTimers.delete(target);
      recordFormValue(target);
    }, 400));
  }
  function recordFormValue(target) {
    try {
      const fieldLabel = getElementLabel(target);
      const fieldName = fieldLabel || target.getAttribute("placeholder") || target.name || target.id || "输入框";
      const sensitive = target instanceof HTMLInputElement && target.type === "password";
      let rawValue = sensitive ? "*****" : target.value || "";
      let isChecked = void 0;
      let optionValue = void 0;
      if (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")) {
        isChecked = target.checked;
        optionValue = target.value || void 0;
        rawValue = target.checked ? target.value || "已选中" : "未选中";
      }
      const capturedValue = rawValue.length > 200 ? `${rawValue.slice(0, 200)}...[截断]` : rawValue;
      sendFlushableRecord({
        type: "RECORD_EVENT",
        payload: {
          event: {
            type: "input",
            timestamp: Date.now(),
            title: `输入「${fieldName}」`,
            description: `输入「${fieldName}」 = ${capturedValue}`,
            url: window.location.href,
            payload: {
              timestamp: Date.now(),
              url: window.location.href,
              tag: target.tagName.toUpperCase(),
              id: target.id || void 0,
              name: target.name || void 0,
              selector: getCssSelector(target),
              fieldLabel: fieldLabel || void 0,
              fieldName,
              placeholder: target.getAttribute("placeholder") || void 0,
              inputType: target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase(),
              value: rawValue,
              checked: isChecked,
              optionValue,
              sensitive
            }
          }
        }
      });
    } catch {
    }
  }
  document.addEventListener(
    "input",
    (event) => {
      try {
        if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
        if (composingInputs.has(target) || event.isComposing) return;
        queueInputRecord(target);
      } catch {
      }
    },
    true
  );
  document.addEventListener("compositionstart", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    composingInputs.add(target);
    const timer = inputTimers.get(target);
    if (timer) clearTimeout(timer);
    inputTimers.delete(target);
  }, true);
  document.addEventListener("compositionend", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    composingInputs.delete(target);
    if (!replayDispatching && !replayCdpPending && Date.now() >= replaySuppressedUntil) queueInputRecord(target);
  }, true);
  document.addEventListener("change", (event) => {
    if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
    const target = event.target;
    if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")) {
      recordFormValue(target);
    }
  }, true);
  document.addEventListener("blur", (event) => {
    if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    flushPendingInputRecord(target);
  }, true);
  let lastUrl = window.location.href;
  function notifyNavigation(toUrl, type) {
    try {
      if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
      if (toUrl === lastUrl) return;
      flushPendingInputRecords();
      flushPendingScrollRecords();
      const fromUrl = lastUrl;
      lastUrl = toUrl;
      let path = toUrl;
      try {
        path = new URL(toUrl).pathname;
      } catch {
      }
      sendToBackground({
        type: "RECORD_EVENT",
        payload: {
          event: {
            type: "navigation",
            timestamp: Date.now(),
            title: "页面跳转",
            description: `跳转至 ${path}`,
            url: toUrl,
            payload: {
              timestamp: Date.now(),
              url: toUrl,
              fromUrl,
              toUrl,
              pageTitle: document.title || "",
              navigationType: type
            }
          }
        }
      }).catch(() => {
      });
    } catch {
    }
  }
  window.addEventListener("popstate", () => notifyNavigation(window.location.href, "popstate"));
  window.addEventListener("hashchange", () => notifyNavigation(window.location.href, "hashchange"));
  window.addEventListener("pagehide", () => {
    if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
    flushPendingInputRecords();
    flushPendingScrollRecords();
  });
  ["pushState", "replaceState"].forEach((method) => {
    const original = history[method];
    history[method] = function(...args) {
      const result = original.apply(this, args);
      notifyNavigation(window.location.href, method);
      return result;
    };
  });
  window.addEventListener("error", (event) => {
    var _a;
    try {
      sendToBackground({
        type: "RECORD_EVENT",
        payload: {
          event: {
            type: "error",
            timestamp: Date.now(),
            title: "JS 运行时异常",
            description: event.message || "未知错误",
            url: window.location.href,
            payload: {
              timestamp: Date.now(),
              url: window.location.href,
              message: event.message || "",
              filename: event.filename,
              lineno: event.lineno,
              colno: event.colno,
              stack: (_a = event.error) == null ? void 0 : _a.stack
            }
          }
        }
      }).catch(() => {
      });
    } catch {
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    var _a, _b, _c;
    try {
      sendToBackground({
        type: "RECORD_EVENT",
        payload: {
          event: {
            type: "error",
            timestamp: Date.now(),
            title: "Promise 未处理异常",
            description: String(((_a = event.reason) == null ? void 0 : _a.message) || event.reason || "Unhandled Promise Rejection"),
            url: window.location.href,
            payload: {
              timestamp: Date.now(),
              url: window.location.href,
              message: String(((_b = event.reason) == null ? void 0 : _b.message) || event.reason || ""),
              stack: (_c = event.reason) == null ? void 0 : _c.stack
            }
          }
        }
      }).catch(() => {
      });
    } catch {
    }
  });
  exports.collectAiObservation = collectAiObservation;
  exports.detectCurrentUserFromPage = detectCurrentUserFromPage;
  exports.findClickTarget = findClickTarget;
  exports.findScrollTarget = findScrollTarget;
  exports.isDatePickerEvent = isDatePickerEvent;
  exports.replayAction = replayAction;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
