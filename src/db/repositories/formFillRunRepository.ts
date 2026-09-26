import { FormFillRunRecord } from '../../shared/types/formFill';
import { db, QACopilotDatabase } from '../index';

export class FormFillRunRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async save(record: FormFillRunRecord): Promise<void> {
    await this.database.formFillRuns.put(record);
  }

  async get(runId: string): Promise<FormFillRunRecord | undefined> {
    return this.database.formFillRuns.get(runId);
  }

  async getLatestByTab(tabId: number): Promise<FormFillRunRecord | undefined> {
    const list = await this.database.formFillRuns
      .where('tabId')
      .equals(tabId)
      .reverse()
      .sortBy('createdAt');
    return list[0];
  }

  async getLatestBySnapshot(snapshotId: string): Promise<FormFillRunRecord | undefined> {
    const list = await this.database.formFillRuns
      .where('snapshotId')
      .equals(snapshotId)
      .reverse()
      .sortBy('createdAt');
    return list[0];
  }

  async listAll(limit = 20): Promise<FormFillRunRecord[]> {
    return this.database.formFillRuns
      .orderBy('createdAt')
      .reverse()
      .limit(limit)
      .toArray();
  }
}

export const formFillRunRepo = new FormFillRunRepository();
