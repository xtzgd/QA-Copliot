/**
 * 事件模型实体定义
 */

export type QAEventType = 
  | 'click' 
  | 'input' 
  | 'scroll'
  | 'navigation' 
  | 'console' 
  | 'error' 
  | 'screenshot'
  | 'custom';

export interface BaseEventPayload {
  timestamp: number;
  url: string;
  /** Browser supplied frame identity; optional for previously recorded events. */
  frameId?: number;
  frameUrl?: string;
  documentId?: string;
}

export interface ClickEventPayload extends BaseEventPayload {
  tag: string;
  text: string;
  role?: string;
  id?: string;
  obsId?: string;
  name?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
  selector: string;
  xpath?: string;
  x?: number;
  y?: number;
  fieldLabel?: string;
  placeholder?: string;
  isInput?: boolean;
  isDatePicker?: boolean;
}

export interface InputEventPayload extends BaseEventPayload {
  tag: string;
  id?: string;
  obsId?: string;
  name?: string;
  selector?: string;
  fieldLabel?: string;
  fieldName?: string;
  placeholder?: string;
  inputType?: string;
  value: string;
  checked?: boolean;
  optionValue?: string;
  /** Password values are intentionally omitted from recordings. */
  sensitive?: boolean;
}

export interface NavigationEventPayload extends BaseEventPayload {
  fromUrl: string;
  toUrl: string;
  pageTitle: string;
  navigationType: 'initial' | 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'reload';
}

export interface ScrollEventPayload extends BaseEventPayload {
  target: 'window' | 'element';
  selector?: string;
  scrollTop: number;
  scrollLeft: number;
}

export interface ConsoleEventPayload extends BaseEventPayload {
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  stack?: string;
}

export interface ErrorEventPayload extends BaseEventPayload {
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  errorType?: string;
}

export interface QAEvent {
  id: string;
  sessionId: string;
  type: QAEventType;
  timestamp: number;
  title: string;
  description: string;
  url: string;
  payload: 
    | ClickEventPayload 
    | InputEventPayload 
    | ScrollEventPayload
    | NavigationEventPayload 
    | ConsoleEventPayload 
    | ErrorEventPayload 
    | Record<string, unknown>;
  relatedRequestId?: string;
  relatedActionId?: string;
}
