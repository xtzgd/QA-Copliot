/**
 * 事件与异常仓储操作
 */

import { db, QACopilotDatabase } from '../index';
import { QAEvent } from '../../shared/types/event';

export class EventRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async add(event: QAEvent): Promise<QAEvent> {
    await this.database.events.add(event);
    return event;
  }

  async listBySession(sessionId: string): Promise<QAEvent[]> {
    return this.database.events
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
  }

  async listRecentBySession(sessionId: string, limit = 50): Promise<QAEvent[]> {
    return this.database.events
      .where('sessionId')
      .equals(sessionId)
      .reverse()
      .sortBy('timestamp')
      .then((events) => events.slice(0, limit));
  }

  async listErrorsBySession(sessionId: string): Promise<QAEvent[]> {
    const all = await this.listBySession(sessionId);
    return all.filter((e) => e.type === 'error' || (e.type === 'console' && (e.payload as { level?: string })?.level === 'error'));
  }

  async getWindowEvents(sessionId: string, targetTime: number, beforeSec = 30, afterSec = 30): Promise<QAEvent[]> {
    const startTime = targetTime - beforeSec * 1000;
    const endTime = targetTime + afterSec * 1000;
    return this.database.events
      .where('sessionId')
      .equals(sessionId)
      .filter((e) => e.timestamp >= startTime && e.timestamp <= endTime)
      .sortBy('timestamp');
  }
}

export const eventRepo = new EventRepository();
