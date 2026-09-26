import { FormFillTemplate } from '../../shared/types/formFill';
import { db, QACopilotDatabase } from '../index';

export class FormFillTemplateRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async save(template: FormFillTemplate): Promise<void> {
    await this.database.fillTemplates.put(template);
  }

  async get(id: string): Promise<FormFillTemplate | undefined> {
    return this.database.fillTemplates.get(id);
  }

  async listAll(): Promise<FormFillTemplate[]> {
    return this.database.fillTemplates.orderBy('updatedAt').reverse().toArray();
  }

  async delete(id: string): Promise<void> {
    await this.database.fillTemplates.delete(id);
  }
}

export const formFillTemplateRepo = new FormFillTemplateRepository();
