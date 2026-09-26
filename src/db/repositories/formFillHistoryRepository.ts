import { FormFillHistoryRecord } from '../../shared/types/formFill';
import { db, QACopilotDatabase } from '../index';

export class FormFillHistoryRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async save(record: FormFillHistoryRecord): Promise<void> {
    await this.database.formFillHistories.put(record);
  }

  async get(id: string): Promise<FormFillHistoryRecord | undefined> {
    return this.database.formFillHistories.get(id);
  }

  /**
   * 获取所有历史记录（收藏置顶，其次按时间倒序）
   */
  async listAll(limit = 30): Promise<FormFillHistoryRecord[]> {
    const all = await this.database.formFillHistories.toArray();
    // 排序策略：收藏的在最前面，其次按时间倒序
    all.sort((a, b) => {
      if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) {
        return a.isFavorite ? -1 : 1;
      }
      return b.timestamp - a.timestamp;
    });
    return all.slice(0, limit);
  }

  /**
   * 根据当前页面 URL 获取相关的历史记录
   */
  async listByUrl(url: string, limit = 10): Promise<FormFillHistoryRecord[]> {
    const list = await this.database.formFillHistories
      .where('url')
      .equals(url)
      .reverse()
      .sortBy('timestamp');
    return list.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    await this.database.formFillHistories.delete(id);
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(id: string): Promise<boolean> {
    const record = await this.database.formFillHistories.get(id);
    if (!record) return false;
    const newStatus = !record.isFavorite;
    await this.database.formFillHistories.update(id, { isFavorite: newStatus });
    return newStatus;
  }

  async updateTitle(id: string, newTitle: string): Promise<void> {
    await this.database.formFillHistories.update(id, { title: newTitle.trim() });
  }

  async clear(): Promise<void> {
    await this.database.formFillHistories.clear();
  }
}

export const formFillHistoryRepo = new FormFillHistoryRepository();
