/**
 * 禅道网页端自动化填单暂存协议
 */

export interface ZentaoPendingFillData {
  bugId: string;
  productId?: number;
  projectId?: number;
  executionId?: number;
  title: string;
  severity: number; // 1~4
  pri: number; // 1~4
  assignedTo?: string;
  openedBuild?: string;
  stepsHtml: string;
  screenshotUrl?: string; // base64
  createdAt: number;
}

export const ZENTAO_AUTOFILL_STORAGE_KEY = 'zentao_pending_autofill';

/**
 * 禅道 Bug 详情页待挂载附件协议 (方案 A: API 建单后详情页自动挂载)
 */
export interface ZentaoPendingAttachment {
  bugId: number;
  snapshotId: string;
  screenshotUrl?: string; // base64 现场截图
  fileName?: string;
  recordingDataUrl?: string; // base64 现场录屏
  recordingFileName?: string;
  createdAt: number;
}

export const ZENTAO_PENDING_ATTACHMENT_KEY = 'zentao_pending_attachment';
