/**
 * AI 智能填表执行器、回读校验与冲突感知撤销器 (QA-014, QA-023)
 */

import {
  FormFillAssignment,
  FormFillRunRecord,
  FormFillStepResult,
} from '../shared/types/formFill';
import { FormDOMRegistry, FormScanner } from './formScanner';

export class FormExecutor {
  private static isCancelled = false;
  private static activeRunId: string | null = null;

  // 历史运行记录缓存（用于撤销）
  private static runHistory = new Map<string, FormFillRunRecord>();

  static cancel(runId?: string) {
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

  static getActiveRunId(): string | null {
    return this.activeRunId;
  }

  static getRunRecord(runId: string): FormFillRunRecord | undefined {
    return this.runHistory.get(runId);
  }

  /**
   * 严格布尔值类型转换 (IMP-09)
   * 杜绝 JavaScript 原生 Boolean("false") === true 的误判，防止字符串 'false'/'0'/'no' 被错误识别为真值
   */
  static toStrictBoolean(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      return s !== 'false' && s !== '0' && s !== 'off' && s !== 'no' && s !== '';
    }
    return Boolean(val);
  }

  /**
   * 判断当前 DOM 控件的值是否视为空值 (QA-023)
   */
  private static isDomValueEmpty(element: HTMLElement, val: string | number | boolean): boolean {
    const tag = element.tagName.toLowerCase();
    const input = element as HTMLInputElement;

    if (input.type === 'checkbox') {
      // false 也是有效状态，不作为空白被覆盖
      return false;
    }
    if (input.type === 'radio') {
      return val === '' || val === false;
    }
    if (input.type === 'number') {
      return val === '' || val === null || val === undefined;
    }
    if (tag === 'select') {
      const select = element as HTMLSelectElement;
      const selectedText = select.selectedOptions?.[0]?.text?.trim() || '';
      return !val || selectedText.includes('请选择') || selectedText.toLowerCase().includes('select') || selectedText === '--请选择--';
    }

    const dropdownRoot = FormScanner.findDropdownRoot(element);
    const isCustomSelect = FormScanner.isDropdownComponent(element, dropdownRoot);

    if (isCustomSelect) {
      if (!val) return true;
      const strVal = String(val).trim();
      const selectWrapper = dropdownRoot || element;
      const placeholder = input.placeholder || element.getAttribute?.('placeholder') || selectWrapper.getAttribute?.('placeholder') || '';
      return !strVal || strVal === placeholder || strVal.includes('请选择') || strVal.toLowerCase().includes('select') || strVal === '--请选择--';
    }

    return typeof val === 'string' && val.trim() === '';
  }

  /**
   * 采用原生原型 setter 赋值，兼容 React/Vue 等前端框架受控组件
   */
  private static setNativeValue(element: HTMLElement, value: string): void {
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (prototypeValueDescriptor && prototypeValueDescriptor.set) {
      prototypeValueDescriptor.set.call(element, value);
    } else {
      (element as HTMLInputElement).value = value;
    }
  }

  /**
   * 派发完整的 DOM 事件流
   */
  private static dispatchInputEvents(element: HTMLElement): void {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * 辅助方法：模拟派发完整的手势与点击事件流 (触发 React rc-select / Vue Element Plus 的事件监听)
   */
  private static dispatchFullClick(el: HTMLElement): void {
    try {
      const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventInit = { bubbles: true, cancelable: true, composed: true, button: 0, view: typeof window !== 'undefined' ? window : undefined, clientX, clientY };

      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, buttons: 1, pointerType: 'mouse', isPrimary: true }));
      }
      if (typeof MouseEvent !== 'undefined') {
        el.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, buttons: 1 }));
      }
      if (typeof el.focus === 'function') {
        el.focus();
      }
      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0, pointerType: 'mouse', isPrimary: true }));
      }
      if (typeof MouseEvent !== 'undefined') {
        el.dispatchEvent(new MouseEvent('mouseup', eventInit));
        el.dispatchEvent(new MouseEvent('click', eventInit));
      } else if (typeof el.click === 'function') {
        el.click();
      } else if (typeof el.dispatchEvent === 'function') {
        el.dispatchEvent(new Event('click', { bubbles: true }));
      }
    } catch {
      try { el.click?.(); } catch {}
    }
  }

  /**
   * 读取当前 DOM 的实际值
   */
  private static readElementValue(element: HTMLElement): string | number | boolean {
    const tag = element.tagName.toLowerCase();
    const input = element as HTMLInputElement;

    if (input.type === 'radio') {
      return FormDOMRegistry.readRadioGroupValue(element) ?? input.checked;
    }
    if (input.type === 'checkbox') {
      return input.checked;
    }
    if (input.type === 'number') {
      return input.value === '' ? '' : Number(input.value);
    }
    if (tag === 'select') {
      return (element as HTMLSelectElement).value;
    }

    const dropdownRoot = FormScanner.findDropdownRoot(element);
    const isCustomSelect = FormScanner.isDropdownComponent(element, dropdownRoot);

    if (isCustomSelect) {
      const selectWrapper = dropdownRoot || element;
      // 优先提取多选 Tag 文本集合
      const tags = selectWrapper.querySelectorAll?.(
        '.el-select__tags-text, .ant-select-selection-item-content, .vue-treeselect__multi-value-item, .arco-tag'
      );
      if (tags && tags.length > 0) {
        const tagTexts = Array.from(tags).map((n: any) => n.textContent?.trim() || '').filter(Boolean);
        if (tagTexts.length > 0) {
          return tagTexts.join(', ');
        }
      }
      const selectedItem = selectWrapper.querySelector?.(
        '.vue-treeselect__single-value, .vue-treeselect__value-container, .el-select__selected-item:not(.is-transparent), .el-select__tags-text, .ant-select-selection-item, .ant-select-selection-selected-value, .arco-select-view-value, .n-base-selection-label, .el-select-dropdown__item.is-selected, [class*="single-value"]'
      );
      if (selectedItem?.textContent?.trim()) {
        const text = selectedItem.textContent.trim();
        if (!text.includes('请选择') && !text.toLowerCase().includes('select')) {
          return text;
        }
      }
      const displayInput = (element.tagName.toLowerCase() === 'input' ? element : selectWrapper.querySelector?.('input')) as HTMLInputElement | null;
      const placeholder = displayInput?.placeholder || selectWrapper.getAttribute?.('placeholder') || selectWrapper.querySelector?.('.el-select__placeholder, .ant-select-selection-placeholder, .vue-treeselect__placeholder, [class*="placeholder"]')?.textContent?.trim() || '';
      if (
        displayInput?.value &&
        displayInput.value !== placeholder &&
        !displayInput.value.includes('请选择') &&
        !displayInput.classList?.contains?.('vue-treeselect__input') &&
        !displayInput.classList?.contains?.('ant-select-selection-search-input') &&
        displayInput.getAttribute?.('role') !== 'searchbox'
      ) {
        return displayInput.value.trim();
      }
      return '';
    }

    return input.value ?? '';
  }

  /**
   * 执行单步填充
   */
  private static async executeAssignment(
    assignment: FormFillAssignment,
    snapshotId: string,
    mode: 'empty_only' | 'allow_overwrite' = 'empty_only'
  ): Promise<FormFillStepResult> {
    const { fieldId, action, value, optionIds } = assignment;
    const element = FormDOMRegistry.get(fieldId, snapshotId);

    if (!element) {
      return {
        fieldId,
        beforeValue: '',
        plannedValue: value ?? optionIds,
        status: 'failed',
        error: '找不到目标表单控件（快照可能已失效或页面已刷新）',
      };
    }

    const input = element as HTMLInputElement;
    const tag = element.tagName.toLowerCase();
    const dropdownRoot = FormScanner.findDropdownRoot(element);
    const selectWrapper = dropdownRoot || (element.closest?.('.custom-select, [role="combobox"]') as HTMLElement | null) || element;

    const isRadio = input.type === 'radio' || fieldId.includes('_radiogroup_');
    const isCheckbox = input.type === 'checkbox';

    const isComponentSelect = FormScanner.isDropdownComponent(element, dropdownRoot);
    // 关键：radio / checkbox 绝不误判为 customSelect；仅当 action 为 select 且元素为下拉组件时进入展开选中分支
    const isCustomSelect = !isRadio && !isCheckbox && tag !== 'select' && (action === 'select' && isComponentSelect);
    const isActuallyReadOnly = Boolean(input.readOnly && !isCustomSelect);

    if (input.disabled || isActuallyReadOnly) {
      return {
        fieldId,
        beforeValue: this.readElementValue(element),
        plannedValue: value ?? optionIds,
        status: 'skipped',
        error: input.disabled ? '控件处于禁用 (disabled) 状态' : '控件处于只读 (readOnly) 状态',
        skippedReason: input.disabled ? '控件处于禁用 (disabled) 状态' : '控件处于只读 (readOnly) 状态',
      };
    }

    const beforeValue = this.readElementValue(element);
    const isCurrentlyEmpty = this.isDomValueEmpty(element, beforeValue);

    // QA-023 & 缺陷 2: “仅填空白”必须绝对保护非空控件（无论原本是否为空，只要当前有值，一律跳过不覆盖）
    if (mode === 'empty_only' && !isCurrentlyEmpty) {
      const wasModifiedByUser =
        assignment.expectedBeforeValue !== undefined &&
        String(beforeValue) !== String(assignment.expectedBeforeValue);

      return {
        fieldId,
        beforeValue,
        plannedValue: value ?? optionIds,
        appliedValue: beforeValue,
        status: 'skipped',
        error: '当前控件已有内容，仅填空白模式禁止覆盖',
        skippedReason: wasModifiedByUser
          ? '字段已被用户修改为非空内容，仅填空白模式自动跳过以保护人工输入'
          : '当前控件已有值，仅填空白模式自动跳过',
      };
    }

    if (action === 'skip') {
      return {
        fieldId,
        beforeValue,
        plannedValue: 'skip',
        status: 'skipped',
        error: '模型或用户标记跳过此字段',
        skippedReason: '模型或用户标记跳过此字段',
      };
    }

    let targetSelectVal = '';
    let targetRadio: HTMLInputElement | null = null;

    try {
      if (tag === 'select') {
        const select = element as HTMLSelectElement;
        targetSelectVal = '';

        if (value !== undefined && value !== null && String(value).trim() !== '') {
          const strVal = String(value).trim();
          const matchedOpt = Array.from(select.options).find(
            (o) => o.value === strVal || o.text?.trim() === strVal || o.id === strVal || (strVal && o.text?.trim().includes(strVal))
          );
          if (matchedOpt) {
            targetSelectVal = matchedOpt.value;
          } else {
            return {
              fieldId,
              beforeValue,
              plannedValue: value ?? optionIds,
              appliedValue: beforeValue,
              status: 'failed',
              error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`,
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
              status: 'failed',
              error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`,
            };
          }
        }

        if (!targetSelectVal && select.options.length > 0) {
          const firstValid = Array.from(select.options).find((o) => !o.disabled && o.value !== '' && !o.text.includes('请选择'));
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
            status: 'failed',
            error: `下拉选项匹配失败：在下拉列表中未找到 "${value ?? optionIds}" 对应的有效选项，已保留原选择`,
          };
        }

        const proto = Object.getPrototypeOf(select);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) {
          desc.set.call(select, targetSelectVal);
        } else {
          select.value = targetSelectVal;
        }
        this.dispatchInputEvents(select);
      } else if (isCustomSelect) {
        // 关键增强：现代组件库自定义下拉框 (Element Plus / AntD / Arco / Naive / role="combobox") 交互展开与选项选中
        // 支持多选（数组、逗号分隔）、树形（级联路径、展开箭头、搜索穿透）、懒加载（异步网络与DOM监听）
        const rawTargets: string[] = [];
        if (assignment.values && Array.isArray(assignment.values) && assignment.values.length > 0) {
          rawTargets.push(...assignment.values.map(String).filter(Boolean));
        } else if (Array.isArray(value) && value.length > 0) {
          rawTargets.push(...value.map(String).filter(Boolean));
        } else if (typeof value === 'string' && value.trim()) {
          const strVal = value.trim();
          if (strVal.includes(',') || strVal.includes('，') || strVal.includes('、')) {
            rawTargets.push(...strVal.split(/[,，、]/).map((s) => s.trim()).filter(Boolean));
          } else {
            rawTargets.push(strVal);
          }
        } else if (optionIds && optionIds.length > 0) {
          rawTargets.push(...optionIds.map(String).filter(Boolean));
        }
        if (rawTargets.length === 0) {
          rawTargets.push('');
        }

        let docCtx: any = (element as any).ownerDocument;
        let rootNode: any = element;
        while (rootNode && (rootNode.parentElement || rootNode.parentNode)) {
          rootNode = rootNode.parentElement || rootNode.parentNode;
        }
        if (!docCtx || typeof docCtx.querySelectorAll !== 'function') {
          docCtx = typeof document !== 'undefined' ? document : rootNode;
        }

        // 1. 点击展开下拉框（选出唯一定位最好的 trigger，且只触发一次点击，避免连续点击导致先展开后立即收起）
        const trigger = (
          selectWrapper.querySelector?.(
            '.el-select__wrapper, .vue-treeselect__control, .ant-select-selector, .arco-select-view, .n-base-selection, .select-trigger'
          ) ||
          selectWrapper.querySelector?.('input') ||
          selectWrapper
        ) as HTMLElement;

        if (trigger.getAttribute?.('aria-expanded') !== 'true' && selectWrapper.getAttribute?.('aria-expanded') !== 'true') {
          FormExecutor.dispatchFullClick(trigger);
        }
        await new Promise((resolve) => setTimeout(resolve, 120));

        const optionSelectors = [
          '.el-select-dropdown__item:not(.is-disabled)',
          '.el-select-dropdown__option-item:not(.is-disabled)',
          '.el-cascader-node:not(.is-disabled)',
          '.vue-treeselect__option',
          '.vue-treeselect__label',
          '.el-tree-node__content',
          '.ant-select-item-option:not(.ant-select-item-option-disabled)',
          '.ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled)',
          '.ant-select-tree-title',
          '.ant-select-tree-node-content-wrapper',
          '.ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled)',
          '.arco-select-option:not(.arco-select-option-disabled)',
          '.arco-cascader-list-item:not(.arco-cascader-list-item-disabled)',
          '.arco-tree-select-node',
          '.n-base-select-option:not(.n-base-select-option--disabled)',
          '.t-select-option:not(.t-is-disabled)',
          '.semi-select-option:not(.semi-select-option-disabled)',
          '.ivu-select-item:not(.ivu-select-item-disabled)',
          '.layui-form-select dl dd:not(.layui-select-tips):not(.layui-disabled)',
          '[role="option"]:not([aria-disabled="true"])',
          '[role="treeitem"]:not([aria-disabled="true"])',
          '[role="menuitem"]:not([aria-disabled="true"])',
          'option:not([disabled])',
        ].join(', ');

        const normalize = (text: string) => text.replace(/[\(（]\d+[\)）]/g, '').replace(/\s+/g, ' ').trim();
        const hierarchySelectors = '.vue-treeselect, .el-tree-select, .el-cascader, .ant-tree-select, .ant-cascader, .arco-tree-select, .arco-cascader, .n-tree-select, .n-cascader, [aria-haspopup="tree"]';
        
        // 关键修正：绝不判断 aria-hidden，因为 Element UI 等组件根标签硬编码了 aria-hidden="true"！
        const usable = (node: HTMLElement): boolean => {
          if (!node) return false;
          if (
            node.getAttribute?.('aria-disabled') === 'true' ||
            node.classList?.contains?.('is-disabled') ||
            node.classList?.contains?.('ant-select-item-option-disabled') ||
            node.classList?.contains?.('vue-treeselect__option--disabled') ||
            node.classList?.contains?.('vue-treeselect__label--disabled') ||
            node.hasAttribute?.('disabled')
          ) {
            return false;
          }
          for (let current: HTMLElement | null = node; current && current !== current.ownerDocument?.body; current = current.parentElement) {
            if (current.hidden) return false;
            const style = current.ownerDocument?.defaultView?.getComputedStyle?.(current) || current.style;
            if (style?.display === 'none' || style?.visibility === 'hidden') return false;
          }
          return true;
        };

        const label = (node: HTMLElement) => (node.querySelector?.('.el-cascader-node__label, .ant-cascader-menu-item-content, .vue-treeselect__label, .el-tree-node__label, .ant-select-item-option-content')?.textContent || node.textContent || '').trim();

        const chosenLabels: string[] = [];
        let associatedMenuFound = false;
        let visibleOptionCount = 0;

        for (const targetOptionText of rawTargets) {
          const path = targetOptionText.split(/\s*(?:\/|>|→|\|)\s*/).filter(Boolean);
          let level = 0;
          let selected = false;
          let searched = false;
          let searchInputUsed: HTMLInputElement | null = null;
          let previousSearch = '';
          let clearedTreeSearch = false;
          const expanded = new WeakSet<HTMLElement>();
          const deadline = Date.now() + 3500;

          const isHierarchical = (container: HTMLElement) => path.length > 1 ||
            Boolean(selectWrapper.matches?.(hierarchySelectors) || selectWrapper.closest?.(hierarchySelectors) ||
              selectWrapper.querySelector?.('input.vue-treeselect__input') ||
              container.querySelector?.('[role="tree"], [role="treeitem"], .el-tree-node, .vue-treeselect__option, .el-cascader-node, .ant-cascader-menu-item'));

          while (Date.now() < deadline && !this.isCancelled) {
            let associated = FormScanner.findAssociatedDropdownContainer(element, selectWrapper, docCtx);
            // 兜底：如果常规关联未命中，从 document 中查找任何可见的激活浮层
            if (!associated && docCtx?.querySelectorAll) {
              const allVisible = Array.from(docCtx.querySelectorAll('.el-select-dropdown, .vue-treeselect__menu, .ant-select-dropdown, [class*="select-dropdown"]')) as HTMLElement[];
              associated = allVisible.find((p) => p && !p.hidden && p.style?.display !== 'none' && p.style?.visibility !== 'hidden') || null;
            }
            associatedMenuFound ||= Boolean(associated);
            const container = associated || selectWrapper;

            if (!clearedTreeSearch && isHierarchical(container)) {
              clearedTreeSearch = true;
              const treeSearch = selectWrapper.querySelector?.('input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input') as HTMLInputElement | null;
              if (treeSearch?.value && !treeSearch.readOnly) {
                this.setNativeValue(treeSearch, '');
                this.dispatchInputEvents(treeSearch);
                await new Promise((resolve) => setTimeout(resolve, 100));
                continue;
              }
            }

            // 关键修正：绝不排除 .vue-treeselect__label，避免误杀所有 vue-treeselect 选项
            let options = (Array.from(container.querySelectorAll?.(optionSelectors) || []) as HTMLElement[]).filter(
              (node) => usable(node) && !node.querySelector?.('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__option, [role="option"], [role="treeitem"]')
            );
            visibleOptionCount = options.length;

            // 搜索后自愈防护：若键入目标词过滤导致结果清空（0 项），说明目标不存在于当前树，立即清空搜索输入框，恢复完整组织树
            if (searched && searchInputUsed && searchInputUsed.value && (
              options.length === 0 ||
              Boolean(container.querySelector?.('.vue-treeselect__tip--no-results, .vue-treeselect__tip--empty, .el-select-dropdown__empty, .ant-empty'))
            )) {
              this.setNativeValue(searchInputUsed, '');
              this.dispatchInputEvents(searchInputUsed);
              await new Promise((resolve) => setTimeout(resolve, 100));
              options = (Array.from(container.querySelectorAll?.(optionSelectors) || []) as HTMLElement[]).filter(
                (node) => usable(node) && !node.querySelector?.('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__option, [role="option"], [role="treeitem"]')
              );
              visibleOptionCount = options.length;
            }

            const target = path[level] || targetOptionText;

            // 1. 精确匹配 (ID 或 value 或 exact label)
            let matched = options.find((node) => {
              const val = node.getAttribute?.('data-value') ?? node.getAttribute?.('value');
              return (path.length <= 1 && optionIds?.includes(node.id)) || val === target || label(node) === target;
            });

            // 2. 归一化文本匹配 (去除括号角标/计数/空格)
            if (!matched && target) {
              matched = options.find((node) => normalize(label(node)) === normalize(target));
            }

            // 3. 模糊与相互包含匹配 (例如目标“普通角色”匹配“普通员工”，“男”匹配“男性”)
            if (!matched && target) {
              matched = options.find((node) => {
                const l = normalize(label(node));
                const t = normalize(target);
                return l && t && (l.includes(t) || t.includes(l));
              });
            }

            // 4. 业务语义匹配 (性别男/女、部门关键词)
            if (!matched && target) {
              if (target.includes('男')) {
                matched = options.find((node) => label(node).includes('男'));
              } else if (target.includes('女')) {
                matched = options.find((node) => label(node).includes('女'));
              }
            }

            // 5. 目标不匹配时的智能兜底 (若已超时尝试或无可展开节点，优先选用第 1 个有效非禁用选项)
            if (!matched && (!target || Date.now() > deadline - 800) && options.length > 0) {
              matched = options.find((node) => {
                const l = label(node);
                return l && !l.includes('请选择') && !l.toLowerCase().includes('select') && l !== '--请选择--';
              });
            }

            if (matched) {
              matched.scrollIntoView?.({ block: 'nearest' });

              // 关键修正：必须精准点击内部可交互标签（.vue-treeselect__label-container / .vue-treeselect__label / .el-tree-node__content）
              // 因为 Vue 的 @click="handleSelect" 绑定在内层 label-container 上，如果仅点击外层 div，事件不会向下传递，组件不会被选中！
              const clickTarget = (
                matched.querySelector?.(
                  '.vue-treeselect__label-container, .vue-treeselect__label, .el-tree-node__content, .el-tree-node__label, .el-cascader-node__label, .ant-select-item-option-content, .ant-select-tree-node-content-wrapper, .ant-select-tree-title'
                ) || matched
              ) as HTMLElement;

              FormExecutor.dispatchFullClick(clickTarget);
              if (clickTarget !== matched) {
                FormExecutor.dispatchFullClick(matched);
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

            // 仅展开当前控件关联菜单内部的折叠树枝节点
            const arrows = Array.from(
              container.querySelectorAll?.(
                '.el-tree-node__expand-icon:not(.is-leaf):not(.expanded), .ant-select-tree-switcher_close, .vue-treeselect__option-arrow-container, [aria-expanded="false"] > .vue-treeselect__option-arrow'
              ) || []
            ) as HTMLElement[];

            if (path.length <= 1) {
              for (const node of options) {
                if (node.querySelector?.('.el-cascader-node__postfix, .ant-cascader-menu-item-expand-icon, .arco-cascader-list-item-expand-icon')) {
                  arrows.push(node);
                }
              }
            }

            const arrow = arrows.find(
              (node) => usable(node) && !expanded.has(node) && !node.closest?.('.vue-treeselect__option--expanded') && !node.querySelector?.('.vue-treeselect__option-arrow--rotated')
            );

            if (arrow) {
              expanded.add(arrow);
              FormExecutor.dispatchFullClick(arrow);

              // 懒加载等待（若出现 loading spinner，轮询等待网络请求加载完毕）
              let waitLoading = 0;
              while (waitLoading < 1500) {
                const isLoading = Boolean(
                  container.querySelector?.('.el-tree-node__loading-icon, .is-loading, .ant-select-tree-switcher-loading-icon, .arco-icon-loading, [aria-busy="true"]')
                );
                if (!isLoading && waitLoading > 100) break;
                await new Promise((r) => setTimeout(r, 60));
                waitLoading += 60;
              }
            } else if (!searched && target && value !== undefined && !/^\d+$/.test(target)) {
              // Search-First 穿透检索
              const search = selectWrapper.querySelector?.(
                'input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input'
              ) as HTMLInputElement | null;
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
              `下拉选择失败：${associatedMenuFound ? '已找到浮层' : '未找到关联浮层'}；可用选项 ${visibleOptionCount} 项；目标「${targetOptionText}」未匹配。`
            );
          }

          // 多选情况下给每个选项留出 DOM 更新间隔
          if (rawTargets.length > 1) {
            await new Promise((r) => setTimeout(r, 80));
          }
        }

        // 多选完成后，安全平稳收起下拉菜单（防止遮挡后续输入框）
        // 核心修正：绝对严禁向组件派发 Escape 键盘事件！
        // 因为 Element UI / 若依系统的 Dialog 弹窗默认设置了 close-on-press-escape: true，
        // 一旦事件冒泡到 el-dialog，会直接将添加用户的 Dialog 弹窗整个关闭！
        if (rawTargets.length > 1 || selectWrapper.classList?.contains?.('is-multiple') || selectWrapper.querySelector?.('.el-select__tags')) {
          try {
            // 触发输入框失焦平稳收起下拉菜单，绝不派发可能导致关闭 Dialog 弹窗的 Escape 键盘事件
            const innerInput = (element.tagName.toLowerCase() === 'input' ? element : selectWrapper.querySelector?.('input')) as HTMLInputElement | null;
            if (typeof innerInput?.blur === 'function') {
              innerInput.blur();
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 60));
        }

        targetSelectVal = chosenLabels.join(', ');

        // 响应式渲染提交等待与回读检验
        const verifyUntil = Date.now() + 1500;
        const expected = normalize(targetSelectVal);
        while (Date.now() < verifyUntil) {
          const actual = String(this.readElementValue(element)).trim();
          const parts = actual.split(/\s*(?:\/|>|→|,|，)\s*/);
          if (
            normalize(actual) === expected ||
            rawTargets.every((t) => normalize(actual).includes(normalize(t))) ||
            (rawTargets.length === 1 && normalize(actual).includes(expected)) ||
            parts.some((part) => normalize(part) === expected)
          ) {
            targetSelectVal = actual;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        // 关键增强：单选框组 Radio Group 选项交互
        const targetVal = String(value ?? optionIds?.[0] ?? '').trim();
        let optionNode = FormDOMRegistry.getOptionElement(fieldId, targetVal, snapshotId) ||
          (optionIds?.[0] ? FormDOMRegistry.getOptionElement(fieldId, optionIds[0], snapshotId) : null);

        // 自愈兜底：若 optionNode 断开或未注册，从当前容器就近按 label 文本寻找
        if (!optionNode || (typeof optionNode.isConnected === 'boolean' && !optionNode.isConnected)) {
          const radioContainer = (element.closest?.('.el-radio-group, .ant-radio-group, [role="radiogroup"], .el-form-item, .ant-form-item, form') || element.parentElement || element) as HTMLElement;
          const labels = Array.from(radioContainer.querySelectorAll?.('label, .el-radio, .ant-radio, .arco-radio, [role="radio"]') || []) as HTMLElement[];
          optionNode = labels.find((l) => (l.textContent?.trim() || '').includes(targetVal)) || null;
        }

        if (!optionNode) {
          throw new Error(`单选目标「${targetVal}」不存在、已失效或被禁用`);
        }

        targetRadio = (optionNode.querySelector?.('input[type="radio"], input') ||
          (optionNode.tagName === 'INPUT' ? optionNode : null)) as HTMLInputElement | null;

        if (targetRadio && targetRadio.disabled) {
          throw new Error(`单选目标「${targetVal}」处于禁用状态`);
        }

        // 优先使用完整手势点击外层 label 包装层，使 Vue/React 响应
        FormExecutor.dispatchFullClick(optionNode);

        // 若点击后原生 input.checked 尚未同步，同步设置并触发事件
        if (targetRadio && !targetRadio.checked) {
          targetRadio.checked = true;
          this.dispatchInputEvents(targetRadio);
        }
      } else if (input.type === 'checkbox') {
        const targetChecked = this.toStrictBoolean(value);
        if (input.checked !== targetChecked) {
          input.click();
          if (input.checked !== targetChecked) {
            input.checked = targetChecked;
            this.dispatchInputEvents(input);
          }
        }
      } else if (tag === 'input' || tag === 'textarea') {
        const strVal = value !== undefined && value !== null ? String(value) : '';
        this.setNativeValue(element, strVal);
        this.dispatchInputEvents(element);
      } else {
        return {
          fieldId,
          beforeValue,
          plannedValue: value ?? optionIds,
          appliedValue: beforeValue,
          status: 'failed',
          error: `不支持向非原生表单控件 <${tag}> 写入数据，需接入专用交互适配器`,
        };
      }

      // 等待微任务与页面框架响应
      await new Promise((resolve) => setTimeout(resolve, 30));

      // 回读校验 (QA-004, QA-014)
      const currentElementValue = this.readElementValue(element);
      const appliedValue = currentElementValue;
      let isMatched = false;

      if (tag === 'select') {
        isMatched = String(appliedValue) === targetSelectVal;
      } else if (isCustomSelect) {
        const actualStr = String(appliedValue).trim();
        const expectedStr = String(targetSelectVal).trim();
        const normalize = (text: string) => text.replace(/[\(（]\d+[\)）]/g, '').replace(/\s+/g, ' ').trim();
        const rawTargets = Array.isArray(value)
          ? value.map(String)
          : String(value ?? optionIds?.[0] ?? '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);

        isMatched = Boolean(targetSelectVal) && Boolean(actualStr) && (
          actualStr === expectedStr ||
          normalize(actualStr) === normalize(expectedStr) ||
          actualStr.includes(expectedStr) ||
          expectedStr.includes(actualStr) ||
          normalize(actualStr).includes(normalize(expectedStr)) ||
          normalize(expectedStr).includes(normalize(actualStr)) ||
          (rawTargets.length > 0 && rawTargets.every((t) => normalize(actualStr).includes(normalize(t))))
        );
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        isMatched = targetRadio?.checked === true ||
          Boolean(
            (element as any)?.classList?.contains?.('is-checked') ||
            targetRadio?.parentElement?.classList?.contains?.('is-checked') ||
            targetRadio?.closest?.('label, .el-radio, .ant-radio')?.classList?.contains?.('is-checked')
          );
      } else if (input.type === 'checkbox') {
        isMatched = appliedValue === this.toStrictBoolean(value);
      } else if (input.type === 'number') {
        isMatched = String(appliedValue) === String(value);
      } else {
        isMatched = String(appliedValue) === String(value ?? '');
      }

      if (!isMatched) {
        const expectedText = tag === 'select' || isCustomSelect ? targetSelectVal : value;
        return {
          fieldId,
          beforeValue,
          plannedValue: value ?? optionIds,
          appliedValue,
          status: 'failed',
          error: `回读值校验失败：期望写入 "${expectedText}"，但实际 DOM 值为 "${appliedValue}"`,
        };
      }

      return {
        fieldId,
        beforeValue,
        plannedValue: value ?? optionIds,
        appliedValue: isCustomSelect ? (targetSelectVal || appliedValue) : appliedValue,
        status: 'success',
      };
    } catch (err) {
      return {
        fieldId,
        beforeValue,
        plannedValue: value ?? optionIds,
        status: 'failed',
        error: `填充执行异常：${(err as Error).message}`,
      };
    }
  }

  /**
   * 执行完整的表单填表计划
   */
  static async executePlan(
    snapshotId: string,
    assignments: FormFillAssignment[],
    mode: 'empty_only' | 'allow_overwrite' = 'empty_only',
    customRunId?: string
  ): Promise<FormFillRunRecord> {
    const runId = customRunId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activeRunId = runId;

    const runRecord: FormFillRunRecord = {
      runId,
      snapshotId,
      status: 'running',
      createdAt: Date.now(),
      steps: [],
    };

    // 缺陷 3: 若任务启动前已有待处理的取消信号，消费该信号并退出本次任务，同时重置标志避免锁死后续任务
    if (this.isCancelled) {
      runRecord.status = 'cancelled';
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
          runRecord.status = 'cancelled';
          break;
        }

        const stepResult = await this.executeAssignment(assignment, snapshotId, mode);
        runRecord.steps.push(stepResult);

        // IMP-05 / IMP-06: 实时向 Background 上报当前步骤执行结果
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          try {
            const sendPromise = chrome.runtime.sendMessage({
              type: 'UPDATE_TASK_STEP',
              payload: {
                runId,
                stepIndex,
                update: {
                  status: stepResult.status === 'success' ? 'success' : stepResult.status === 'skipped' ? 'skipped' : 'failed',
                  actionSent: true,
                  verified: stepResult.status === 'success',
                  error: stepResult.error,
                },
              },
            });
            if (sendPromise && typeof sendPromise.catch === 'function') {
              sendPromise.catch(() => {});
            }
          } catch {}
        }
        stepIndex += 1;
      }
    } finally {
      // 任务结束时自动复位取消状态，确保生产链路后续任务完全恢复可执行
      this.isCancelled = false;
      this.activeRunId = null;
    }

    runRecord.finishedAt = Date.now();
    if (runRecord.status === 'running') {
      const hasFailed = runRecord.steps.some((s) => s.status === 'failed');
      const hasSuccess = runRecord.steps.some((s) => s.status === 'success');
      if (hasFailed && hasSuccess) {
        runRecord.status = 'partial';
      } else if (hasFailed) {
        runRecord.status = 'failed';
      } else {
        runRecord.status = 'completed';
      }
    }

    // 存入运行历史
    this.runHistory.set(runId, runRecord);
    this.activeRunId = null;

    // IMP-05: 派发独立完成消息通知后台任务协调器收敛任务状态并释放占用 (QA-P1)
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const sendFinish = chrome.runtime.sendMessage({
          type: 'FINISH_TASK',
          payload: {
            runId,
            status: runRecord.status,
            error: runRecord.steps.find((s) => s.status === 'failed')?.error,
          },
        });
        if (sendFinish && typeof sendFinish.catch === 'function') {
          sendFinish.catch(() => {});
        }
      } catch {}
    }

    return runRecord;
  }

  /**
   * 撤销指定填表任务 (Undo)
   * 缺陷 7: 支持从外部持久化数据恢复 steps，刷新页面也能成功撤销
   */
  static async undo(
    runId: string,
    fallbackRecord?: { snapshotId?: string; steps?: FormFillStepResult[] }
  ): Promise<{
    success: boolean;
    restoredCount: number;
    conflictCount: number;
    error?: string;
  }> {
    const record =
      this.runHistory.get(runId) ||
      (fallbackRecord?.steps
        ? {
            runId,
            snapshotId: fallbackRecord.snapshotId || '',
            status: 'completed' as const,
            createdAt: Date.now(),
            steps: fallbackRecord.steps,
          }
        : undefined);

    if (!record) {
      return {
        success: false,
        restoredCount: 0,
        conflictCount: 0,
        error: `找不到填表运行记录: ${runId}`,
      };
    }

    let restoredCount = 0;
    let conflictCount = 0;

    // 逆序撤销恢复
    const steps = [...record.steps].reverse();
    const successfulSteps = steps.filter((s) => s.status === 'success' && s.appliedValue !== undefined);

    if (successfulSteps.length === 0) {
      return {
        success: true,
        restoredCount: 0,
        conflictCount: 0,
      };
    }

    // 缺陷 5: 真实网页刷新后 DOM 注册表清空，明确返回快照失效错误，不能静默返回成功
    let missingElementCount = 0;
    for (const step of successfulSteps) {
      const element = FormDOMRegistry.get(step.fieldId, record.snapshotId);
      if (!element || (typeof document !== 'undefined' && document.contains && !document.contains(element))) {
        missingElementCount++;
      }
    }

    if (missingElementCount === successfulSteps.length) {
      return {
        success: false,
        restoredCount: 0,
        conflictCount: missingElementCount,
        error: '当前网页已被刷新或重新加载，表单快照与控件映射已失效，无法在已刷新的页面上执行撤销恢复。',
      };
    }

    for (const step of steps) {
      // 仅撤销成功写入的字段
      if (step.status !== 'success' || step.appliedValue === undefined) {
        continue;
      }

      const element = FormDOMRegistry.get(step.fieldId, record.snapshotId);
      if (!element || (typeof document !== 'undefined' && document.contains && !document.contains(element))) {
        conflictCount++;
        continue;
      }

      const currentVal = this.readElementValue(element);

      // 冲突感知：当前 DOM 值必须依然等于该任务写入的 appliedValue
      if (String(currentVal) !== String(step.appliedValue)) {
        conflictCount++;
        continue;
      }

      // 恢复为 beforeValue
      const tag = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;

      if (input.type === 'radio' || (tag !== 'select' && FormScanner.isDropdownComponent(element, FormScanner.findDropdownRoot(element)))) {
        // Restore through the component interaction, never by changing its display input.
        if (step.beforeValue === '') {
          conflictCount++;
          continue;
        }
        const restored = await this.executeAssignment({ fieldId: step.fieldId, action: input.type === 'radio' ? 'check' : 'select', value: step.beforeValue, source: 'instruction' }, record.snapshotId, 'allow_overwrite');
        if (restored.status !== 'success') {
          conflictCount++;
          continue;
        }
      } else if (input.type === 'checkbox') {
        const targetBool = this.toStrictBoolean(step.beforeValue);
        if (input.checked !== targetBool) {
          input.checked = targetBool;
          this.dispatchInputEvents(input);
        }
      } else if (tag === 'select') {
        (element as HTMLSelectElement).value = String(step.beforeValue);
        this.dispatchInputEvents(element);
      } else {
        this.setNativeValue(element, String(step.beforeValue));
        this.dispatchInputEvents(element);
      }

      restoredCount++;
    }

    record.status = 'undone';
    return {
      success: true,
      restoredCount,
      conflictCount,
    };
  }
}
