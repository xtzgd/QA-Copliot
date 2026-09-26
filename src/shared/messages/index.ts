/**
 * 统一跨上下文消息协议 (TASK-002)
 */

import { QAEvent } from '../types/event';
import { NetworkRequest } from '../types/network';
import { TestSession } from '../types/session';
import { BugSnapshot } from '../types/snapshot';
import { ElementInspectResult } from '../tools/locatorGenerator';
import { PageContext } from '../types/page';
import { TaskRunRecord, TaskStepItem } from '../types/task';
import { ImportedTestSuite } from '../types/testCase';

export type MessageType =
  | 'PING'
  | 'PONG'
  | 'START_SESSION'
  | 'STOP_SESSION'
  | 'FLUSH_PENDING_RECORDS'
  | 'GET_CURRENT_SESSION'
  | 'CURRENT_SESSION_RESPONSE'
  | 'RECORD_EVENT'
  | 'EVENT_RECORDED'
  | 'NETWORK_START'
  | 'RECORD_NETWORK'
  | 'NETWORK_RECORDED'
  | 'CREATE_SNAPSHOT'
  | 'SNAPSHOT_CREATED'
  | 'TAKE_SCREENSHOT'
  | 'SCREENSHOT_RESULT'
  | 'REPLAY_SESSION'
  | 'STOP_REPLAY'
  | 'START_ELEMENT_INSPECTION'
  | 'STOP_ELEMENT_INSPECTION'
  | 'ELEMENT_INSPECTED'
  | 'ANALYZE_PAGE'
  | 'SCAN_FORM_SNAPSHOT'
  | 'EXECUTE_FORM_FILL'
  | 'CANCEL_FORM_FILL'
  | 'UNDO_FORM_FILL'
  | 'GET_ACTIVE_TASK'
  | 'ACTIVE_TASK_RESPONSE'
  | 'CANCEL_ACTIVE_TASK'
  | 'TASK_STATUS_UPDATED'
  | 'UPDATE_TASK_STEP'
  | 'FINISH_TASK'
  | 'PING_TASK_STATUS'
  | 'TRIGGER_QUICK_LOGIN'
  | 'EXECUTE_QUICK_LOGIN'
  | 'RUN_IMPORTED_TEST_SUITE'
  | 'RUN_NATURAL_LANGUAGE_TEST'
  | 'UPDATE_SESSION_TITLE';

export interface BaseMessage<T extends MessageType, P = unknown> {
  type: T;
  payload: P;
  sender?: 'content' | 'background' | 'sidepanel' | 'devtools';
  timestamp?: number;
}

export type PingMessage = BaseMessage<'PING', { text: string }>;
export type PongMessage = BaseMessage<'PONG', { text: string; time: number }>;

export type StartSessionMessage = BaseMessage<'START_SESSION', {
  projectId: string;
  projectName: string;
  environment: string;
  title: string;
}>;

export type StopSessionMessage = BaseMessage<'STOP_SESSION', {
  sessionId: string;
}>;
export type FlushPendingRecordsMessage = BaseMessage<'FLUSH_PENDING_RECORDS', void>;

export type GetCurrentSessionMessage = BaseMessage<'GET_CURRENT_SESSION', void>;
export type CurrentSessionResponseMessage = BaseMessage<'CURRENT_SESSION_RESPONSE', {
  session: TestSession | null;
}>;

export type RecordEventMessage = BaseMessage<'RECORD_EVENT', {
  event: Omit<QAEvent, 'id' | 'sessionId'> & { sessionId?: string };
}>;

export type EventRecordedMessage = BaseMessage<'EVENT_RECORDED', {
  event: QAEvent;
  sessionStats: TestSession['stats'];
}>;

export type NetworkStartMessage = BaseMessage<'NETWORK_START', {
  requestId: string;
  method: string;
  url: string;
  startedAt: number;
}>;

export type RecordNetworkMessage = BaseMessage<'RECORD_NETWORK', {
  request: Omit<NetworkRequest, 'id' | 'sessionId'> & {
    requestId?: string;
    targetSessionId?: string;
  };
}>;

export type NetworkRecordedMessage = BaseMessage<'NETWORK_RECORDED', {
  request: NetworkRequest;
  timelineEvent: QAEvent;
  sessionStats: TestSession['stats'];
}>;

export type CreateSnapshotMessage = BaseMessage<'CREATE_SNAPSHOT', {
  sessionId: string;
  windowDurationSec?: number;
}>;

export type SnapshotCreatedMessage = BaseMessage<'SNAPSHOT_CREATED', {
  snapshot: BugSnapshot;
}>;

export type TakeScreenshotMessage = BaseMessage<'TAKE_SCREENSHOT', { persistToSession?: boolean } | void>;
export type ScreenshotResultMessage = BaseMessage<'SCREENSHOT_RESULT', {
  dataUrl?: string;
  error?: string;
}>;
export type ReplaySessionMessage = BaseMessage<'REPLAY_SESSION', {
  events: QAEvent[];
  stepDelayMs?: number;
  targetTabId?: number;
  targetFrameId?: number;
}>;
export type StopReplayMessage = BaseMessage<'STOP_REPLAY', void>;
export type StartElementInspectionMessage = BaseMessage<'START_ELEMENT_INSPECTION', void>;
export type StopElementInspectionMessage = BaseMessage<'STOP_ELEMENT_INSPECTION', void>;
export type ElementInspectedMessage = BaseMessage<'ELEMENT_INSPECTED', {
  element: ElementInspectResult;
}>;
import {
  FormSnapshot,
  FormFillAssignment,
  FormFillStepResult,
  FormFillRunRecord,
} from '../types/formFill';

export type AnalyzePageMessage = BaseMessage<'ANALYZE_PAGE', void>;
export type ScanFormSnapshotMessage = BaseMessage<'SCAN_FORM_SNAPSHOT', { targetTabId?: number } | void>;
export type ExecuteFormFillMessage = BaseMessage<'EXECUTE_FORM_FILL', {
  runId?: string;
  snapshotId: string;
  assignments: FormFillAssignment[];
  mode?: 'empty_only' | 'allow_overwrite';
  targetTabId?: number;
}>;
export type CancelFormFillMessage = BaseMessage<'CANCEL_FORM_FILL', {
  targetTabId?: number;
  runId?: string;
} | void>;
export type UndoFormFillMessage = BaseMessage<'UNDO_FORM_FILL', {
  runId: string;
  targetTabId?: number;
  snapshotId?: string;
  steps?: FormFillStepResult[];
}>;

export type GetActiveTaskMessage = BaseMessage<'GET_ACTIVE_TASK', void>;
export type ActiveTaskResponseMessage = BaseMessage<'ACTIVE_TASK_RESPONSE', {
  task: TaskRunRecord | null;
}>;
export type CancelActiveTaskMessage = BaseMessage<'CANCEL_ACTIVE_TASK', {
  runId?: string;
} | void>;
export type TaskStatusUpdatedMessage = BaseMessage<'TASK_STATUS_UPDATED', {
  task: TaskRunRecord;
}>;

export type UpdateTaskStepMessage = BaseMessage<'UPDATE_TASK_STEP', {
  runId: string;
  stepIndex: number;
  update: Partial<TaskStepItem>;
}>;
export type FinishTaskMessage = BaseMessage<'FINISH_TASK', {
  runId: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
}>;
export type PingTaskStatusMessage = BaseMessage<'PING_TASK_STATUS', {
  runId: string;
}>;
export type TriggerQuickLoginMessage = BaseMessage<'TRIGGER_QUICK_LOGIN', {
  url: string;
  username: string;
  password: string;
  loginTriggerSelector?: string;
  autoSubmit?: boolean;
}>;

export type ExecuteQuickLoginMessage = BaseMessage<'EXECUTE_QUICK_LOGIN', {
  username: string;
  password: string;
  loginTriggerSelector?: string;
  autoSubmit?: boolean;
}>;

export type RunImportedTestSuiteMessage = BaseMessage<'RUN_IMPORTED_TEST_SUITE', {
  suite: ImportedTestSuite;
}>;
export type RunNaturalLanguageTestMessage = BaseMessage<'RUN_NATURAL_LANGUAGE_TEST', {
  instruction: string;
}>;

export type UpdateSessionTitleMessage = BaseMessage<'UPDATE_SESSION_TITLE', {
  sessionId: string;
  title: string;
}>;

export type ExtensionMessage =
  | PingMessage
  | PongMessage
  | UpdateTaskStepMessage
  | FinishTaskMessage
  | PingTaskStatusMessage
  | TriggerQuickLoginMessage
  | ExecuteQuickLoginMessage
  | RunImportedTestSuiteMessage
  | RunNaturalLanguageTestMessage
  | UpdateSessionTitleMessage
  | StartSessionMessage
  | StopSessionMessage
  | FlushPendingRecordsMessage
  | GetCurrentSessionMessage
  | CurrentSessionResponseMessage
  | RecordEventMessage
  | EventRecordedMessage
  | NetworkStartMessage
  | RecordNetworkMessage
  | NetworkRecordedMessage
  | CreateSnapshotMessage
  | SnapshotCreatedMessage
  | TakeScreenshotMessage
  | ScreenshotResultMessage
  | ReplaySessionMessage
  | StopReplayMessage
  | StartElementInspectionMessage
  | StopElementInspectionMessage
  | ElementInspectedMessage
  | AnalyzePageMessage
  | ScanFormSnapshotMessage
  | ExecuteFormFillMessage
  | CancelFormFillMessage
  | UndoFormFillMessage
  | GetActiveTaskMessage
  | ActiveTaskResponseMessage
  | CancelActiveTaskMessage
  | TaskStatusUpdatedMessage;

export interface AnalyzePageResponse extends PageContext {
  url: string;
  title: string;
  error?: string;
}

export interface ScanFormSnapshotResponse {
  snapshot?: FormSnapshot;
  error?: string;
}

export interface ExecuteFormFillResponse {
  runRecord?: FormFillRunRecord;
  error?: string;
}

export interface UndoFormFillResponse {
  success: boolean;
  restoredCount: number;
  conflictCount: number;
  error?: string;
}

/**
 * 发送消息至 Background Service Worker
 */
export async function sendToBackground<TResponse = unknown>(
  message: ExtensionMessage
): Promise<TResponse | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime?.sendMessage) {
      return null;
    }
    return await new Promise<TResponse | null>((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          // 立即访问 chrome.runtime.lastError 消除 Chrome 内部未检查标记
          const err = chrome.runtime.lastError;
          if (err) {
            // 静默处理连接尚未建立或唤醒的情况，不向控制台抛出告警
            resolve(null);
          } else {
            resolve((response as TResponse) ?? null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
