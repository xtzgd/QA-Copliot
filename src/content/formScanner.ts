/**
 * AI 智能填表 DOM 分析与表单快照扫描器 (QA-011, QA-023)
 * 支持顶层弹窗范围智能锁定、现代 UI 库下拉框 (Element Plus/AntD) 识别与 Radio 单选组聚合
 */

import {
  FormFieldItem,
  FormFieldKind,
  FormFieldOption,
  FormInfo,
  FormSnapshot,
} from '../shared/types/formFill';
import { cleanLabelText, getElementLabel, getVisualSpatialLabel, stripActionPrefix } from '../shared/tools/elementLabel';

// 维护快照字段到真实 DOM 节点的映射
export class FormDOMRegistry {
  private static registry = new Map<
    string,
    {
      element: HTMLElement;
      snapshotId: string;
      optionElements?: Map<string, HTMLElement>;
    }
  >();

  static register(
    fieldId: string,
    element: HTMLElement,
    snapshotId: string,
    optionElements?: Map<string, HTMLElement>
  ) {
    this.registry.set(fieldId, { element, snapshotId, optionElements });
  }

  static get(fieldId: string, expectedSnapshotId?: string): HTMLElement | null {
    const item = this.registry.get(fieldId);
    if (!item) return null;
    if (expectedSnapshotId && item.snapshotId !== expectedSnapshotId) return null;
    if (typeof document !== 'undefined' && document.contains && !document.contains(item.element)) return null;
    return item.element;
  }

  static getOptionElement(fieldId: string, valOrLabel: string, expectedSnapshotId?: string): HTMLElement | null {
    const item = this.registry.get(fieldId);
    if (!item || !item.optionElements) return null;
    if (expectedSnapshotId && item.snapshotId !== expectedSnapshotId) return null;
    return item.optionElements.get(valOrLabel) || null;
  }

  static readRadioGroupValue(element: HTMLElement): string | undefined {
    const entry = [...this.registry.values()].find(item => item.element === element && item.optionElements);
    if (!entry) return undefined;
    for (const [label, node] of entry.optionElements!) {
      const radio = (node.tagName === 'INPUT' ? node : node.querySelector?.('input[type="radio"]')) as HTMLInputElement | null;
      if (radio?.checked) return label;
    }
    return '';
  }

  static clearSnapshot(snapshotId: string) {
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

export class FormScanner {
  /**
   * 元素可见性检测：增强支持被 Element Plus/AntD 隐藏原生 input 的 Radio/Checkbox
   */
  private static isVisible(element: HTMLElement): boolean {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const computed = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(node) : node.style;
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true' || computed?.display === 'none' || computed?.visibility === 'hidden') return false;
    }
    const rect = element.getBoundingClientRect();
    const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(element) : (element.style as any);
    if (style?.display === 'none' || style?.visibility === 'hidden') {
      return false;
    }

    const hasSize =
      (rect.width > 0 && rect.height > 0) ||
      element.offsetParent !== null ||
      (element.getClientRects && element.getClientRects().length > 0);
    if (hasSize) return true;

    // 针对被组件库隐藏的原生 radio / checkbox（如 opacity: 0，宽高设为 0）
    if ((element as any).type === 'radio' || (element as any).type === 'checkbox') {
      const parentWrapper = (element.parentElement?.closest('label, .el-radio, .ant-radio, .el-checkbox, .ant-checkbox') || element.closest('label, .el-radio, .ant-radio, .el-checkbox, .ant-checkbox')) as HTMLElement | null;
      if (parentWrapper) {
        const parentRect = typeof parentWrapper.getBoundingClientRect === 'function' ? parentWrapper.getBoundingClientRect() : null;
        return Boolean(
          (parentRect && parentRect.width > 0 && parentRect.height > 0) ||
          parentWrapper.offsetParent !== null ||
          parentWrapper.style?.display !== 'none'
        );
      }
    }

    return false;
  }

  private static isElementNode(node: any): boolean {
    if (!node) return false;
    if (typeof HTMLElement !== 'undefined' && node instanceof HTMLElement) return true;
    return Boolean(node.tagName || node.nodeType === 1);
  }

  /**
   * 优先探测当前页面顶层可见弹窗/抽屉/模态框范围 (消除背景无关表单干扰)
   */
  private static findTopmostActiveScope(root: Document): { scopeElement: HTMLElement; formTitle: string; formId: string } | null {
    if (!root || typeof root.querySelectorAll !== 'function') return null;

    const dialogSelectors = [
      '.el-dialog',
      '.el-drawer',
      '.ant-modal',
      '.ant-modal-content',
      '.ant-drawer',
      '.arco-modal',
      '.n-modal',
      '[role="dialog"]',
      'dialog[open]',
    ];

    const candidates: HTMLElement[] = [];
    for (const sel of dialogSelectors) {
      try {
        const list = Array.from(root.querySelectorAll(sel));
        for (const item of list) {
          if (this.isElementNode(item)) {
            const role = (item as any).getAttribute?.('role');
            if (role === 'combobox' || role === 'listbox' || role === 'option') {
              continue;
            }
            if (typeof (item as any).querySelectorAll !== 'function') {
              continue;
            }
            if (this.isVisible(item as HTMLElement)) {
              candidates.push(item as HTMLElement);
            }
          }
        }
      } catch {}
    }

    if (candidates.length === 0) return null;

    // 选择最后一个（DOM 树最靠后、通常 z-index 最高的顶层弹窗）
    const unique = [...new Set(candidates)];
    const stack = (node: HTMLElement): number[] => {
      const levels: number[] = [];
      for (let current: HTMLElement | null = node; current; current = current.parentElement) {
        const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(current) : current.style;
        const z = Number.parseInt(style?.zIndex || '', 10);
        if (Number.isFinite(z)) levels.unshift(z);
      }
      return levels;
    };
    unique.sort((a, b) => {
      const left = stack(a), right = stack(b);
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const delta = (left[i] || 0) - (right[i] || 0);
        if (delta) return delta;
      }
      const position = a.compareDocumentPosition?.(b) || 0;
      return position & 4 ? -1 : position & 2 ? 1 : 0;
    });
    const topDialog = unique[unique.length - 1];

    let formTitle = '';
    const titleEl = (topDialog && typeof (topDialog as any).querySelector === 'function')
      ? (topDialog as any).querySelector(
          '.el-dialog__title, .ant-modal-title, .arco-modal-title, [class*="dialog__title"], [class*="modal-title"], [class*="modal__title"], [class*="drawer__title"], [role="heading"], h1, h2, h3'
        )
      : null;
    if (titleEl && titleEl.textContent) {
      formTitle = titleEl.textContent.trim();
    }
    if (!formTitle) {
      formTitle = (topDialog as any).getAttribute?.('aria-label') || '顶层弹窗表单';
    }

    const formId = topDialog.id || 'active_dialog_form';
    return {
      scopeElement: topDialog,
      formTitle,
      formId,
    };
  }

  /**
   * 查找元素所属的最外层现代 UI 下拉组件根容器 (Select Component Root)
   */
  public static findDropdownRoot(element: HTMLElement): HTMLElement | null {
    if (!element || typeof element.closest !== 'function') return null;

    const rootSelectors = [
      '.el-select',
      '.el-select-v2',
      '.el-cascader',
      '.el-tree-select',
      '.ant-select',
      '.ant-cascader',
      '.ant-tree-select',
      '.arco-select',
      '.arco-cascader',
      '.arco-tree-select',
      '.n-select',
      '.n-base-selection',
      '.n-tree-select',
      '.n-cascader',
      '.t-select',
      '.t-cascader',
      '.t-tree-select',
      '.semi-select',
      '.semi-tree-select',
      '.semi-cascader',
      '.ivu-select',
      '.ivu-cascader',
      '.layui-form-select',
      '.v-select',
      '.custom-select',
      '.selectpicker',
      '.bootstrap-select',
      '.vue-treeselect',
      '.select2',
      '[class*="treeselect"]',
      '[class*="cascader"]',
      '[class*="dropdown-select"]',
      '[class*="select-container"]',
      '[class*="selectBox"]',
      '[class*="select-box"]',
    ].join(', ');

    const matched = element.closest?.(rootSelectors) as HTMLElement | null;
    if (!matched) return null;

    // 向上探测是否存在更高层级的统一组件根容器（例如 .el-select__wrapper 处于 .el-select 内部）
    const outer = matched.parentElement?.closest?.(rootSelectors) as HTMLElement | null;
    return outer || matched;
  }

  /**
   * 判断元素是否属于下拉框 (原生 Select / 组件库自定义下拉 / 启发式模拟下拉框)
   * 彻底避免下拉框被误识别为 text 文本框
   */
  public static isDropdownComponent(element: HTMLElement, dropdownRoot?: HTMLElement | null): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === 'select') return true;

    // 排除单选和多选框
    const input = element as HTMLInputElement;
    if (input.type === 'radio' || input.type === 'checkbox') return false;

    // 1. 存在已识别的组件库下拉根容器
    if (dropdownRoot) return true;

    // 2. 如果是纯非表单标签（如 div / span），必须处于组件库下拉根容器内，否则由独立 ARIA 分支处理
    if (tag !== 'input') {
      return false;
    }

    // 3. 针对 input 标签的启发式下拉特征嗅探（彻底避免各类可搜索下拉、只读下拉被误识别为普通 text）
    const role = element.getAttribute?.('role');
    if (role === 'combobox') return true;
    const ariaHasPopup = element.getAttribute?.('aria-haspopup');
    if (ariaHasPopup === 'listbox' || ariaHasPopup === 'tree' || ariaHasPopup === 'menu' || ariaHasPopup === 'true') {
      return true;
    }

    const isReadOnly = Boolean(input.readOnly || input.hasAttribute?.('readonly') || input.getAttribute?.('aria-readonly') === 'true');
    const placeholder = (input.placeholder || input.getAttribute?.('placeholder') || '').trim();
    const hasSelectPlaceholder = placeholder.includes('请选择') || placeholder.includes('选择') || placeholder.toLowerCase().includes('select') || placeholder.toLowerCase().includes('choose') || placeholder === '--请选择--';

    // 3.1 readonly 且 placeholder 提示选择
    if (isReadOnly && hasSelectPlaceholder) {
      return true;
    }

    // 3.2 即使不包含 readonly，只要 placeholder 明确为“请选择”类引导词
    if (placeholder.startsWith('请选择') || placeholder.startsWith('请挑选') || placeholder === '请选择' || placeholder === '--请选择--') {
      return true;
    }

    // 3.3 检查是否紧邻或包含下拉小三角图标（常见的 caret / arrow-down / down 图标）
    const parent = element.parentElement;
    if (parent) {
      const hasArrowIcon = Boolean(
        parent.querySelector?.(
          '.el-select__caret, .el-icon-arrow-down, .ant-select-arrow, .arco-select-view-icon, .n-base-selection-suffix, [class*="caret"], [class*="arrow-down"], [class*="chevron-down"], [class*="icon-down"], [class*="down-arrow"], svg[data-icon="down"]'
        )
      );
      if (hasArrowIcon && (isReadOnly || hasSelectPlaceholder)) {
        return true;
      }
    }

    // 3.4 检查 Bootstrap / Layui 等 data 属性
    if (
      element.getAttribute?.('data-toggle') === 'dropdown' ||
      element.getAttribute?.('data-bs-toggle') === 'dropdown' ||
      parent?.getAttribute?.('data-toggle') === 'dropdown' ||
      parent?.getAttribute?.('data-bs-toggle') === 'dropdown'
    ) {
      return true;
    }

    // 3.5 检查 class 是否包含下拉相关关键词
    const cls = (element.className || '').toLowerCase();
    if (cls.includes('select__input') || cls.includes('selection-search') || cls.includes('dropdown-input')) {
      return true;
    }

    return false;
  }

  private static getFieldLabel(element: HTMLElement, wrapperOrTrigger?: HTMLElement | null): string {
    const formItem = element.closest?.('.el-form-item, .ant-form-item, .arco-form-item, .n-form-item');
    const explicit = element.getAttribute?.('aria-label') ||
      (element as HTMLInputElement).labels?.[0]?.textContent ||
      formItem?.querySelector?.('.el-form-item__label, .ant-form-item-label, .arco-form-item-label, .n-form-item-label')?.textContent;
    if (explicit?.trim()) return cleanLabelText(explicit);
    // 0. 优先：Midscene 视觉空间几何就近原则 (Visual Spatial Proximity)
    const spatial = getVisualSpatialLabel(wrapperOrTrigger || element);
    if (spatial && spatial !== '未命名字段') return spatial;

    let intelligent = getElementLabel(element);
    if (intelligent && intelligent !== '未命名字段') return intelligent;

    if (wrapperOrTrigger && wrapperOrTrigger !== element) {
      intelligent = getElementLabel(wrapperOrTrigger);
      if (intelligent && intelligent !== '未命名字段') return intelligent;
    }

    const input = (element.tagName.toLowerCase() === 'input' ? element : (wrapperOrTrigger?.querySelector?.('input') || element.querySelector?.('input'))) as HTMLInputElement | null;
    if (input?.placeholder) {
      const stripped = stripActionPrefix(input.placeholder);
      if (stripped) return stripped;
      if (!input.placeholder.includes('请选择') && !input.placeholder.includes('请输入')) {
        return input.placeholder.trim();
      }
    }

    // 检查 wrapper 的 placeholder 属性或占位节点
    if (wrapperOrTrigger) {
      const phEl = wrapperOrTrigger.querySelector?.(
        '.el-select__placeholder, .ant-select-selection-placeholder, .arco-select-view-placeholder, [class*="placeholder"]'
      );
      if (phEl?.textContent) {
        const stripped = stripActionPrefix(phEl.textContent.trim());
        if (stripped) return stripped;
      }
    }

    if (input?.name || input?.id) return input.name || input.id;
    if (element.id) return element.id;
    return '未命名字段';
  }

  private static isCaptchaField(element: HTMLElement): boolean {
    const str = `${element.id || ''} ${(element as HTMLInputElement).name || ''} ${(element as HTMLInputElement).placeholder || ''}`.toLowerCase();
    return str.includes('captcha') || str.includes('verify') || str.includes('验证码');
  }

  static scan(root: Document = document): FormSnapshot {
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const forms: FormInfo[] = [];
    const fields: FormFieldItem[] = [];

    // 1. 优先探测顶层可见弹窗/抽屉（消除背景无关表单干扰）
    const topScope = this.findTopmostActiveScope(root);
    const searchRoot: HTMLElement | Document = (topScope && topScope.scopeElement && typeof (topScope.scopeElement as any).querySelectorAll === 'function')
      ? topScope.scopeElement
      : root;

    const formMap = new Map<HTMLElement | null, string>();
    const defaultFormId = 'default_form';
    let hasDefaultFormFields = false;

    if (topScope) {
      forms.push({
        formId: topScope.formId,
        title: topScope.formTitle,
        fieldCount: 0,
      });
      formMap.set(topScope.scopeElement, topScope.formId);
    } else {
      // 无弹窗时，查找页面中的主要 form 容器
      const domForms = typeof root.querySelectorAll === 'function'
        ? Array.from(root.querySelectorAll('form, .el-form, .ant-form, .arco-form'))
        : [];
      domForms.forEach((formElem, index) => {
        const formId = formElem.id || `form_${index + 1}`;
        formMap.set(formElem as HTMLElement, formId);
        const title =
          formElem.getAttribute('name') ||
          formElem.getAttribute('aria-label') ||
          formElem.id ||
          `表单 ${index + 1}`;
        forms.push({
          formId,
          title,
          fieldCount: 0,
        });
      });
    }

    // 2. 遍历表单控件 (精确包含控件根容器与表单输入，避免深层包装层嵌套重复)
    const selectTriggerSelectors = [
      'input',
      'select',
      'textarea',
      '[role="combobox"]',
      '.el-select',
      '.el-select-v2',
      '.el-cascader',
      '.el-tree-select',
      '.ant-select',
      '.ant-cascader',
      '.ant-tree-select',
      '.arco-select',
      '.arco-cascader',
      '.arco-tree-select',
      '.n-select',
      '.n-base-selection',
      '.n-tree-select',
      '.n-cascader',
      '.t-select',
      '.t-cascader',
      '.t-tree-select',
      '.semi-select',
      '.semi-tree-select',
      '.semi-cascader',
      '.ivu-select',
      '.ivu-cascader',
      '.layui-form-select',
      '.v-select',
      '.custom-select',
      '.selectpicker',
      '.bootstrap-select',
      '.vue-treeselect',
      '.select2',
    ].join(', ');

    const rawElements = (searchRoot && typeof searchRoot.querySelectorAll === 'function')
      ? Array.from(searchRoot.querySelectorAll(selectTriggerSelectors))
      : [];

    const radioInputs: HTMLInputElement[] = [];
    const processedDropdownRoots = new Set<HTMLElement>();

    rawElements.forEach((elem, index) => {
      const element = elem as HTMLElement;
      const tag = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;

      // 忽略隐藏/按钮等非填报控件
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button' || input.type === 'reset') {
        return;
      }

      if (!this.isVisible(element)) {
        return;
      }

      // 下拉框组件探测与根节点归一化排重
      const dropdownRoot = this.findDropdownRoot(element);
      const isDropdown = this.isDropdownComponent(element, dropdownRoot);

      // 下拉框控件排重：同一自定义下拉框的组件根容器与内部子 input 只解析为一个统一的 select 字段
      if (isDropdown && tag !== 'select') {
        const canonicalRoot = dropdownRoot || element;
        if (
          processedDropdownRoots.has(canonicalRoot) ||
          Array.from(processedDropdownRoots).some((root) => root === element || root.contains(element) || element.contains(root))
        ) {
          return;
        }
        processedDropdownRoots.add(canonicalRoot);
      }

      // 单选框暂存，后续统一按组聚合为 Radio Group 字段
      if (input.type === 'radio') {
        radioInputs.push(input);
        return;
      }

      const parentForm = element.closest('form, .el-form, .ant-form, .arco-form');
      const formId = topScope
        ? topScope.formId
        : parentForm
          ? (formMap.get(parentForm as HTMLElement) || defaultFormId)
          : defaultFormId;

      if (formId === defaultFormId) {
        hasDefaultFormFields = true;
      }

      const canonicalWrapper = dropdownRoot || element;
      const innerInput = (tag === 'input' ? element : (canonicalWrapper.querySelector?.('input') || element.querySelector?.('input'))) as HTMLInputElement | null;
      const fieldId = `field_${snapshotId}_${index + 1}_${input.name || input.id || canonicalWrapper.id || tag}`;
      const label = this.getFieldLabel(innerInput || element, canonicalWrapper);
      const sensitive = tag === 'input' && input.type === 'password';
      const disabled = input.disabled || Boolean(input.hasAttribute?.('disabled')) || input.getAttribute?.('aria-disabled') === 'true' || Boolean(canonicalWrapper.hasAttribute?.('disabled'));
      let readOnly = input.readOnly || Boolean(input.hasAttribute?.('readonly')) || input.getAttribute?.('aria-readonly') === 'true';
      const required = input.required || Boolean(input.hasAttribute?.('required')) || input.getAttribute?.('aria-required') === 'true' || Boolean(canonicalWrapper.hasAttribute?.('required'));

      let kind: FormFieldKind = 'text';
      let currentValue: string | number | boolean = input.value ?? '';
      let isEmpty = false;
      let unsupportedReason: string | undefined;
      let options: FormFieldOption[] | undefined;
      let optionsState: FormFieldItem['optionsState'] = 'none';
      let groupName: string | undefined;

      // 检查是否为验证码或文件
      if (input.type === 'file') {
        kind = 'unsupported';
        unsupportedReason = '第一期暂不支持文件上传';
      } else if (this.isCaptchaField(element)) {
        kind = 'unsupported';
        unsupportedReason = '验证码需人工输入';
      } else if (tag !== 'select' && tag !== 'input' && element.getAttribute?.('role') === 'combobox' && !dropdownRoot) {
        kind = 'unsupported';
        unsupportedReason = '自定义 ARIA 控件尚未接入专用点击展开交互适配器';
        optionsState = 'partial';
        currentValue = element.textContent?.trim() || '';
        isEmpty = !currentValue || currentValue.includes('请选择');
      } else if (isDropdown) {
        // 关键增强：全面支持现代 UI 库下拉框 (Element Plus / AntD / 原生 Select / Arco / Naive / 自定义下拉等)
        kind = 'select';
        readOnly = false; // 下拉框内部的 readonly 是为了阻止键盘打字，不代表下拉不可选！豁免只读判定！

        if (tag === 'select') {
          const select = element as HTMLSelectElement;
          optionsState = 'complete';
          options = Array.from(select.options).map((opt, optIdx) => ({
            optionId: opt.id || `opt_${optIdx}_${opt.value}`,
            value: opt.value,
            label: opt.text?.trim() || opt.value,
            disabled: opt.disabled,
          }));
          currentValue = select.value ?? '';
          const selectedText = select.selectedOptions?.[0]?.text?.trim() || '';
          isEmpty = !currentValue || selectedText.includes('请选择') || selectedText.toLowerCase().includes('select') || selectedText === '--请选择--';
        } else {
          // 自定义下拉框（如 .el-select, .ant-select, .arco-select, .n-select 等）
          const selectWrapper = canonicalWrapper;

          const trigger = (
            selectWrapper.querySelector?.('.el-select__wrapper, .select-trigger, .ant-select-selector, .arco-select-view, .n-base-selection, input') ||
            element ||
            selectWrapper
          ) as HTMLElement;

          // 1. 尝试从组件库专门渲染选中项的容器提取当前值
          const selectedItemEl = selectWrapper.querySelector?.(
            '.el-select__selected-item:not(.is-transparent), .el-select__tags-text, .ant-select-selection-item, .ant-select-selection-selected-value, .arco-select-view-value, .n-base-selection-label, .el-select-dropdown__item.is-selected, .vue-treeselect__single-value, [class*="single-value"]'
          );

          const placeholder = innerInput?.placeholder ||
            selectWrapper.getAttribute?.('placeholder') ||
            selectWrapper.querySelector?.('.el-select__placeholder, .ant-select-selection-placeholder, .vue-treeselect__placeholder, [class*="placeholder"]')?.textContent?.trim() ||
            '';

          let displayVal = '';
          if (selectedItemEl && selectedItemEl.textContent?.trim()) {
            displayVal = selectedItemEl.textContent.trim();
          } else if (
            innerInput &&
            innerInput.value &&
            innerInput.value !== placeholder &&
            !innerInput.value.includes('请选择') &&
            !innerInput.classList?.contains?.('vue-treeselect__input') &&
            innerInput.getAttribute?.('role') !== 'searchbox'
          ) {
            displayVal = innerInput.value.trim();
          }
          // 关键防护：绝对严禁将 selectWrapper.textContent 兜底赋给 displayVal！
          // 因为 selectWrapper 内部包含隐藏的全部 option 菜单节点，会导致所有未选的下拉框被误判为“已有值”（如男女未知、董事长项目经理等），从而在仅填空白模式下被全部跳过！

          currentValue = displayVal;
          isEmpty = !displayVal || displayVal === placeholder || displayVal.includes('请选择') || displayVal.toLowerCase().includes('select') || displayVal === '--请选择--';

          // 2. 尝试采集已挂载到 body/组件 上的下拉项（支持 TreeSelect、Cascader 及多种现代组件库）
          const probedOptions = FormScanner.extractDropdownOptionsFromDom(element, selectWrapper, root);
          if (probedOptions.length > 0) {
            options = probedOptions;
            optionsState = 'complete';
          } else {
            optionsState = 'unloaded';
          }

          // 将触发节点和包装层注册到 DOM Registry，确保点击展开时命中有效容器
          FormDOMRegistry.register(fieldId, trigger, snapshotId);
        }
      } else if (tag === 'textarea') {
        kind = 'textarea';
        currentValue = (element as HTMLTextAreaElement).value ?? '';
        isEmpty = typeof currentValue === 'string' && currentValue.trim() === '';
      } else if (input.type === 'checkbox') {
        kind = 'checkbox';
        groupName = input.name || undefined;
        currentValue = input.checked;
        isEmpty = false; // 复选框未勾选为有效状态
      } else if (input.type === 'number' || input.type === 'range') {
        kind = 'number';
        if (input.value === '' || input.value === null || input.value === undefined) {
          currentValue = '';
          isEmpty = true;
        } else {
          currentValue = Number(input.value);
          isEmpty = false;
        }
      } else if (input.type === 'date' || input.type === 'datetime-local' || input.type === 'time' || input.type === 'month') {
        kind = 'date';
        currentValue = input.value || '';
        isEmpty = !input.value;
      } else {
        kind = 'text';
        currentValue = input.value || '';
        isEmpty = typeof currentValue === 'string' && currentValue.trim() === '';
      }

      const min = input.min === '' || input.min === undefined ? undefined : Number(input.min);
      const max = input.max === '' || input.max === undefined ? undefined : Number(input.max);
      const step = input.step === '' || input.step === undefined ? undefined : Number(input.step);

      const fieldItem: FormFieldItem = {
        fieldId,
        formId,
        tag,
        kind,
        sensitive,
        name: input.name || input.id || '',
        label,
        placeholder: input.placeholder || undefined,
        currentValue,
        isEmpty,
        required,
        disabled,
        readOnly,
        isVisible: true,
        constraints: {
          min: min !== undefined && Number.isFinite(min) ? min : undefined,
          max: max !== undefined && Number.isFinite(max) ? max : undefined,
          maxLength: input.maxLength > 0 ? input.maxLength : undefined,
          pattern: input.pattern || undefined,
          step: step !== undefined && Number.isFinite(step) ? step : undefined,
        },
        optionsState,
        options,
        groupName,
        unsupportedReason,
      };

      fields.push(fieldItem);
      if (!FormDOMRegistry.get(fieldId, snapshotId)) {
        FormDOMRegistry.register(fieldId, element, snapshotId);
      }
    });

    // 3. 关键增强：单选框组（Radio Group）聚合
    const radioGroups = new Map<HTMLElement | string, HTMLInputElement[]>();
    radioInputs.forEach((radio) => {
      // 聚合键优先使用 name，若无则使用所属单选容器或表单项容器
      const radioGroupContainer = radio.closest('.el-radio-group, .ant-radio-group, [role="radiogroup"]') as HTMLElement | null;
      const formItemParent = radio.closest('.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, fieldset') as HTMLElement | null;
      const groupKey: HTMLElement | string = radio.name || radioGroupContainer || formItemParent || 'default_radio_group';
      if (!radioGroups.has(groupKey)) {
        radioGroups.set(groupKey, []);
      }
      radioGroups.get(groupKey)!.push(radio);
    });

    let radioGroupIndex = 0;
    radioGroups.forEach((radios, groupKeyRef) => {
      radioGroupIndex += 1;
      const firstRadio = radios[0];
      const parentForm = firstRadio.closest('form, .el-form, .ant-form, .arco-form');
      const formId = topScope
        ? topScope.formId
        : parentForm
          ? (formMap.get(parentForm as HTMLElement) || defaultFormId)
          : defaultFormId;

      // 提取单选组的主标题（如“状态”、“性别”、“报销类型”）
      // 1. 优先从表单项外层容器（如 .el-form-item）中提取官方标准 Label（100% 杜绝空间几何或子选项文本误吸附）
      const formItemParent = firstRadio.closest?.(
        '.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, .t-form-item, .semi-form-item, .form-group, .form-item, [class*="form-item"], fieldset'
      ) as HTMLElement | null;
      let formItemLabel = '';
      if (formItemParent) {
        const titleEl = formItemParent.querySelector?.(
          '.el-form-item__label, .ant-form-item-label, .arco-form-item-label, .n-form-item-label, [class*="form-item__label"], [class*="form-label"], [class*="item-label"], [class*="field-label"], legend'
        ) as HTMLElement | null;
        if (titleEl && titleEl.textContent?.trim()) {
          formItemLabel = cleanLabelText(titleEl.textContent.trim());
        }
      }

      // 2. 其次才使用视觉空间几何或通用元素识别
      const radioContainer = (firstRadio.closest?.('.el-radio-group, .ant-radio-group, [role="radiogroup"]') || formItemParent || firstRadio) as HTMLElement;
      const spatialRadioLabel = getVisualSpatialLabel(radioContainer);
      const intelligentLabel = getElementLabel(firstRadio) || getElementLabel(radioContainer);
      const mainLabel = formItemLabel || spatialRadioLabel || intelligentLabel || firstRadio.name || `单选组 ${radioGroupIndex}`;

      const optionElements = new Map<string, HTMLElement>();
      const options: FormFieldOption[] = [];
      let checkedLabel = '';

      const groupKeyName = typeof groupKeyRef === 'string'
        ? groupKeyRef
        : (firstRadio.name || (groupKeyRef.id ? groupKeyRef.id : `group_${radioGroupIndex}`));

      radios.forEach((radio, rIdx) => {
        // 提取该选项的人类可读标签（从外层 label 或兄弟 span）
        const parentNode = radio.parentElement;
        const labelWrapper = (parentNode ? (parentNode.closest('label, .el-radio, .ant-radio') || parentNode) : radio.closest('label, .el-radio, .ant-radio')) as HTMLElement | null;
        let optLabel = '';
        if (labelWrapper) {
          const radioTextSpan = labelWrapper.querySelector('.el-radio__label, .ant-radio-wrapper, span');
          if (radioTextSpan && radioTextSpan.textContent && radioTextSpan.textContent.trim()) {
            optLabel = radioTextSpan.textContent.trim();
          } else {
            optLabel = (labelWrapper.textContent || '').trim();
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
          disabled: radio.disabled,
        });

        // 绑定选项点击目标（优先点击外层 label 包装层，使 Vue/React 响应）
        const clickTarget = labelWrapper || radio;
        optionElements.set(optLabel, clickTarget);
        optionElements.set(optVal, clickTarget);
        optionElements.set(optId, clickTarget);

        if (radio.checked) {
          checkedLabel = optLabel;
        }
      });

      const fieldId = `field_${snapshotId}_radiogroup_${groupKeyName}`;
      const radioGroupItem: FormFieldItem = {
        fieldId,
        formId,
        tag: 'input',
        kind: 'radio',
        name: firstRadio.name || groupKeyName,
        label: mainLabel,
        currentValue: checkedLabel,
        isEmpty: checkedLabel === '',
        required: radios.some((r) => r.required),
        disabled: radios.every((r) => r.disabled),
        readOnly: false,
        isVisible: true,
        optionsState: 'complete',
        options,
        groupName: firstRadio.name || groupKeyName,
      };

      fields.push(radioGroupItem);
      FormDOMRegistry.register(fieldId, firstRadio, snapshotId, optionElements);
    });

    if (hasDefaultFormFields && !forms.some((f) => f.formId === defaultFormId)) {
      forms.unshift({
        formId: defaultFormId,
        title: '页面主要表单',
        fieldCount: 0,
      });
    }

    // 统计各表单字段数
    forms.forEach((form) => {
      form.fieldCount = fields.filter((f) => f.formId === form.formId).length;
    });

    return {
      snapshotId,
      url: root.location ? root.location.href : '',
      title: root.title || '',
      forms,
      fields,
      timestamp: Date.now(),
    };
  }

  static readonly DROPDOWN_OPTION_SELECTORS = [
    '.el-cascader-node, .ant-cascader-menu-item, .arco-cascader-list-item',
    '.el-select-dropdown__item',
    '.el-select-dropdown__option-item',
    '.ant-select-item-option',
    '.ant-select-dropdown-menu-item',
    '.arco-select-option',
    '.n-base-select-option',
    '.t-select-option',
    '.semi-select-option',
    '.ivu-select-item',
    '.vue-treeselect__option',
    '.vue-treeselect__label',
    '.el-tree-node__content',
    '.ant-select-tree-title',
    '.ant-select-tree-node-content-wrapper',
    '.arco-tree-select-node',
    '.layui-form-select dl dd:not(.layui-select-tips)',
    '[role="option"]',
    '[role="treeitem"]',
  ].join(', ');

  static dispatchFullClick(el: HTMLElement): void {
    if (!el) return;
    try {
      const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventInit = { bubbles: true, cancelable: true, view: typeof window !== 'undefined' ? window : undefined, clientX, clientY };
      if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
      if (typeof MouseEvent !== 'undefined') el.dispatchEvent(new MouseEvent('mousedown', eventInit));
      if (typeof el.focus === 'function') el.focus();
      if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerup', eventInit));
      if (typeof MouseEvent !== 'undefined') {
        el.dispatchEvent(new MouseEvent('mouseup', eventInit));
        el.dispatchEvent(new MouseEvent('click', eventInit));
      } else if (typeof el.click === 'function') {
        el.click();
      }
    } catch {
      try { el.click?.(); } catch {}
    }
  }

  static extractOptionsFromContainer(container: HTMLElement | Element): FormFieldOption[] {
    if (!container || typeof (container as any).querySelectorAll !== 'function') return [];
    try {
      const raw = Array.from((container as any).querySelectorAll(this.DROPDOWN_OPTION_SELECTORS)) as HTMLElement[];
      const validNodes = raw.filter((el) => {
        if (!el) return false;
        // 排除侧栏内部节点，防止误采背景树
        if (el.closest?.('aside, nav, .sidebar, .org-tree, [class*="sidebar"]')) return false;
        // 排除大容器（避免父级树分支重复当选项）
        if (el.querySelector?.('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]')) return false;
        return true;
      });

      const options: FormFieldOption[] = [];
      const seenLabels = new Set<string>();

      for (let idx = 0; idx < validNodes.length; idx++) {
        const el = validNodes[idx];
        const rawText = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!rawText || rawText.includes('请选择') || rawText.toLowerCase().includes('select') || rawText === '--请选择--') continue;

        // 关键：去掉类似 (2) 或角标计数，获取纯净部门/选项名称
        let cleanText = rawText.replace(/[\(（]\d+[\)）]/g, '').trim();
        if (!cleanText) continue;
        if (seenLabels.has(cleanText)) continue;
        seenLabels.add(cleanText);

        const val = el.getAttribute?.('data-value') || el.getAttribute?.('value') || cleanText;

        // 只有组件自身明确声明 disabled，才标记为 disabled
        // 严禁将树枝节点（父级部门/公司）强制设为 disabled，因为在若依等管理系统中父级部门同样是可以被选中的有效项
        const disabled = Boolean(
          el.classList?.contains?.('is-disabled') ||
          el.classList?.contains?.('ant-select-item-option-disabled') ||
          el.classList?.contains?.('vue-treeselect__option--disabled') ||
          el.classList?.contains?.('vue-treeselect__label--disabled') ||
          el.getAttribute?.('aria-disabled') === 'true'
        );

        options.push({
          optionId: el.id || `opt_${idx}_${cleanText}`,
          value: val,
          label: cleanText,
          disabled,
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
  static findAssociatedDropdownContainer(element: HTMLElement, selectWrapper: HTMLElement, root: Document = document): HTMLElement | null {
    const docContext = element.ownerDocument || root;
    const innerInput = (element.tagName.toLowerCase() === 'input' ? element : selectWrapper.querySelector?.('input')) as HTMLInputElement | null;

    // 1. 优先在组件内部查找（例如 vue-treeselect 的 menu 直接挂在组件内）
    const internalMenu = selectWrapper.querySelector?.(
      '.vue-treeselect__menu, .vue-treeselect__menu-container, [class*="treeselect"][class*="menu"], .el-select-dropdown'
    ) as HTMLElement | null;
    if (internalMenu) {
      return internalMenu;
    }

    // ARIA may point to an offscreen accessibility list, not the clickable menu.
    const linkedNodes = [element, innerInput, selectWrapper, selectWrapper.querySelector?.('[aria-controls], [aria-owns]')].filter(Boolean) as HTMLElement[];
    for (const node of linkedNodes) {
      const ids = [node.getAttribute?.('aria-controls'), node.getAttribute?.('aria-owns')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const linked = docContext.getElementById?.(id);
        if (!linked) continue;
        const menu = linked.closest?.('.el-select-dropdown, .el-tree-select__popper, .ant-select-dropdown, .el-cascader__dropdown, .ant-cascader-dropdown, .arco-select-popup, .arco-cascader-popup') || linked;
        let hidden = false;
        for (let current: HTMLElement | null = menu as HTMLElement; current; current = current.parentElement) {
          const style = current.ownerDocument?.defaultView?.getComputedStyle(current) || current.style;
          if (current.hidden || current.getAttribute?.('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') { hidden = true; break; }
        }
        if (!hidden) return menu as HTMLElement;
      }
    }

    // 3. 检查页面上当前处于打开/可见状态且空间几何就近吸附的下拉浮层 (Midscene 空间几何就近原则)
    if (docContext && typeof (docContext as any).querySelectorAll === 'function') {
      const poppers = Array.from((docContext as any).querySelectorAll(
        '.el-select-dropdown, .el-tree-select__popper, .el-cascader__dropdown, .el-cascader-panel, .ant-cascader-dropdown, .arco-cascader-popup, .n-cascader-menu, .ant-select-dropdown, .arco-select-popup, .vue-treeselect__portal-container, [class*="select-dropdown"]'
      )) as HTMLElement[];

      const wRect = typeof selectWrapper.getBoundingClientRect === 'function' ? selectWrapper.getBoundingClientRect() : null;

      for (const popper of poppers) {
        if (!popper || popper.style?.display === 'none' || popper.style?.visibility === 'hidden' || popper.getAttribute?.('aria-hidden') === 'true') continue;

        // 若能获取真实屏幕物理尺寸，校验空间吸附几何距离（浮层必定紧贴当前下拉框上方或下方）
        if (wRect && wRect.width > 0 && wRect.height > 0 && typeof popper.getBoundingClientRect === 'function') {
          const pRect = popper.getBoundingClientRect();
          if (pRect.width > 0 && pRect.height > 0) {
            const xOverlap = pRect.left < wRect.right + 25 && pRect.right > wRect.left - 25;
            const yClose = Math.abs(pRect.top - wRect.bottom) < 40 || Math.abs(pRect.bottom - wRect.top) < 40;
            if (!xOverlap || !yClose) {
              // 几何位置不吻合，说明属于页面其他下拉框的浮层，坚决排除！
              continue;
            }
          }
        } else if (poppers.length > 1) {
          // 在无真实坐标且存在多个 popper 时，无法断言哪个属于当前下拉框，坚决不盲目采用
          continue;
        }

        return popper;
      }
    }

    return null;
  }

  /**
   * 优先从前端框架受控组件（如 Vue / Vue-Treeselect / Element UI）挂载的内部 ViewModel 中直接提取选项
   * 优势：零 DOM 点击、零弹层闪烁、无侵入性、绝对安全（绝不会触发遮罩关闭或全局弹窗消失）
   */
  static extractOptionsFromVueInstance(element: HTMLElement, selectWrapper: HTMLElement): FormFieldOption[] {
    try {
      const vueInst = (selectWrapper as any)?.__vue__ || (element as any)?.__vue__;
      if (!vueInst) return [];

      // 1. 适配 vue-treeselect 扁平化节点列表 (forest.nodeList)
      if (vueInst.forest?.nodeList && Array.isArray(vueInst.forest.nodeList)) {
        const options: FormFieldOption[] = [];
        const seen = new Set<string>();
        for (const node of vueInst.forest.nodeList) {
          if (!node) continue;
          const rawLabel = String(node.label || node.name || node.id || '').trim();
          const cleanLabel = rawLabel.replace(/[\(（]\d+[\)）]/g, '').trim();
          if (!cleanLabel || seen.has(cleanLabel)) continue;
          seen.add(cleanLabel);
          options.push({
            optionId: String(node.id || cleanLabel),
            value: String(node.id ?? cleanLabel),
            label: cleanLabel,
            disabled: Boolean(node.isDisabled),
          });
        }
        if (options.length > 0) return options;
      }

      // 2. 适配 vue-treeselect / 级联树原始 options 递归遍历
      const rawOptions = vueInst.options || vueInst.normalizedOptions || vueInst.$props?.options;
      if (Array.isArray(rawOptions)) {
        const options: FormFieldOption[] = [];
        const seen = new Set<string>();
        const traverse = (items: any[]) => {
          for (const item of items) {
            if (!item) continue;
            // 处理 Element UI ElOption 实例 (有 currentLabel)
            const rawLabel = String(item.currentLabel ?? item.label ?? item.name ?? item.value ?? '').trim();
            const cleanLabel = rawLabel.replace(/[\(（]\d+[\)）]/g, '').trim();
            if (cleanLabel && !cleanLabel.includes('请选择') && !seen.has(cleanLabel)) {
              seen.add(cleanLabel);
              const val = String(item.value ?? item.id ?? cleanLabel);
              options.push({
                optionId: String(item.id || item.value || cleanLabel),
                value: val,
                label: cleanLabel,
                disabled: Boolean(item.isDisabled || item.disabled),
              });
            }
            if (Array.isArray(item.children)) traverse(item.children);
          }
        };
        traverse(rawOptions);
        if (options.length > 0) return options;
      }
    } catch {}
    return [];
  }

  static extractDropdownOptionsFromDom(element: HTMLElement, selectWrapper: HTMLElement, root: Document = document): FormFieldOption[] {
    // 0. 优先从 Vue 实例内存模型中直接无损提取选项（0 点击、0 闪烁、0 副作用）
    const vueOpts = this.extractOptionsFromVueInstance(element, selectWrapper);
    if (vueOpts.length > 0) return vueOpts;

    const container = this.findAssociatedDropdownContainer(element, selectWrapper, root);
    if (!container) return [];
    return this.extractOptionsFromContainer(container);
  }

  /** 扫描保持只读，兼容旧入口。 */
  static async scanWithProbe(root: Document = document): Promise<FormSnapshot> {
    return this.scan(root);
  }
}
