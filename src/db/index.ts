/**
 * IndexedDB 数据库层封装 (Dexie.js) - TASK-003
 */

import Dexie, { type EntityTable } from 'dexie';
import { QAEvent } from '../shared/types/event';
import { NetworkRequest } from '../shared/types/network';
import { Environment, Project, TestSession } from '../shared/types/session';
import { Bug, BugSnapshot } from '../shared/types/snapshot';
import { ScreenshotEvidence } from '../shared/types/screenshot';
import { RecordingEvidence } from '../shared/types/recording';
import { FormFillHistoryRecord, FormFillRunRecord, FormFillTemplate } from '../shared/types/formFill';

export interface PluginSetting {
  id: string;
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface RecordingChunk {
  id: string;
  recordingId?: string;
  sessionId: string;
  chunkIndex: number;
  data: Blob;
  size: number;
  createdAt: number;
}

export class QACopilotDatabase extends Dexie {
  sessions!: EntityTable<TestSession, 'id'>;
  events!: EntityTable<QAEvent, 'id'>;
  networkRequests!: EntityTable<NetworkRequest, 'id'>;
  snapshots!: EntityTable<BugSnapshot, 'id'>;
  bugs!: EntityTable<Bug, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  environments!: EntityTable<Environment, 'id'>;
  settings!: EntityTable<PluginSetting, 'id'>;
  screenshots!: EntityTable<ScreenshotEvidence, 'id'>;
  consoleLogs!: EntityTable<QAEvent, 'id'>;
  recordings!: EntityTable<RecordingEvidence, 'id'>;
  recordingChunks!: EntityTable<RecordingChunk, 'id'>;
  formFillRuns!: EntityTable<FormFillRunRecord, 'runId'>;
  fillTemplates!: EntityTable<FormFillTemplate, 'id'>;
  formFillHistories!: EntityTable<FormFillHistoryRecord, 'id'>;

  constructor(dbName = 'QACopilotDB') {
    super(dbName);

    this.version(1).stores({
      sessions: 'id, projectId, status, startedAt, endedAt',
      events: 'id, sessionId, type, timestamp',
      networkRequests: 'id, sessionId, method, status, startedAt, isError, isSlow',
      snapshots: 'id, sessionId, createdAt',
      bugs: 'id, snapshotId, sessionId, status, createdAt',
      projects: 'id, name, createdAt',
      environments: 'id, projectId, name',
      settings: 'id, key, updatedAt',
    });

    this.version(2).stores({
      sessions: 'id, projectId, status, startedAt, endedAt',
      events: 'id, sessionId, type, timestamp',
      networkRequests: 'id, sessionId, method, status, startedAt, isError, isSlow',
      snapshots: 'id, sessionId, createdAt',
      bugs: 'id, snapshotId, sessionId, status, createdAt',
      projects: 'id, name, createdAt',
      environments: 'id, projectId, name',
      settings: 'id, key, updatedAt',
      screenshots: 'id, sessionId, snapshotId, createdAt',
    });

    this.version(3).stores({
      sessions: 'id, projectId, status, startedAt, endedAt',
      events: 'id, sessionId, type, timestamp',
      networkRequests: 'id, sessionId, method, status, startedAt, isError, isSlow',
      snapshots: 'id, sessionId, createdAt',
      bugs: 'id, snapshotId, sessionId, status, createdAt',
      projects: 'id, name, createdAt',
      environments: 'id, projectId, name',
      settings: 'id, key, updatedAt',
      screenshots: 'id, sessionId, snapshotId, createdAt',
      consoleLogs: 'id, sessionId, type, timestamp',
    });

    this.version(4).stores({
      sessions: 'id, projectId, status, startedAt, endedAt',
      events: 'id, sessionId, type, timestamp',
      networkRequests: 'id, sessionId, method, status, startedAt, isError, isSlow',
      snapshots: 'id, sessionId, createdAt',
      bugs: 'id, snapshotId, sessionId, status, createdAt',
      projects: 'id, name, createdAt',
      environments: 'id, projectId, name',
      settings: 'id, key, updatedAt',
      screenshots: 'id, sessionId, snapshotId, createdAt',
      consoleLogs: 'id, sessionId, type, timestamp',
      recordings: 'id, sessionId, tabId, createdAt',
    });

    this.version(5).stores({
      recordingChunks: 'id, recordingId, sessionId, chunkIndex, createdAt',
      formFillRuns: 'runId, snapshotId, tabId, createdAt, status',
    });

    this.version(6).stores({
      fillTemplates: 'id, name, createdAt, updatedAt',
    });

    this.version(7).stores({
      formFillHistories: 'id, url, title, timestamp, isFavorite',
    });
  }
}

export const db = new QACopilotDatabase();
