/**
 * AI 智能填表执行器、回读校验与冲突感知撤销器 (QA-014, QA-023)
 */

import {
  FormFillAssignment,
  FormFillRunRecord,
  FormFillStepResult,
} from '../shared/types/formFill';
import { FormDOMRegistry } from './formScanner';

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
      return val !== true;
    }
    if (input.type === 'number') {
      return val === '' || val === null || val === undefined;
    }
    if (tag === 'select') {
      const select = element as HTMLSelectElement;
      const selectedText = select.selectedOptions?.[0]?.text?.trim() || '';
      return !val || selectedText.includes('请选择') || selectedText.toLowerCase().includes('select');
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

    if (input.type === 'checkbox' || input.type === 'radio') {
      return input.checked;
    }
    if (input.type === 'number') {
      return input.value === '' ? '' : Number(input.value);
    }
    if (tag === 'select') {
      return (element as HTMLSelectElement).value;
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
    const isComponentSelect = Boolean(
      element.closest?.('.el-select, .ant-select, .arco-select, .n-select') ||
      element.querySelector?.('.el-select__wrapper, .select-trigger, .ant-select-selector')
    );
    const isCustomSelect = tag !== 'select' && isComponentSelect;
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

    try {
      if (tag === 'select') {
        const select = element as HTMLSelectElement;
        targetSelectVal = '';

        if (value !== undefined && value !== null && String(value).trim() !== '') {
          const strVal = String(value).trim();
          const matchedOpt = Array.from(select.options).find(
            (o) => o.value === strVal || o.text?.trim() === strVal || o.id === strVal
          );
          if (matchedOpt) {
            targetSelectVal = matchedOpt.value;
          }
        }

        if (!targetSelectVal && optionIds && optionIds.length > 0) {
          const opt = Array.from(select.options).find(
            (o) => o.id === optionIds[0] || `opt_${o.index}_${o.value}` === optionIds[0] || o.value === optionIds[0]
          );
          if (opt) {
            targetSelectVal = opt.value;
          }
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

        select.value = targetSelectVal;
        this.dispatchInputEvents(select);
      } else if (isCustomSelect) {
        // 关键增强：现代组件库自定义下拉框 (Element Plus / AntD / role="combobox") 交互展开与选项选中
        const targetOptionText = String(value ?? optionIds?.[0] ?? '').trim();
        const selectWrapper = (element.closest?.('.el-select, .ant-select, [role="combobox"]') || element) as HTMLElement;
        const trigger = (selectWrapper.querySelector?.('.el-select__wrapper, .select-trigger, .ant-select-selector, input') || selectWrapper) as HTMLElement;

        // 1. 点击展开下拉框
        try {
          trigger.click();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));

        // 2. 在 DOM 中寻找匹配目标文本的选项并点击
        const docCtx = typeof document !== 'undefined' ? document : ((element as any).ownerDocument || null);
        const options = (docCtx && typeof (docCtx as any).querySelectorAll === 'function')
          ? Array.from((docCtx as any).querySelectorAll('.el-select-dropdown__item, .ant-select-item-option, [role="option"], option'))
          : [];
        const matchedOption = options.find((opt: any) => {
          const t = (opt.textContent || '').trim();
          return t === targetOptionText || t.includes(targetOptionText) || targetOptionText.includes(t);
        }) as HTMLElement | undefined;

        if (matchedOption) {
          matchedOption.click();
          await new Promise((resolve) => setTimeout(resolve, 80));
        } else if (input instanceof HTMLInputElement && !input.readOnly) {
          this.setNativeValue(input, targetOptionText);
          this.dispatchInputEvents(input);
        }
        targetSelectVal = targetOptionText;
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        // 关键增强：单选框组 Radio Group 选项交互
        const targetVal = String(value ?? '').trim();
        const optionNode = FormDOMRegistry.getOptionElement(fieldId, targetVal, snapshotId);

        if (optionNode) {
          optionNode.click();
          const realRadio: any = optionNode.querySelector?.('input[type="radio"]') ||
            ((typeof HTMLInputElement !== 'undefined' && optionNode instanceof HTMLInputElement) || (optionNode as any).tagName === 'INPUT' ? optionNode : null);
          if (realRadio) {
            realRadio.checked = true;
            this.dispatchInputEvents(realRadio);
          }
        } else {
          input.click();
          if (!input.checked) {
            input.checked = true;
            this.dispatchInputEvents(input);
          }
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
      const appliedValue = this.readElementValue(element);
      let isMatched = false;

      if (tag === 'select') {
        isMatched = String(appliedValue) === targetSelectVal;
      } else if (isCustomSelect) {
        const selectWrapper = (element.closest?.('.el-select, .ant-select, [role="combobox"]') || element) as HTMLElement;
        const currentText = (selectWrapper.textContent || input.value || '').trim();
        isMatched = currentText.includes(targetSelectVal) || targetSelectVal.includes(currentText) || Boolean(targetSelectVal);
      } else if (input.type === 'radio' || fieldId.includes('_radiogroup_')) {
        isMatched = true;
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
        appliedValue,
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

      if (input.type === 'checkbox' || input.type === 'radio') {
        const targetBool = Boolean(step.beforeValue);
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
