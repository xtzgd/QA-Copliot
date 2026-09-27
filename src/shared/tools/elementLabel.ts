/**
 * 表单控件与 DOM 元素的人类可读标签 (Label) 智能提取工具
 * 支持原生 label、Element UI/Plus、Ant Design、Arco、Naive UI 等常见表单容器与兄弟节点识别
 */

function isDomElement(el: any): boolean {
  if (!el || typeof el !== 'object') return false;
  if (typeof Element !== 'undefined') {
    return el instanceof Element;
  }
  return typeof el.tagName === 'string';
}

function isInputLike(el: any): boolean {
  if (!isDomElement(el)) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function safeEscapeCss(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/["\\]/g, '\\$&');
}

/**
 * 清洗提取出的 Label 文本：移除首尾冒号、必填红星、修饰符号及多余空格
 */
export function cleanLabelText(text: string): string {
  return text
    .replace(/^[\s*：:·•\-—]+/, '')
    .replace(/[\s*：:·•\-—]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 智能剥离表单提示词中的动作前缀（如“请选择/输入”、“请选择”、“请输入”），提炼核心字段名词
 * 例如: "请选择所属部门" -> "所属部门"; "请输入经办人姓名" -> "经办人姓名"; "请选择" -> ""
 */
export function stripActionPrefix(text: string): string {
  if (!text) return '';
  let s = cleanLabelText(text);

  // 移除常见前缀
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
    /^input\s*/i,
  ];

  for (const re of prefixes) {
    if (re.test(s)) {
      s = s.replace(re, '').trim();
      break;
    }
  }

  // 清洗剥离后可能残余的标点
  s = cleanLabelText(s);

  // 若剥离后只剩下纯符号或占位字符（如 "--"、"..."、"暂无"、"请选择"），视为空
  if (
    !s ||
    s === '请选择' ||
    s === '选择' ||
    s === '请输入' ||
    s === '输入' ||
    s === '搜索' ||
    s === '--' ||
    s === '---' ||
    s === '暂无' ||
    s.toLowerCase() === 'select' ||
    s.toLowerCase() === 'choose'
  ) {
    return '';
  }

  return s;
}

/**
 * 常见表单字段英文名到中文友好名称的语义字典映射
 */
const COMMON_FIELD_SEMANTICS: Record<string, string> = {
  name: '姓名',
  username: '用户名',
  user: '用户',
  nickname: '昵称',
  realname: '真实姓名',
  account: '账号',
  password: '密码',
  pwd: '密码',
  email: '电子邮箱',
  mail: '邮箱',
  phone: '手机号码',
  mobile: '手机号',
  tel: '联系电话',
  telephone: '电话',
  role: '角色',
  roleid: '角色',
  roles: '角色',
  dept: '所属部门',
  deptid: '所属部门',
  department: '所属部门',
  departmentid: '所属部门',
  company: '所属公司',
  corp: '企业名称',
  org: '所属组织',
  organization: '所属机构',
  gender: '性别',
  sex: '性别',
  age: '年龄',
  birthday: '出生日期',
  birth: '出生日期',
  status: '状态',
  state: '状态',
  type: '类型',
  category: '分类',
  class: '类别',
  level: '级别',
  grade: '等级',
  title: '标题',
  subject: '主题',
  desc: '描述',
  description: '详细描述',
  remark: '备注',
  content: '内容',
  address: '地址',
  addr: '地址',
  city: '城市',
  province: '省份',
  area: '地区',
  region: '区域',
  country: '国家',
  date: '日期',
  time: '时间',
  createdat: '创建时间',
  amount: '金额',
  price: '价格',
  money: '费用',
  code: '编码',
  orderno: '订单编号',
  idcard: '身份证号',
  postcode: '邮政编码',
  zipcode: '邮编',
};

/**
 * 查找与当前点击/交互元素直接关联的真实输入控件（Input / Textarea / Select）
 */
export function findAssociatedInput(el: Element | any): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | any {
  if (!isDomElement(el)) return null;

  if (isInputLike(el)) {
    return el;
  }

  // 1. 向下查找子树中包含的真实输入控件（仅当 el 确为输入框包装容器时，防止误匹配整个导航/卡片/表单）
  try {
    const isWrapper = Boolean(
      (el.className && typeof el.className === 'string' && /input[-_]?wrapper|input[-_]?affix|select[-_]?wrapper|el-input|ant-input|n-input|arco-input|el-select|ant-select|n-select|arco-select/i.test(el.className)) ||
      (typeof el.matches === 'function' && el.matches('.el-input, .el-input__wrapper, .el-textarea, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, .el-select, .ant-select, .arco-select, .n-select, [class*="input-wrapper"], [class*="select-trigger"], [class*="select__wrapper"], [class*="select-selector"]'))
    );
    if (isWrapper && typeof el.querySelector === 'function') {
      const inside = el.querySelector(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
      );
      if (inside) return inside;
    }
  } catch {}

  // 2. 向上在最近的常见输入框或下拉框包装容器中查找真实输入框
  try {
    if (typeof el.closest === 'function') {
      const wrapper = el.closest(
        '.el-input, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, .el-select, .ant-select, .arco-select, .n-select, [class*="input-wrapper"], [class*="select-trigger"], [class*="select__wrapper"]'
      );
      if (wrapper && wrapper !== el && typeof wrapper.querySelector === 'function') {
        const input = wrapper.querySelector(
          'input:not([type="hidden"]), textarea, select'
        );
        if (input) return input;
      }
    }
  } catch {}

  return null;
}

/**
 * 获取当前控件的最外层已知组件包装层（如 .el-select, .ant-select, .form-item 等）
 */
function findComponentWrapper(el: Element | any): Element | any {
  if (!isDomElement(el)) return el;
  try {
    if (typeof el.closest === 'function') {
      const wrapper = el.closest(
        '.el-select, .el-select-v2, .el-cascader, .el-tree-select, .ant-select, .ant-cascader, .ant-tree-select, .arco-select, .arco-cascader, .arco-tree-select, .n-select, .n-base-selection, .t-select, .semi-select, .ivu-select, .layui-form-select, .v-select, .custom-select, [class*="select-container"], [class*="selectBox"], [class*="select-box"], [class*="dropdown-select"]'
      );
      if (wrapper) return wrapper;
    }
  } catch {}
  return el;
}
/**
 * 借鉴 Midscene 的视觉空间几何就近原则 (Visual Spatial Proximity)
 * 摆脱对脆弱 DOM 层级结构的死板依赖，直接基于屏幕物理渲染坐标查找控件正左侧或正上方最近的人类可读标签
 */
export function getVisualSpatialLabel(el: Element | any, searchContainer?: Element | Document): string {
  if (!isDomElement(el)) return '';
  if (typeof el.getBoundingClientRect !== 'function') return '';

  let targetRect = el.getBoundingClientRect();
  // 若当前元素尺寸为 0，向上尝试查找其组件包装容器
  if ((!targetRect || targetRect.width <= 0 || targetRect.height <= 0) && typeof el.closest === 'function') {
    const parentComp = el.closest('.el-select, .ant-select, .vue-treeselect, .el-radio-group, .el-input, .el-textarea');
    if (parentComp && typeof parentComp.getBoundingClientRect === 'function') {
      targetRect = parentComp.getBoundingClientRect();
    }
  }

  // 必须是具备真实屏幕渲染尺寸的可见元素
  if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) return '';

  // 确定搜索范围容器（优先限定在同一弹窗或表单内部，避免跨容器误匹配背景无关文本）
  const container = (searchContainer && typeof searchContainer.querySelectorAll === 'function')
    ? searchContainer
    : (typeof el.closest === 'function' ? el.closest('.el-dialog, .el-drawer, .ant-modal, .arco-modal, form, .el-form, .ant-form, [class*="row"], [class*="form"], body') : null) ||
      (el.parentElement && typeof el.parentElement.querySelectorAll === 'function' ? el.parentElement : null) ||
      (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function' ? document : null);

  if (!container || typeof container.querySelectorAll !== 'function') return '';

  const targetCenterY = targetRect.top + targetRect.height / 2;
  const targetLeft = targetRect.left;
  const targetTop = targetRect.top;

  // 查询容器内所有潜在的文本/标签承载节点
  const candidates = Array.from(
    container.querySelectorAll('label, .el-form-item__label, .ant-form-item-label, .arco-form-item-label, [class*="label"], [class*="title"], dt, th, span, div, p')
  ) as HTMLElement[];

  let bestMatchText = '';
  let bestScore = Infinity;

  for (const cand of candidates) {
    if (!cand || cand === el) continue;
    if (cand.closest?.('.el-message, .el-notification, .ant-message, .ant-notification, [role="alert"], [role="status"], [class*="toast"]')) continue;
    // 排除包含目标控件本身的容器，或者在目标控件内部的子节点
    if ((typeof cand.contains === 'function' && cand.contains(el)) || (typeof el.contains === 'function' && el.contains(cand))) continue;
    // 排除内部包含输入控件的复杂包装容器（避免把别的输入框整块当标签）
    if (cand.querySelector?.('input, select, textarea, [role="combobox"]')) continue;

    // 排除单选框、复选框自身的选项文本标签及其容器
    if (cand.closest?.('.el-radio, .ant-radio, .arco-radio, .n-radio, .el-checkbox, .ant-checkbox, .el-radio-group, .ant-radio-group, [role="radiogroup"]')) continue;

    const candRect = typeof cand.getBoundingClientRect === 'function' ? cand.getBoundingClientRect() : null;
    if (!candRect || candRect.width <= 0 || candRect.height <= 0) continue;

    const candCenterY = candRect.top + candRect.height / 2;
    const candRight = candRect.right;
    const candBottom = candRect.bottom;

    const text = (cand.innerText || cand.textContent || '').trim();
    if (!text || text.length > 30 || text.includes('\n')) continue;
    const cleaned = cleanLabelText(text);
    if (!cleaned) continue;

    // 1. 水平左侧就近 (Horizontal Left Proximity): 常见横向排列表单（如若依/Element默认布局）
    // 标签在控件正左侧，且在同一水平行（垂直中心对齐）
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

    // 2. 垂直上方就近 (Vertical Top Proximity): 常见竖向排列表单
    // 如果没有找到更优的左侧标签，考虑正上方的标签
    const isAbove = candBottom <= targetTop + 10 && candBottom >= targetTop - 90;
    const isHorizAligned = Math.abs((candRect.left + candRect.width / 2) - (targetLeft + targetRect.width / 2)) <= Math.max(targetRect.width, 120);

    if (isAbove && isHorizAligned) {
      const verticalDist = Math.max(0, targetTop - candBottom);
      const horizontalOffset = Math.abs((candRect.left + candRect.width / 2) - (targetLeft + targetRect.width / 2));
      const score = verticalDist * 1.5 + horizontalOffset + 50; // 加权重，优先左侧对齐

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
  return '';
}

/**
 * 智能提取控件人类可读的字段名称 (Label / Field Title)
 * 全面支持原生 label、Midscene 视觉空间几何就近定位、Element Plus / AntD / Arco 组件库容器及占位符提炼
 */
export function getElementLabel(el: Element | any): string {
  if (!isDomElement(el)) return '';

  const targetInput = isInputLike(el) ? el : (findAssociatedInput(el) || el);
  const componentWrapper = findComponentWrapper(el);

  // 0. 优先：Midscene 视觉空间几何就近识别 (Visual Spatial Proximity)
  const spatialLabel = getVisualSpatialLabel(componentWrapper || targetInput);
  if (spatialLabel && spatialLabel !== '未命名字段') {
    return spatialLabel;
  }

  let rawCandidate = '';

  // 1. 原生 HTML labels 属性
  if (targetInput.labels && targetInput.labels.length > 0) {
    rawCandidate = targetInput.labels[0].textContent || '';
  }

  // 2. 原生 label[for="id"]（同时检查 targetInput 与 componentWrapper 的 id）
  if (!rawCandidate && typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    try {
      const idToFind = targetInput.id || (componentWrapper !== targetInput ? componentWrapper.id : null);
      if (idToFind) {
        const forLabel = document.querySelector(`label[for="${safeEscapeCss(idToFind)}"]`);
        if (forLabel) rawCandidate = forLabel.textContent || '';
      }
    } catch {}
  }

  // 3. 祖先为 <label> 标签（如 <label>所属角色 <div class="el-select">...</div></label>）
  if (!rawCandidate) {
    try {
      const parentLabel = (typeof componentWrapper.closest === 'function' ? componentWrapper.closest('label') : null) ||
        (typeof targetInput.closest === 'function' ? targetInput.closest('label') : null);
      if (parentLabel) {
        // 关键防护：如果 parentLabel 是单选框组件内部的选项包装层（如 .el-radio, .ant-radio），
        // 且处于更大的表单项容器中（如 .el-form-item），它代表的是选项值（如“正常”、“停用”），不能当作字段标题！
        const isRadioOptionWrapper = targetInput.type === 'radio' && Boolean(
          parentLabel.classList?.contains?.('el-radio') ||
          parentLabel.classList?.contains?.('ant-radio') ||
          parentLabel.classList?.contains?.('arco-radio') ||
          parentLabel.classList?.contains?.('n-radio') ||
          parentLabel.closest?.('.el-form-item, .ant-form-item, .arco-form-item, [role="radiogroup"]')
        );
        if (!isRadioOptionWrapper) {
          let labelText = parentLabel.textContent || '';
          if (targetInput.value) {
            labelText = labelText.replace(String(targetInput.value), '');
          }
          rawCandidate = labelText;
        }
      }
    } catch {}
  }

  // 4. 现代 UI 库表单项容器（Element Plus, Ant Design, Arco, Naive, Bootstrap, Layui 等）
  if (!rawCandidate) {
    try {
      const formItemSelector = [
        '.el-form-item',
        '.ant-form-item',
        '.arco-form-item',
        '.n-form-item',
        '.t-form-item',
        '.semi-form-item',
        '.ivu-form-item',
        '.layui-form-item',
        '.form-group',
        '.form-item',
        '.form-row',
        '.form-line',
        '.field-row',
        '.field-item',
        '[class*="form-item"]',
        '[class*="formItem"]',
        '[class*="form-group"]',
        'fieldset',
      ].join(', ');

      const formItem = (typeof componentWrapper.closest === 'function' ? componentWrapper.closest(formItemSelector) : null) ||
        (typeof targetInput.closest === 'function' ? targetInput.closest(formItemSelector) : null);

      if (formItem && typeof formItem.querySelector === 'function') {
        const labelSelector = [
          '.el-form-item__label',
          '.ant-form-item-label',
          '.arco-form-item-label',
          '.n-form-item-label',
          '[class*="form-item__label"]',
          '[class*="form-label"]',
          '[class*="item-label"]',
          '[class*="field-label"]',
          '[class*="field-title"]',
          '[class*="item-title"]',
          'legend',
          'dt',
          'th',
          'label',
        ].join(', ');

        const candidateLabels = (typeof formItem.querySelectorAll === 'function')
          ? Array.from(formItem.querySelectorAll(labelSelector)) as HTMLElement[]
          : (typeof formItem.querySelector === 'function' ? [formItem.querySelector(labelSelector) as HTMLElement].filter(Boolean) : []);
        for (const labelEl of candidateLabels) {
          const isSelf = labelEl === targetInput || labelEl === componentWrapper;
          const containsTarget = typeof labelEl.contains === 'function' && (labelEl.contains(targetInput) || labelEl.contains(componentWrapper));
          const isInsideTarget = (typeof targetInput.contains === 'function' && targetInput.contains(labelEl)) ||
            (typeof componentWrapper.contains === 'function' && componentWrapper.contains(labelEl));
          const isOptionLabel = Boolean(
            labelEl.closest?.(
              '.el-radio, .ant-radio, .arco-radio, .n-radio, .el-checkbox, .ant-checkbox, .el-radio-group, .ant-radio-group, [role="radiogroup"]'
            )
          );

          if (!isSelf && !containsTarget && !isInsideTarget && !isOptionLabel) {
            const txt = (labelEl.textContent || '').trim();
            if (txt) {
              rawCandidate = txt;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // 5. 紧邻的前置兄弟节点（优先从 componentWrapper 的前置兄弟找，其次 targetInput 的前置兄弟）
  if (!rawCandidate) {
    try {
      const probeNodes = [componentWrapper, targetInput];
      for (const node of probeNodes) {
        if (!node) continue;
        const prev = node.previousElementSibling || (node.parentElement && node.parentElement.children && node.parentElement.children.length === 1 ? node.parentElement.previousElementSibling : null);
        if (prev && typeof prev.tagName === 'string') {
          const tag = prev.tagName.toUpperCase();
          if (['LABEL', 'SPAN', 'DIV', 'P', 'TD', 'TH', 'B', 'STRONG'].includes(tag)) {
            const prevText = (prev.textContent || prev.innerText || '').trim();
            if (prevText && prevText.length <= 35 && !prevText.includes('\n')) {
              rawCandidate = prevText;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // 6. 表格同行前一个单元格（<tr><td>申请角色：</td><td><div class="el-select">...</div></td></tr>）
  if (!rawCandidate) {
    try {
      const td = (typeof componentWrapper.closest === 'function' ? componentWrapper.closest('td') : null) ||
        (typeof targetInput.closest === 'function' ? targetInput.closest('td') : null);
      if (td && td.previousElementSibling) {
        const prevTdText = (td.previousElementSibling.textContent || td.previousElementSibling.innerText || '').trim();
        if (prevTdText && prevTdText.length <= 35) {
          rawCandidate = prevTdText;
        }
      }
    } catch {}
  }

  // 7. ARIA 属性: aria-labelledby / aria-label / title
  if (!rawCandidate) {
    const probeNodes = [componentWrapper, targetInput];
    for (const node of probeNodes) {
      if (!node || typeof node.getAttribute !== 'function') continue;
      const labelledby = node.getAttribute('aria-labelledby');
      if (labelledby && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        try {
          const refEl = document.getElementById(labelledby);
          if (refEl && refEl.textContent) {
            rawCandidate = refEl.textContent.trim();
            break;
          }
        } catch {}
      }
      const ariaLabel = node.getAttribute('aria-label');
      if (ariaLabel) {
        rawCandidate = ariaLabel.trim();
        break;
      }
      const titleAttr = node.getAttribute('title');
      if (titleAttr) {
        rawCandidate = titleAttr.trim();
        break;
      }
    }
  }

  // 8. 占位符提取与智能剥离 (Placeholder Stripping)
  // 当页面没有独立 label 时，从“请选择所属角色”、“请输入手机号”中提取核心名词
  let strippedPlaceholder = '';
  try {
    let ph = targetInput.placeholder ||
      (typeof targetInput.getAttribute === 'function' ? targetInput.getAttribute('placeholder') : '') ||
      (typeof componentWrapper.getAttribute === 'function' ? componentWrapper.getAttribute('placeholder') : '') ||
      '';

    if (!ph && typeof componentWrapper.querySelector === 'function') {
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
  } catch {}

  // 综合判定有效 Label
  const cleanedRaw = cleanLabelText(rawCandidate);
  if (cleanedRaw && cleanedRaw.length <= 40) {
    // 若 rawCandidate 也是诸如“请选择所属部门”，进一步提炼
    const stripped = stripActionPrefix(cleanedRaw);
    return stripped || cleanedRaw;
  }

  // 若无外部 label，使用从 placeholder 提炼出的核心名词
  if (strippedPlaceholder && strippedPlaceholder.length <= 40) {
    return strippedPlaceholder;
  }

  // 若仍为空，且原始 placeholder 本身是友好的非动词词组（如“搜索你喜欢的商品...”）
  const fallbackPh = targetInput.placeholder || (typeof componentWrapper.getAttribute === 'function' ? componentWrapper.getAttribute('placeholder') : '');
  if (fallbackPh && !fallbackPh.startsWith('请选择') && !fallbackPh.startsWith('请输入') && fallbackPh !== '请选择') {
    const cleanedPh = cleanLabelText(fallbackPh);
    if (cleanedPh && cleanedPh.length <= 40) {
      return cleanedPh;
    }
  }

  // 9. 语义性 name 属性回退（如 name="department" -> "所属部门", name="roleId" -> "角色"）
  const rawName = targetInput.name || (typeof componentWrapper.getAttribute === 'function' ? componentWrapper.getAttribute('name') : '');
  if (rawName && typeof rawName === 'string') {
    const cleanKey = rawName.toLowerCase().replace(/[-_]/g, '');
    if (COMMON_FIELD_SEMANTICS[cleanKey]) {
      return COMMON_FIELD_SEMANTICS[cleanKey];
    }
    // 过滤随机生成的无意义 name/id
    if (!/^(el-id|ant-select|rc_select|form_|input_|\d+)/i.test(rawName)) {
      return rawName.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim();
    }
  }

  return '';
}

/**
 * 针对点击交互生成清晰直观的人类可读标题与步骤说明
 */
export function describeClickElement(target: Element | any): {
  title: string;
  description: string;
  fieldLabel?: string;
  text: string;
  isInput: boolean;
  effectiveTarget: Element | any;
} {
  const associatedInput = findAssociatedInput(target);
  const effectiveTarget = associatedInput || target;
  const tag = (effectiveTarget.tagName || '').toUpperCase();

  const isInput = Boolean(
    associatedInput ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) ||
    effectiveTarget.getAttribute?.('contenteditable') === 'true' ||
    ['textbox', 'combobox', 'searchbox'].includes(effectiveTarget.getAttribute?.('role') || '')
  );

  const fieldLabel = getElementLabel(effectiveTarget);

  const rawText = (
    effectiveTarget.innerText ||
    effectiveTarget.textContent ||
    effectiveTarget.getAttribute?.('aria-label') ||
    effectiveTarget.getAttribute?.('title') ||
    ''
  ).trim();

  // 若为非输入控件且包含多行文本（如点击了带子项的菜单节点/卡片），提取首行作为主标题
  let text = rawText;
  if (!isInput && rawText.includes('\n')) {
    const firstLine = rawText.split('\n').map((l: string) => l.trim()).filter(Boolean)[0];
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

  let title = '';
  let description = '';

  if (isInput && fieldLabel) {
    const isSelect = tag === 'SELECT' || effectiveTarget.getAttribute?.('role') === 'combobox';
    title = `点击「${fieldLabel}」`;
    description = isSelect ? `点击「${fieldLabel}」下拉选择框` : `点击「${fieldLabel}」输入框`;
  } else if (text) {
    title = `点击 ${text}`;
    description = `点击「${text}」`;
  } else {
    title = `点击 ${tag}`;
    description = ''; // 由外部使用 CSS Selector 兜底
  }

  return {
    title,
    description,
    fieldLabel: fieldLabel || undefined,
    text,
    isInput,
    effectiveTarget,
  };
}
