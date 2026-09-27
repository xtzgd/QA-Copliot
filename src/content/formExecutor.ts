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
      const selectedItem = selectWrapper.querySelector?.(
        '.vue-treeselect__single-value, .el-select__selected-item:not(.is-transparent), .el-select__tags-text, .ant-select-selection-item, .ant-select-selection-selected-value, .arco-select-view-value, .n-base-selection-label, .el-select-dropdown__item.is-selected, [class*="single-value"]'
      );
      if (selectedItem?.textContent?.trim()) {
        return selectedItem.textContent.trim();
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
        const targetOptionText = String(value ?? optionIds?.[0] ?? '').trim();
        let docCtx: any = (element as any).ownerDocument;
        let rootNode: any = element;
        while (rootNode && (rootNode.parentElement || rootNode.parentNode)) {
          rootNode = rootNode.parentElement || rootNode.parentNode;
        }
        if (!docCtx || typeof docCtx.querySelectorAll !== 'function') {
          docCtx = typeof document !== 'undefined' ? document : rootNode;
        }

        // 辅助方法：模拟派发完整的手势与点击事件流 (触发 React rc-select / Vue Element Plus 的事件监听)
        const dispatchFullClick = (el: HTMLElement) => {
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
            }
          } catch {
            try { el.click?.(); } catch {}
          }
        };

        // 1. 点击展开下拉框（选出唯一定位最好的 trigger，且只触发一次点击，避免连续点击导致先展开后立即收起）
        const trigger = (
          selectWrapper.querySelector?.(
            '.el-select__wrapper, .vue-treeselect__control, .ant-select-selector, .arco-select-view, .n-base-selection, .select-trigger'
          ) ||
          selectWrapper.querySelector?.('input') ||
          selectWrapper
        ) as HTMLElement;

        if (trigger.getAttribute?.('aria-expanded') !== 'true' && selectWrapper.getAttribute?.('aria-expanded') !== 'true') dispatchFullClick(trigger);
        await new Promise((resolve) => setTimeout(resolve, 80));

        // 2. 轮询等待选项浮层 (Popper / Dropdown) 渲染完成 (最多等待 800ms)
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

        // Resolve again on every iteration: lazy loading can replace both menu and option nodes.
        const normalize = (text: string) => text.replace(/[\(（]\d+[\)）]/g, '').replace(/\s+/g, ' ').trim();
        const path = targetOptionText.split(/\s*(?:\/|>|→|\|)\s*/).filter(Boolean);
        let level = 0;
        let selected = false;
        let searched = false;
        let searchInputUsed: HTMLInputElement | null = null;
        let previousSearch = '';
        let clearedTreeSearch = false;
        const hierarchySelectors = '.vue-treeselect, .el-tree-select, .el-cascader, .ant-tree-select, .ant-cascader, .arco-tree-select, .arco-cascader, .n-tree-select, .n-cascader, [aria-haspopup="tree"]';
        const isHierarchical = (container: HTMLElement) => path.length > 1 ||
          Boolean(selectWrapper.matches?.(hierarchySelectors) || selectWrapper.closest?.(hierarchySelectors) ||
            selectWrapper.querySelector?.('input.vue-treeselect__input') ||
            container.querySelector?.('[role="tree"], [role="treeitem"], .el-tree-node, .vue-treeselect__option, .el-cascader-node, .ant-cascader-menu-item'));
        let associatedMenuFound = false;
        let visibleOptionCount = 0;
        const expanded = new WeakSet<HTMLElement>();
        const deadline = Date.now() + 3500;
        const usable = (node: HTMLElement): boolean => {
          for (let current: HTMLElement | null = node; current; current = current.parentElement) {
            const style = current.ownerDocument?.defaultView?.getComputedStyle(current) || current.style;
            if (current.hidden || style?.display === 'none' || style?.visibility === 'hidden' || current.getAttribute?.('aria-hidden') === 'true') return false;
          }
          return node.getAttribute?.('aria-disabled') !== 'true' && !node.closest?.('[disabled], [aria-disabled="true"], .is-disabled, .ant-select-item-option-disabled');
        };
        const label = (node: HTMLElement) => (node.querySelector?.('.el-cascader-node__label, .ant-cascader-menu-item-content, .vue-treeselect__label, .el-tree-node__label, .ant-select-item-option-content')?.textContent || node.textContent || '').trim();
        while (Date.now() < deadline && !this.isCancelled) {
          const associated = FormScanner.findAssociatedDropdownContainer(element, selectWrapper, docCtx);
          associatedMenuFound ||= Boolean(associated);
          const container = associated || selectWrapper;
          if (!clearedTreeSearch && isHierarchical(container)) {
            clearedTreeSearch = true;
            const treeSearch = selectWrapper.querySelector?.('input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input') as HTMLInputElement | null;
            if (treeSearch?.value && !treeSearch.readOnly) {
              this.setNativeValue(treeSearch, '');
              this.dispatchInputEvents(treeSearch);
              await new Promise(resolve => setTimeout(resolve, 100));
              continue;
            }
          }
          const options = (Array.from(container.querySelectorAll?.(optionSelectors) || []) as HTMLElement[]).filter(node => usable(node) && !node.querySelector?.('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]'));
          visibleOptionCount = options.length;
          const target = path[level] || targetOptionText;
          const byId = options.filter(node => (path.length <= 1 && optionIds?.includes(node.id)) || (node.getAttribute?.('data-value') ?? node.getAttribute?.('value')) === target);
          const exact = options.filter(node => label(node) === target);
          const matches = byId.length ? byId : exact.length ? exact : options.filter(node => normalize(label(node)) === normalize(target));
          const matched = matches.length === 1 ? matches[0] : !target ? options.find(node => label(node) && !label(node).includes('请选择')) : undefined;
          if (matched) {
            matched.scrollIntoView?.({ block: 'nearest' });
            dispatchFullClick(matched);
            if (level < path.length - 1) {
              level++;
              await new Promise(resolve => setTimeout(resolve, 100));
              continue;
            }
            targetSelectVal = label(matched);
            selected = true;
            break;
          }
          // Only expand collapsed tree branches inside this control's associated menu.
          const arrows = Array.from(container.querySelectorAll?.('.el-tree-node__expand-icon:not(.is-leaf):not(.expanded), .ant-select-tree-switcher_close, .vue-treeselect__option-arrow-container, [aria-expanded="false"] > .vue-treeselect__option-arrow') || []) as HTMLElement[];
          if (path.length <= 1) {
            for (const node of options) {
              if (node.querySelector?.('.el-cascader-node__postfix, .ant-cascader-menu-item-expand-icon, .arco-cascader-list-item-expand-icon')) arrows.push(node);
            }
          }
          const arrow = arrows.find(node => usable(node) && !expanded.has(node) && !node.closest?.('.vue-treeselect__option--expanded') && !node.querySelector?.('.vue-treeselect__option-arrow--rotated'));
          if (arrow) {
            expanded.add(arrow);
            dispatchFullClick(arrow);
          } else if (!searched && !isHierarchical(container) && target && value !== undefined) {
            const search = selectWrapper.querySelector?.('input.vue-treeselect__input, input.el-select__input, input.ant-select-selection-search-input') as HTMLInputElement | null;
            if (search && !search.readOnly) {
              searchInputUsed = search;
              previousSearch = search.value;
              this.setNativeValue(search, target);
              this.dispatchInputEvents(search);
            }
            searched = true;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!selected && searchInputUsed && searchInputUsed.value !== previousSearch) {
          this.setNativeValue(searchInputUsed, previousSearch);
          this.dispatchInputEvents(searchInputUsed);
        }
        if (!selected) throw new Error(`下拉选择失败：${associatedMenuFound ? '已找到浮层' : '未找到关联浮层'}；可用选项 ${visibleOptionCount} 项；第 ${level + 1} 级目标「${path[level] || targetOptionText}」未匹配。`);
        // Give reactive rendering time to commit; never manufacture the display value.
        const verifyUntil = Date.now() + 1500;
        const expected = normalize(targetSelectVal);
        while (Date.now() < verifyUntil) {
          const actual = String(this.readElementValue(element)).trim();
          const parts = actual.split(/\s*(?:\/|>|→)\s*/);
          if (normalize(actual) === expected || (path.length > 1 && parts.length === path.length && parts.every((part, index) => normalize(part) === normalize(path[index])))) {
            targetSelectVal = actual;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        // 关键增强：单选框组 Radio Group 选项交互
        const targetVal = String(value ?? optionIds?.[0] ?? '').trim();
        const optionNode = FormDOMRegistry.getOptionElement(fieldId, targetVal, snapshotId) ||
          (optionIds?.[0] ? FormDOMRegistry.getOptionElement(fieldId, optionIds[0], snapshotId) : null);
        targetRadio = (optionNode?.querySelector?.('input[type="radio"]') ||
          (optionNode?.tagName === 'INPUT' ? optionNode : null)) as HTMLInputElement | null;
        if (!targetRadio || targetRadio.disabled || targetRadio.isConnected === false) {
          throw new Error('单选目标不存在、已失效或被禁用');
        }
        optionNode!.click();
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
        isMatched = Boolean(targetSelectVal) && String(appliedValue).trim() === targetSelectVal.trim();
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        isMatched = targetRadio?.checked === true;
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
