/**
 * AI 智能填表数据类型与协议定义 (QA-011 ~ QA-016, QA-023)
 */

export type FormFieldKind =
  | 'text'
  | 'number'
  | 'date'
  | 'radio'
  | 'checkbox'
  | 'select'
  | 'textarea'
  | 'unsupported';

export interface FormFieldOption {
  optionId: string;
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FormFieldItem {
  fieldId: string;
  formId: string;
  tag: string;
  kind: FormFieldKind;
  name: string;
  label: string;
  placeholder?: string;
  currentValue: string | number | boolean;
  /** Do not send the current value of password-like fields to a remote model. */
  sensitive?: boolean;
  /**
   * 按控件类型严格区分空值 (QA-023):
   * - 文本/文本域: 仅 trim() === '' 为 true
   * - 数字: 0 为有效值 (isEmpty = false)
   * - 复选框: false 为有效值 (未选中状态，isEmpty = false)
   * - 单选框: 存在选中项时为 false，组内均未选中时为 true
   * - 下拉框: 选中值为空或占位项 (如'请选择') 时为 true
   */
  isEmpty: boolean;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  isVisible: boolean;
  constraints?: {
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
    step?: number;
  };
  optionsState?: 'complete' | 'partial' | 'unloaded' | 'none';
  options?: FormFieldOption[];
  groupName?: string;
  unsupportedReason?: string;
}

export interface FormInfo {
  formId: string;
  title: string;
  fieldCount: number;
}

export interface FormSnapshot {
  snapshotId: string;
  tabId?: number;
  frameId?: number;
  url: string;
  title: string;
  forms: FormInfo[];
  fields: FormFieldItem[];
  timestamp: number;
}

export type FormFillAction = 'fill' | 'select' | 'check' | 'setDate' | 'skip';

export interface FormFillAssignment {
  fieldId: string;
  action: FormFillAction;
  value?: string | number | boolean;
  optionIds?: string[];
  source: 'instruction' | 'source_text' | 'generated' | 'option';
  reason?: string;
  expectedBeforeValue?: string | number | boolean;
  wasEmpty?: boolean;
}

export interface FormFillUnresolved {
  fieldId: string;
  reason: string;
}

export interface FormFillPlanContext {
  snapshotId: string;
  instruction: string;
  sourceText?: string;
  mode: 'empty_only' | 'allow_overwrite';
  fields: FormFieldItem[];
}

export interface FormFillPlanResponse {
  snapshotId: string;
  assignments: FormFillAssignment[];
  unresolved: FormFillUnresolved[];
}

export type FormFillStepStatus = 'success' | 'failed' | 'skipped' | 'conflict';

export interface FormFillStepResult {
  fieldId: string;
  beforeValue: string | number | boolean;
  plannedValue?: string | number | boolean | string[];
  appliedValue?: string | number | boolean;
  status: FormFillStepStatus;
  error?: string;
  skippedReason?: string;
}

export interface FormFillRunRecord {
  runId: string;
  snapshotId: string;
  tabId?: number;
  frameId?: number;
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed' | 'undone';
  createdAt: number;
  finishedAt?: number;
  steps: FormFillStepResult[];
}

/**
 * 智能填表可复用模板 (IMP-10)
 * 允许保存用户确认过的填写规则，用于同类表单的快速匹配与填入
 */
export interface FormFillTemplateFieldRule {
  labelPattern: string;
  fieldName?: string;
  kind?: FormFieldKind;
  value: string | number | boolean;
  action?: FormFillAction;
}

export interface FormFillTemplate {
  id: string;
  name: string;
  description?: string;
  urlPattern?: string;
  formFeatures?: string[];
  rules: FormFillTemplateFieldRule[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 表单填充历史记录
 * 自动留存用户执行成功的填充数据，用于跨快照/刷新后的一键填表复用
 */
export interface FormFillHistoryField {
  label: string;
  name?: string;
  kind: FormFieldKind;
  value: string | number | boolean;
  action?: FormFillAction;
}

export interface FormFillHistoryRecord {
  id: string;
  title: string;
  url: string;
  formTitle?: string;
  timestamp: number;
  isFavorite?: boolean;
  fields: FormFillHistoryField[];
}
