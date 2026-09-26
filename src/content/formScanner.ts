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
import { getElementLabel } from '../shared/tools/elementLabel';

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
    const topDialog = candidates[candidates.length - 1];

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

  private static getFieldLabel(element: HTMLElement, _root?: Document): string {
    const intelligent = getElementLabel(element);
    if (intelligent) return intelligent;

    const input = element as HTMLInputElement;
    if (input.placeholder) return input.placeholder.trim();
    if (input.name || input.id) return input.name || input.id;
    return '未命名字段';
  }

  private static isCaptchaField(element: HTMLElement): boolean {
    const str = `${element.id || ''} ${(element as HTMLInputElement).name || ''} ${(element as HTMLInputElement).placeholder || ''}`.toLowerCase();
    return str.includes('captcha') || str.includes('verify') || str.includes('验证码');
  }

  /**
   * 判断元素是否属于现代组件库下拉框 (Element Plus / AntD / 原生 Select)
   */
  private static isDropdownComponent(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === 'select') return true;
    if (tag === 'input' && (element.closest('.el-select, .ant-select, .arco-select, .n-select, [class*="select-trigger"]') || element.getAttribute('role') === 'combobox')) return true;
    if (element.closest('.el-select, .ant-select, .arco-select, .n-select')) return true;
    return false;
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

    // 2. 遍历表单控件 (支持 input, select, textarea, 以及带有 role="combobox" 的自定义下拉)
    const rawElements = (searchRoot && typeof searchRoot.querySelectorAll === 'function')
      ? Array.from(searchRoot.querySelectorAll('input, select, textarea, [role="combobox"]'))
      : [];

    const radioInputs: HTMLInputElement[] = [];

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

      const fieldId = `field_${snapshotId}_${index + 1}_${input.name || input.id || tag}`;
      const label = this.getFieldLabel(element, root);
      const sensitive = tag === 'input' && input.type === 'password';
      const disabled = input.disabled || Boolean(input.hasAttribute?.('disabled')) || input.getAttribute?.('aria-disabled') === 'true';
      let readOnly = input.readOnly || Boolean(input.hasAttribute?.('readonly')) || input.getAttribute?.('aria-readonly') === 'true';
      const required = input.required || Boolean(input.hasAttribute?.('required')) || input.getAttribute?.('aria-required') === 'true';

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
      } else if (tag !== 'select' && tag !== 'input' && element.getAttribute?.('role') === 'combobox' && !element.closest?.('.el-select, .ant-select, .arco-select')) {
        kind = 'unsupported';
        unsupportedReason = '自定义 ARIA 控件尚未接入专用点击展开交互适配器';
        optionsState = 'partial';
        currentValue = element.textContent?.trim() || '';
        isEmpty = !currentValue || currentValue.includes('请选择');
      } else if (this.isDropdownComponent(element)) {
        // 关键增强：全面支持现代 UI 库下拉框 (Element Plus / AntD / 原生 Select)
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
          isEmpty = !currentValue || selectedText.includes('请选择') || selectedText.toLowerCase().includes('select');
        } else {
          // 自定义下拉框（如 .el-select, .ant-select, [role="combobox"]）
          const selectWrapper = element.closest('.el-select, .ant-select, [role="combobox"]') as HTMLElement || element;
          const displayVal = input.value || selectWrapper.textContent?.trim() || '';
          currentValue = displayVal;
          const placeholder = input.placeholder || element.getAttribute('placeholder') || '';
          isEmpty = !displayVal || displayVal === placeholder || displayVal.includes('请选择') || displayVal.toLowerCase().includes('select');

          // 尝试采集已存在的选项浮层（如已挂载到 body 上的下拉项）
          const docContext = typeof document !== 'undefined' ? document : (root.ownerDocument || root);
          const domOptionItems = (docContext && typeof (docContext as any).querySelectorAll === 'function')
            ? Array.from((docContext as any).querySelectorAll('.el-select-dropdown__item, .ant-select-item-option, [role="option"]'))
            : [];
          if (domOptionItems.length > 0) {
            options = (domOptionItems as any[]).map((optEl, optIdx) => {
              const text = optEl.textContent?.trim() || `选项${optIdx + 1}`;
              return {
                optionId: optEl.id || `opt_${optIdx}_${text}`,
                value: text,
                label: text,
                disabled: Boolean(optEl.classList?.contains?.('is-disabled')),
              };
            });
            optionsState = 'complete';
          } else {
            optionsState = 'unloaded';
          }
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
      FormDOMRegistry.register(fieldId, element, snapshotId);
    });

    // 3. 关键增强：单选框组（Radio Group）聚合
    const radioGroups = new Map<string, HTMLInputElement[]>();
    radioInputs.forEach((radio) => {
      // 聚合键优先使用 name，若无则使用表单项容器
      const formItemParent = radio.closest('.el-form-item, .ant-form-item, [role="radiogroup"], fieldset');
      const groupKey = radio.name || (formItemParent ? (formItemParent as HTMLElement).className : 'default_radio_group');
      if (!radioGroups.has(groupKey)) {
        radioGroups.set(groupKey, []);
      }
      radioGroups.get(groupKey)!.push(radio);
    });

    let radioGroupIndex = 0;
    radioGroups.forEach((radios, groupKey) => {
      radioGroupIndex += 1;
      const firstRadio = radios[0];
      const parentForm = firstRadio.closest('form, .el-form, .ant-form, .arco-form');
      const formId = topScope
        ? topScope.formId
        : parentForm
          ? (formMap.get(parentForm as HTMLElement) || defaultFormId)
          : defaultFormId;

      // 提取单选组的主标题（如“性别”、“报销类型”）
      const mainLabel = getElementLabel(firstRadio) || firstRadio.name || `单选组 ${radioGroupIndex}`;

      const optionElements = new Map<string, HTMLElement>();
      const options: FormFieldOption[] = [];
      let checkedLabel = '';

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
        const optId = radio.id || `radio_${groupKey}_${rIdx}_${optVal}`;
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

      const fieldId = `field_${snapshotId}_radiogroup_${groupKey}`;
      const radioGroupItem: FormFieldItem = {
        fieldId,
        formId,
        tag: 'input',
        kind: 'radio',
        name: firstRadio.name || groupKey,
        label: mainLabel,
        currentValue: checkedLabel,
        isEmpty: checkedLabel === '',
        required: radios.some((r) => r.required),
        disabled: radios.every((r) => r.disabled),
        readOnly: false,
        isVisible: true,
        optionsState: 'complete',
        options,
        groupName: firstRadio.name || groupKey,
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
}
