import { QAEvent } from '../../shared/types/event';
import { db, QACopilotDatabase } from '../index';

export class ConsoleRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async add(event: QAEvent): Promise<QAEvent> {
    await this.database.consoleLogs.put(event);
    return event;
  }

  async listBySession(sessionId: string): Promise<QAEvent[]> {
    return this.database.consoleLogs.where('sessionId').equals(sessionId).sortBy('timestamp');
  }
}

export const consoleRepo = new ConsoleRepository();
