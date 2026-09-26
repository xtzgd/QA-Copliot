import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { QACopilotDatabase } from '../src/db';
import { SessionRepository } from '../src/db/repositories/sessionRepository';
import { EventRepository } from '../src/db/repositories/eventRepository';
import { SnapshotRepository } from '../src/db/repositories/snapshotRepository';
import { ScreenshotRepository } from '../src/db/repositories/screenshotRepository';
import { TestSession } from '../src/shared/types/session';
import { QAEvent } from '../src/shared/types/event';

describe('最小测试链路验证 (Content Script -> Background -> IndexedDB -> SidePanel)', () => {
  let testDb: QACopilotDatabase;
  let sessionRepo: SessionRepository;
  let eventRepo: EventRepository;
  let snapshotRepo: SnapshotRepository;
  let screenshotRepo: ScreenshotRepository;

  beforeEach(() => {
    testDb = new QACopilotDatabase(`flow_test_${Date.now()}_${Math.random()}`);
    sessionRepo = new SessionRepository(testDb);
    eventRepo = new EventRepository(testDb);
    snapshotRepo = new SnapshotRepository(testDb);
    screenshotRepo = new ScreenshotRepository(testDb);
  });

  it('完整链路：开始测试 -> 页面记录操作事件 -> 异常事件 -> 固化 Snapshot', async () => {
    // 1. 开始测试 (模拟 START_SESSION)
    const session: TestSession = {
      id: 'sess-flow-1',
      projectId: 'proj-shop',
      projectName: '商城系统',
      environment: 'TEST',
      title: '商城系统 订单创建测试',
      status: 'in_progress',
      startedAt: Date.now(),
      initialUrl: 'https://test.xxx.com/order/create',
      currentUrl: 'https://test.xxx.com/order/create',
      browserInfo: {
        userAgent: 'Mozilla/5.0 Chrome/120.0',
        browserName: 'Chrome',
        browserVersion: '120.0',
        os: 'macOS',
        viewport: { width: 1920, height: 1080 },
      },
      stats: {
        actionCount: 0,
        apiCount: 0,
        errorCount: 0,
      },
    };
    await sessionRepo.create(session);

    // 2. 模拟 Content Script 发送点击事件 (RECORD_EVENT)
    const clickEvent: QAEvent = {
      id: 'evt-click-1',
      sessionId: session.id,
      type: 'click',
      timestamp: Date.now(),
      title: '点击 提交订单',
      description: '点击「提交订单」',
      url: session.currentUrl,
      payload: {
        timestamp: Date.now(),
        url: session.currentUrl,
        tag: 'BUTTON',
        text: '提交订单',
        selector: '#submit-order',
      },
    };
    await eventRepo.add(clickEvent);
    await sessionRepo.updateStats(session.id, { actionCount: 1 });

    // 3. 模拟页面抛出 JS 异常 (RECORD_EVENT)
    const errorEvent: QAEvent = {
      id: 'evt-err-1',
      sessionId: session.id,
      type: 'error',
      timestamp: Date.now() + 500,
      title: 'JS 运行时异常',
      description: 'TypeError: Cannot read properties of undefined (reading orderId)',
      url: session.currentUrl,
      payload: {
        timestamp: Date.now() + 500,
        url: session.currentUrl,
        message: 'TypeError: Cannot read properties of undefined',
      },
    };
    await eventRepo.add(errorEvent);
    await sessionRepo.updateStats(session.id, { errorCount: 1 });

    // 4. 验证会话统计与状态
    const current = await sessionRepo.getById(session.id);
    expect(current?.stats.actionCount).toBe(1);
    expect(current?.stats.errorCount).toBe(1);

    // 5. 模拟点击「发现问题」创建快照 (CREATE_SNAPSHOT)
    const windowEvents = await eventRepo.getWindowEvents(session.id, Date.now(), 30, 30);
    expect(windowEvents.length).toBe(2);

    const snapshot = await snapshotRepo.createSnapshot({
      id: 'SNAP-20260903-001',
      sessionId: session.id,
      createdAt: Date.now(),
      url: session.currentUrl,
      environment: session.environment,
      browserInfo: session.browserInfo,
      windowDurationSec: 60,
      contextBeforeSec: 30,
      contextAfterSec: 10,
      captureUntil: Date.now() + 10_000,
      events: windowEvents,
      networkRequests: [],
      consoleErrors: [errorEvent],
      summary: {
        eventCount: windowEvents.length,
        requestCount: 0,
        errorCount: 1,
      },
    });

    expect(snapshot.id).toBe('SNAP-20260903-001');
    expect(snapshot.summary.eventCount).toBe(2);
    expect(snapshot.summary.errorCount).toBe(1);
    expect(snapshot.contextAfterSec).toBe(10);
    expect((await testDb.snapshots.get(snapshot.id))?.events).toEqual([]);

    const afterSnapshotEvent: QAEvent = {
      id: 'evt-after-snapshot',
      sessionId: session.id,
      type: 'click',
      timestamp: snapshot.createdAt + 1_000,
      title: '点击关闭提示',
      description: '点击「关闭」',
      url: session.currentUrl,
      payload: {
        timestamp: snapshot.createdAt + 1_000,
        url: session.currentUrl,
        tag: 'BUTTON',
        text: '关闭',
        selector: '#close',
      },
    };
    await eventRepo.add(afterSnapshotEvent);
    await snapshotRepo.appendEventToCapturingSnapshots(afterSnapshotEvent);
    expect((await snapshotRepo.getSnapshotById(snapshot.id))?.events.some((event) => event.id === afterSnapshotEvent.id)).toBe(true);

    await screenshotRepo.add({
      id: 'shot-1',
      sessionId: session.id,
      snapshotId: snapshot.id,
      createdAt: Date.now(),
      url: session.currentUrl,
      dataUrl: 'data:image/png;base64,updated',
    });
    await snapshotRepo.updateSnapshot(snapshot.id, {
      screenshotId: 'shot-1',
      screenshotUrl: 'data:image/png;base64,updated',
    });
    const reopenedSnapshot = await snapshotRepo.getLatestSnapshot();
    expect(reopenedSnapshot?.id).toBe(snapshot.id);
    expect(reopenedSnapshot?.screenshotUrl).toContain('updated');
    expect((await snapshotRepo.listSnapshots()).length).toBe(1);
    expect((await screenshotRepo.listBySession(session.id)).length).toBe(1);

    // 6. Bug 编辑内容可保存为草稿并重新打开
    await snapshotRepo.createBug({
      id: 'BUG-20260903-001',
      snapshotId: snapshot.id,
      sessionId: session.id,
      title: '订单提交失败',
      severity: 'Critical',
      status: 'draft',
      reproductionSteps: ['点击提交订单'],
      expectedResult: '订单创建成功',
      actualResult: '页面出现异常',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const reopenedDraft = await snapshotRepo.getBugById('BUG-20260903-001');
    expect(reopenedDraft?.title).toBe('订单提交失败');
    expect(reopenedDraft?.status).toBe('draft');

    // 7. 结束测试 Session
    await sessionRepo.complete(session.id);
    const completed = await sessionRepo.getById(session.id);
    expect(completed?.status).toBe('completed');
  });

  it('快照反馈页点击查看详情并生成Bug可直接直达 bug_editor 提单视图', async () => {
    const { useAppStore } = await import('../src/sidepanel/store/useAppStore');
    useAppStore.setState({ currentTab: 'home', activeView: 'snapshot_result' });
    expect(useAppStore.getState().activeView).toBe('snapshot_result');

    useAppStore.getState().setCurrentTab('bug', 'bug_editor');
    expect(useAppStore.getState().currentTab).toBe('bug');
    expect(useAppStore.getState().activeView).toBe('bug_editor');
  });
});
