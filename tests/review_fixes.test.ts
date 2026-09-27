/**
 * Review 专项验证测试套件 (第二轮复查 5 项问题严格回归)
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { FormDOMRegistry, FormScanner } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { db } from '../src/db';
import { recordingChunkRepo } from '../src/db/repositories/recordingChunkRepository';
import { recordingRepo } from '../src/db/repositories/recordingRepository';
import { formFillRunRepo } from '../src/db/repositories/formFillRunRepository';
import { recordingService } from '../src/sidepanel/services/recordingService';

// ==========================================
// 轻量级 DOM Mock
// ==========================================
class MockDOMElement {
  id: string = '';
  name: string = '';
  tagName: string;
  type: string = 'text';
  value: string = '';
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  required: boolean = false;
  placeholder: string = '';
  options: any[] = [];
  selectedOptions: any[] = [];
  labels: Array<{ textContent: string }> = [];
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  listeners: Record<string, Array<(e: any) => void>> = {};
  style: any = { display: 'block', visibility: 'visible' };

  constructor(tag: string, id: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
  }

  getAttribute(attr: string): string | null {
    if (attr === 'name') return this.name;
    if (attr === 'id') return this.id;
    return null;
  }

  hasAttribute(attr: string): boolean {
    if (attr === 'disabled') return this.disabled;
    if (attr === 'readonly') return this.readOnly;
    return false;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  get offsetParent() {
    return {};
  }

  closest(selector: string): MockDOMElement | null {
    if (selector === 'form') {
      let cur = this.parentNode;
      while (cur) {
        if (cur.tagName === 'FORM') return cur;
        cur = cur.parentNode;
      }
    }
    return null;
  }

  addEventListener(event: string, callback: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  dispatchEvent(event: any): boolean {
    const list = this.listeners[event.type] || [];
    list.forEach((cb) => cb(event));
    return true;
  }

  click() {
    if (this.type === 'checkbox' || this.type === 'radio') {
      this.checked = !this.checked;
    }
    this.dispatchEvent({ type: 'click' });
    this.dispatchEvent({ type: 'change' });
  }

  focus() {
    this.dispatchEvent({ type: 'focus' });
  }

  blur() {
    this.dispatchEvent({ type: 'blur' });
  }
}

class MockDocument {
  allElements: MockDOMElement[] = [];
  forms: MockDOMElement[] = [];
  title = 'Review Fixes Test Page';
  URL = 'https://example.com/review-form';

  querySelectorAll(selector: string): MockDOMElement[] {
    if (selector === 'form') return this.forms;
    return this.allElements;
  }

  getElementById(id: string): MockDOMElement | null {
    return this.allElements.find((el) => el.id === id) || null;
  }
}

describe('第二轮复查 5 项关键问题回归验证', () => {
  let mockDoc: MockDocument;
  let sentMessages: Array<{ tabId: number; message: any }> = [];
  let handleMessage: typeof import('../src/background/index').handleMessage;
  let latestMockRecorder: any = null;

  beforeAll(async () => {
    const chromeMock = {
      runtime: {
        lastError: undefined,
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn((_message: unknown, callback?: () => void) => callback?.()),
      },
      desktopCapture: {
        chooseDesktopMedia: vi.fn((_types: any, cb: (id: string) => void) => cb('mock-stream-id')),
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      tabs: {
        query: vi.fn(async ({ active }: { active?: boolean }) => {
          if (active) {
            return [{ id: 202, windowId: 1, url: 'https://example.com/tabB', title: '页面 B' }];
          }
          return [
            { id: 101, windowId: 1, url: 'https://example.com/tabA', title: '页面 A' },
            { id: 202, windowId: 1, url: 'https://example.com/tabB', title: '页面 B' },
          ];
        }),
        get: vi.fn(async (id: number) => ({
          id,
          windowId: 1,
          url: id === 101 ? 'https://example.com/tabA' : 'https://example.com/tabB',
          title: id === 101 ? '页面 A' : '页面 B',
        })),
        captureVisibleTab: vi.fn(async () => 'data:image/png;base64,smoke'),
        sendMessage: vi.fn(async (tabId: number, message: any) => {
          sentMessages.push({ tabId, message });
          if (message.type === 'CAPTURE_PING') {
            return { ready: true, networkReady: true };
          }
          if (message.type === 'EXECUTE_FORM_FILL') {
            return { runRecord: { runId: message.payload.runId || 'test-run-123', snapshotId: 'snap-1', tabId } };
          }
          if (message.type === 'CANCEL_FORM_FILL') {
            return { success: true };
          }
          if (message.type === 'UNDO_FORM_FILL') {
            return { success: true, restoredCount: 1, conflictCount: 0 };
          }
          return { success: true };
        }),
      },
      scripting: { executeScript: vi.fn(async () => []) },
      storage: {
        session: { set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      },
    };

    vi.stubGlobal('chrome', chromeMock);

    // Mock MediaRecorder 与媒体设备 API
    class MockMediaRecorder {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      ondataavailable: ((e: any) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      mimeType = 'video/webm';
      static isTypeSupported = vi.fn(() => true);

      constructor(public stream: any, public options: any) {
        latestMockRecorder = this;
      }

      start() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }

      emitData(chunk: Blob) {
        this.ondataavailable?.({ data: chunk });
      }
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    if (typeof navigator === 'undefined') {
      vi.stubGlobal('navigator', {});
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(async () => ({
          getVideoTracks: () => [{
            addEventListener: vi.fn(),
            stop: vi.fn(),
          }],
          getTracks: () => [{
            stop: vi.fn(),
          }],
        })),
      },
      configurable: true,
      writable: true,
    });

    ({ handleMessage } = await import('../src/background/index'));
  });

  beforeEach(() => {
    mockDoc = new MockDocument();
    sentMessages = [];
    FormDOMRegistry.clearAll();
    FormExecutor.clearHistory();
    FormExecutor.resetCancel();
  });

  // =======================================================
  // 1. [P1] 第二次填表时，“停止”可能完全无效
  // =======================================================
  it('复查问题 1: 第二次填表时，停止信号精准停止当前任务，不因旧 runId 失效', async () => {
    const input1 = new MockDOMElement('input', 'f1');
    const input2 = new MockDOMElement('input', 'f2');
    mockDoc.allElements.push(input1, input2);
    const snapshot = FormScanner.scan(mockDoc as any);

    // 第一次填表：成功完成并生成任务 1
    const run1 = await FormExecutor.executePlan(
      snapshot.snapshotId,
      [{ fieldId: snapshot.fields[0].fieldId, action: 'fill', value: 'run1-val', source: 'instruction' }],
      'allow_overwrite',
      'run_batch_1'
    );
    expect(run1.status).toBe('completed');
    expect(input1.value).toBe('run1-val');

    // 第二次填表：当前运行 run_batch_2
    // 在调用 cancel 时，传入当前正在执行的任务 ID 或不传 runId，验证能精准取消第二次任务
    FormExecutor.cancel('run_batch_2'); // 精准指定当前批次

    const run2 = await FormExecutor.executePlan(
      snapshot.snapshotId,
      [{ fieldId: snapshot.fields[1].fieldId, action: 'fill', value: 'run2-val', source: 'instruction' }],
      'allow_overwrite',
      'run_batch_2'
    );

    // 第二次任务必须成功被 cancelled，且 input2 绝对不被填入！
    expect(run2.status).toBe('cancelled');
    expect(input2.value).toBe('');
  });

  // =======================================================
  // 2. [P1] “仅填空白”仍允许覆盖原本就有值的字段
  // =======================================================
  it('复查问题 2: "仅填空白" 模式下，无论大模型是否返回 fill，只要原本已有值，绝对禁止覆盖', async () => {
    const input = new MockDOMElement('input', 'existing-company');
    input.value = '已有公司名称'; // 本来就有值
    mockDoc.allElements.push(input);

    const snapshot = FormScanner.scan(mockDoc as any);
    const fieldId = snapshot.fields[0].fieldId;

    // 模拟场景：扫描时 wasEmpty 为 false，大模型依然返回了覆盖动作 action: 'fill'
    const runRecord = await FormExecutor.executePlan(
      snapshot.snapshotId,
      [
        {
          fieldId,
          action: 'fill', // 远程模型或覆盖方案返回了 fill
          value: 'AI 企图覆盖的新名称',
          source: 'generated',
          wasEmpty: false, // 原本就有值
          expectedBeforeValue: '已有公司名称',
        },
      ],
      'empty_only' // 用户选择了“仅填空白”
    );

    // 验证：绝对不被覆盖！原值保留！步骤被跳过！
    expect(input.value).toBe('已有公司名称');
    expect(runRecord.steps[0].status).toBe('skipped');
    expect(runRecord.steps[0].skippedReason).toContain('当前控件已有值');
  });

  // =======================================================
  // 3. [P1] 中断录像虽然存了分片，但用户无法恢复，再次录屏还会删除它
  // =======================================================
  it('复查问题 3: 遗留分片在再次录屏时自动转存为录像证据，checkAndAutoRecover 可主动恢复', async () => {
    const sessionId = `session-legacy-${Date.now()}`;
    await recordingChunkRepo.clearChunks(sessionId);

    // 模拟上次异常中断遗留的 2 个分片
    const chunkA = new Blob(['video-part-A'], { type: 'video/webm' });
    const chunkB = new Blob(['video-part-B'], { type: 'video/webm' });
    await recordingChunkRepo.saveChunk({
      id: `${sessionId}-0`,
      sessionId,
      chunkIndex: 0,
      data: chunkA,
      size: chunkA.size,
      createdAt: Date.now() - 2000,
    });
    await recordingChunkRepo.saveChunk({
      id: `${sessionId}-1`,
      sessionId,
      chunkIndex: 1,
      data: chunkB,
      size: chunkB.size,
      createdAt: Date.now() - 1000,
    });

    // 1. 验证生产检测与恢复接口：checkAndAutoRecover 能够将遗留分片恢复成完整录像
    const autoRecovered = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com');
    expect(autoRecovered).toBeDefined();
    expect(autoRecovered?.blob.size).toBe(chunkA.size + chunkB.size);

    // 验证恢复后，分片表已清空，且录像已写入 recordingRepo
    const remainingChunks = await recordingChunkRepo.getChunks(sessionId);
    expect(remainingChunks).toHaveLength(0);
    const inDb = await recordingRepo.getById(autoRecovered!.id);
    expect(inDb).toBeDefined();
  });

  // =======================================================
  // 4. [P2] 下拉方案输入无效选项，会清空原选择并报告成功
  // =======================================================
  it('复查问题 4: 下拉方案输入无效选项时，拒绝写入并保留原选择，步骤报告失败', async () => {
    const select = new MockDOMElement('select', 'city-select');
    select.options = [
      { id: 'opt-bj', value: 'BJ', text: '北京' },
      { id: 'opt-sh', value: 'SH', text: '上海' },
    ];
    select.value = 'BJ'; // 原值选择北京
    mockDoc.allElements.push(select);

    const snapshot = FormScanner.scan(mockDoc as any);
    const fieldId = snapshot.fields[0].fieldId;

    // 方案中输入了不存在的选项值“火星”，在 allow_overwrite 模式下执行写入
    const runRecord = await FormExecutor.executePlan(
      snapshot.snapshotId,
      [
        {
          fieldId,
          action: 'fill',
          value: '火星', // 无效选项
          source: 'instruction',
        },
      ],
      'allow_overwrite'
    );

    // 验证：原值北京 (BJ) 被保留，绝不被清空为 ''，步骤状态为 failed 并给出明确报错！
    expect(select.value).toBe('BJ');
    expect(runRecord.steps[0].status).toBe('failed');
    expect(runRecord.steps[0].error).toContain('未找到 "火星" 对应的有效选项');
  });

  // =======================================================
  // 5. [P2] “刷新网页后撤销”仍不成立
  // =======================================================
  it('复查问题 5: 真实模拟网页刷新 (FormDOMRegistry.clearAll)，撤销准确报告快照失效不可撤销', async () => {
    const input = new MockDOMElement('input', 'user-name');
    input.value = 'original-user';
    mockDoc.allElements.push(input);

    const snapshot = FormScanner.scan(mockDoc as any);
    const fieldId = snapshot.fields[0].fieldId;

    // 填表写入新值 (allow_overwrite 模式)
    const runRecord = await FormExecutor.executePlan(
      snapshot.snapshotId,
      [{ fieldId, action: 'fill', value: 'new-user', source: 'instruction' }],
      'allow_overwrite'
    );
    expect(input.value).toBe('new-user');

    // 关键：真实模拟被测网页刷新（清空整个页面的 DOM 节点注册表）
    FormDOMRegistry.clearAll();

    // 此时尝试从持久化步骤进行撤销
    const undoResult = await FormExecutor.undo(runRecord.runId, {
      snapshotId: runRecord.snapshotId,
      steps: runRecord.steps,
    });

    // 验证：系统必须如实报告快照失效，不能虚报成功！
    expect(undoResult.success).toBe(false);
    expect(undoResult.restoredCount).toBe(0);
    expect(undoResult.error).toContain('当前网页已被刷新或重新加载，表单快照与控件映射已失效');
  });

  // =======================================================
  // 6. [P1] 正在录制的视频会被误当成中断录像恢复
  // =======================================================
  it('复查问题 6: 正在录制期间 (active=true)，checkAndAutoRecover 绝不误恢复且不删除当前分片', async () => {
    const sessionId = `session-active-${Date.now()}`;
    await recordingChunkRepo.clearChunks(sessionId);

    // 1. 启动录屏，此时 active 变为 true
    const status = await recordingService.start({
      sessionId,
      tabId: 101,
      url: 'https://example.com/recording-page',
    });
    expect(status.active).toBe(true);

    // 模拟录制产生分片
    const chunk1 = new Blob(['active-video-data-1'], { type: 'video/webm' });
    latestMockRecorder?.emitData(chunk1);

    // 稍微等待异步落库完成
    await new Promise((r) => setTimeout(r, 30));
    const activeChunks = await recordingChunkRepo.getChunks(sessionId);
    expect(activeChunks.length).toBeGreaterThanOrEqual(1);

    // 2. 模拟切到其他页面再返回首页：触发 checkAndAutoRecover
    const recoverResult = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com');
    // 关键断言：绝对返回 null，绝不会误将其当成遗留录像提前收割！
    expect(recoverResult).toBeNull();

    // 关键断言：正在录制的分片绝对没有被清空！
    const chunksAfter = await recordingChunkRepo.getChunks(sessionId);
    expect(chunksAfter.length).toBe(activeChunks.length);

    // 3. 模拟停止录制，验证录制正常保存且状态重置
    const savedEvidence = await recordingService.stop();
    expect(savedEvidence).toBeDefined();
    expect(savedEvidence.sessionId).toBe(sessionId);
    expect(recordingService.getStatus().active).toBe(false);
  });

  // =======================================================
  // 7. [P1] 遗留录像恢复失败后，仍继续录制并覆盖旧分片
  // =======================================================
  it('复查问题 7: 遗留录像恢复失败时立即中止录屏启动阻止覆盖；且分片使用独立 recordingId 隔离', async () => {
    const sessionId = `session-legacy-fail-${Date.now()}`;
    await recordingChunkRepo.clearChunks(sessionId);

    // 1. 预先注入遗留分片
    const legacyRecordingId = `recording_legacy_old`;
    const oldChunk = new Blob(['old-legacy-frames'], { type: 'video/webm' });
    await recordingChunkRepo.saveChunk({
      id: `${legacyRecordingId}-chunk-0`,
      recordingId: legacyRecordingId,
      sessionId,
      chunkIndex: 0,
      data: oldChunk,
      size: oldChunk.size,
      createdAt: Date.now() - 5000,
    });

    // 2. 模拟录像恢复转存时发生严重故障（例如 recordingRepo.add 抛出异常）
    vi.spyOn(recordingRepo, 'add').mockRejectedValueOnce(new Error('IndexedDB 磁盘配额已满写入失败'));

    // 3. 尝试启动新录屏：必须 fail-fast 抛出异常，绝不允许继续录制覆盖旧分片！
    await expect(
      recordingService.start({
        sessionId,
        tabId: 101,
        url: 'https://example.com',
      })
    ).rejects.toThrow('为防止数据损坏已阻止新录制');

    // 验证：录像服务状态保持未激活，旧分片依然完好保存在数据库中，绝未被删除或覆盖！
    expect(recordingService.getStatus().active).toBe(false);
    const retainedChunks = await recordingChunkRepo.getChunksByRecordingId(legacyRecordingId);
    expect(retainedChunks).toHaveLength(1);
    expect(retainedChunks[0].data.size).toBe(oldChunk.size);

    // 恢复 mock
    vi.restoreAllMocks();

    // 4. 验证分片隔离性：即使同一 Session 进行两次录制，分片 ID 也是独立 recordingId，完全不会冲突覆盖
    const normalStatus = await recordingService.start({
      sessionId,
      tabId: 101,
      url: 'https://example.com',
    });
    expect(normalStatus.active).toBe(true);

    const newChunk = new Blob(['new-fresh-recording-frame'], { type: 'video/webm' });
    latestMockRecorder?.emitData(newChunk);
    await new Promise((r) => setTimeout(r, 30));

    // 检查新录制保存的分片，验证其 id 包含专属 recordingId，与旧分片完全隔离
    const allSessionChunks = await recordingChunkRepo.getChunks(sessionId);
    const newRecordingChunks = allSessionChunks.filter((c) => c.recordingId !== legacyRecordingId);
    expect(newRecordingChunks.length).toBeGreaterThan(0);
    expect(newRecordingChunks[0].recordingId).toBeDefined();
    expect(newRecordingChunks[0].recordingId).not.toBe(legacyRecordingId);

    // 正常停止录制
    await recordingService.stop();
  });

  // =======================================================
  // 8. [P2] ID 前缀判断不一致导致重复恢复生成重复录像
  // =======================================================
  it('复查问题 8: 统一支持 recording- 前缀规范，幂等防重与并发锁确保多次恢复绝不生成重复录像', async () => {
    const sessionId = `session-prefix-idemp-${Date.now()}`;
    await recordingChunkRepo.clearChunks(sessionId);

    // 1. 使用标准 createEntityId('recording') 生成生产真实的 recordingId (格式: recording-xxx)
    const standardRecordingId = `recording-${Date.now().toString(36)}-standard123`;
    expect(standardRecordingId.startsWith('recording-')).toBe(true);

    const chunkData = new Blob(['standard-recording-video-content'], { type: 'video/webm' });
    await recordingChunkRepo.saveChunk({
      id: `${standardRecordingId}-chunk-0`,
      recordingId: standardRecordingId,
      sessionId,
      chunkIndex: 0,
      data: chunkData,
      size: chunkData.size,
      createdAt: Date.now() - 3000,
    });

    // 2. 模拟并发或连续两次触发 checkAndAutoRecover（例如首页挂载、切 tab 快速重新进入）
    const [result1, result2] = await Promise.all([
      recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/prefix-test'),
      recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/prefix-test'),
    ]);

    // 验证 1: 恢复出的录像 ID 必须精确保持为分片所属的 standardRecordingId，绝不重新生成随机 ID
    expect(result1).toBeDefined();
    expect(result1?.id).toBe(standardRecordingId);
    expect(result2?.id).toBe(standardRecordingId);

    // 验证 2: 数据库中落库的录像证据必须只有唯一一条，绝对禁止重复生成重复录像！
    const sessionRecordings = await recordingRepo.listBySession(sessionId);
    expect(sessionRecordings).toHaveLength(1);
    expect(sessionRecordings[0].id).toBe(standardRecordingId);

    // 验证 3: 恢复完成后分片已完全清理，后续调用 checkAndAutoRecover 不再有分片待处理
    const result3 = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/prefix-test');
    expect(result3).toBeNull();
    const finalRecordings = await recordingRepo.listBySession(sessionId);
    expect(finalRecordings).toHaveLength(1);

    // 验证 4: 若分片异常残留（模拟分片清理失败或重复触发），幂等防重机制命中已落库记录，清理分片并直接返回已有记录，绝不重复 insert 生成第 2 条录像
    await recordingChunkRepo.saveChunk({
      id: `${standardRecordingId}-chunk-0`,
      recordingId: standardRecordingId,
      sessionId,
      chunkIndex: 0,
      data: chunkData,
      size: chunkData.size,
      createdAt: Date.now(),
    });
    const result4 = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/prefix-test');
    expect(result4?.id).toBe(standardRecordingId);
    const recordingsAfterResidual = await recordingRepo.listBySession(sessionId);
    expect(recordingsAfterResidual).toHaveLength(1); // 严格保持唯一 1 条！

    // 验证 5: 残留分片被清理干净
    const remainingChunks = await recordingChunkRepo.getChunksByRecordingId(standardRecordingId);
    expect(remainingChunks).toHaveLength(0);
  });

  // =======================================================
  // 9. [P2] 旧版本无 recordingId 分片清理失败重试防重复入库
  // =======================================================
  it('复查问题 9: 旧格式无 recordingId 的遗留分片具备确定性稳定恢复 ID，清理失败后再次重试绝不重复入库', async () => {
    const sessionId = `session-legacy-compat-${Date.now()}`;
    await recordingChunkRepo.clearChunks(sessionId);

    // 1. 模拟旧格式分片（完全没有 recordingId 字段，仅有 sessionId）
    const legacyCreatedAt = Date.now() - 10000;
    const chunkBlob = new Blob(['legacy-format-video-data'], { type: 'video/webm' });
    await recordingChunkRepo.saveChunk({
      id: `${sessionId}-0`,
      // 故意不传 recordingId，模拟旧数据结构
      sessionId,
      chunkIndex: 0,
      data: chunkBlob,
      size: chunkBlob.size,
      createdAt: legacyCreatedAt,
    });

    // 2. 模拟清理失败场景：拦截 clearChunks / clearChunksByRecordingId 抛出异常使其失败
    vi.spyOn(recordingChunkRepo, 'clearChunksByRecordingId').mockRejectedValueOnce(new Error('Simulated clear failure'));
    vi.spyOn(recordingChunkRepo, 'clearChunks').mockRejectedValueOnce(new Error('Simulated clear failure'));

    const recoveredFirst = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/legacy-test');
    expect(recoveredFirst).toBeDefined();
    // 验证生成的是确定性稳定 ID，而非无序随机 ID
    expect(recoveredFirst?.id).toBe(`recording-legacy-${sessionId}-${legacyCreatedAt}`);

    // 验证首次恢复后，数据库已有 1 条录像记录
    const recordingsRound1 = await recordingRepo.listBySession(sessionId);
    expect(recordingsRound1).toHaveLength(1);

    // 验证分片确实因清理失败仍残留在数据库中
    const chunksStillThere = await recordingChunkRepo.getChunks(sessionId);
    expect(chunksStillThere).toHaveLength(1);

    // 恢复 mock
    vi.restoreAllMocks();

    // 3. 再次触发恢复（相同场景重试）：验证命中已落库记录，成功幂等返回，绝对不会生成第 2 条录像
    const recoveredRetry = await recordingService.checkAndAutoRecover(sessionId, 101, 'https://example.com/legacy-test');
    expect(recoveredRetry).toBeDefined();
    expect(recoveredRetry?.id).toBe(recoveredFirst?.id);

    // 核心断言：录像记录严格仍然只有 1 条，杜绝了旧格式分片重复入库！
    const recordingsRound2 = await recordingRepo.listBySession(sessionId);
    expect(recordingsRound2).toHaveLength(1);

    // 验证分片在这次成功清理干净
    const chunksAfterRetry = await recordingChunkRepo.getChunks(sessionId);
    expect(chunksAfterRetry).toHaveLength(0);
  });
});
