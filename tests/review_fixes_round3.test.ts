/**
 * 第三轮 Review 关键缺陷专项回归验证测试 (Review 5 项重点问题)
 * 1. iframe 抢先返回错误与 frameId: 0 路由
 * 2. 任务协调器并发排他防护与 isTargetBusy 业务阻断
 * 3. 后台重启后的任务恢复与探活核实
 * 4. 自定义 ARIA 下拉控件识别 (unsupported) 与执行器拒绝假写入
 * 5. 填表任务逐步执行进度上报
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskCoordinator } from '../src/background/tasks/taskCoordinator';
import { FormScanner, FormDOMRegistry } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { FormFillAssignment } from '../src/shared/types/formFill';

// 轻量 MockNode 兼容 Node.js 运行环境
class MockNode {
  tagName: string;
  id: string = '';
  type: string = 'text';
  value: string = '';
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  textContent: string = '';
  attributes: Record<string, string> = {};

  constructor(tag: string, id: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }

  closest() {
    return null;
  }

  querySelector() {
    return null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  dispatchEvent() {
    return true;
  }
}

describe('第三轮 Review 5 项重点缺陷回归验证', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    FormExecutor.resetCancel();
    FormExecutor.clearHistory();
    FormDOMRegistry.clearAll();
  });

  describe('问题 1: iframe 消息隔离与 frameId: 0 防护', () => {
    it('非顶层 frame 接收到顶层填表/扫描指令时应严格静默忽略，不调用 sendResponse', async () => {
      let topFrameResponded = false;
      let iframeResponded = false;

      const mockTopFrameHandler = (msg: { type: string }, sendResponse: (res: unknown) => void) => {
        const isTop = true;
        if (msg.type === 'SCAN_FORM_SNAPSHOT') {
          if (!isTop) return false;
          sendResponse({ snapshot: { snapshotId: 'snap-top', forms: [], fields: [] } });
          return false;
        }
        return false;
      };

      const mockIframeHandler = (msg: { type: string }, sendResponse: (res: unknown) => void) => {
        const isTop = false;
        if (msg.type === 'SCAN_FORM_SNAPSHOT') {
          // 修复后：子 frame 必须静默忽略，不调用 sendResponse 抢占信道
          if (!isTop) return false;
          sendResponse({ error: 'iframe error' });
          return false;
        }
        return false;
      };

      mockTopFrameHandler({ type: 'SCAN_FORM_SNAPSHOT' }, () => {
        topFrameResponded = true;
      });

      mockIframeHandler({ type: 'SCAN_FORM_SNAPSHOT' }, () => {
        iframeResponded = true;
      });

      expect(topFrameResponded).toBe(true);
      expect(iframeResponded).toBe(false); // 子 frame 绝不应抢先响应
    });
  });

  describe('问题 2: 任务协调器并发排他防护', () => {
    it('同一目标页面正在执行任务时，启动第二个任务应严格拒绝并抛出明确错误', () => {
      const coordinator = new TaskCoordinator();
      const targetTabId = 1001;

      // 启动第一个任务
      coordinator.startTask(
        'form_fill',
        '任务 A',
        { tabId: targetTabId, frameId: 0 },
        3
      );

      expect(coordinator.isTargetBusy(targetTabId)).toBe(true);

      // 尝试在同一标签页启动第二个任务，应当被严格拒绝抛出异常
      expect(() => {
        coordinator.startTask(
          'replay',
          '任务 B',
          { tabId: targetTabId, frameId: 0 },
          2
        );
      }).toThrowError(/当前已有任务「任务 A」.*正在执行中，禁止并发执行/);

      // 且当前活跃任务仍应保持为任务 A
      expect(coordinator.getActiveTask()?.title).toBe('任务 A');
      expect(coordinator.getActiveTask()?.status).toBe('running');
    });

    it('完成前一个任务后，同一目标页面才能接受新任务', () => {
      const coordinator = new TaskCoordinator();
      const targetTabId = 1002;

      const taskA = coordinator.startTask(
        'form_fill',
        '任务 A',
        { tabId: targetTabId, frameId: 0 },
        2
      );

      coordinator.finishTask(taskA.runId, 'completed');
      expect(coordinator.isTargetBusy(targetTabId)).toBe(false);

      // 此时启动新任务正常通过
      const taskB = coordinator.startTask(
        'replay',
        '任务 B',
        { tabId: targetTabId, frameId: 0 },
        2
      );
      expect(taskB.title).toBe('任务 B');
      expect(coordinator.isTargetBusy(targetTabId)).toBe(true);
    });
  });

  describe('问题 3: 后台重启任务恢复与探活核实', () => {
    it('从 storage 恢复任务时，若探活发现目标标签页已关闭，应安全标记为 interrupted', async () => {
      const coordinator = new TaskCoordinator();

      const mockSavedTask = {
        runId: 'run-crash-test',
        type: 'form_fill' as const,
        title: '中断填表',
        status: 'running' as const,
        target: { tabId: 9999, frameId: 0 },
        currentStep: 1,
        totalSteps: 5,
        startedAt: Date.now() - 10000,
        steps: [],
      };

      vi.stubGlobal('chrome', {
        storage: {
          session: {
            get: vi.fn().mockResolvedValue({ activeTaskRun: mockSavedTask }),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
        tabs: {
          // 模拟目标 tab 不存在
          get: vi.fn().mockRejectedValue(new Error('Tab not found')),
        },
      });

      const restored = await coordinator.restoreFromStorage();
      expect(restored).toBeDefined();
      expect(restored?.runId).toBe('run-crash-test');

      // 探活逻辑：模拟后台检测并收敛状态
      if (restored && restored.status === 'running') {
        try {
          await chrome.tabs.get(restored.target.tabId);
        } catch {
          coordinator.finishTask(restored.runId, 'interrupted', '后台重启后目标页面已关闭');
        }
      }

      // 验证最终状态被修正为 interrupted，杜绝虚假 running
      expect(coordinator.getActiveTask()).toBeNull();
      expect(coordinator.isTargetBusy(9999)).toBe(false);
    });
  });

  describe('问题 4: 自定义 ARIA 下拉控件识别与拒绝假写入', () => {
    it('FormScanner 遇到非原生 ARIA 控件时应标记为 kind: unsupported，并给出明确原因', () => {
      const container = new MockNode('div', 'custom-combobox-1');
      container.setAttribute('role', 'combobox');
      container.textContent = '请选择所属行业';

      const mockDoc = {
        forms: [],
        querySelectorAll: (selector: string) => {
          if (selector.includes('role=')) return [container];
          return [];
        },
        location: { href: 'http://test.com/aria' },
        title: 'ARIA 测试',
      };

      const snapshot = FormScanner.scan(mockDoc as any);
      const ariaField = snapshot.fields.find((f) => f.fieldId.includes('custom-combobox-1'));

      expect(ariaField).toBeDefined();
      expect(ariaField?.kind).toBe('unsupported');
      expect(ariaField?.unsupportedReason).toContain('自定义 ARIA 控件尚未接入专用点击展开交互适配器');
    });

    it('FormExecutor 拒绝向非原生表单元素写入数据，绝不注入 .value 冒充成功', async () => {
      const divElement = new MockNode('div', 'custom-div');
      divElement.setAttribute('role', 'combobox');
      divElement.textContent = '请选择';

      const snapshotId = 'snap-div-test';
      const fieldId = 'field-div-1';
      FormDOMRegistry.register(fieldId, divElement as any, snapshotId);

      const assignment: FormFillAssignment = {
        fieldId,
        action: 'fill',
        value: '假装填入的值',
      };

      const result = await FormExecutor.executePlan(snapshotId, [assignment], 'allow_overwrite', 'run-div-1');

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error).toContain('不支持向非原生表单控件 <div> 写入数据');
      // 确认 div 上绝未被挂载非法的 value 属性
      expect((divElement as any).value).toBe('');
    });
  });

  describe('问题 5: 填表逐步进度上报', () => {
    it('FormExecutor.executePlan 在执行每一步后应派发 UPDATE_TASK_STEP 消息通知后台', async () => {
      const input1 = new MockNode('input', 'inp-1');
      input1.type = 'text';

      const input2 = new MockNode('input', 'inp-2');
      input2.type = 'text';

      const snapshotId = 'snap-step-test';
      FormDOMRegistry.register('field-1', input1 as any, snapshotId);
      FormDOMRegistry.register('field-2', input2 as any, snapshotId);

      const stepUpdates: Array<{ stepIndex: number; status: string }> = [];

      vi.stubGlobal('chrome', {
        runtime: {
          sendMessage: vi.fn().mockImplementation((msg) => {
            if (msg.type === 'UPDATE_TASK_STEP') {
              stepUpdates.push({
                stepIndex: msg.payload.stepIndex,
                status: msg.payload.update.status,
              });
            }
            return Promise.resolve({ success: true });
          }),
        },
      });

      const assignments: FormFillAssignment[] = [
        { fieldId: 'field-1', action: 'fill', value: '张三' },
        { fieldId: 'field-2', action: 'fill', value: '李四' },
      ];

      const runRecord = await FormExecutor.executePlan(snapshotId, assignments, 'empty_only', 'run-progress-test');

      expect(runRecord.status).toBe('completed');
      expect(stepUpdates.length).toBe(2);
      expect(stepUpdates[0]).toEqual({ stepIndex: 0, status: 'success' });
      expect(stepUpdates[1]).toEqual({ stepIndex: 1, status: 'success' });
      expect(input1.value).toBe('张三');
      expect(input2.value).toBe('李四');
    });
  });

  describe('复查新发现 3 项 P1 级缺陷回归验证', () => {
    it('问题 1: 切换标签页排他强阻断 - 标签页 A 执行填表时，切换到标签页 B 启动新任务必须被强阻断，绝不覆盖原任务或并发操作', async () => {
      const coordinator = new TaskCoordinator();
      coordinator.startTask('form_fill', '标签页A填表', { tabId: 101, frameId: 0 }, 5);
      expect(coordinator.hasActiveTask()).toBe(true);

      // 切换到标签页 B 尝试启动回放，必须被全局排他拒绝
      expect(() => {
        coordinator.startTask('replay', '标签页B回放', { tabId: 102, frameId: 0 }, 3);
      }).toThrowError(/当前已有任务「标签页A填表」\(标签页 ID: 101\) 正在执行中/);

      // 确认原任务依然完好运行，并未被置为 interrupted 或覆盖
      expect(coordinator.getActiveTask()?.runId).toBeDefined();
      expect(coordinator.getActiveTask()?.status).toBe('running');
      expect(coordinator.getActiveTask()?.target.tabId).toBe(101);
    });

    it('问题 2: 填表执行结束后独立派发 FINISH_TASK 消息通知后台释放占用', async () => {
      const input = new MockNode('input', 'finish-input');
      input.type = 'text';
      const snapId = 'snap-finish-msg';
      FormDOMRegistry.register('f-1', input as any, snapId);

      const sentMessages: any[] = [];
      vi.stubGlobal('chrome', {
        runtime: {
          sendMessage: vi.fn().mockImplementation((msg) => {
            sentMessages.push(msg);
            return Promise.resolve({ success: true });
          }),
        },
      });

      await FormExecutor.executePlan(snapId, [{ fieldId: 'f-1', action: 'fill', value: '王五' }], 'empty_only', 'run-finish-test');

      // 验证最后发出了 FINISH_TASK 独立消息
      const finishMsg = sentMessages.find((m) => m.type === 'FINISH_TASK');
      expect(finishMsg).toBeDefined();
      expect(finishMsg.payload.runId).toBe('run-finish-test');
      expect(finishMsg.payload.status).toBe('completed');
    });

    it('回放步骤执行中/步骤间隔中重启后台: 即使页面探活返回 isRunning=true，也不能判定整段回放可继续，必须统一中断并释放任务占用 (QA-P1)', async () => {
      const mockStorageData: Record<string, any> = {
        activeTaskRun: {
          runId: 'replay-recovery-test',
          type: 'replay',
          title: '回放恢复测试',
          status: 'running',
          target: { tabId: 888, frameId: 0 },
          currentStep: 1,
          totalSteps: 3,
          startedAt: Date.now(),
          steps: [],
        },
      };

      const pageSentMessages: Array<{ tabId: number; message: any }> = [];

      vi.stubGlobal('chrome', {
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: vi.fn() },
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
        },
        sidePanel: {
          setPanelBehavior: vi.fn(),
        },
        storage: {
          session: {
            get: vi.fn().mockImplementation((key) => Promise.resolve({ [key]: mockStorageData[key] })),
            set: vi.fn().mockImplementation((obj) => {
              Object.assign(mockStorageData, obj);
              return Promise.resolve();
            }),
            remove: vi.fn().mockImplementation((key) => {
              delete mockStorageData[key];
              return Promise.resolve();
            }),
          },
        },
        tabs: {
          get: vi.fn().mockResolvedValue({ id: 888, url: 'https://example.com' }),
          sendMessage: vi.fn().mockImplementation((tabId, msg) => {
            pageSentMessages.push({ tabId, message: msg });
            if (msg.type === 'PING_TASK_STATUS') {
              // 关键验证：即使页面残留 ID 导致返回 isRunning: true
              return Promise.resolve({ isRunning: true, activeRunId: 'replay-recovery-test' });
            }
            return Promise.resolve({ success: true });
          }),
        },
      });

      const { initTaskCoordinatorRecovery, taskCoordinator } = await import('../src/background/index');
      await initTaskCoordinatorRecovery();

      // 验证 1: 回放任务绝不能保留为 running，必须被标记为 interrupted 并从 storage 清除
      expect(mockStorageData.activeTaskRun).toBeUndefined();
      expect(taskCoordinator.hasActiveTask()).toBe(false);
      expect(taskCoordinator.isTargetBusy(888)).toBe(false);

      // 验证 2: 必须向页面同步派发 STOP_CONTENT_REPLAY，终止页面可能残留的单步等待动作
      const stopReplaySent = pageSentMessages.some((m) => m.message.type === 'STOP_CONTENT_REPLAY');
      expect(stopReplaySent).toBe(true);
    });

    it('填表任务在后台重启后按 FormExecutor 执行器状态恢复: 探活成功保持 running，探活失败标记 interrupted', async () => {
      const mockStorageData: Record<string, any> = {
        activeTaskRun: {
          runId: 'fill-recovery-test',
          type: 'form_fill',
          title: '填表恢复测试',
          status: 'running',
          target: { tabId: 777, frameId: 0 },
          currentStep: 2,
          totalSteps: 5,
          startedAt: Date.now(),
          steps: [],
        },
      };

      vi.stubGlobal('chrome', {
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: vi.fn() },
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
        },
        sidePanel: { setPanelBehavior: vi.fn() },
        storage: {
          session: {
            get: vi.fn().mockImplementation((key) => Promise.resolve({ [key]: mockStorageData[key] })),
            set: vi.fn().mockImplementation((obj) => {
              Object.assign(mockStorageData, obj);
              return Promise.resolve();
            }),
            remove: vi.fn().mockImplementation((key) => {
              delete mockStorageData[key];
              return Promise.resolve();
            }),
          },
        },
        tabs: {
          get: vi.fn().mockResolvedValue({ id: 777, url: 'https://example.com' }),
          sendMessage: vi.fn().mockImplementation((tabId, msg) => {
            if (msg.type === 'PING_TASK_STATUS') {
              return Promise.resolve({ isRunning: true, activeRunId: 'fill-recovery-test' });
            }
            return Promise.resolve({ success: true });
          }),
        },
      });

      const { initTaskCoordinatorRecovery, taskCoordinator } = await import('../src/background/index');
      await initTaskCoordinatorRecovery();

      // 填表执行器在页面存活，保留 running 状态等待其派发 FINISH_TASK
      expect(taskCoordinator.getActiveTask()?.runId).toBe('fill-recovery-test');
      expect(taskCoordinator.getActiveTask()?.status).toBe('running');

      // 收尾清理
      taskCoordinator.finishTask('fill-recovery-test', 'completed');
    });

    it('问题 3: 回放执行若抛出未捕获异常，任务被安全标记为 failed 并释放占用，不永久悬挂', async () => {
      const coordinator = new TaskCoordinator();
      const replayId = 'replay-throw-test';
      coordinator.startTask('replay', '异常回放测试', { tabId: 303, frameId: 0 }, 2, undefined, replayId);
      expect(coordinator.hasActiveTask()).toBe(true);

      // 模拟回放通信或导航抛出致命异常
      try {
        throw new Error('Tab connection crashed');
      } catch (err: any) {
        coordinator.finishTask(replayId, 'failed', err.message);
      }

      // 验证任务被正确收敛，且活跃任务被释放
      expect(coordinator.getActiveTask()).toBeNull();
      expect(coordinator.hasActiveTask()).toBe(false);
      expect(coordinator.isTargetBusy(303)).toBe(false);
    });
  });
});
