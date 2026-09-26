/**
 * 网络请求仓储操作
 */

import { db, QACopilotDatabase } from '../index';
import { NetworkRequest } from '../../shared/types/network';

export class NetworkRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async add(request: NetworkRequest): Promise<NetworkRequest> {
    await this.database.networkRequests.add(request);
    return request;
  }

  async listBySession(sessionId: string): Promise<NetworkRequest[]> {
    return this.database.networkRequests
      .where('sessionId')
      .equals(sessionId)
      .sortBy('startedAt');
  }

  async listErrorsBySession(sessionId: string): Promise<NetworkRequest[]> {
    return this.database.networkRequests
      .where('sessionId')
      .equals(sessionId)
      .filter((r) => r.isError || r.isSlow)
      .sortBy('startedAt');
  }

  async getWindowRequests(sessionId: string, targetTime: number, beforeSec = 30, afterSec = 30): Promise<NetworkRequest[]> {
    const startTime = targetTime - beforeSec * 1000;
    const endTime = targetTime + afterSec * 1000;
    return this.database.networkRequests
      .where('sessionId')
      .equals(sessionId)
      .filter((r) => r.startedAt >= startTime && r.startedAt <= endTime)
      .sortBy('startedAt');
  }
}

export const networkRepo = new NetworkRepository();
