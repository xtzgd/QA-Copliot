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
      (el.className && typeof el.className === 'string' && /input[-_]?wrapper|input[-_]?affix|el-input|ant-input|n-input|arco-input/i.test(el.className)) ||
      (typeof el.matches === 'function' && el.matches('.el-input, .el-input__wrapper, .el-textarea, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, [class*="input-wrapper"], [class*="InputWrapper"], [class*="input-affix"]'))
    );
    if (isWrapper && typeof el.querySelector === 'function') {
      const inside = el.querySelector(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
      );
      if (inside) return inside;
    }
  } catch {}

  // 2. 向上在最近的常见输入框包装容器中查找真实输入框
  try {
    if (typeof el.closest === 'function') {
      const wrapper = el.closest(
        '.el-input, .ant-input-affix-wrapper, .ant-input-wrapper, .arco-input-wrapper, .n-input, [class*="input-wrapper"], [class*="InputWrapper"], [class*="input-affix"]'
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
 * 智能提取控件人类可读的字段名称 (Label / Field Title)
 */
export function getElementLabel(el: Element | any): string {
  if (!isDomElement(el)) return '';

  const input = findAssociatedInput(el) || el;
  let label = '';

  // 1. 原生 HTML labels 属性
  if (input.labels && input.labels.length > 0) {
    label = input.labels[0].textContent || '';
  }

  // 2. 原生 label[for="id"]
  if (!label && input.id && typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    try {
      const forLabel = document.querySelector(`label[for="${safeEscapeCss(input.id)}"]`);
      if (forLabel) label = forLabel.textContent || '';
    } catch {}
  }

  // 3. 祖先为 <label> 标签
  if (!label && typeof input.closest === 'function') {
    try {
      const parentLabel = input.closest('label');
      if (parentLabel) {
        label = parentLabel.textContent || '';
        if (input.value) {
          label = label.replace(String(input.value), '');
        }
      }
    } catch {}
  }

  // 4. 现代 UI 库表单项容器（Element Plus, Ant Design, Arco, Naive, Bootstrap 等）
  if (!label && typeof input.closest === 'function') {
    try {
      const formItem = input.closest(
        '.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, .form-group, .form-item, .form-row, [class*="form-item"], [class*="formItem"], tr, fieldset'
      );
      if (formItem && typeof formItem.querySelector === 'function') {
        const labelEl = formItem.querySelector(
          'label, .el-form-item__label, .ant-form-item-label, .arco-form-item-label, [class*="label"], [class*="Label"], dt, th'
        );
        if (labelEl && (typeof labelEl.contains !== 'function' || !labelEl.contains(input))) {
          label = labelEl.textContent || '';
        }
      }
    } catch {}
  }

  // 5. 紧邻的前置兄弟节点（如 <span>手机号:</span> <input />）
  if (!label) {
    try {
      const prev = (input.parentElement && input.parentElement.children && input.parentElement.children.length > 1)
        ? (input.previousElementSibling || input.parentElement.previousElementSibling)
        : input.previousElementSibling;
      if (prev && typeof prev.tagName === 'string' && ['LABEL', 'SPAN', 'DIV', 'P', 'TD', 'TH'].includes(prev.tagName.toUpperCase())) {
        const prevText = (prev.textContent || prev.innerText || '').trim();
        if (prevText && prevText.length <= 30 && !prevText.includes('\n')) {
          label = prevText;
        }
      }
    } catch {}
  }

  // 6. 表格同行前一个单元格（<tr><td>手机号</td><td><input /></td></tr>）
  if (!label && typeof input.closest === 'function') {
    try {
      const td = input.closest('td');
      if (td && td.previousElementSibling) {
        const prevTdText = (td.previousElementSibling.textContent || td.previousElementSibling.innerText || '').trim();
        if (prevTdText && prevTdText.length <= 30) {
          label = prevTdText;
        }
      }
    } catch {}
  }

  // 7. ARIA 属性: aria-labelledby
  if (!label && typeof input.getAttribute === 'function') {
    const labelledby = input.getAttribute('aria-labelledby');
    if (labelledby && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      try {
        const refEl = document.getElementById(labelledby);
        if (refEl) label = refEl.textContent || '';
      } catch {}
    }
  }

  // 8. ARIA 属性: aria-label
  if (!label && typeof input.getAttribute === 'function') {
    label = input.getAttribute('aria-label') || '';
  }

  // 9. placeholder 占位符
  if (!label && input.placeholder) {
    label = input.placeholder;
  }

  // 10. title 属性
  if (!label && typeof input.getAttribute === 'function') {
    label = input.getAttribute('title') || '';
  }

  const cleaned = cleanLabelText(label);
  if (cleaned && cleaned.length <= 40) {
    return cleaned;
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
