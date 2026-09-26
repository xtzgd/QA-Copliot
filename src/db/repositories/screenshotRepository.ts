import { ScreenshotEvidence } from '../../shared/types/screenshot';
import { db, QACopilotDatabase } from '../index';

export class ScreenshotRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async add(screenshot: ScreenshotEvidence): Promise<ScreenshotEvidence> {
    await this.database.screenshots.add(screenshot);
    return screenshot;
  }

  async getById(id: string): Promise<ScreenshotEvidence | undefined> {
    return this.database.screenshots.get(id);
  }

  async listBySession(sessionId: string): Promise<ScreenshotEvidence[]> {
    return this.database.screenshots.where('sessionId').equals(sessionId).sortBy('createdAt');
  }
}

export const screenshotRepo = new ScreenshotRepository();
