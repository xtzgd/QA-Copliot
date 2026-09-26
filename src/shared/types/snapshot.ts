/**
 * Bug 快照与 Bug 报告实体定义
 */

import { QAEvent } from './event';
import { NetworkRequest } from './network';
import { BrowserContextInfo } from './session';

export type BugSeverity = 'Blocker' | 'Critical' | 'Major' | 'Minor' | 'Suggestion';

export interface BugSnapshot {
  id: string;
  sessionId: string;
  createdAt: number;
  url: string;
  environment?: string;
  browserInfo: BrowserContextInfo;
  windowDurationSec: number; // 上下文时间窗口（秒）
  contextBeforeSec?: number;
  contextAfterSec?: number;
  captureUntil?: number;
  screenshotUrl?: string;
  screenshotId?: string;
  eventIds?: string[];
  networkRequestIds?: string[];
  consoleEventIds?: string[];
  events: QAEvent[];
  networkRequests: NetworkRequest[];
  consoleErrors: QAEvent[];
  summary: {
    eventCount: number;
    requestCount: number;
    errorCount: number;
  };
}

export interface BugSubmissionRecord {
  platform: 'zentao';
  siteUrl: string; // 提交时的规范化站点根地址 (如 https://zentao.hbisscm.com)
  apiVersion: 'v1' | 'v2'; // 提交时采用的 API 版本
  externalId: string; // 远端 Bug 编号
  externalUrl: string; // 远端完整查看链接
  submittedAt: number; // 提交时间戳
  attachmentStatus: 'uploaded' | 'failed' | 'unsupported' | 'none';
  attachmentError?: string; // 失败原因
}

export interface Bug {
  id: string;
  snapshotId: string;
  sessionId: string;
  title: string;
  severity: BugSeverity;
  pri?: number; // 优先级 (1~4级)
  status: 'draft' | 'submitted' | 'closed';
  reproductionSteps: string[];
  expectedResult: string;
  actualResult: string;
  aiAnalysis?: string;
  externalPlatform?: 'zentao';
  externalId?: string;
  externalUrl?: string;
  assignedTo?: string;
  submission?: BugSubmissionRecord;
  createdAt: number;
  updatedAt: number;
}
