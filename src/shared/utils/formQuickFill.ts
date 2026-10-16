import { FormFillAssignment, FormFillTemplate, FormSnapshot, FormFillRunRecord } from '../types/formFill';
import { ExecuteFormFillResponse, ScanFormSnapshotResponse, sendToBackground } from '../messages';
import { matchTemplateField } from './formTemplateMatching';
import { formFillRunRepo } from '../../db/repositories/formFillRunRepository';
import { formFillHistoryRepo } from '../../db/repositories/formFillHistoryRepository';

export interface TemplateQuickFillResult {
  success: boolean;
  message: string;
  filledCount?: number;
  totalCount?: number;
  snapshot?: FormSnapshot;
  runRecord?: FormFillRunRecord;
}

/**
 * 极速根据模板填充当前活动网页的表单字段并回读校验
 */
export async function executeTemplateQuickFill(template: FormFillTemplate): Promise<TemplateQuickFillResult> {
  // 1. 扫描当前活动页面
  const scanRes = await sendToBackground<ScanFormSnapshotResponse>({
    type: 'SCAN_FORM_SNAPSHOT',
    payload: undefined,
  });

  const activeSnap = scanRes?.snapshot;
  if (!activeSnap) {
    return { success: false, message: scanRes?.error || '未找到活动页面，请刷新被测网页后重试' };
  }

  const targetFields = activeSnap.fields;
  if (targetFields.length === 0) {
    return { success: false, message: '当前页面未检测到可填充的表单字段', snapshot: activeSnap };
  }

  const quickAssignments: FormFillAssignment[] = [];
  const matchedFieldIds = new Set<string>();

  for (const rule of template.rules) {
    const matched = matchTemplateField(rule, targetFields, matchedFieldIds);
    if (matched) {
      matchedFieldIds.add(matched.fieldId);
      let optionIds: string[] | undefined;
      if (matched.options && matched.options.length > 0) {
        const valStr = String(rule.value).trim();
        const opt = matched.options.find(
          (o) => o.value === valStr || o.label?.trim() === valStr || o.optionId === valStr
        );
        if (opt) {
          optionIds = [opt.optionId];
        }
      }

      quickAssignments.push({
        fieldId: matched.fieldId,
        action: rule.action || (matched.kind === 'select' ? 'select' : matched.kind === 'checkbox' || matched.kind === 'radio' ? 'check' : 'fill'),
        value: rule.value,
        optionIds,
        source: 'instruction',
        reason: `来自模板 [${template.name}]`,
        expectedBeforeValue: matched.currentValue,
        wasEmpty: matched.isEmpty,
      });
    }
  }

  if (quickAssignments.length === 0) {
    return { success: false, message: `当前页面未找到与模板 [${template.name}] 匹配的可用字段`, snapshot: activeSnap };
  }

  const currentRunId = `run_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const res = await sendToBackground<ExecuteFormFillResponse>({
    type: 'EXECUTE_FORM_FILL',
    payload: {
      runId: currentRunId,
      snapshotId: activeSnap.snapshotId,
      targetTabId: activeSnap.tabId,
      mode: 'allow_overwrite',
      assignments: quickAssignments,
    },
  });

  if (!res || res.error || !res.runRecord) {
    return { success: false, message: res?.error || '模板一键填充执行失败', snapshot: activeSnap };
  }

  await formFillRunRepo.save(res.runRecord).catch(() => {});
  // 记录到填表历史
  await formFillHistoryRepo.save({
    id: `hist_${Date.now()}`,
    url: activeSnap.url || '',
    timestamp: Date.now(),
    title: `模板填表: ${template.name}`,
    fields: quickAssignments.map((a) => ({
      fieldId: a.fieldId,
      label: activeSnap.fields.find((f) => f.fieldId === a.fieldId)?.label || a.fieldId,
      value: a.value ?? '',
      kind: activeSnap.fields.find((f) => f.fieldId === a.fieldId)?.kind || 'text',
      source: 'instruction',
    })),
  }).catch(() => {});

  const successCount = res.runRecord.steps.filter((s) => s.status === 'success').length;
  return {
    success: true,
    message: `⚡ 模板 [${template.name}] 填充完成：已成功写入 ${successCount}/${quickAssignments.length} 个字段`,
    filledCount: successCount,
    totalCount: quickAssignments.length,
    snapshot: activeSnap,
    runRecord: res.runRecord,
  };
}
