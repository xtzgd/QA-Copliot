import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { QACopilotDatabase } from '../src/db';
import { SessionRepository } from '../src/db/repositories/sessionRepository';
import { EventRepository } from '../src/db/repositories/eventRepository';
import { ConsoleRepository } from '../src/db/repositories/consoleRepository';
import { ProjectRepository } from '../src/db/repositories/projectRepository';
import { TestSession } from '../src/shared/types/session';
import { QAEvent } from '../src/shared/types/event';

describe('IndexedDB & Repositories (TASK-003)', () => {
  let testDb: QACopilotDatabase;
  let sessionRepo: SessionRepository;
  let eventRepo: EventRepository;
  let consoleRepo: ConsoleRepository;
  let projectRepo: ProjectRepository;

  beforeEach(async () => {
    testDb = new QACopilotDatabase(`test_db_${Date.now()}_${Math.random()}`);
    sessionRepo = new SessionRepository(testDb);
    eventRepo = new EventRepository(testDb);
    consoleRepo = new ConsoleRepository(testDb);
    projectRepo = new ProjectRepository(testDb);
  });

  it('能够正常创建、查询和完成测试 Session', async () => {
    const sessionData: TestSession = {
      id: 'sess-001',
      projectId: 'proj-1',
      projectName: '商城系统',
      environment: 'TEST',
      title: '订单创建测试',
      status: 'in_progress',
      startedAt: Date.now(),
      initialUrl: 'https://test.example.com/order/create',
      currentUrl: 'https://test.example.com/order/create',
      browserInfo: {
        userAgent: 'Chrome 120',
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

    await sessionRepo.create(sessionData);

    const active = await sessionRepo.getCurrentActive();
    expect(active).toBeDefined();
    expect(active?.id).toBe('sess-001');
    expect(active?.title).toBe('订单创建测试');

    // 更新统计
    await sessionRepo.updateStats('sess-001', { actionCount: 2, errorCount: 1 });
    const updated = await sessionRepo.getById('sess-001');
    expect(updated?.stats.actionCount).toBe(2);
    expect(updated?.stats.errorCount).toBe(1);

    // 重命名会话
    await sessionRepo.updateTitle('sess-001', '修改后的会话名称');
    const renamed = await sessionRepo.getById('sess-001');
    expect(renamed?.title).toBe('修改后的会话名称');

    // 完成会话
    await sessionRepo.complete('sess-001');
    const completed = await sessionRepo.getById('sess-001');
    expect(completed?.status).toBe('completed');
    expect(completed?.endedAt).toBeGreaterThan(0);
  });

  it('能够添加事件并在时间窗口内过滤检索', async () => {
    const baseTime = 1700000000000;

    const event1: QAEvent = {
      id: 'evt-1',
      sessionId: 'sess-001',
      type: 'navigation',
      timestamp: baseTime,
      title: '打开页面',
      description: '访问 /order/create',
      url: 'https://test.example.com/order/create',
      payload: {
        timestamp: baseTime,
        url: 'https://test.example.com/order/create',
        fromUrl: '',
        toUrl: 'https://test.example.com/order/create',
        pageTitle: '创建订单',
        navigationType: 'initial',
      },
    };

    const event2: QAEvent = {
      id: 'evt-2',
      sessionId: 'sess-001',
      type: 'click',
      timestamp: baseTime + 5000,
      title: '点击按钮',
      description: '点击「提交订单」',
      url: 'https://test.example.com/order/create',
      payload: {
        timestamp: baseTime + 5000,
        url: 'https://test.example.com/order/create',
        tag: 'BUTTON',
        text: '提交订单',
        selector: '#submit-order',
      },
    };

    const event3: QAEvent = {
      id: 'evt-3',
      sessionId: 'sess-001',
      type: 'error',
      timestamp: baseTime + 6000,
      title: 'JS 异常',
      description: 'TypeError: Cannot read properties of undefined',
      url: 'https://test.example.com/order/create',
      payload: {
        timestamp: baseTime + 6000,
        url: 'https://test.example.com/order/create',
        message: 'TypeError: Cannot read properties of undefined',
      },
    };

    await eventRepo.add(event1);
    await eventRepo.add(event2);
    await eventRepo.add(event3);
    await consoleRepo.add(event3);

    const list = await eventRepo.listBySession('sess-001');
    expect(list.length).toBe(3);

    // 测试异常检索
    const errors = await eventRepo.listErrorsBySession('sess-001');
    expect(errors.length).toBe(1);
    expect(errors[0].id).toBe('evt-3');
    expect((await consoleRepo.listBySession('sess-001')).map((event) => event.id)).toEqual(['evt-3']);

    // 测试时间窗口检索（在发生异常前后 10 秒）
    const windowEvents = await eventRepo.getWindowEvents('sess-001', baseTime + 6000, 10, 10);
    expect(windowEvents.length).toBe(3);
  });

  it('并发更新 Session 统计时不会丢失计数', async () => {
    const session: TestSession = {
      id: 'sess-concurrent',
      projectId: 'proj-1',
      projectName: '商城系统',
      environment: 'TEST',
      title: '并发采集测试',
      status: 'in_progress',
      startedAt: Date.now(),
      initialUrl: 'https://test.example.com',
      currentUrl: 'https://test.example.com',
      browserInfo: {
        userAgent: 'Chrome', browserName: 'Chrome', browserVersion: '120', os: 'macOS',
        viewport: { width: 1280, height: 720 },
      },
      stats: { actionCount: 0, apiCount: 0, errorCount: 0 },
    };
    await sessionRepo.create(session);
    await Promise.all(Array.from({ length: 50 }, () =>
      sessionRepo.updateStats(session.id, { apiCount: 1 })
    ));
    expect((await sessionRepo.getById(session.id))?.stats.apiCount).toBe(50);
  });

  it('删除 Session 时级联清理全部关联证据', async () => {
    const sessionId = 'sess-delete';
    await sessionRepo.create({
      id: sessionId, projectId: 'proj-1', projectName: '商城系统', environment: 'TEST', title: '待删除',
      status: 'completed', startedAt: 1, endedAt: 2, initialUrl: 'https://example.test', currentUrl: 'https://example.test',
      browserInfo: { userAgent: 'Chrome', browserName: 'Chrome', browserVersion: '120', os: 'macOS', viewport: { width: 1280, height: 720 } },
      stats: { actionCount: 1, apiCount: 1, errorCount: 1 },
    });
    await testDb.events.add({ id: 'evt-delete', sessionId, type: 'click', timestamp: 1, title: '点击', description: '点击', url: 'https://example.test', payload: { timestamp: 1, url: 'https://example.test' } });
    await testDb.consoleLogs.add({ id: 'console-delete', sessionId, type: 'error', timestamp: 1, title: '错误', description: '错误', url: 'https://example.test', payload: { timestamp: 1, url: 'https://example.test' } });
    await testDb.networkRequests.add({ id: 'req-delete', sessionId, method: 'GET', url: 'https://example.test/api', pathname: '/api', status: 500, startedAt: 1, duration: 10, isError: true, isSlow: false });
    await testDb.snapshots.add({ id: 'snap-delete', sessionId, createdAt: 1, url: 'https://example.test', browserInfo: { userAgent: 'Chrome', browserName: 'Chrome', browserVersion: '120', os: 'macOS', viewport: { width: 1280, height: 720 } }, windowDurationSec: 30, events: [], networkRequests: [], consoleErrors: [], summary: { eventCount: 1, requestCount: 1, errorCount: 1 } });
    await testDb.bugs.add({ id: 'bug-delete', snapshotId: 'snap-delete', sessionId, title: '错误', severity: 'Major', status: 'draft', reproductionSteps: [], expectedResult: '', actualResult: '', createdAt: 1, updatedAt: 1 });
    await testDb.screenshots.add({ id: 'shot-delete', sessionId, snapshotId: 'snap-delete', createdAt: 1, url: 'https://example.test', dataUrl: 'data:image/png;base64,AA==' });
    await testDb.recordings.add({ id: 'recording-delete', sessionId, tabId: 1, createdAt: 1, durationMs: 1000, url: 'https://example.test', mimeType: 'video/webm', size: 1, blob: new Blob(['x']) });

    await sessionRepo.deleteWithEvidence(sessionId);

    expect(await testDb.sessions.get(sessionId)).toBeUndefined();
    for (const table of [testDb.events, testDb.consoleLogs, testDb.networkRequests, testDb.snapshots, testDb.bugs, testDb.screenshots, testDb.recordings]) {
      expect(await table.where('sessionId').equals(sessionId).count()).toBe(0);
    }
  });

  it('初始化项目环境并持久化自定义域名映射', async () => {
    await projectRepo.ensureDefaults();
    const projects = await projectRepo.listProjects();
    expect(projects.map((project) => project.name)).toContain('商城系统');
    const shop = projects.find((project) => project.name === '商城系统')!;
    expect(await projectRepo.listEnvironments(shop.id)).toHaveLength(4);
    await projectRepo.upsertEnvironment({
      id: `${shop.id}-UAT`,
      projectId: shop.id,
      name: 'UAT',
      baseUrl: 'https://uat.example.com',
    });
    expect((await projectRepo.listEnvironments(shop.id)).find((environment) => environment.name === 'UAT')?.baseUrl)
      .toBe('https://uat.example.com');
  });
});
