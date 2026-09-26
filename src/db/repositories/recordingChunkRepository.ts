import { db, QACopilotDatabase, RecordingChunk } from '../index';

export class RecordingChunkRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async saveChunk(chunk: RecordingChunk): Promise<void> {
    await this.database.recordingChunks.put(chunk);
  }

  async getChunks(sessionId: string): Promise<RecordingChunk[]> {
    return this.database.recordingChunks
      .where('sessionId')
      .equals(sessionId)
      .sortBy('chunkIndex');
  }

  async getChunksByRecordingId(recordingId: string): Promise<RecordingChunk[]> {
    return this.database.recordingChunks
      .where('recordingId')
      .equals(recordingId)
      .sortBy('chunkIndex');
  }

  async clearChunks(sessionId: string): Promise<void> {
    await this.database.recordingChunks
      .where('sessionId')
      .equals(sessionId)
      .delete();
  }

  async clearChunksByRecordingId(recordingId: string): Promise<void> {
    await this.database.recordingChunks
      .where('recordingId')
      .equals(recordingId)
      .delete();
  }

  async listLegacyRecordingIds(sessionId: string, excludeRecordingId?: string): Promise<string[]> {
    const chunks = await this.database.recordingChunks
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    const ids = new Set<string>();
    for (const c of chunks) {
      const recId = c.recordingId || sessionId;
      if (recId !== excludeRecordingId) {
        ids.add(recId);
      }
    }
    return Array.from(ids);
  }

  async listUnfinishedSessionIds(): Promise<string[]> {
    const all = await this.database.recordingChunks.toArray();
    const sessionIds = new Set(all.map((c) => c.sessionId));
    return Array.from(sessionIds);
  }
}

export const recordingChunkRepo = new RecordingChunkRepository();
