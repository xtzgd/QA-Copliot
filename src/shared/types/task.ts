/**
 * 统一任务中心数据模型 (IMP-05 / IMP-06)
 */

import { PageTarget } from './page';

export type TaskType = 'form_fill' | 'replay' | 'runner_test';

export type TaskStatus = 
  | 'queued' 
  | 'running' 
  | 'cancelling' 
  | 'cancelled' 
  | 'completed' 
  | 'partial' 
  | 'failed' 
  | 'interrupted';

export interface TaskStepItem {
  stepIndex: number;
  title: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  detail?: string;
  actionSent?: boolean;
  verified?: boolean;
  assertionPassed?: boolean;
  error?: string;
  durationMs?: number;
}

export interface TaskRunRecord {
  runId: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  target: PageTarget;
  currentStep: number;
  totalSteps: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  steps: TaskStepItem[];
}
