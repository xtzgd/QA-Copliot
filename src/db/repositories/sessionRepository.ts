/**
 * 会话仓储操作
 */

import { db, QACopilotDatabase } from '../index';
import { TestSession } from '../../shared/types/session';

export class SessionRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async create(session: TestSession): Promise<TestSession> {
    await this.database.sessions.add(session);
    return session;
  }

  async getById(id: string): Promise<TestSession | undefined> {
    return this.database.sessions.get(id);
  }

  async getCurrentActive(): Promise<TestSession | undefined> {
    return this.database.sessions
      .where('status')
      .equals('in_progress')
      .reverse()
      .sortBy('startedAt')
      .then((sessions) => sessions[0]);
  }

  async updateCurrentUrl(id: string, url: string): Promise<void> {
    await this.database.sessions.update(id, { currentUrl: url });
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.database.sessions.update(id, { title: title.trim() });
  }

  async updateStats(id: string, delta: Partial<TestSession['stats']>): Promise<void> {
    // Content/Network 消息可能同时到达，必须在单个读写事务内执行原子累加。
    await this.database.transaction('rw', this.database.sessions, async () => {
      await this.database.sessions.where('id').equals(id).modify((session) => {
        session.stats = {
          actionCount: session.stats.actionCount + (delta.actionCount || 0),
          apiCount: session.stats.apiCount + (delta.apiCount || 0),
          errorCount: session.stats.errorCount + (delta.errorCount || 0),
        };
      });
    });
  }

  async complete(id: string): Promise<void> {
    await this.database.sessions.update(id, {
      status: 'completed',
      endedAt: Date.now(),
    });
  }

  async deleteWithEvidence(id: string): Promise<void> {
    await this.database.transaction('rw', [
      this.database.sessions,
      this.database.events,
      this.database.networkRequests,
      this.database.consoleLogs,
      this.database.snapshots,
      this.database.bugs,
      this.database.screenshots,
      this.database.recordings,
    ], async () => {
      await Promise.all([
        this.database.events.where('sessionId').equals(id).delete(),
        this.database.networkRequests.where('sessionId').equals(id).delete(),
        this.database.consoleLogs.where('sessionId').equals(id).delete(),
        this.database.snapshots.where('sessionId').equals(id).delete(),
        this.database.bugs.where('sessionId').equals(id).delete(),
        this.database.screenshots.where('sessionId').equals(id).delete(),
        this.database.recordings.where('sessionId').equals(id).delete(),
      ]);
      await this.database.sessions.delete(id);
    });
  }

  async listRecent(limit = 10): Promise<TestSession[]> {
    return this.database.sessions
      .orderBy('startedAt')
      .reverse()
      .limit(limit)
      .toArray();
  }
}

export const sessionRepo = new SessionRepository();
