/**
 * 快照与 Bug 仓储操作
 */

import { db, QACopilotDatabase } from '../index';
import { Bug, BugSnapshot } from '../../shared/types/snapshot';
import { QAEvent } from '../../shared/types/event';
import { NetworkRequest } from '../../shared/types/network';

export class SnapshotRepository {
  constructor(private database: QACopilotDatabase = db) {}

  private async hydrateSnapshot(snapshot?: BugSnapshot): Promise<BugSnapshot | undefined> {
    if (!snapshot) return snapshot;
    const [screenshot, events, networkRequests, consoleErrors] = await Promise.all([
      snapshot.screenshotId ? this.database.screenshots.get(snapshot.screenshotId) : undefined,
      snapshot.eventIds ? this.database.events.bulkGet(snapshot.eventIds) : snapshot.events,
      snapshot.networkRequestIds
        ? this.database.networkRequests.bulkGet(snapshot.networkRequestIds)
        : snapshot.networkRequests,
      snapshot.consoleEventIds ? this.database.events.bulkGet(snapshot.consoleEventIds) : snapshot.consoleErrors,
    ]);
    return {
      ...snapshot,
      screenshotUrl: snapshot.screenshotUrl || screenshot?.dataUrl,
      events: (events || []).filter(Boolean) as QAEvent[],
      networkRequests: (networkRequests || []).filter(Boolean) as NetworkRequest[],
      consoleErrors: (consoleErrors || []).filter(Boolean) as QAEvent[],
    };
  }

  async createSnapshot(snapshot: BugSnapshot): Promise<BugSnapshot> {
    const storedSnapshot: BugSnapshot = {
      ...snapshot,
      screenshotUrl: undefined,
      eventIds: snapshot.eventIds || snapshot.events.map((event) => event.id),
      networkRequestIds: snapshot.networkRequestIds || snapshot.networkRequests.map((request) => request.id),
      consoleEventIds: snapshot.consoleEventIds || snapshot.consoleErrors.map((event) => event.id),
      events: [],
      networkRequests: [],
      consoleErrors: [],
    };
    await this.database.snapshots.add(storedSnapshot);
    return snapshot;
  }

  async getSnapshotById(id: string): Promise<BugSnapshot | undefined> {
    return this.hydrateSnapshot(await this.database.snapshots.get(id));
  }

  async listSnapshotsBySession(sessionId: string): Promise<BugSnapshot[]> {
    const snapshots = await this.database.snapshots
      .where('sessionId')
      .equals(sessionId)
      .reverse()
      .sortBy('createdAt');
    return Promise.all(snapshots.map((snapshot) => this.hydrateSnapshot(snapshot) as Promise<BugSnapshot>));
  }

  async getLatestSnapshot(): Promise<BugSnapshot | undefined> {
    return this.hydrateSnapshot(await this.database.snapshots.orderBy('createdAt').reverse().first());
  }

  async listSnapshots(limit = 50): Promise<BugSnapshot[]> {
    const snapshots = await this.database.snapshots.orderBy('createdAt').reverse().limit(limit).toArray();
    return Promise.all(snapshots.map((snapshot) => this.hydrateSnapshot(snapshot) as Promise<BugSnapshot>));
  }

  async updateSnapshot(id: string, updates: Partial<BugSnapshot>): Promise<void> {
    const {
      screenshotUrl: _transientScreenshot,
      events,
      networkRequests,
      consoleErrors,
      ...storedUpdates
    } = updates;
    if (events) storedUpdates.eventIds = events.map((event) => event.id);
    if (networkRequests) storedUpdates.networkRequestIds = networkRequests.map((request) => request.id);
    if (consoleErrors) storedUpdates.consoleEventIds = consoleErrors.map((event) => event.id);
    await this.database.snapshots.update(id, storedUpdates);
  }

  async appendEventToCapturingSnapshots(event: QAEvent): Promise<void> {
    await this.database.transaction('rw', this.database.snapshots, async () => {
      const snapshots = await this.database.snapshots.where('sessionId').equals(event.sessionId).toArray();
      const isConsoleError = !event.relatedRequestId && (event.type === 'error' ||
        (event.type === 'console' && (event.payload as { level?: string }).level === 'error'));
      for (const snapshot of snapshots) {
        if (!snapshot.captureUntil || event.timestamp <= snapshot.createdAt || event.timestamp > snapshot.captureUntil) continue;
        const alreadyIncluded = (snapshot.eventIds || []).includes(event.id);
        const consoleAlreadyIncluded = (snapshot.consoleEventIds || []).includes(event.id);
        await this.database.snapshots.update(snapshot.id, {
          eventIds: alreadyIncluded ? snapshot.eventIds : [...(snapshot.eventIds || []), event.id],
          consoleEventIds: isConsoleError && !consoleAlreadyIncluded
            ? [...(snapshot.consoleEventIds || []), event.id]
            : snapshot.consoleEventIds,
          summary: {
            ...snapshot.summary,
            eventCount: alreadyIncluded ? snapshot.summary.eventCount : snapshot.summary.eventCount + 1,
            errorCount: isConsoleError && !consoleAlreadyIncluded
              ? snapshot.summary.errorCount + 1
              : snapshot.summary.errorCount,
          },
        });
      }
    });
  }

  async appendNetworkToCapturingSnapshots(request: NetworkRequest): Promise<void> {
    await this.database.transaction('rw', this.database.snapshots, async () => {
      const snapshots = await this.database.snapshots.where('sessionId').equals(request.sessionId).toArray();
      for (const snapshot of snapshots) {
        if (!snapshot.captureUntil || request.startedAt <= snapshot.createdAt || request.startedAt > snapshot.captureUntil) continue;
        const alreadyIncluded = (snapshot.networkRequestIds || []).includes(request.id);
        await this.database.snapshots.update(snapshot.id, {
          networkRequestIds: alreadyIncluded
            ? snapshot.networkRequestIds
            : [...(snapshot.networkRequestIds || []), request.id],
          summary: {
            ...snapshot.summary,
            requestCount: alreadyIncluded ? snapshot.summary.requestCount : snapshot.summary.requestCount + 1,
            errorCount: !alreadyIncluded && (request.isError || request.isSlow)
              ? snapshot.summary.errorCount + 1
              : snapshot.summary.errorCount,
          },
        });
      }
    });
  }

  async createBug(bug: Bug): Promise<Bug> {
    await this.database.bugs.add(bug);
    return bug;
  }

  async getBugById(id: string): Promise<Bug | undefined> {
    return this.database.bugs.get(id);
  }

  async updateBug(id: string, updates: Partial<Bug>): Promise<void> {
    await this.database.bugs.update(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  }

  async listBugs(limit = 20): Promise<Bug[]> {
    return this.database.bugs
      .orderBy('createdAt')
      .reverse()
      .limit(limit)
      .toArray();
  }
}

export const snapshotRepo = new SnapshotRepository();
