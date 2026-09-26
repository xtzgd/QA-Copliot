export interface FormFieldInfo {
  tag: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
}

export interface PageActionInfo {
  tag: string;
  type: string;
  label: string;
  name?: string;
}

export interface PageContext {
  fields: FormFieldInfo[];
  actions: PageActionInfo[];
  formCount: number;
}

export interface PageTarget {
  tabId: number;
  frameId?: number;
  documentId?: string;
  url?: string;
}
