/**
 * AI 智能填表交互页面 (QA-013)
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  FileSpreadsheet,
  FolderCheck,
  History,
  Play,
  RotateCcw,
  Sparkles,
  Star,
  StopCircle,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  FormFillAssignment,
  FormFieldItem,
  FormFillHistoryField,
  FormFillHistoryRecord,
  FormFillRunRecord,
  FormFillTemplate,
  FormSnapshot,
} from '../../shared/types/formFill';
import {
  ExecuteFormFillResponse,
  ScanFormSnapshotResponse,
  UndoFormFillResponse,
  sendToBackground,
} from '../../shared/messages';
import { aiProviderService } from '../../ai';
import { formFillRunRepo } from '../../db/repositories/formFillRunRepository';
import { formFillTemplateRepo } from '../../db/repositories/formFillTemplateRepository';
import { formFillHistoryRepo } from '../../db/repositories/formFillHistoryRepository';
import { matchTemplateField } from '../../shared/utils/formTemplateMatching';
import { useAppStore } from '../store/useAppStore';

interface EditableAssignment extends FormFillAssignment {
  checked: boolean;
  fieldLabel: string;
  fieldKind: string;
  currentValue: string | number | boolean;
  isEmpty: boolean;
}

export const AiFillPage: React.FC = () => {
  const { setToastMessage } = useAppStore();

  const [snapshot, setSnapshot] = useState<FormSnapshot | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string>('all');
  const [instruction, setInstruction] = useState<string>('联系人张三，公司星河科技，行业软件服务，其他空白字段合理生成');
  const [sourceText, setSourceText] = useState<string>('');
  const [fillMode, setFillMode] = useState<'empty_only' | 'allow_overwrite'>('empty_only');

  const [templates, setTemplates] = useState<FormFillTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isTemplatesExpanded, setIsTemplatesExpanded] = useState(true);
  const [isQuickFillingTemplateId, setIsQuickFillingTemplateId] = useState<string | null>(null);

  const [histories, setHistories] = useState<FormFillHistoryRecord[]>([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [isQuickFillingId, setIsQuickFillingId] = useState<string | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);

  const [assignments, setAssignments] = useState<EditableAssignment[]>([]);
  const [unresolved, setUnresolved] = useState<Array<{ fieldId: string; reason: string }>>([]);
  const [lastRunRecord, setLastRunRecord] = useState<FormFillRunRecord | null>(null);

  // 加载填写模板列表 (IMP-10) 与填表历史记录
  useEffect(() => {
    formFillTemplateRepo.listAll().then((list) => {
      setTemplates(list);
    }).catch((err) => {
      console.warn('[QA Copilot] 加载填写模板失败:', err);
    });

    formFillHistoryRepo.listAll().then((list) => {
      setHistories(list);
    }).catch((err) => {
      console.warn('[QA Copilot] 加载填表历史记录失败:', err);
    });
  }, []);

  // 页面加载或切换快照时，自动从 IndexedDB 恢复最近一次填表记录与撤销依据 (QA-014, QA-016)
  React.useEffect(() => {
    let isMounted = true;
    const restoreHistory = async () => {
      try {
        let record: FormFillRunRecord | undefined;
        if (snapshot?.snapshotId) {
          record = await formFillRunRepo.getLatestBySnapshot(snapshot.snapshotId);
        }
        if (!record && snapshot?.tabId !== undefined) {
          record = await formFillRunRepo.getLatestByTab(snapshot.tabId);
        }
        if (!record) {
          const list = await formFillRunRepo.listAll(1);
          record = list[0];
        }
        if (isMounted && record) {
          setLastRunRecord(record);
        }
      } catch (err) {
        console.warn('[QA Copilot] 恢复填表记录失败:', err);
      }
    };
    restoreHistory();
    return () => {
      isMounted = false;
    };
  }, [snapshot?.snapshotId, snapshot?.tabId]);

  // 1. 扫描当前网页表单
  const handleScanForm = async () => {
    setIsScanning(true);
    setAssignments([]);
    setUnresolved([]);

    const res = await sendToBackground<ScanFormSnapshotResponse>({
      type: 'SCAN_FORM_SNAPSHOT',
      payload: undefined,
    });

    setIsScanning(false);
    if (!res || res.error || !res.snapshot) {
      setToastMessage(res?.error || '未找到活动页面或页面未就绪，请刷新被测网页后重试');
      return;
    }

    setSnapshot(res.snapshot);
    if (res.snapshot.forms.length > 0) {
      setSelectedFormId('all');
    }
    const emptyCount = res.snapshot.fields.filter((f) => f.isEmpty).length;
    setToastMessage(`识别到 ${res.snapshot.fields.length} 个字段（其中 ${emptyCount} 个待填写空白项）`);
  };

  // 过滤当前表单下的字段
  const currentFields: FormFieldItem[] = React.useMemo(() => {
    if (!snapshot) return [];
    if (selectedFormId === 'all') return snapshot.fields;
    return snapshot.fields.filter((f) => f.formId === selectedFormId);
  }, [snapshot, selectedFormId]);

  // 当前表单中已录入非空有效值的字段数
  const filledCount = React.useMemo(() => {
    return currentFields.filter(
      (f) =>
        !f.disabled &&
        !f.readOnly &&
        f.kind !== 'unsupported' &&
        f.currentValue !== null &&
        f.currentValue !== undefined &&
        String(f.currentValue).trim() !== '' &&
        String(f.currentValue).trim() !== '请选择' &&
        String(f.currentValue).trim() !== '--请选择--'
    ).length;
  }, [currentFields]);

  // 2. 生成填表计划
  const handleGeneratePlan = async () => {
    if (!snapshot || currentFields.length === 0) {
      setToastMessage('请先识别当前页面表单');
      return;
    }
    if (!instruction.trim()) {
      setToastMessage('请输入填写要求或选择快捷模版');
      return;
    }

    setIsPlanning(true);
    try {
      const plan = await aiProviderService.planFormFill({
        snapshotId: snapshot.snapshotId,
        instruction,
        sourceText,
        mode: fillMode,
        fields: currentFields,
      });

      const fieldMap = new Map<string, FormFieldItem>(currentFields.map((f) => [f.fieldId, f]));

      const editableList: EditableAssignment[] = plan.assignments.map((item) => {
        const f = fieldMap.get(item.fieldId);
        return {
          ...item,
          checked: item.action !== 'skip',
          fieldLabel: f?.label || item.fieldId,
          fieldKind: f?.kind || 'text',
          currentValue: f?.currentValue ?? '',
          isEmpty: f?.isEmpty ?? false,
          expectedBeforeValue: f?.currentValue ?? '',
          wasEmpty: f?.isEmpty ?? false,
        };
      });

      setAssignments(editableList);
      setUnresolved(plan.unresolved);
      const readyCount = editableList.filter((a) => a.checked).length;
      setToastMessage(`方案生成完毕，推荐填充 ${readyCount} 项字段`);
    } catch (err) {
      setToastMessage((err as Error).message);
    } finally {
      setIsPlanning(false);
    }
  };

  // 3. 执行填表
  const handleExecuteFill = async () => {
    if (!snapshot) return;
    const selectedAssignments = assignments.filter((a) => a.checked);
    if (selectedAssignments.length === 0) {
      setToastMessage('请至少勾选一个要填充的字段');
      return;
    }

    const currentRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setExecutingRunId(currentRunId);
    setIsExecuting(true);

    let res: ExecuteFormFillResponse | null = null;
    try {
      res = await sendToBackground<ExecuteFormFillResponse>({
        type: 'EXECUTE_FORM_FILL',
        payload: {
          runId: currentRunId,
          snapshotId: snapshot.snapshotId,
          targetTabId: snapshot.tabId,
          mode: fillMode,
          assignments: selectedAssignments.map((a) => ({
            fieldId: a.fieldId,
            action: a.action,
            value: a.value,
            optionIds: a.optionIds,
            source: a.source,
            reason: a.reason,
            expectedBeforeValue: a.expectedBeforeValue,
            wasEmpty: a.wasEmpty,
          })),
        },
      });
    } finally {
      setIsExecuting(false);
      setExecutingRunId(null);
    }

    if (!res || res.error || !res.runRecord) {
      setToastMessage(res?.error || '执行填充失败');
      return;
    }

    setLastRunRecord(res.runRecord);
    // 持久化到 IndexedDB 数据库 (QA-014, QA-016)
    await formFillRunRepo.save(res.runRecord).catch((err) => {
      console.warn('[QA Copilot] 保存填表运行记录失败:', err);
    });

    const successCount = res.runRecord.steps.filter((s) => s.status === 'success').length;
    const failCount = res.runRecord.steps.filter((s) => s.status === 'failed').length;

    // 自动留存填表历史记录 (支持跨快照/刷新后一键复用)
    if (successCount > 0) {
      try {
        const successStepIds = new Set(
          res.runRecord.steps.filter((s) => s.status === 'success').map((s) => s.fieldId)
        );
        const historyFields: FormFillHistoryField[] = [];
        for (const assign of selectedAssignments) {
          if (successStepIds.has(assign.fieldId) && assign.action !== 'skip') {
            const field = currentFields.find((f) => f.fieldId === assign.fieldId);
            const stepResult = res.runRecord.steps.find((s) => s.fieldId === assign.fieldId);
            historyFields.push({
              label: assign.fieldLabel || field?.label || assign.fieldId,
              name: field?.name || assign.fieldId.split('_').slice(3).join('_'),
              kind: (assign.fieldKind as any) || field?.kind || 'text',
              value: stepResult?.appliedValue ?? assign.value ?? '',
              action: assign.action,
            });
          }
        }

        if (historyFields.length > 0) {
          const currentForm = snapshot.forms.find((f) => f.formId === selectedFormId);
          const formTitle = currentForm?.title || snapshot.title || '常用表单';
          const historyRecord: FormFillHistoryRecord = {
            id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: `${formTitle} (${historyFields.length}项)`,
            url: snapshot.url || '',
            formTitle,
            timestamp: Date.now(),
            fields: historyFields,
          };
          await formFillHistoryRepo.save(historyRecord);
          const updatedHistories = await formFillHistoryRepo.listAll();
          setHistories(updatedHistories);
        }
      } catch (err) {
        console.warn('[QA Copilot] 自动保存填表历史失败:', err);
      }
    }

    if (failCount === 0) {
      setToastMessage(`🎉 成功完成 ${successCount} 项字段填充并回读校验通过！`);
    } else {
      setToastMessage(`填充完成：${successCount} 项成功，${failCount} 项回读异常`);
    }
  };

  // 4. 取消执行 (停止当前正在执行的填表任务，缺陷 1: 绝不传已过期的旧任务 ID)
  const handleCancelFill = async () => {
    await sendToBackground({
      type: 'CANCEL_FORM_FILL',
      payload: {
        targetTabId: snapshot?.tabId,
        runId: executingRunId || undefined,
      },
    });
    setToastMessage('已发送停止信号');
  };

  // 5. 撤销填充 (Undo，支持页面刷新后通过落库 steps 恢复)
  const handleUndo = async () => {
    if (!lastRunRecord) return;
    const res = await sendToBackground<UndoFormFillResponse>({
      type: 'UNDO_FORM_FILL',
      payload: {
        runId: lastRunRecord.runId,
        targetTabId: lastRunRecord.tabId ?? snapshot?.tabId,
        snapshotId: lastRunRecord.snapshotId,
        steps: lastRunRecord.steps,
      },
    });

    if (res?.success) {
      setToastMessage(`已撤销恢复 ${res.restoredCount} 项字段${res.conflictCount > 0 ? `（${res.conflictCount} 项因手动更改跳过）` : ''}`);
      // 重新扫描以更新当前值
      handleScanForm();
    } else {
      setToastMessage(res?.error || '撤销失败');
    }
  };

  /**
   * ⚡ 一键填表 (One-Click Fill)
   * 自动探测当前页面、根据历史字段语义特征动态映射真实 DOM 节点并极速执行填充与回读
   */
  const handleQuickFill = async (history: FormFillHistoryRecord) => {
    setIsQuickFillingId(history.id);
    try {
      // 1. 如果当前尚未扫描表单，自动执行静默扫描
      let activeSnap = snapshot;
      if (!activeSnap) {
        setIsScanning(true);
        const scanRes = await sendToBackground<ScanFormSnapshotResponse>({
          type: 'SCAN_FORM_SNAPSHOT',
          payload: undefined,
        });
        setIsScanning(false);
        if (!scanRes || scanRes.error || !scanRes.snapshot) {
          setToastMessage(scanRes?.error || '未找到活动页面，请刷新被测网页后重试');
          return;
        }
        activeSnap = scanRes.snapshot;
        setSnapshot(scanRes.snapshot);
      }

      const targetFields = activeSnap.fields;
      if (targetFields.length === 0) {
        setToastMessage('当前页面未检测到可填充的表单字段');
        return;
      }

      // 2. 动态特征匹配（永不硬编码失效 ID）
      const quickAssignments: FormFillAssignment[] = [];
      const matchedFieldIds = new Set<string>();

      for (const hField of history.fields) {
        const matched = targetFields.find((f) => {
          if (matchedFieldIds.has(f.fieldId)) return false;
          if (f.disabled || f.readOnly || f.kind === 'unsupported') return false;

          // 规则 a: 控件 name 相同
          if (hField.name && f.name && hField.name === f.name) return true;

          // 规则 b: Label 完全相同或语义包含
          const hl = hField.label.trim().toLowerCase();
          const fl = f.label.trim().toLowerCase();
          if (hl === fl) return true;
          if (hl.length >= 2 && (fl.includes(hl) || hl.includes(fl))) return true;

          return false;
        });

        if (matched) {
          matchedFieldIds.add(matched.fieldId);
          let optionIds: string[] | undefined;
          if (matched.options && matched.options.length > 0) {
            const valStr = String(hField.value).trim();
            const opt = matched.options.find(
              (o) => o.value === valStr || o.label?.trim() === valStr || o.optionId === valStr
            );
            if (opt) {
              optionIds = [opt.optionId];
            }
          }

          quickAssignments.push({
            fieldId: matched.fieldId,
            action: hField.action || (matched.kind === 'select' ? 'select' : matched.kind === 'checkbox' || matched.kind === 'radio' ? 'check' : 'fill'),
            value: hField.value,
            optionIds,
            source: 'instruction',
            reason: `来自一键填表历史 [${history.title}]`,
            expectedBeforeValue: matched.currentValue,
            wasEmpty: matched.isEmpty,
          });
        }
      }

      if (quickAssignments.length === 0) {
        setToastMessage(`当前页面未找到与历史记录 [${history.title}] 匹配的可用字段`);
        return;
      }

      // 3. 极速执行填充
      const currentRunId = `run_quick_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setExecutingRunId(currentRunId);
      setIsExecuting(true);

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

      setIsExecuting(false);
      setExecutingRunId(null);

      if (!res || res.error || !res.runRecord) {
        setToastMessage(res?.error || '一键填表执行失败');
        return;
      }

      setLastRunRecord(res.runRecord);
      await formFillRunRepo.save(res.runRecord).catch(() => {});

      const successCount = res.runRecord.steps.filter((s) => s.status === 'success').length;
      setToastMessage(`⚡ 一键填表成功！已完成 ${successCount}/${quickAssignments.length} 项字段填充并回读校验通过`);

      // 重新静默扫描以同步页面最新状态
      handleScanForm();
    } catch (err) {
      setToastMessage(`一键填表异常: ${(err as Error).message}`);
    } finally {
      setIsQuickFillingId(null);
      setIsExecuting(false);
      setExecutingRunId(null);
    }
  };

  /**
   * 载入历史记录到下方方案预览中（方便微调个别字段）
   */
  const handleLoadHistory = (history: FormFillHistoryRecord) => {
    if (!snapshot) {
      setToastMessage('请先点击上方“识别当前网页表单”');
      return;
    }

    const matchedFieldIds = new Set<string>();
    const editableList: EditableAssignment[] = [];

    for (const hField of history.fields) {
      const field = currentFields.find((f) => {
        if (matchedFieldIds.has(f.fieldId)) return false;
        if (f.disabled || f.readOnly || f.kind === 'unsupported') return false;
        if (hField.name && f.name && hField.name === f.name) return true;
        const hl = hField.label.trim().toLowerCase();
        const fl = f.label.trim().toLowerCase();
        if (hl === fl) return true;
        if (hl.length >= 2 && (fl.includes(hl) || hl.includes(fl))) return true;
        return false;
      });

      if (field) {
        matchedFieldIds.add(field.fieldId);
        let optionIds: string[] | undefined;
        if (field.options && field.options.length > 0) {
          const valStr = String(hField.value).trim();
          const opt = field.options.find(
            (o) => o.value === valStr || o.label?.trim() === valStr || o.optionId === valStr
          );
          if (opt) {
            optionIds = [opt.optionId];
          }
        }

        editableList.push({
          fieldId: field.fieldId,
          action: hField.action || (field.kind === 'select' ? 'select' : field.kind === 'checkbox' || field.kind === 'radio' ? 'check' : 'fill'),
          value: hField.value,
          optionIds,
          source: 'instruction',
          reason: `载入历史记录 [${history.title}]`,
          expectedBeforeValue: field.currentValue,
          wasEmpty: field.isEmpty,
          checked: true,
          fieldLabel: field.label,
          fieldKind: field.kind,
          currentValue: field.currentValue,
          isEmpty: field.isEmpty,
        });
      }
    }

    if (editableList.length === 0) {
      setToastMessage(`当前页面未找到与历史记录 [${history.title}] 匹配的字段`);
      return;
    }

    setAssignments(editableList);
    setToastMessage(`已将历史 [${history.title}] 的 ${editableList.length} 项字段载入方案预览，您可以微调后执行`);
  };

  const handleToggleFavorite = async (id: string) => {
    await formFillHistoryRepo.toggleFavorite(id);
    const updated = await formFillHistoryRepo.listAll();
    setHistories(updated);
  };

  const handleDeleteHistory = async (id: string) => {
    await formFillHistoryRepo.delete(id);
    const updated = await formFillHistoryRepo.listAll();
    setHistories(updated);
    setToastMessage('已删除该填表记录');
  };

  // 6. 套用填写模板 (IMP-10: 基于当前 DOM 动态标签/name 特征匹配，不硬编码失效 ID)
  const handleApplyTemplate = (templateId: string) => {
    if (!snapshot) {
      setToastMessage('请先点击上方“识别当前网页表单”');
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;

    let matchedCount = 0;
    const newAssignments: EditableAssignment[] = [];

    for (const field of currentFields) {
      if (field.kind === 'unsupported' || field.disabled || field.readOnly) continue;

      const matchedRule = tpl.rules.find((r) => {
        if (r.fieldName && field.name && r.fieldName === field.name) return true;
        if (r.labelPattern) {
          const pattern = r.labelPattern.trim().toLowerCase();
          const targetLabel = field.label.trim().toLowerCase();
          if (targetLabel.includes(pattern) || pattern.includes(targetLabel)) return true;
          try {
            const regex = new RegExp(r.labelPattern.trim(), 'i');
            if (regex.test(field.label) || (field.name && regex.test(field.name))) return true;
          } catch {}
        }
        return false;
      });

      if (matchedRule) {
        matchedCount++;
        let optionIds: string[] | undefined;
        if (field.options && field.options.length > 0) {
          const valStr = String(matchedRule.value).trim();
          const opt = field.options.find(
            (o) =>
              o.value === valStr ||
              o.label?.trim() === valStr ||
              o.optionId === valStr ||
              (o.label && (o.label.trim().includes(valStr) || valStr.includes(o.label.trim())))
          );
          if (opt) {
            optionIds = [opt.optionId];
          }
        }
        newAssignments.push({
          fieldId: field.fieldId,
          action: matchedRule.action || (field.kind === 'select' ? 'select' : field.kind === 'checkbox' || field.kind === 'radio' ? 'check' : 'fill'),
          value: matchedRule.value,
          optionIds,
          source: 'instruction',
          reason: `匹配模板 [${tpl.name}] 规则`,
          expectedBeforeValue: field.currentValue,
          wasEmpty: field.isEmpty,
          checked: true,
          fieldLabel: field.label,
          fieldKind: field.kind,
          currentValue: field.currentValue,
          isEmpty: field.isEmpty,
        });
      }
    }

    if (newAssignments.length === 0) {
      setToastMessage(`模板 [${tpl.name}] 在当前页面未能匹配到可用字段`);
      return;
    }

    setAssignments(newAssignments);
    setToastMessage(`已套用模板 [${tpl.name}]：动态匹配成功 ${matchedCount} 项字段，请在下方预览确认`);
  };

  // 7. 保存当前勾选项为填写模板 (IMP-10)
  const handleSaveAsTemplate = async () => {
    const selected = assignments.filter((a) => a.checked);
    if (selected.length === 0) {
      setToastMessage('请先勾选需要保存到模板的字段');
      return;
    }
    const name = window.prompt('请输入填写模板名称（如：常用客户资料 / 标准注册信息）：');
    if (!name || !name.trim()) return;

    const tpl: FormFillTemplate = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      urlPattern: snapshot?.url || '',
      rules: selected.map((a) => ({
        labelPattern: a.fieldLabel,
        fieldName: a.fieldId.split('_').slice(3).join('_'),
        kind: a.fieldKind as any,
        value: a.value ?? '',
        action: a.action,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await formFillTemplateRepo.save(tpl);
    const updated = await formFillTemplateRepo.listAll();
    setTemplates(updated);
    setSelectedTemplateId(tpl.id);
    setIsTemplatesExpanded(true);
    setToastMessage(`模板 [${tpl.name}] 已成功保存！后续同类表单可一键复用`);
  };

  // 8. 识别当前表单并直接提取已录入字段保存为模板 (支持在页面手动输入后直接提取固化为模板)
  const handleExtractFormAsTemplate = async () => {
    setIsScanning(true);
    const scanRes = await sendToBackground<ScanFormSnapshotResponse>({
      type: 'SCAN_FORM_SNAPSHOT',
      payload: undefined,
    });
    setIsScanning(false);
    if (!scanRes || scanRes.error || !scanRes.snapshot) {
      setToastMessage(scanRes?.error || '未找到活动页面，请刷新被测网页后重试');
      return;
    }
    const activeSnap = scanRes.snapshot;
    setSnapshot(activeSnap);

    const targetFields = selectedFormId === 'all'
      ? activeSnap.fields
      : activeSnap.fields.filter((f) => f.formId === selectedFormId);

    const fieldsToExtract = targetFields.filter((f) => {
      if (f.disabled || f.readOnly || f.kind === 'unsupported') return false;
      if (f.currentValue === null || f.currentValue === undefined) return false;
      if (typeof f.currentValue === 'string') {
        const trimmed = f.currentValue.trim();
        if (!trimmed || trimmed === '请选择' || trimmed === '--请选择--') return false;
      }
      return true;
    });

    if (fieldsToExtract.length === 0) {
      setToastMessage('当前表单尚未检测到已录入的有效字段，请先在页面上填写部分字段后提取');
      return;
    }

    const currentForm = activeSnap.forms.find((f) => f.formId === selectedFormId);
    const formTitle = currentForm?.title || activeSnap.title || '常用表单';
    const defaultName = `${formTitle}模板 (${fieldsToExtract.length}项)`;

    const name = window.prompt(`检测到 ${fieldsToExtract.length} 项已录入字段，请输入模板名称：`, defaultName);
    if (!name || !name.trim()) return;

    const tpl: FormFillTemplate = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      urlPattern: activeSnap.url || '',
      rules: fieldsToExtract.map((f) => ({
        labelPattern: f.label,
        fieldName: f.name || f.fieldId.split('_').slice(3).join('_'),
        kind: f.kind,
        value: f.currentValue,
        action: f.kind === 'select' ? 'select' : f.kind === 'checkbox' || f.kind === 'radio' ? 'check' : 'fill',
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await formFillTemplateRepo.save(tpl);
    const updated = await formFillTemplateRepo.listAll();
    setTemplates(updated);
    setSelectedTemplateId(tpl.id);
    setIsTemplatesExpanded(true);
    setToastMessage(`🎉 成功识别并提取 ${fieldsToExtract.length} 项已录入字段，保存为模板 [${tpl.name}]！后续可随时一键直接填充`);
  };

  // 9. 模板一键填充 (无需手动生成方案或逐项确认，直接极速写入当前页面并回读校验)
  const handleQuickFillTemplate = async (template: FormFillTemplate) => {
    setIsQuickFillingTemplateId(template.id);
    try {
      // 1. 优先实时扫描当前网页（确保拿到真实 DOM 最新的 fieldId 及选项数据）
      setIsScanning(true);
      const scanRes = await sendToBackground<ScanFormSnapshotResponse>({
        type: 'SCAN_FORM_SNAPSHOT',
        payload: undefined,
      });
      setIsScanning(false);

      const activeSnap = scanRes?.snapshot;
      if (!activeSnap) {
        setToastMessage(scanRes?.error || '未找到活动页面，请刷新被测网页后重试');
        return;
      }
      setSnapshot(activeSnap);

      const targetFields = activeSnap.fields;
      if (targetFields.length === 0) {
        setToastMessage('当前页面未检测到可填充的表单字段');
        return;
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
        setToastMessage(`当前页面未找到与模板 [${template.name}] 匹配的可用字段`);
        return;
      }

      const currentRunId = `run_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setExecutingRunId(currentRunId);
      setIsExecuting(true);

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

      setIsExecuting(false);
      setExecutingRunId(null);

      if (!res || res.error || !res.runRecord) {
        setToastMessage(res?.error || '模板一键填充执行失败');
        return;
      }

      setLastRunRecord(res.runRecord);
      await formFillRunRepo.save(res.runRecord).catch(() => {});

      const successCount = res.runRecord.steps.filter((s) => s.status === 'success').length;
      setToastMessage(`⚡ 模板 [${template.name}] 填充结束，已完成 ${successCount}/${quickAssignments.length} 项字段写入并校验通过`);

      // 重新静默扫描以同步页面最新状态
      const refreshed = await sendToBackground<ScanFormSnapshotResponse>({
        type: 'SCAN_FORM_SNAPSHOT',
        payload: undefined,
      });
      if (refreshed?.snapshot) {
        setSnapshot(refreshed.snapshot);
      }
    } catch (err) {
      setIsExecuting(false);
      setExecutingRunId(null);
      setToastMessage((err as Error).message || '模板一键填充异常');
    } finally {
      setIsScanning(false);
      setIsQuickFillingTemplateId(null);
    }
  };

  // 10. 删除模板
  const handleDeleteTemplate = async (templateId: string) => {
    await formFillTemplateRepo.delete(templateId);
    const updated = await formFillTemplateRepo.listAll();
    setTemplates(updated);
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId('');
    }
    setToastMessage('已删除该填写模板');
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* 识别与范围卡片 */}
      <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            <span>表单识别与范围</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExtractFormAsTemplate}
              disabled={isScanning || isExecuting}
              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1 text-[11px]"
              title="识别当前表单和已录入的字段值并保存为模板"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-amber-600" />
              <span>存为模板</span>
            </button>
            <button
              onClick={handleScanForm}
              disabled={isScanning || isExecuting}
              className="px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {isScanning ? '正在分析...' : snapshot ? '重新识别' : '识别当前网页表单'}
            </button>
          </div>
        </div>

        {snapshot ? (
          <div className="flex flex-col gap-1.5 pt-1 text-[11px] text-slate-600 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="truncate max-w-[180px] text-slate-500">{snapshot.title || snapshot.url}</span>
              <span className="font-semibold text-slate-700">
                共 {currentFields.length} 个字段
                {filledCount > 0 && (
                  <span className="text-emerald-600 font-normal ml-1">
                    (已填 {filledCount} 项)
                  </span>
                )}
              </span>
            </div>

            {snapshot.forms.length > 1 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-slate-500">填写范围:</span>
                <select
                  value={selectedFormId}
                  onChange={(e) => setSelectedFormId(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[11px] text-slate-800"
                >
                  <option value="all">全部表单 ({snapshot.fields.length})</option>
                  {snapshot.forms.map((f) => (
                    <option key={f.formId} value={f.formId}>
                      {f.title} ({f.fieldCount})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">点击按钮自动扫描当前活动标签页的所有表单控件与约束</p>
        )}
      </div>

      {/* 填写模板库 (可一键秒填) */}
      <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Bookmark className="w-4 h-4 text-indigo-600" />
            <span>填写模板库</span>
            {templates.length > 0 && (
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded-full font-medium">
                {templates.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExtractFormAsTemplate}
              disabled={isScanning || isExecuting}
              className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-0.5 transition-colors px-1.5 py-0.5 rounded hover:bg-indigo-50"
              title="从当前网页提取已录入数据保存为新模板"
            >
              <BookmarkPlus className="w-3 h-3" />
              <span>提取录入为模板</span>
            </button>
            {templates.length > 0 && (
              <button
                type="button"
                onClick={() => setIsTemplatesExpanded(!isTemplatesExpanded)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                title={isTemplatesExpanded ? '折叠列表' : '展开列表'}
              >
                {isTemplatesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {templates.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-1">
            💡 在网页表单填写数据后点击「存为模板」，保存后下次打开同类表单即可一键秒填
          </p>
        ) : isTemplatesExpanded ? (
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            {templates.map((tpl) => {
              const isCurrentlyFilling = isQuickFillingTemplateId === tpl.id;
              const dateStr = tpl.updatedAt
                ? new Date(tpl.updatedAt).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
              return (
                <div
                  key={tpl.id}
                  className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:border-slate-300 transition-all flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                      <span className="font-semibold text-slate-800 text-[11px] truncate" title={tpl.name}>
                        {tpl.name}
                      </span>
                      <span className="text-[9px] bg-slate-200/80 text-slate-600 px-1.5 py-0.2 rounded shrink-0">
                        {tpl.rules.length} 项
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApplyTemplate(tpl.id)}
                        disabled={isExecuting}
                        className="px-2 py-0.5 bg-slate-200/70 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-medium transition-colors"
                        title="载入到下方方案预览中微调修改"
                      >
                        套用
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickFillTemplate(tpl)}
                        disabled={isExecuting}
                        className="px-2.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded text-[10px] font-medium flex items-center gap-0.5 transition-colors shadow-2xs"
                        title="一键直接填充当前网页"
                      >
                        <Zap className="w-2.5 h-2.5" />
                        <span>{isCurrentlyFilling ? '填充中...' : '一键填充'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors p-0.5 ml-0.5"
                        title="删除此模板"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* 字段规则预览标签 */}
                  <div className="flex items-center gap-1 flex-wrap text-[10px] text-slate-600">
                    {dateStr && (
                      <>
                        <span className="text-slate-400 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {dateStr}
                        </span>
                        <span className="text-slate-300">·</span>
                      </>
                    )}
                    {tpl.rules.slice(0, 3).map((r, rIdx) => (
                      <span
                        key={rIdx}
                        className="px-1.5 py-0.2 bg-white border border-slate-200/80 rounded text-slate-600 truncate max-w-[110px]"
                        title={`${r.labelPattern || r.fieldName}: ${String(r.value)}`}
                      >
                        {r.labelPattern || r.fieldName}: <strong className="font-normal text-slate-800">{String(r.value)}</strong>
                      </span>
                    ))}
                    {tpl.rules.length > 3 && (
                      <span className="text-slate-400 text-[9px]">+{tpl.rules.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 常用与历史填表卡片 (一键填表) */}
      <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <History className="w-4 h-4 text-emerald-600" />
            <span>常用与历史填表</span>
            {histories.length > 0 && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded-full font-medium">
                {histories.length}
              </span>
            )}
          </div>
          {histories.length > 0 && (
            <button
              type="button"
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1"
              title={isHistoryExpanded ? '折叠列表' : '展开列表'}
            >
              {isHistoryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {histories.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-1">
            💡 成功填充表单后将自动记录，后续在此可一键秒级回填
          </p>
        ) : isHistoryExpanded ? (
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            {histories.map((h) => {
              const isCurrentlyFilling = isQuickFillingId === h.id;
              const timeStr = new Date(h.timestamp).toLocaleDateString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div
                  key={h.id}
                  className={`p-2.5 rounded-lg border transition-all flex flex-col gap-1.5 ${
                    h.isFavorite
                      ? 'bg-amber-50/40 border-amber-200/80 shadow-2xs'
                      : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                      <button
                        type="button"
                        onClick={() => handleToggleFavorite(h.id)}
                        className={`transition-colors shrink-0 ${
                          h.isFavorite ? 'text-amber-500 fill-amber-500' : 'text-slate-300 hover:text-amber-400'
                        }`}
                        title={h.isFavorite ? '取消常用' : '设为常用'}
                      >
                        <Star className={`w-3.5 h-3.5 ${h.isFavorite ? 'fill-current' : ''}`} />
                      </button>
                      <span className="font-semibold text-slate-800 text-[11px] truncate" title={h.title}>
                        {h.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadHistory(h)}
                        disabled={isExecuting}
                        className="px-2 py-0.5 bg-slate-200/70 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-medium transition-colors"
                        title="载入到下方方案预览中微调修改"
                      >
                        载入
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickFill(h)}
                        disabled={isExecuting}
                        className="px-2.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-[10px] font-medium flex items-center gap-0.5 transition-colors shadow-2xs"
                        title="一键直接填充当前网页"
                      >
                        <Zap className="w-2.5 h-2.5" />
                        <span>{isCurrentlyFilling ? '填充中...' : '一键填表'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHistory(h.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors p-0.5 ml-0.5"
                        title="删除此记录"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* 字段摘要预览标签 */}
                  <div className="flex items-center gap-1 flex-wrap text-[10px] text-slate-600">
                    <span className="text-slate-400 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {timeStr}
                    </span>
                    <span className="text-slate-300">·</span>
                    {h.fields.slice(0, 3).map((f, fIdx) => (
                      <span
                        key={fIdx}
                        className="px-1.5 py-0.2 bg-white border border-slate-200/80 rounded text-slate-600 truncate max-w-[110px]"
                        title={`${f.label}: ${String(f.value)}`}
                      >
                        {f.label}: <strong className="font-normal text-slate-800">{String(f.value)}</strong>
                      </span>
                    ))}
                    {h.fields.length > 3 && (
                      <span className="text-slate-400 text-[9px]">+{h.fields.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 填写要求与策略输入 */}
      <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <Edit3 className="w-3.5 h-3.5 text-slate-600" />
            <span>填写要求与模式</span>
          </span>
          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            {aiProviderService.activeProvider.label}
          </span>
        </div>

        {/* 模板复用栏 (IMP-10) */}
        {templates.length > 0 && (
          <div className="flex items-center gap-1.5 p-2 bg-slate-50 rounded-lg border border-slate-200">
            <FolderCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="flex-1 bg-white border border-slate-200 rounded px-1.5 py-1 text-[11px] text-slate-800 truncate"
            >
              <option value="">-- 选择已有填写模板 --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rules.length} 项)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleApplyTemplate(selectedTemplateId)}
              disabled={!selectedTemplateId || !snapshot}
              className="px-2 py-1 bg-slate-200 hover:bg-slate-300 disabled:opacity-40 text-slate-700 rounded text-[11px] font-medium shrink-0 transition-colors"
              title="载入到下方方案预览中微调"
            >
              套用
            </button>
            <button
              type="button"
              onClick={() => {
                const t = templates.find((tpl) => tpl.id === selectedTemplateId);
                if (t) handleQuickFillTemplate(t);
              }}
              disabled={!selectedTemplateId || isExecuting}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded text-[11px] font-medium shrink-0 transition-colors flex items-center gap-1 shadow-2xs"
              title="直接一键填充当前网页"
            >
              <Zap className="w-3 h-3" />
              <span>{isQuickFillingTemplateId === selectedTemplateId ? '填充中...' : '一键填充'}</span>
            </button>
          </div>
        )}

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          placeholder="例如：联系人张三，公司星河科技，行业软件服务，其他空白字段合理生成"
          className="w-full p-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
        />

        <input
          type="text"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="可选：补充业务资料（如客户简介或参数文本）"
          className="w-full p-1.5 border border-slate-200 rounded-lg text-[11px] focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
        />

        {/* 策略模式选择 */}
        <div className="flex items-center gap-4 text-[11px] text-slate-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="fillMode"
              checked={fillMode === 'empty_only'}
              onChange={() => setFillMode('empty_only')}
              className="text-blue-600"
            />
            <span className="font-medium">仅填空白（默认保留已有值）</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="fillMode"
              checked={fillMode === 'allow_overwrite'}
              onChange={() => setFillMode('allow_overwrite')}
              className="text-blue-600"
            />
            <span>允许覆盖</span>
          </label>
        </div>

        <button
          onClick={handleGeneratePlan}
          disabled={!snapshot || isPlanning || isExecuting}
          className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isPlanning ? '方案规划中...' : '生成填写方案'}</span>
        </button>
      </div>

      {/* 方案预览与确认 */}
      {assignments.length > 0 && (
        <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-bold text-slate-800">
              方案预览 ({assignments.filter((a) => a.checked).length}/{assignments.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="text-[10px] text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-0.5 transition-colors"
                title="将当前已勾选字段保存为可复用模板"
              >
                <BookmarkPlus className="w-3 h-3" />
                <span>存为模板</span>
              </button>
              <button
                onClick={() => setAssignments((prev) => prev.map((a) => ({ ...a, checked: true })))}
                className="text-[10px] text-blue-600 hover:underline"
              >
                全选
              </button>
              <button
                onClick={() => setAssignments((prev) => prev.map((a) => ({ ...a, checked: false })))}
                className="text-[10px] text-slate-500 hover:underline"
              >
                清空
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {assignments.map((item, idx) => (
              <div
                key={item.fieldId}
                className={`p-2 rounded-lg border text-[11px] flex flex-col gap-1 transition-colors ${
                  item.checked ? 'bg-blue-50/40 border-blue-200' : 'bg-slate-50/60 border-slate-200 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAssignments((prev) =>
                          prev.map((a, i) => (i === idx ? { ...a, checked } : a))
                        );
                      }}
                      className="rounded text-blue-600"
                    />
                    <span>{item.fieldLabel}</span>
                    <span className="text-[9px] text-slate-400 font-normal">({item.fieldKind})</span>
                  </label>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                      item.source === 'instruction'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.source === 'generated'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {item.source === 'instruction' ? '指令匹配' : item.source === 'generated' ? '规则生成' : '保留'}
                  </span>
                </div>

                <div className="flex items-center gap-2 pl-5 text-slate-600">
                  <span className="shrink-0 text-slate-400">当前:</span>
                  <span className="truncate max-w-[80px]">
                    {snapshot?.fields.find((field) => field.fieldId === item.fieldId)?.sensitive
                      ? '••••••'
                      : String(item.currentValue) || <em className="text-slate-300">空白</em>}
                  </span>
                  <span className="text-slate-300">→</span>
                  <span className="shrink-0 text-slate-400">写入:</span>
                  <input
                    type="text"
                    value={item.value !== undefined ? String(item.value) : ''}
                    disabled={!item.checked}
                    onChange={(e) => {
                      const val = e.target.value;
                      const field = currentFields.find((f) => f.fieldId === item.fieldId);
                      let newOptionIds = item.optionIds;
                      if (field && (field.kind === 'select' || field.kind === 'radio' || field.kind === 'checkbox') && field.options) {
                        const trimmed = val.trim();
                        const matched = field.options.find(
                          (opt) => opt.value === trimmed || opt.label?.trim() === trimmed || opt.optionId === trimmed
                        );
                        newOptionIds = matched ? [matched.optionId] : undefined;
                      }
                      setAssignments((prev) =>
                        prev.map((a, i) => (i === idx ? { ...a, value: val, optionIds: newOptionIds } : a))
                      );
                    }}
                    className="flex-1 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-800 focus:outline-hidden"
                  />
                </div>
              </div>
            ))}
          </div>

          {unresolved.length > 0 && (
            <div className="p-2 bg-amber-50 rounded-lg text-[10px] text-amber-800 flex flex-col gap-1 border border-amber-200">
              <span className="font-semibold flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-amber-600" />
                <span>{unresolved.length} 个字段未自动填充：</span>
              </span>
              <ul className="list-disc pl-4 space-y-0.5">
                {unresolved.slice(0, 3).map((u, i) => (
                  <li key={i}>{u.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 执行与停止按钮 */}
          <div className="flex items-center gap-2 pt-1">
            {isExecuting ? (
              <button
                onClick={handleCancelFill}
                className="flex-1 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>停止填充</span>
              </button>
            ) : (
              <button
                onClick={handleExecuteFill}
                disabled={assignments.filter((a) => a.checked).length === 0}
                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>执行填充</span>
              </button>
            )}

            {lastRunRecord && lastRunRecord.status !== 'undone' && (
              <button
                onClick={handleUndo}
                disabled={isExecuting}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors flex items-center gap-1"
                title="撤销本次填充（如已被手动修改则保留新值）"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>撤销</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 历史执行结果简报 */}
      {lastRunRecord && (
        <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>填充执行报告</span>
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                lastRunRecord.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : lastRunRecord.status === 'undone'
                    ? 'bg-slate-200 text-slate-600'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {lastRunRecord.status === 'completed'
                ? '全部成功'
                : lastRunRecord.status === 'partial'
                  ? '部分成功'
                  : lastRunRecord.status === 'undone'
                    ? '已撤销'
                    : lastRunRecord.status === 'failed'
                      ? '执行失败'
                      : '已停止'}
            </span>
          </div>

          <div className="flex flex-col gap-1 text-[11px] text-slate-600">
            {lastRunRecord.steps.map((step) => (
              <div key={step.fieldId} className="flex flex-col gap-1 border-b border-slate-100 last:border-0 py-1.5 select-text">
                <span className="truncate max-w-[160px] text-slate-700">{snapshot?.fields.find((field) => field.fieldId === step.fieldId)?.label || assignments.find((item) => item.fieldId === step.fieldId)?.fieldLabel || step.fieldId.split('_').slice(-1)[0]}</span>
                {step.status === 'success' ? (
                  <span className="text-emerald-600 font-medium">✓ 已写入并回读</span>
                ) : step.status === 'skipped' ? (
                  <span className="text-slate-400 whitespace-pre-wrap break-words">跳过：{step.skippedReason || step.error || '未执行'}</span>
                ) : (
                  <span className="text-red-600 whitespace-pre-wrap break-words select-text" title={step.error}>
                    × {step.error || '失败'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
