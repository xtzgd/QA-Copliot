/**
 * 统一后台任务协调器 (IMP-05 / IMP-06)
 * 负责集中管理回放、智能填表等长耗时与多步骤动作的生命周期状态
 */

import { TaskRunRecord, TaskType, TaskStepItem } from '../../shared/types/task';
import { PageTarget } from '../../shared/types/page';

export class TaskCoordinator {
  private activeTask: TaskRunRecord | null = null;
  private onBroadcast?: (message: { type: 'TASK_STATUS_UPDATED'; payload: { task: TaskRunRecord } }) => void;

  constructor(broadcastFn?: (message: { type: 'TASK_STATUS_UPDATED'; payload: { task: TaskRunRecord } }) => void) {
    this.onBroadcast = broadcastFn;
  }

  public setBroadcastFn(fn: (message: { type: 'TASK_STATUS_UPDATED'; payload: { task: TaskRunRecord } }) => void) {
    this.onBroadcast = fn;
  }

  /**
   * 判断全局是否存在任何处于运行、取消中或排队状态的活跃任务
   */
  public hasActiveTask(): boolean {
    if (!this.activeTask) return false;
    return (
      this.activeTask.status === 'running' ||
      this.activeTask.status === 'cancelling' ||
      this.activeTask.status === 'queued'
    );
  }

  /**
   * 启动一个新任务，全局同一时间仅允许一个活跃任务，避免多任务并发修改网页或跨标签页竞争 (QA-P1)
   */
  public startTask(
    type: TaskType,
    title: string,
    target: PageTarget,
    totalSteps: number,
    initialSteps?: TaskStepItem[],
    runIdOverride?: string
  ): TaskRunRecord {
    // 严格全局排他：任何标签页有活跃任务时均禁止启动新任务，防止切页绕过互斥
    if (this.hasActiveTask()) {
      const current = this.activeTask!;
      throw new Error(
        `当前已有任务「${current.title}」(标签页 ID: ${current.target.tabId}) 正在执行中，禁止并发执行。请等待其完成或先手动中止`
      );
    }

    const runId = runIdOverride || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const steps: TaskStepItem[] = initialSteps || Array.from({ length: totalSteps }, (_, i) => ({
      stepIndex: i,
      title: `步骤 ${i + 1}`,
      status: 'pending',
    }));

    const task: TaskRunRecord = {
      runId,
      type,
      title,
      status: 'running',
      target,
      currentStep: 0,
      totalSteps,
      startedAt: Date.now(),
      steps,
    };

    this.activeTask = task;
    this.persistActiveTask(task);
    this.notifyUpdate(task);
    return task;
  }

  /**
   * 更新某个步骤的执行状态
   */
  public updateStep(
    runId: string,
    stepIndex: number,
    update: Partial<TaskStepItem>
  ): TaskRunRecord | null {
    if (!this.activeTask || this.activeTask.runId !== runId) return null;

    if (this.activeTask.steps[stepIndex]) {
      Object.assign(this.activeTask.steps[stepIndex], update);
    }
    this.activeTask.currentStep = Math.max(this.activeTask.currentStep, stepIndex + 1);
    this.persistActiveTask(this.activeTask);
    this.notifyUpdate(this.activeTask);
    return this.activeTask;
  }

  /**
   * 完成任务
   */
  public finishTask(
    runId: string,
    status: 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted',
    error?: string
  ): TaskRunRecord | null {
    if (!this.activeTask || this.activeTask.runId !== runId) return null;

    this.activeTask.status = status;
    this.activeTask.finishedAt = Date.now();
    if (error) this.activeTask.error = error;

    const finished = { ...this.activeTask };
    this.persistActiveTask(null);
    this.notifyUpdate(finished);
    this.activeTask = null;
    return finished;
  }

  /**
   * 标记任务正在取消中
   */
  public markCancelling(runId?: string): TaskRunRecord | null {
    if (!this.activeTask) return null;
    if (runId && this.activeTask.runId !== runId) return null;

    this.activeTask.status = 'cancelling';
    this.persistActiveTask(this.activeTask);
    this.notifyUpdate(this.activeTask);
    return this.activeTask;
  }

  /**
   * 获取当前运行中的任务
   */
  public getActiveTask(): TaskRunRecord | null {
    return this.activeTask;
  }

  /**
   * 判断目标标签页当前是否被正在执行的任务独占
   */
  public isTargetBusy(tabId: number): boolean {
    if (!this.activeTask) return false;
    const isRunning = this.activeTask.status === 'running' || this.activeTask.status === 'cancelling' || this.activeTask.status === 'queued';
    return isRunning && this.activeTask.target.tabId === tabId;
  }

  /**
   * 从 storage 恢复任务状态（侧边栏重开或 worker 重启）
   */
  public async restoreFromStorage(): Promise<TaskRunRecord | null> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const stored = await chrome.storage.session.get('activeTaskRun');
        if (stored?.activeTaskRun) {
          this.activeTask = stored.activeTaskRun as TaskRunRecord;
          return this.activeTask;
        }
      }
    } catch {}
    return null;
  }

  private persistActiveTask(task: TaskRunRecord | null) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        if (task) {
          chrome.storage.session.set({ activeTaskRun: task }).catch(() => {});
        } else {
          chrome.storage.session.remove('activeTaskRun').catch(() => {});
        }
      }
    } catch {}
  }

  private notifyUpdate(task: TaskRunRecord) {
    if (this.onBroadcast) {
      try {
        this.onBroadcast({
          type: 'TASK_STATUS_UPDATED',
          payload: { task },
        });
      } catch {}
    }
  }
}

export const taskCoordinator = new TaskCoordinator();
