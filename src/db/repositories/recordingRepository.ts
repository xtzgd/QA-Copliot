import { RecordingEvidence } from '../../shared/types/recording';
import { db, QACopilotDatabase } from '../index';

export class RecordingRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async add(recording: RecordingEvidence): Promise<RecordingEvidence> {
    await this.database.recordings.add(recording);
    return recording;
  }

  async getById(id: string): Promise<RecordingEvidence | undefined> {
    return this.database.recordings.get(id);
  }

  async listBySession(sessionId: string): Promise<RecordingEvidence[]> {
    return this.database.recordings.where('sessionId').equals(sessionId).reverse().sortBy('createdAt');
  }

  async listRecent(limit: number = 10): Promise<RecordingEvidence[]> {
    return this.database.recordings.orderBy('createdAt').reverse().limit(limit).toArray();
  }
}

export const recordingRepo = new RecordingRepository();
