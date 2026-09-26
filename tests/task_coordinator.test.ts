/**
 * IMP-05 / IMP-06 任务协调器 (TaskCoordinator) 专项测试
 * 验证长耗时任务（回放、智能填表）的生命周期、步骤推进、取消中止、多标签互斥与广播通知
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCoordinator } from '../src/background/tasks/taskCoordinator';
import type { TaskRunRecord } from '../src/shared/types/task';
import type { PageTarget } from '../src/shared/types/page';

describe('TaskCoordinator 任务协调器', () => {
  let coordinator: TaskCoordinator;
  let broadcastedMessages: Array<{ type: string; payload: { task: TaskRunRecord } }>;

  const mockTarget: PageTarget = {
    tabId: 201,
    frameId: 0,
    url: 'https://example.com/form',
  };

  beforeEach(() => {
    broadcastedMessages = [];
    coordinator = new TaskCoordinator((msg) => {
      broadcastedMessages.push(msg);
    });
  });

  it('正常生命周期: startTask -> updateStep -> finishTask', () => {
    // 1. 启动任务
    const task = coordinator.startTask('replay', '操作流回放', mockTarget, 3);
    expect(task.runId).toBeDefined();
    expect(task.type).toBe('replay');
    expect(task.title).toBe('操作流回放');
    expect(task.status).toBe('running');
    expect(task.totalSteps).toBe(3);
    expect(task.currentStep).toBe(0);
    expect(coordinator.getActiveTask()?.runId).toBe(task.runId);
    expect(coordinator.isTargetBusy(201)).toBe(true);
    expect(broadcastedMessages.length).toBe(1);
    expect(broadcastedMessages[0].payload.task.status).toBe('running');

    // 2. 推进步骤 0
    const updated1 = coordinator.updateStep(task.runId, 0, { status: 'running' });
    expect(updated1?.steps[0].status).toBe('running');
    expect(updated1?.currentStep).toBe(1);

    // 推进步骤 0 完成
    coordinator.updateStep(task.runId, 0, { status: 'success' });
    expect(coordinator.getActiveTask()?.steps[0].status).toBe('success');

    // 推进步骤 1 完成
    coordinator.updateStep(task.runId, 1, { status: 'success' });
    expect(coordinator.getActiveTask()?.currentStep).toBe(2);

    // 3. 完成任务
    const finished = coordinator.finishTask(task.runId, 'completed');
    expect(finished?.status).toBe('completed');
    expect(finished?.finishedAt).toBeDefined();
    expect(coordinator.getActiveTask()).toBeNull();
    expect(coordinator.isTargetBusy(201)).toBe(false);

    // 验证最后一次广播为完成状态
    const lastBroadcast = broadcastedMessages[broadcastedMessages.length - 1];
    expect(lastBroadcast.payload.task.status).toBe('completed');
  });

  it('任务取消逻辑: markCancelling -> finishTask(cancelled)', () => {
    const task = coordinator.startTask('form_fill', '智能表单填充', mockTarget, 5);
    expect(task.status).toBe('running');

    // 标记取消中
    const cancelling = coordinator.markCancelling(task.runId);
    expect(cancelling?.status).toBe('cancelling');
    expect(coordinator.getActiveTask()?.status).toBe('cancelling');
    // 取消中依然属于 busy 状态，防止被外部并发指令覆盖
    expect(coordinator.isTargetBusy(201)).toBe(true);

    // 完成取消
    const cancelled = coordinator.finishTask(task.runId, 'cancelled', '用户手动中止');
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.error).toBe('用户手动中止');
    expect(coordinator.getActiveTask()).toBeNull();
    expect(coordinator.isTargetBusy(201)).toBe(false);
  });

  it('目标独占检测 (isTargetBusy): 同 Tab 互斥，不同 Tab 不受干扰', () => {
    coordinator.startTask('replay', '测试回放', { tabId: 301, frameId: 0 }, 2);

    expect(coordinator.isTargetBusy(301)).toBe(true);
    expect(coordinator.isTargetBusy(302)).toBe(false); // 另一个 Tab 不忙碌
    expect(coordinator.isTargetBusy(999)).toBe(false);
  });

  it('全局活跃任务排他机制: 任何标签页存在活跃任务时，禁止在其他标签页并发启动新任务 (QA-P1)', () => {
    const task1 = coordinator.startTask('replay', '页面A回放', { tabId: 201, frameId: 0 }, 2);
    expect(task1.status).toBe('running');
    expect(coordinator.hasActiveTask()).toBe(true);

    // 尝试在另一个 Tab 启动新任务，必须被全局排他强阻断，抛出明确异常，绝不覆盖任务或在后台并行
    expect(() => {
      coordinator.startTask('form_fill', '页面B填表', { tabId: 202, frameId: 0 }, 4);
    }).toThrowError(/当前已有任务「页面A回放」\(标签页 ID: 201\) 正在执行中，禁止并发执行/);

    // 确认原任务状态未受任何影响
    expect(coordinator.getActiveTask()?.runId).toBe(task1.runId);
    expect(task1.status).toBe('running');

    // 正常结束 task1 之后，页面 B 才能启动新任务
    coordinator.finishTask(task1.runId, 'completed');
    expect(coordinator.hasActiveTask()).toBe(false);

    const task2 = coordinator.startTask('form_fill', '页面B填表', { tabId: 202, frameId: 0 }, 4);
    expect(task2.status).toBe('running');
    expect(coordinator.getActiveTask()?.runId).toBe(task2.runId);
  });

  it('无效 runId 保护: 尝试更新已结束或不存在的任务不会产生副作用', () => {
    const task = coordinator.startTask('replay', '单次回放', mockTarget, 1);
    coordinator.finishTask(task.runId, 'completed');

    const result = coordinator.updateStep('non-existent-id', 0, { status: 'success' });
    expect(result).toBeNull();

    const cancelResult = coordinator.markCancelling('non-existent-id');
    expect(cancelResult).toBeNull();
  });
});
