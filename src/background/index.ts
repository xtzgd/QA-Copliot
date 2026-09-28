/**
 * Background Service Worker (E0 核心 + E1 会话 + E2 网络/异常 + E3 快照)
 */

import { eventRepo } from '../db/repositories/eventRepository';
import { networkRepo } from '../db/repositories/networkRepository';
import { sessionRepo } from '../db/repositories/sessionRepository';
import { snapshotRepo } from '../db/repositories/snapshotRepository';
import { screenshotRepo } from '../db/repositories/screenshotRepository';
import { consoleRepo } from '../db/repositories/consoleRepository';
import { ExtensionMessage } from '../shared/messages';
import { AnomalyDetector } from '../shared/rules/anomalyDetector';
import { captureHeaders, captureText } from '../shared/utils/captureText';
import { QAEvent } from '../shared/types/event';
import { NetworkRequest } from '../shared/types/network';
import { BrowserContextInfo, TestSession } from '../shared/types/session';
import { BugSnapshot } from '../shared/types/snapshot';
import { createEntityId } from '../shared/utils/id';
import { taskCoordinator } from './tasks/taskCoordinator';
import { CdpInputSession } from './cdp/cdpInput';
import { CdpInputAction } from '../shared/types/cdp';
import { aiProviderService, AIProviderMode } from '../ai';
import {
  BrowserAgentPlan,
  ImportedTestSuite,
  MidsceneStep,
  WebFrameObservation,
  WebObservationElement,
} from '../shared/types/testCase';
export { taskCoordinator };

console.log('[QA Copilot SW] Service Worker 启动');

let activeReplayId: string | null = null;
let activeAgentRunId: string | null = null;
let activeFormFillTabId: number | null = null;
const cdpInputSession = new CdpInputSession();
let expectedReplayNavigation: { tabId: number; expiresAt: number } | null = null;

async function resolveReplayFrameId(tabId: number, event: QAEvent, explicitFrameId?: number): Promise<number | null | undefined> {
  if (explicitFrameId !== undefined) return explicitFrameId;
  const payload = event.payload as { frameId?: number; frameUrl?: string };
  const recordedFrameId = payload.frameId;
  if (!payload.frameUrl) return recordedFrameId;

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const matches = (frames || []).filter((frame) => frame.url === payload.frameUrl);
    if (matches.length === 1) return matches[0].frameId;
    if (recordedFrameId !== undefined && matches.some((frame) => frame.frameId === recordedFrameId)) {
      return recordedFrameId;
    }
    if (matches.length > 1) return null;
  } catch {}
  return recordedFrameId;
}

function isCapturablePageUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function activePageError(url?: string): string {
  if (!isCapturablePageUrl(url)) {
    return '当前是 Chrome 内部页面，无法采集。请切换到 http/https 被测页面后再操作';
  }
  return '当前标签页不是本次测试绑定的页面，请切回开始测试时的标签页';
}

async function ensurePageCaptureReady(tabId: number): Promise<void> {
  type CaptureStatus = { ready?: boolean; networkReady?: boolean };
  let status: CaptureStatus | undefined;
  try {
    status = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PING' }) as CaptureStatus | undefined;
    if (status?.ready && status.networkReady) return;
  } catch {}

  try {
    if (!status?.ready) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
        world: 'ISOLATED',
        injectImmediately: true,
      });
    }
    if (!status?.networkReady) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['injected.js'],
        world: 'MAIN',
        injectImmediately: true,
      });
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PING' }) as CaptureStatus | undefined;
      if (status?.ready && status.networkReady) return;
    }
  } catch (error) {
    throw new Error(`页面采集脚本注入失败：${(error as Error).message}`);
  }
  if (status?.ready && !status.networkReady) {
    throw new Error('API 请求监控脚本没有就绪，请刷新被测页面后重试');
  }
  throw new Error('页面采集脚本没有响应，请刷新被测页面后重试');
}

async function stopInspectionInTab(tabId: number): Promise<void> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    await Promise.all((frames || [{ frameId: 0 }]).map(({ frameId }) =>
      chrome.tabs.sendMessage(tabId, { type: 'STOP_ELEMENT_INSPECTION' }, { frameId }).catch(() => {})
    ));
  } catch {}
}

async function stopReplayInTab(tabId: number): Promise<void> {
  await cdpInputSession.detach().catch(() => {});
  try {
    const frames = typeof chrome !== 'undefined' && typeof chrome.webNavigation?.getAllFrames === 'function'
      ? await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)
      : null;
    if (frames && frames.length > 0) {
      await Promise.all(frames.map(({ frameId }) =>
        chrome.tabs.sendMessage(tabId, { type: 'STOP_CONTENT_REPLAY' }, { frameId }).catch(() => {})
      ));
    }
  } catch {}
  if (typeof chrome !== 'undefined' && typeof chrome.tabs?.sendMessage === 'function') {
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_CONTENT_REPLAY' }).catch(() => {});
  }
}

function validateRunSuite(suite: ImportedTestSuite): string | null {
  if (!suite || !Array.isArray(suite.tasks) || suite.tasks.length < 1 || suite.tasks.length > 20) {
    return '用例任务数量无效，请重新导入并校验';
  }
  let count = 0;
  for (const task of suite.tasks) {
    if (!task || typeof task.name !== 'string' || task.name.length > 200 || !Array.isArray(task.steps)) return '用例任务结构无效';
    for (const step of task.steps) {
      count += 1;
      if (!step || !['ai', 'assert', 'sleep'].includes(step.type)) return '用例包含当前版本不支持的步骤';
      if ((step.type === 'ai' || step.type === 'assert') &&
        (typeof step.instruction !== 'string' || !step.instruction.trim() || step.instruction.length > 4_000)) {
        return '用例步骤指令不能为空且不能超过 4000 字符';
      }
      if (step.type === 'sleep' && (!Number.isFinite(step.milliseconds) || step.milliseconds < 0 || step.milliseconds > 30_000)) {
        return '用例等待时间必须在 0 到 30000 毫秒之间';
      }
    }
  }
  if (count < 1 || count > 100) return '全部任务必须包含 1 到 100 个步骤';
  if (suite.pageUrl && (typeof suite.pageUrl !== 'string' || !isCapturablePageUrl(suite.pageUrl))) return '用例 page.url 必须是 http 或 https 地址';
  return null;
}

async function configureAgentProvider(): Promise<void> {
  const values = await chrome.storage.local.get([
    'aiProviderMode', 'aiBaseUrl', 'aiApiKey', 'aiModel', 'aiRemoteEndpoint', 'enterpriseGatewayUrl',
  ]);
  const mode = (values.aiProviderMode || 'heuristic') as AIProviderMode;
  if (mode !== 'remote') throw new Error('自然语言自动化需要先在「设置 → AI」中启用并配置远程大模型');
  const baseUrl = values.aiBaseUrl || values.aiRemoteEndpoint || values.enterpriseGatewayUrl;
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('请先在「设置 → AI」填写大模型 API 地址');
  aiProviderService.configure(mode, {
    baseUrl,
    apiKey: values.aiApiKey,
    model: values.aiModel,
  });
}

async function waitForAgentDelay(
  runId: string,
  milliseconds: number,
): Promise<void> {
  const endAt = Date.now() + milliseconds;
  while (Date.now() < endAt) {
    if (activeAgentRunId !== runId) throw new Error('任务已取消');
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, endAt - Date.now())));
  }
  if (activeAgentRunId !== runId) throw new Error('任务已取消');
}

async function collectAgentObservations(tabId: number): Promise<WebFrameObservation[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => [{ frameId: 0, url: '' }]);
  const observations = await Promise.all((frames || []).slice().sort((a, b) => a.frameId - b.frameId).slice(0, 8).map(async (frame) => {
    try {
      let result = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_AI_OBSERVATION' }, { frameId: frame.frameId }) as {
        error?: string; url?: string; title?: string; text?: string; scrollY?: number; scrollX?: number; elements?: WebObservationElement[];
      } | undefined;
      if (!result) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] }, files: ['content.js'], world: 'ISOLATED', injectImmediately: true,
        }).catch(() => {});
        result = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_AI_OBSERVATION' }, { frameId: frame.frameId }) as typeof result;
      }
      if (!result || result.error) return null;
      return {
        frameId: frame.frameId,
        frameUrl: result.url || frame.url || '',
        title: result.title || '',
        text: (result.text || '').slice(0, 4_000),
        scrollY: Number(result.scrollY || 0),
        scrollX: Number(result.scrollX || 0),
        elements: (result.elements || []).slice(0, 150).map((element) => ({
          ...element,
          id: `${frame.frameId}:${element.id}`,
        })),
      } satisfies WebFrameObservation;
    } catch {
      return null;
    }
  }));
  const found = observations.filter((item): item is WebFrameObservation => Boolean(item));
  if (found.length === 0) throw new Error('无法读取当前页面，请确认页面已加载且允许 QA Copilot 注入脚本');
  let remainingElements = 200;
  return found.map((frame) => {
    const elements = frame.elements.slice(0, Math.min(150, remainingElements));
    remainingElements -= elements.length;
    return { ...frame, elements };
  });
}

function createAgentEvent(
  action: Exclude<BrowserAgentPlan, { action: 'finished' | 'assertion' }>,
  target: WebObservationElement | undefined,
  frame: WebFrameObservation | undefined,
  pageUrl: string,
): QAEvent {
  const timestamp = Date.now();
  const basePayload = {
    timestamp,
    url: frame?.frameUrl || pageUrl,
    frameId: frame?.frameId ?? 0,
    frameUrl: frame?.frameUrl || pageUrl,
  };
  const id = createEntityId('agent-action');
  if (action.action === 'scroll') {
    const delta = action.direction === 'down' || action.direction === 'right' ? action.distance : -action.distance;
    return {
      id, sessionId: '', type: 'scroll', timestamp, title: '滚动页面', description: `向${action.direction}滚动 ${action.distance}px`, url: pageUrl,
      payload: {
        ...basePayload,
        target: 'window',
        scrollTop: action.direction === 'down' || action.direction === 'up' ? Math.max(0, (frame?.scrollY || 0) + delta) : (frame?.scrollY || 0),
        scrollLeft: action.direction === 'left' || action.direction === 'right' ? Math.max(0, (frame?.scrollX || 0) + delta) : (frame?.scrollX || 0),
      },
    };
  }
  if (!target) throw new Error('AI 选择了本轮页面观察中不存在的控件');
  const obsId = target.id.replace(/^\d+:/, '');
  if (action.action === 'tap') {
    return {
      id, sessionId: '', type: 'click', timestamp, title: `点击 ${target.name || target.text || target.tag}`, description: `点击 ${target.name || target.text || target.tag}`, url: pageUrl,
      payload: {
        ...basePayload,
        id: obsId,
        obsId,
        tag: target.tag.toUpperCase(), text: target.text || target.name || '', role: target.role,
        name: target.name, testId: target.testId, ariaLabel: target.ariaLabel,
        selector: target.selector,
      },
    };
  }
  const canType = ['input', 'textarea', 'select'].includes(target.tag) &&
    !(target.tag === 'input' && ['checkbox', 'radio'].includes(target.inputType || ''));
  if (!canType) throw new Error(`AI 选择的「${target.name || target.text || target.tag}」不是可输入控件`);
  let value = action.value || '';
  if (target.tag === 'select') {
    const option = target.options?.find((item) => item.value === value || item.label === value);
    if (!option) throw new Error(`AI 选择的下拉值不在页面选项中：${value.slice(0, 80)}`);
    value = option.value;
  }
  return {
    id, sessionId: '', type: 'input', timestamp, title: `填写 ${target.name || target.placeholder || target.tag}`, description: `填写 ${target.name || target.placeholder || target.tag}`, url: pageUrl,
    payload: {
      ...basePayload,
      id: obsId,
      obsId,
      tag: target.tag.toUpperCase(), name: target.name, fieldName: target.name,
      fieldLabel: target.name, placeholder: target.placeholder, inputType: target.inputType,
      selector: target.selector, value,
    },
  };
}

async function dispatchAgentEvent(tabId: number, runId: string, event: QAEvent): Promise<void> {
  await waitForTabNavigationComplete(tabId);
  await ensureReplayContentReady(tabId);
  if (!cdpInputSession.isAttached) {
    try { await cdpInputSession.attach(tabId); } catch { /* DOM fallback remains available */ }
  }
  const payload = event.payload as { frameId?: number };
  const frameId = payload.frameId ?? 0;
  const request = {
    type: 'REPLAY_ACTION',
    payload: { event, replayId: runId, targetFrameId: frameId, useCdp: cdpInputSession.isAttached },
  };
  if (event.type === 'click') expectedReplayNavigation = { tabId, expiresAt: Date.now() + 5_000 };
  const result = await chrome.tabs.sendMessage(tabId, request, { frameId }) as {
    success?: boolean; error?: string; cdpInput?: CdpInputAction;
  } | undefined;
  if (!result?.success) {
    if (expectedReplayNavigation?.tabId === tabId) expectedReplayNavigation = null;
    throw new Error(result?.error || '浏览器操作失败');
  }
  if (result.cdpInput) {
    try {
      await cdpInputSession.dispatch(tabId, result.cdpInput);
    } finally {
      await chrome.tabs.sendMessage(tabId, { type: 'REPLAY_ACTION_COMPLETE', payload: { replayId: runId } }, { frameId }).catch(() => {});
    }
  }
  if (event.type === 'click') {
    await waitForTabNavigationComplete(tabId, 150);
    if (expectedReplayNavigation?.tabId === tabId) expectedReplayNavigation = null;
  }
}

async function executeAiInstruction(
  tabId: number,
  runId: string,
  instruction: string,
  stepIndex: number,
  history: string[],
  assertMode = false,
): Promise<{ verified: boolean; reason?: string; actionsSent: boolean }> {
  let actionsSent = false;
  for (let turn = 0; ; turn += 1) {
    if (activeAgentRunId !== runId) throw new Error('任务已取消');
    taskCoordinator.updateStep(runId, stepIndex, {
      status: 'running',
      detail: assertMode ? `第 ${turn + 1} 轮：正在读取页面并准备断言` : `第 ${turn + 1} 轮：正在读取页面状态`,
    });
    const observations = await collectAgentObservations(tabId);
    let screenshotUrl: string | undefined;
    try {
      const storage = typeof chrome !== 'undefined' && chrome.storage?.local
        ? await chrome.storage.local.get('aiVisionEnabled')
        : {};
      const aiVisionEnabled = storage.aiVisionEnabled !== false;
      if (aiVisionEnabled && typeof chrome !== 'undefined' && typeof chrome.tabs?.get === 'function' && typeof chrome.tabs?.captureVisibleTab === 'function') {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.windowId) {
          screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 75,
          });
        }
      }
    } catch (e) {
      console.warn('[QA Copilot Agent] 视口截图采集跳过，继续纯 DOM 模式:', e);
    }

    taskCoordinator.updateStep(runId, stepIndex, {
      status: 'running',
      detail: assertMode
        ? `第 ${turn + 1} 轮：页面${screenshotUrl ? '与视口画面' : ''}已读取，正在请求 AI 核对断言`
        : `第 ${turn + 1} 轮：页面${screenshotUrl ? '与视口画面' : ''}已读取，等待 AI 规划动作（单次请求最多 35 秒）`,
    });
    const plan = await aiProviderService.planBrowserAction({
      instruction,
      observations,
      history,
      mode: assertMode ? 'assert' : 'act',
      screenshotUrl,
    });
    if (activeAgentRunId !== runId) throw new Error('任务已取消');
    if (plan.action === 'assertion') {
      if (!assertMode) throw new Error('大模型在动作模式返回了断言结果，步骤已停止');
      history.push(`断言${plan.passed ? '通过' : '失败'}：${plan.reason}`);
      if (!plan.passed) throw new Error(`断言未通过：${plan.reason || instruction}`);
      taskCoordinator.updateStep(runId, stepIndex, { detail: `断言通过：${plan.reason}` });
      return { verified: true, reason: plan.reason, actionsSent };
    }
    if (assertMode) throw new Error('大模型没有返回断言结果');
    if (plan.action === 'finished') {
      history.push(`AI 判断目标完成：${plan.reason}`);
      taskCoordinator.updateStep(runId, stepIndex, { detail: `AI 判断目标已完成：${plan.reason || '未提供说明'}（未执行独立断言）` });
      return { verified: false, reason: plan.reason, actionsSent };
    }

    let target: WebObservationElement | undefined;
    let frame: WebFrameObservation | undefined;
    if (plan.action === 'tap' || plan.action === 'input') {
      for (const item of observations) {
        const found = item.elements.find((element) => element.id === plan.elementId);
        if (found) { target = found; frame = item; break; }
      }
      if (!target || !frame) throw new Error('AI 选择了观察列表之外的页面控件，本步骤已停止');
    } else if (plan.action === 'scroll') {
      frame = observations.find((item) => item.frameId === plan.frameId);
      if (!frame) throw new Error('AI 选择了本轮观察列表之外的 frame，本步骤已停止');
    }
    const event = createAgentEvent(plan as Exclude<BrowserAgentPlan, { action: 'finished' | 'assertion' }>, target, frame, frame?.frameUrl || (await chrome.tabs.get(tabId)).url || '');
    taskCoordinator.updateStep(runId, stepIndex, { detail: `第 ${turn + 1} 轮：正在${event.description}` });
    await dispatchAgentEvent(tabId, runId, event);
    const actionSummary = event.description;
    history.push(actionSummary);
    actionsSent = true;
    taskCoordinator.updateStep(runId, stepIndex, { detail: `已${actionSummary}，等待页面更新后重新观察`, actionSent: true });
    // 弹窗与页面渲染缓冲：若动作涉及新增、打开、点击等可能触发弹窗动画或异步加载的操作，给予充足的动画完成与 DOM 挂载等待时间
    const isTriggerAction = /新增|添加|创建|打开|查看|编辑|弹窗|modal|dialog|drawer|button|tab|click/i.test(actionSummary);
    const waitMs = isTriggerAction ? 700 : 400;
    await waitForAgentDelay(runId, waitMs);
  }
}

async function runImportedSuite(suite: ImportedTestSuite): Promise<unknown> {
  const validationError = validateRunSuite(suite);
  if (validationError) return { error: validationError };
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === undefined) return { error: '未找到活动标签页' };
  const tabId = activeTab.id;
  const initialUrl = suite.pageUrl || activeTab.url || '';
  if (!isCapturablePageUrl(initialUrl)) return { error: activePageError(initialUrl) };
  if (taskCoordinator.hasActiveTask()) {
    return { error: `当前已有任务「${taskCoordinator.getActiveTask()?.title || '其他任务'}」正在执行中` };
  }
  try {
    await configureAgentProvider();
  } catch (error) {
    return { error: (error as Error).message };
  }
  if (taskCoordinator.hasActiveTask()) {
    return { error: `当前已有任务「${taskCoordinator.getActiveTask()?.title || '其他任务'}」正在执行中` };
  }

  const flattened = suite.tasks.flatMap((task) => task.steps.map((step) => ({ task, step })));
  const runId = createEntityId('agent-run');
  try {
    taskCoordinator.startTask(
      'runner_test',
      suite.tasks.length === 1 ? suite.tasks[0].name : `${suite.tasks.length} 个导入用例`,
      { tabId, frameId: 0, url: initialUrl },
      flattened.length,
      flattened.map(({ task: sourceTask, step }, index) => ({
        stepIndex: index,
        title: `${sourceTask.name} · ${step.name || (step.type === 'ai' ? step.instruction : step.type === 'assert' ? `断言：${step.instruction}` : step.type === 'sleep' ? `等待 ${step.milliseconds}ms` : `不支持：${step.key}`)}`,
        status: 'pending',
      })),
      runId,
    );
  } catch (error) {
    return { error: (error as Error).message };
  }
  activeAgentRunId = runId;
  const history: string[] = [];
  let currentUrl = activeTab.url || '';
  taskCoordinator.updateStep(runId, 0, {
    status: 'running',
    detail: suite.pageUrl && suite.pageUrl !== currentUrl ? '正在打开用例指定页面' : '正在连接当前页面',
  });
  try {
    if (suite.pageUrl && suite.pageUrl !== currentUrl) {
      expectedReplayNavigation = { tabId, expiresAt: Date.now() + 25_000 };
      await navigateReplayTab(tabId, suite.pageUrl);
      currentUrl = suite.pageUrl;
      expectedReplayNavigation = null;
    }
    taskCoordinator.updateStep(runId, 0, { detail: '页面已连接，正在准备执行环境' });
    await ensureReplayContentReady(tabId);
    try { await cdpInputSession.attach(tabId); } catch { /* CSP/Chrome constraints use the existing in-page fallback */ }

    for (let index = 0; index < flattened.length; index += 1) {
      if (activeAgentRunId !== runId) {
        taskCoordinator.finishTask(runId, 'cancelled', '用户手动取消任务');
        return { success: false, cancelled: true, runId };
      }
      const { step } = flattened[index];
      taskCoordinator.updateStep(runId, index, { status: 'running', detail: '正在准备本步骤' });
      const startedAt = Date.now();
      try {
        let verified = false;
        let assertionPassed: boolean | undefined;
        let actionSent = false;
        if (step.type === 'ai') {
          const result = await executeAiInstruction(tabId, runId, step.instruction, index, history);
          verified = result.verified;
          actionSent = result.actionsSent || false;
        } else if (step.type === 'assert') {
          const result = await executeAiInstruction(tabId, runId, step.instruction, index, history, true);
          verified = result.verified;
          assertionPassed = true;
        } else if (step.type === 'sleep') {
          await waitForAgentDelay(runId, step.milliseconds);
        } else {
          throw new Error(`不支持的步骤：${(step as MidsceneStep).type}`);
        }
        taskCoordinator.updateStep(runId, index, {
          status: 'success', actionSent,
          verified, assertionPassed, durationMs: Date.now() - startedAt,
          detail: assertionPassed ? '断言通过' : verified ? '步骤已验证' : actionSent ? '动作已执行，未做独立断言' : '步骤已完成',
        });
      } catch (error) {
        const reason = (error as Error).message || '步骤执行失败';
        if (activeAgentRunId !== runId) {
          taskCoordinator.finishTask(runId, 'cancelled', '用户手动取消任务');
          return { success: false, cancelled: true, runId };
        }
        taskCoordinator.updateStep(runId, index, { status: 'failed', error: reason, durationMs: Date.now() - startedAt });
        taskCoordinator.finishTask(runId, 'failed', `第 ${index + 1} 步失败：${reason}`);
        return { success: false, failedStep: index + 1, error: reason, runId };
      }
    }
    taskCoordinator.finishTask(runId, 'completed');
    return { success: true, runId, completed: flattened.length };
  } catch (error) {
    const reason = (error as Error).message || '用例执行失败';
    taskCoordinator.finishTask(runId, activeAgentRunId === runId ? 'failed' : 'cancelled', reason);
    return { success: false, error: reason, runId };
  } finally {
    await cdpInputSession.detach();
    if (activeAgentRunId === runId) activeAgentRunId = null;
    expectedReplayNavigation = null;
    const active = taskCoordinator.getActiveTask();
    if (active?.runId === runId) taskCoordinator.finishTask(runId, 'interrupted', '任务执行流程异常退出');
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[QA Copilot SW] 插件安装完成');
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('[QA Copilot SW] 设置 sidePanel 行为失败:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      console.error('[QA Copilot SW] 处理消息异常:', error);
      sendResponse({ error: (error as Error).message });
    });
  return true;
});

interface InFlightRequestContext {
  requestId: string;
  tabId?: number;
  frameId?: number;
  sessionId?: string;
  startedAt: number;
}
export const inFlightRequests = new Map<string, InFlightRequestContext>();
export const processedRequestIds = new Set<string>();

export function markRequestProcessed(id: string) {
  if (processedRequestIds.size > 2000) {
    const first = processedRequestIds.values().next().value;
    if (first) processedRequestIds.delete(first);
  }
  processedRequestIds.add(id);
}

export async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'PING':
      return { type: 'PONG', payload: { text: message.payload.text, time: Date.now() } };

    case 'ELEMENT_INSPECTED':
      if (message.payload?.element) {
        message.payload.element.frame = {
          ...(message.payload.element.frame || {
            url: sender.url || '',
            frameXPath: [],
            frameCssPath: [],
            offset: { left: 0, top: 0 },
            zoom: 1,
            complete: sender.frameId === 0,
          }),
          frameId: sender.frameId ?? 0,
          url: sender.url || message.payload.element.frame?.url || '',
        };
      }
      broadcastMessage(message);
      if (sender.tab?.id !== undefined) await stopInspectionInTab(sender.tab.id);
      return { success: true };

    case 'START_ELEMENT_INSPECTION': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { error: '未找到活动标签页' };
      if (!isCapturablePageUrl(tab.url)) return { error: activePageError(tab.url) };
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        const results = await Promise.all((frames || [{ frameId: 0 }]).map(async ({ frameId }) => {
          try {
            return await chrome.tabs.sendMessage(tab.id!, { type: 'START_ELEMENT_INSPECTION' }, { frameId });
          } catch {
            return null;
          }
        }));
        if (!results.some((result) => (result as { success?: boolean } | null)?.success)) {
          return { error: '页面 frame 没有响应，请刷新被测页面后重试' };
        }
        return { success: true, frameCount: results.filter(Boolean).length };
      } catch (error) {
        return { error: `无法开启元素选择：${(error as Error).message}，请刷新被测页面后重试` };
      }
    }

    case 'STOP_ELEMENT_INSPECTION': {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (tabId !== undefined) await stopInspectionInTab(tabId);
      return { success: true };
    }

    case 'TRIGGER_QUICK_LOGIN': {
      const { url, username, password, loginTriggerSelector, autoSubmit } = message.payload;
      if (!isCapturablePageUrl(url)) {
        return { error: '目标 URL 不合法，必须为 http 或 https 网址' };
      }

      try {
        // 1. 创建新标签页
        const newTab = await chrome.tabs.create({ url, active: true });
        if (!newTab.id) {
          return { error: '创建新标签页失败' };
        }
        const targetTabId = newTab.id;

        // 2. 监听标签页加载完成 (status === 'complete')
        await new Promise<void>((resolve, reject) => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          const onUpdatedListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tabId === targetTabId && changeInfo.status === 'complete') {
              cleanup();
              resolve();
            }
          };

          const onRemovedListener = (tabId: number) => {
            if (tabId === targetTabId) {
              cleanup();
              reject(new Error('目标标签页在加载完成前已被关闭'));
            }
          };

          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(onUpdatedListener);
            chrome.tabs.onRemoved.removeListener(onRemovedListener);
          };

          chrome.tabs.onUpdated.addListener(onUpdatedListener);
          chrome.tabs.onRemoved.addListener(onRemovedListener);

          // 15 秒超时保底
          timeoutId = setTimeout(() => {
            cleanup();
            resolve();
          }, 15000);
        });

        // 稍候 300ms 保证页面初始 DOM 与脚本渲染基本就绪
        await new Promise((r) => setTimeout(r, 300));

        // 确保 Content Script 就绪注入
        await ensurePageCaptureReady(targetTabId);

        // 发送 EXECUTE_QUICK_LOGIN 消息
        const result = await chrome.tabs.sendMessage(
          targetTabId,
          {
            type: 'EXECUTE_QUICK_LOGIN',
            payload: {
              username,
              password,
              loginTriggerSelector,
              autoSubmit,
            },
          },
          { frameId: 0 }
        );

        return result || { success: true, message: '快捷登录指令已发送' };
      } catch (error) {
        return { error: `快捷登录失败：${(error as Error).message}` };
      }
    }

    case 'STOP_REPLAY': {
      let targetTabId = taskCoordinator.getActiveTask()?.target.tabId;
      if (targetTabId === undefined && typeof chrome !== 'undefined' && typeof chrome.tabs?.query === 'function') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        targetTabId = tabs[0]?.id;
      }
      if (activeReplayId) {
        taskCoordinator.finishTask(activeReplayId, 'cancelled', '停止回放');
      }
      activeReplayId = null;
      expectedReplayNavigation = null;
      if (targetTabId !== undefined) await stopReplayInTab(targetTabId);
      return { success: true };
    }

    case 'UPDATE_TASK_STEP': {
      const { runId, stepIndex, update } = message.payload;
      const updated = taskCoordinator.updateStep(runId, stepIndex, update);
      return { success: true, task: updated };
    }

    case 'FINISH_TASK': {
      const { runId, status, error } = message.payload;
      const finished = taskCoordinator.finishTask(runId, status, error);
      return { success: true, task: finished };
    }

    case 'GET_ACTIVE_TASK':
      return { task: taskCoordinator.getActiveTask() };

    case 'CANCEL_ACTIVE_TASK': {
      const active = taskCoordinator.getActiveTask();
      if (!active) return { success: true, message: '当前没有运行中的任务' };

      taskCoordinator.markCancelling(active.runId);

      if (active.type === 'replay') {
        activeReplayId = null;
        expectedReplayNavigation = null;
        if (active.target.tabId !== undefined) await stopReplayInTab(active.target.tabId);
      } else if (active.type === 'form_fill') {
        const targetTabId = active.target.tabId ?? activeFormFillTabId;
        if (targetTabId !== undefined && targetTabId !== null) {
          chrome.tabs.sendMessage(
            targetTabId,
            { type: 'CANCEL_FORM_FILL', payload: { runId: active.runId, targetTabId } },
            { frameId: 0 }
          ).catch(() => {});
        }
      } else if (active.type === 'runner_test') {
        activeAgentRunId = null;
        expectedReplayNavigation = null;
        if (active.target.tabId !== undefined) await stopReplayInTab(active.target.tabId);
      }

      taskCoordinator.finishTask(active.runId, 'cancelled', '用户手动取消任务');
      return { success: true };
    }

    case 'RUN_IMPORTED_TEST_SUITE':
      return await runImportedSuite(message.payload.suite);

    case 'RUN_NATURAL_LANGUAGE_TEST': {
      const instruction = message.payload.instruction?.trim();
      if (!instruction) return { error: '请先描述要执行的测试目标' };
      if (instruction.length > 4_000) return { error: '测试目标不能超过 4000 字符' };
      return await runImportedSuite({
        tasks: [{ name: '自然语言自动化测试', steps: [{ type: 'ai', instruction }] }],
      });
    }

    case 'REPLAY_SESSION': {
      const replayEvents = message.payload.events
        .filter((event) => event.type === 'navigation' || event.type === 'click' || event.type === 'input' || event.type === 'scroll')
        .sort((a, b) => a.timestamp - b.timestamp);
      if (replayEvents.length === 0) return { error: '该 Session 没有可回放的用户操作' };

      // QA-003：回放绑定目标标签页与 frame。优先锁定指定的 targetTabId，未指定则锁定当前活动 tab
      const specifiedTabId = (message.payload as { targetTabId?: number }).targetTabId;
      const specifiedFrameId = (message.payload as { targetFrameId?: number }).targetFrameId;

      let lockedTabId: number | undefined;
      let targetUrl: string | undefined;

      if (specifiedTabId !== undefined) {
        try {
          const tab = typeof chrome.tabs.get === 'function' ? await chrome.tabs.get(specifiedTabId) : undefined;
          if (tab?.id !== undefined) {
            lockedTabId = tab.id;
            targetUrl = tab.url;
          } else {
            lockedTabId = specifiedTabId;
          }
        } catch {
          return { error: `回放绑定的目标标签页 (ID: ${specifiedTabId}) 已关闭或不存在` };
        }
      } else {
        const windowTabs = typeof chrome.tabs.query === 'function' ? await chrome.tabs.query({ active: true, currentWindow: true }) : [];
        let [tab] = windowTabs;
        if (!tab || !isCapturablePageUrl(tab.url)) {
          const allTabs = typeof chrome.tabs.query === 'function' ? await chrome.tabs.query({ currentWindow: true }) : [];
          const capturableTab = allTabs.find((t) => isCapturablePageUrl(t.url));
          if (capturableTab) {
            tab = capturableTab;
            if (typeof chrome.tabs.update === 'function') {
              await chrome.tabs.update(tab.id!, { active: true }).catch(() => {});
            }
          }
        }
        if (tab?.id === undefined) return { error: '未找到活动标签页' };
        lockedTabId = tab.id;
        targetUrl = tab.url;
      }

      if (lockedTabId === undefined) return { error: '未找到活动标签页' };

      const firstNavEvent = replayEvents[0]?.type === 'navigation' ? replayEvents[0] : undefined;
      const firstNavUrl = firstNavEvent ? ((firstNavEvent.payload as any)?.toUrl || firstNavEvent.url) : undefined;
      const willNavigateImmediately = Boolean(firstNavUrl && isCapturablePageUrl(firstNavUrl));

      if (!isCapturablePageUrl(targetUrl) && !willNavigateImmediately) return { error: activePageError(targetUrl) };

      // IMP-05: 严格全局排他，防止切页绕过并发互斥 (QA-P1)
      if (taskCoordinator.hasActiveTask()) {
        const busyTask = taskCoordinator.getActiveTask();
        return {
          error: `当前已有任务「${busyTask?.title || '其他任务'}」(标签页 ID: ${busyTask?.target.tabId}) 正在执行中，禁止并发执行。请等待其完成或先手动中止`,
        };
      }

      const replayId = createEntityId('replay');
      activeReplayId = replayId;

      // IMP-05: 注册到后台统一任务协调器
      taskCoordinator.startTask(
        'replay',
        '操作步骤回放',
        { tabId: lockedTabId, frameId: specifiedFrameId ?? 0, url: targetUrl },
        replayEvents.length,
        replayEvents.map((evt, idx) => ({
          stepIndex: idx,
          title: evt.title || `步骤 ${idx + 1}`,
          status: 'pending',
        })),
        replayId
      );

      const failures: Array<{ eventId: string; error: string }> = [];
      let completed = 0;
      const stepDelayMs = Math.max(200, Math.min(3_000, message.payload.stepDelayMs || 700));
      let cdpAttached = false;

      try {
        try {
          await cdpInputSession.attach(lockedTabId);
          cdpAttached = true;
        } catch (error) {
          console.warn('[QA Copilot Replay] CDP 不可用，回退到页面脚本输入:', (error as Error).message);
        }

        for (const event of replayEvents) {
          if (activeReplayId !== replayId) {
            taskCoordinator.finishTask(replayId, 'cancelled', '回放已停止');
            return { stopped: true, completed, total: replayEvents.length, failures };
          }

          // 严格校验目标标签页存活状态，防止切页或原标签页关闭后误操作其他页面 (QA-003)
          if (typeof chrome.tabs.get === 'function') {
            try {
              const currentTab = await chrome.tabs.get(lockedTabId);
              if (!currentTab) throw new Error('Tab not found');
            } catch {
              taskCoordinator.finishTask(replayId, 'interrupted', '目标标签页已关闭');
              return {
                stopped: true,
                completed,
                total: replayEvents.length,
                failures: [...failures, { eventId: event.id, error: '目标标签页已关闭，回放安全终止' }],
                error: '目标标签页已关闭，回放安全终止',
              };
            }
          }

          if (event.type === 'navigation') {
            const destination = String((event.payload as { toUrl?: string }).toUrl || event.url || '');
            let currentTabUrl: string | undefined;
            if (typeof chrome.tabs.get === 'function') {
              try {
                const actualTab = await chrome.tabs.get(lockedTabId);
                currentTabUrl = actualTab.url;
              } catch {}
            }
            if (destination && destination !== currentTabUrl && isCapturablePageUrl(destination)) {
              expectedReplayNavigation = { tabId: lockedTabId, expiresAt: Date.now() + 5_000 };
              await navigateReplayTab(lockedTabId, destination);
            }
          } else {
            await waitForTabNavigationComplete(lockedTabId);
            await ensureReplayContentReady(lockedTabId);
            if (cdpAttached && !cdpInputSession.isAttached) {
              try {
                await cdpInputSession.attach(lockedTabId);
              } catch (error) {
                cdpAttached = false;
                console.warn('[QA Copilot Replay] 导航后无法重新附加 CDP，继续使用页面脚本输入:', (error as Error).message);
              }
            }
            const actionFrameId = await resolveReplayFrameId(lockedTabId, event, specifiedFrameId);
            let result: { success?: boolean; error?: string; cdpInput?: CdpInputAction } | undefined;
            if (actionFrameId === null) {
              result = { success: false, error: '多个 iframe 使用相同地址，无法确定录制时所在的 frame' };
            } else {
              for (let attempt = 0; attempt < 2; attempt += 1) {
                let actionSent = false;
                if (event.type === 'click') {
                  expectedReplayNavigation = { tabId: lockedTabId, expiresAt: Date.now() + 5_000 };
                }
                const actionMessage = {
                  type: 'REPLAY_ACTION',
                  payload: { event, replayId, targetFrameId: actionFrameId, useCdp: cdpAttached },
                };
                result = (actionFrameId !== undefined
                  ? await chrome.tabs.sendMessage(lockedTabId, actionMessage, { frameId: actionFrameId })
                  : await chrome.tabs.sendMessage(lockedTabId, actionMessage)) as
                  { success?: boolean; error?: string; cdpInput?: CdpInputAction } | undefined;
                if (result?.success && result.cdpInput) {
                  actionSent = true;
                  try {
                    await cdpInputSession.dispatch(lockedTabId, result.cdpInput);
                    result.cdpInput = undefined;
                  } catch (error) {
                    result = { success: false, error: `CDP 输入失败：${(error as Error).message}` };
                  } finally {
                    const completeMessage = {
                      type: 'REPLAY_ACTION_COMPLETE',
                      payload: { replayId },
                    };
                    if (actionFrameId !== undefined) {
                      await chrome.tabs.sendMessage(lockedTabId, completeMessage, { frameId: actionFrameId }).catch(() => {});
                    } else {
                      await chrome.tabs.sendMessage(lockedTabId, completeMessage).catch(() => {});
                    }
                  }
                }
                if (result?.success) actionSent = true;
                if (result?.success && event.type === 'click') {
                  try {
                    const navigationStarted = await waitForTabNavigationComplete(lockedTabId, 150);
                    if (!navigationStarted && expectedReplayNavigation?.tabId === lockedTabId) {
                      expectedReplayNavigation = null;
                    }
                  } catch (error) {
                    result = { success: false, error: `点击后页面导航未完成：${(error as Error).message}` };
                  }
                }
                if (!actionSent && !result?.success && expectedReplayNavigation?.tabId === lockedTabId) {
                  expectedReplayNavigation = null;
                }
                if (result?.success || actionSent || activeReplayId !== replayId) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }
            if (!result?.success) {
              const errMsg = result?.error || '执行失败';
              taskCoordinator.updateStep(replayId, completed, { status: 'failed', error: errMsg });
              const stepTitle = event.title || event.description || `第 ${completed + 1} 步`;
              const fullError = `第 ${completed + 1} 步 [${stepTitle}] 执行失败: ${errMsg}`;
              taskCoordinator.finishTask(replayId, 'failed', fullError);
              return {
                success: false,
                stopped: true,
                failedStep: completed + 1,
                completed,
                total: replayEvents.length,
                failures: [{ eventId: event.id, error: errMsg }],
                error: fullError,
              };
            }
          }
          completed += 1;
          taskCoordinator.updateStep(replayId, completed - 1, {
            status: 'success',
            actionSent: true,
          });
          await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
        }
        taskCoordinator.finishTask(replayId, 'completed');
        return { success: true, completed, total: replayEvents.length, failures: [] };
      } catch (error) {
        const errMsg = (error as Error)?.message || '回放执行发生异常';
        taskCoordinator.finishTask(replayId, 'failed', errMsg);
        return {
          success: false,
          completed,
          total: replayEvents.length,
          failures: [...failures, { eventId: 'runtime_exception', error: errMsg }],
          error: `回放异常终止: ${errMsg}`,
        };
      } finally {
        await cdpInputSession.detach();
        if (activeReplayId === replayId) activeReplayId = null;
        // QA-P1 兜底保护：若任务仍处于运行状态且未收敛，强制安全收敛并释放占用，绝不永久悬挂
        const cur = taskCoordinator.getActiveTask();
        if (cur && cur.runId === replayId && (cur.status === 'running' || cur.status === 'cancelling')) {
          taskCoordinator.finishTask(replayId, 'interrupted', '回放流程异常中断退出');
        }
      }
    }

    case 'ANALYZE_PAGE': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { fields: [], actions: [], formCount: 0, url: '', title: '', error: '未找到活动标签页' };
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: 'ANALYZE_PAGE' });
      } catch (error) {
        return {
          fields: [],
          actions: [],
          formCount: 0,
          url: tab.url || '',
          title: tab.title || '',
          error: `当前页面不可分析：${(error as Error).message}`,
        };
      }
    }

    case 'SCAN_FORM_SNAPSHOT': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { error: '未找到活动标签页' };
      try {
        // IMP-04: 明确指定 frameId: 0，杜绝子 iframe 竞争抢先返回
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FORM_SNAPSHOT' }, { frameId: 0 });
        if (response?.snapshot) {
          response.snapshot.tabId = tab.id;
          response.snapshot.frameId = 0;
        }
        return response;
      } catch (error) {
        return { error: `无法扫描当前页面表单：${(error as Error).message}` };
      }
    }

    case 'EXECUTE_FORM_FILL': {
      let targetTabId = message.payload?.targetTabId;
      if (targetTabId === undefined || targetTabId === null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabId = tab?.id;
      }
      if (targetTabId === undefined || targetTabId === null) return { error: '未找到目标标签页' };
      activeFormFillTabId = targetTabId;

      // IMP-05: 严格全局排他，防止切页绕过并发互斥 (QA-P1)
      if (taskCoordinator.hasActiveTask()) {
        const busyTask = taskCoordinator.getActiveTask();
        return {
          error: `当前已有任务「${busyTask?.title || '其他任务'}」(标签页 ID: ${busyTask?.target.tabId}) 正在执行中，禁止并发执行。请等待其完成或先手动中止`,
        };
      }

      const runId = message.payload?.runId || createEntityId('fill');
      const assignments = message.payload?.assignments || [];

      // IMP-05: 注册到后台任务协调器
      taskCoordinator.startTask(
        'form_fill',
        '智能表单填写',
        { tabId: targetTabId, frameId: 0 },
        assignments.length,
        assignments.map((a, idx) => ({
          stepIndex: idx,
          title: `字段 [${a.fieldId}] ${a.action}`,
          status: 'pending',
        })),
        runId
      );

      try {
        // IMP-04: 明确指定 frameId: 0，避免子 iframe 错误抢先返回
        const response = await chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 });
        if (response?.runRecord) {
          response.runRecord.tabId = targetTabId;
          response.runRecord.frameId = 0;
          const status = response.runRecord.status === 'completed'
            ? 'completed'
            : response.runRecord.status === 'cancelled'
              ? 'cancelled'
              : 'partial';
          taskCoordinator.finishTask(runId, status);
        } else {
          taskCoordinator.finishTask(runId, 'failed', response?.error || '填表未返回有效记录');
        }
        return response;
      } catch (error) {
        taskCoordinator.finishTask(runId, 'failed', (error as Error).message);
        return { error: `执行表单填充失败：${(error as Error).message}` };
      }
    }

    case 'CANCEL_FORM_FILL': {
      if (message.payload?.runId) {
        taskCoordinator.finishTask(message.payload.runId, 'cancelled', '用户手动取消');
      }
      const targetTabId = message.payload?.targetTabId ?? activeFormFillTabId;
      const sentTabIds = new Set<number>();
      if (targetTabId !== undefined && targetTabId !== null) {
        sentTabIds.add(targetTabId);
        chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 }).catch(() => {});
      }
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      for (const tab of tabs) {
        if (tab.id !== undefined && !sentTabIds.has(tab.id)) {
          chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {});
        }
      }
      return { success: true };
    }

    case 'UNDO_FORM_FILL': {
      let targetTabId: number | null | undefined = message.payload?.targetTabId ?? activeFormFillTabId;
      if (targetTabId === undefined || targetTabId === null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabId = tab?.id;
      }
      if (targetTabId === undefined || targetTabId === null) {
        return { success: false, restoredCount: 0, conflictCount: 0, error: '未找到目标标签页' };
      }
      try {
        return await chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 });
      } catch (error) {
        return { success: false, restoredCount: 0, conflictCount: 0, error: `撤销失败：${(error as Error).message}` };
      }
    }

    case 'GET_CURRENT_SESSION': {
      const session = await sessionRepo.getCurrentActive();
      return { session: session || null };
    }

    case 'UPDATE_SESSION_TITLE': {
      const { sessionId, title } = message.payload;
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) return { error: '会话标题不能为空' };
      await sessionRepo.updateTitle(sessionId, cleanTitle);
      const activeSession = await sessionRepo.getCurrentActive();
      if (activeSession && activeSession.id === sessionId) {
        activeSession.title = cleanTitle;
        broadcastMessage({
          type: 'CURRENT_SESSION_RESPONSE',
          payload: { session: activeSession },
        });
      }
      return { success: true, title: cleanTitle };
    }

    case 'START_SESSION': {
      const { projectId, projectName, environment, title } = message.payload;
      const existingSession = await sessionRepo.getCurrentActive();
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isCapturablePageUrl(activeTab?.url)) {
        return { error: activePageError(activeTab?.url) };
      }
      if (activeTab?.id === undefined) return { error: '未找到活动标签页' };
      try {
        await ensurePageCaptureReady(activeTab.id);
      } catch (error) {
        return { error: (error as Error).message };
      }
      if (existingSession) {
        if (existingSession.tabId !== undefined && existingSession.tabId !== activeTab.id) {
          return { error: activePageError(activeTab.url) };
        }
        return { session: existingSession, alreadyActive: true };
      }
      const currentUrl = activeTab?.url || 'https://unknown-page';

      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const chromeVersion = ua.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1] || '未知';
      const browserInfo: BrowserContextInfo = {
        userAgent: ua,
        browserName: 'Chrome',
        browserVersion: chromeVersion,
        os: typeof navigator !== 'undefined' ? navigator.platform || 'macOS' : 'Windows',
        viewport: {
          width: activeTab?.width || 1920,
          height: activeTab?.height || 1080,
        },
      };

      // 方案3：智能生成会话标题。若未显式指定，优先提取页面标题 + (项目-环境)
      let sessionTitle = title;
      if (!sessionTitle || sessionTitle === `${projectName} 测试`) {
        const rawTabTitle = (activeTab?.title || '').trim();
        const cleanTitle = rawTabTitle
          .replace(/\s*[-_—|]\s*(?:Google Chrome|Chromium|Firefox|Edge)$/i, '')
          .trim();
        const isValidTitle = cleanTitle &&
          !cleanTitle.startsWith('http://') &&
          !cleanTitle.startsWith('https://') &&
          cleanTitle !== 'New Tab';
        if (isValidTitle) {
          const shortTitle = cleanTitle.length > 24 ? `${cleanTitle.slice(0, 24)}…` : cleanTitle;
          sessionTitle = `${shortTitle} (${projectName}-${environment})`;
        } else {
          sessionTitle = `${projectName} (${environment})`;
        }
      }

      const newSession: TestSession = {
        id: createEntityId('sess'),
        projectId,
        projectName,
        environment,
        title: sessionTitle,
        status: 'in_progress',
        startedAt: Date.now(),
        initialUrl: currentUrl,
        currentUrl,
        tabId: activeTab?.id,
        browserInfo,
        stats: {
          actionCount: 0,
          apiCount: 0,
          errorCount: 0,
        },
      };

      await sessionRepo.create(newSession);
      await chrome.storage.session.set({ activeSessionId: newSession.id });

      const initialNavEvent: QAEvent = {
        id: createEntityId('evt'),
        sessionId: newSession.id,
        type: 'navigation',
        timestamp: Date.now(),
        title: '打开页面',
        description: `访问 ${newSession.initialUrl}`,
        url: newSession.initialUrl,
        payload: {
          timestamp: Date.now(),
          url: newSession.initialUrl,
          fromUrl: '',
          toUrl: newSession.initialUrl,
          pageTitle: activeTab?.title || '',
          navigationType: 'initial',
        },
      };
      await eventRepo.add(initialNavEvent);
      await sessionRepo.updateStats(newSession.id, { actionCount: 1 });
      newSession.stats.actionCount = 1;

      broadcastMessage({
        type: 'CURRENT_SESSION_RESPONSE',
        payload: { session: newSession },
      });

      return { session: newSession };
    }

    case 'STOP_SESSION': {
      const { sessionId } = message.payload;
      const activeSession = await sessionRepo.getCurrentActive();
      if (activeSession?.id === sessionId && activeSession.tabId !== undefined) {
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: activeSession.tabId });
          await Promise.all((frames || [{ frameId: 0 }]).map(({ frameId }) =>
            chrome.tabs.sendMessage(
              activeSession.tabId!,
              { type: 'FLUSH_PENDING_RECORDS' },
              { frameId }
            ).catch(() => {})
          ));
        } catch {}
      }
      await sessionRepo.complete(sessionId);
      await chrome.storage.session.remove('activeSessionId');

      broadcastMessage({
        type: 'CURRENT_SESSION_RESPONSE',
        payload: { session: null },
      });
      return { success: true };
    }

    case 'RECORD_EVENT': {
      const activeSession = await sessionRepo.getCurrentActive();
      if (!activeSession) {
        return { ignored: true, reason: 'No active session' };
      }
      if (activeSession.tabId !== undefined && sender.tab?.id !== activeSession.tabId) {
        return { ignored: true, reason: 'Event belongs to another tab' };
      }

      const eventData = message.payload.event;
      // 子 frame 的用户操作进入同一时间线；子 frame 导航不更新主页面地址。
      const isChildFrame = sender.frameId !== undefined && sender.frameId !== 0;
      if (isChildFrame && !['click', 'input', 'scroll', 'error', 'console'].includes(eventData.type)) {
        return { ignored: true, reason: 'Interaction belongs to a child frame' };
      }
      if (eventData.type === 'navigation' && expectedReplayNavigation) {
        if (expectedReplayNavigation.expiresAt <= Date.now()) {
          expectedReplayNavigation = null;
        } else if (sender.tab?.id === expectedReplayNavigation.tabId) {
          expectedReplayNavigation = null;
          return { ignored: true, reason: 'Navigation was triggered by the replay runner' };
        }
      }
      const isError = eventData.type === 'error' ||
        (eventData.type === 'console' && (eventData.payload as { level?: string })?.level === 'error');

      // 更新当前 Session URL（若为导航事件）
      if (eventData.type === 'navigation' && eventData.url) {
        activeSession.currentUrl = eventData.url;
        await sessionRepo.updateCurrentUrl(activeSession.id, eventData.url);
      }

      const fullEvent: QAEvent = {
        id: createEntityId('evt'),
        sessionId: activeSession.id,
        type: eventData.type,
        timestamp: eventData.timestamp || Date.now(),
        title: eventData.title,
        description: eventData.description,
        url: eventData.url || sender.tab?.url || activeSession.currentUrl,
        payload: {
          ...(eventData.payload as Record<string, unknown>),
          frameId: sender.frameId ?? 0,
          frameUrl: sender.url || eventData.url || '',
          ...(sender.documentId ? { documentId: sender.documentId } : {}),
        } as QAEvent['payload'],
      };

      // 关联因果链分析（若是 JS 错误）
      if (isError) {
        const recentActions = await eventRepo.listRecentBySession(activeSession.id, 10);
        const classified = AnomalyDetector.classifyJsError(fullEvent, recentActions);
        fullEvent.description = classified.description;
        if (classified.relatedAction) {
          fullEvent.title = `[关联操作] ${fullEvent.title}`;
          fullEvent.relatedActionId = classified.relatedAction.actionId;
        }
      }

      await eventRepo.add(fullEvent);
      if (isError) await consoleRepo.add(fullEvent);
      await snapshotRepo.appendEventToCapturingSnapshots(fullEvent);
      await sessionRepo.updateStats(activeSession.id, {
        actionCount: isError ? 0 : 1,
        errorCount: isError ? 1 : 0,
      });

      const updatedSession = await sessionRepo.getById(activeSession.id);
      const stats = updatedSession?.stats || activeSession.stats;

      broadcastMessage({
        type: 'EVENT_RECORDED',
        payload: {
          event: fullEvent,
          sessionStats: stats,
        },
      });

      return { success: true, eventId: fullEvent.id };
    }

    case 'NETWORK_START': {
      const { requestId, startedAt } = message.payload;
      const activeSession = await sessionRepo.getCurrentActive();
      const tabId = sender.tab?.id;
      const frameId = sender.frameId;

      let boundSessionId: string | undefined = undefined;
      if (activeSession && (activeSession.tabId === undefined || tabId === activeSession.tabId)) {
        boundSessionId = activeSession.id;
      }

      inFlightRequests.set(requestId, {
        requestId,
        tabId,
        frameId,
        sessionId: boundSessionId,
        startedAt,
      });

      // 定期清理过期的在途上下文（大于 15 分钟）
      if (inFlightRequests.size > 500) {
        const now = Date.now();
        for (const [key, ctx] of inFlightRequests.entries()) {
          if (now - ctx.startedAt > 15 * 60 * 1000) {
            inFlightRequests.delete(key);
          }
        }
      }

      return { success: true };
    }

    case 'RECORD_NETWORK': {
      const raw = message.payload.request;
      const requestId = raw.requestId;

      // 幂等防重：如果同一 requestId 已处理过，直接忽略
      if (requestId && processedRequestIds.has(requestId)) {
        return { ignored: true, reason: 'Duplicate network capture message' };
      }

      const inFlight = requestId ? inFlightRequests.get(requestId) : undefined;
      if (requestId) {
        inFlightRequests.delete(requestId);
      }

      const activeSession = await sessionRepo.getCurrentActive();

      let targetSessionId: string | undefined = undefined;

      if (inFlight) {
        // 请求发起时有确切上下文
        if (inFlight.sessionId) {
          targetSessionId = inFlight.sessionId;
        } else {
          // 发起时明确没有绑定的 Session（测试开始前的在途请求），严格不归入后来开始的会话
          return { ignored: true, reason: 'Request started before session began' };
        }
      } else {
        // 无 inFlight 记录（直接调用或兼容旧调用路径）
        if (raw.targetSessionId) {
          targetSessionId = raw.targetSessionId;
        } else if (raw.startedAt) {
          // 检查是否早于当前活跃会话
          if (activeSession && raw.startedAt < activeSession.startedAt) {
            const pastSessions = await sessionRepo.listRecent(5);
            const originSession = pastSessions.find(
              (s) => s.id !== activeSession.id && raw.startedAt >= s.startedAt && (!s.endedAt || raw.startedAt <= s.endedAt)
            );
            if (originSession) {
              targetSessionId = originSession.id;
            } else {
              return { ignored: true, reason: 'Request started before current session began' };
            }
          } else if (activeSession) {
            if (activeSession.tabId !== undefined && sender.tab?.id !== undefined && sender.tab.id !== activeSession.tabId) {
              return { ignored: true, reason: 'Request belongs to another tab' };
            }
            targetSessionId = activeSession.id;
          } else {
            // 当前无活动 session，检查是否属于最近已结束的 session 晚到响应
            const pastSessions = await sessionRepo.listRecent(5);
            const originSession = pastSessions.find(
              (s) => raw.startedAt >= s.startedAt && (!s.endedAt || raw.startedAt <= s.endedAt)
            );
            if (originSession) {
              targetSessionId = originSession.id;
            }
          }
        } else if (activeSession) {
          if (activeSession.tabId !== undefined && sender.tab?.id !== undefined && sender.tab.id !== activeSession.tabId) {
            return { ignored: true, reason: 'Request belongs to another tab' };
          }
          targetSessionId = activeSession.id;
        }
      }

      if (!targetSessionId) {
        return { ignored: true, reason: 'Unattributed network request' };
      }

      const targetSession = await sessionRepo.getById(targetSessionId);
      if (!targetSession) {
        return { ignored: true, reason: 'Target session does not exist' };
      }

      if (targetSession.tabId !== undefined && sender.tab?.id !== undefined && sender.tab.id !== targetSession.tabId) {
        return { ignored: true, reason: 'Request belongs to another tab' };
      }

      if (requestId) {
        markRequestProcessed(requestId);
      }

      const recentActions = await eventRepo.listRecentBySession(targetSessionId, 10);
      const storedSettings = await chrome.storage.local.get({ slowThresholdMs: 2000 });
      const slowThresholdMs = Math.max(500, Math.min(10_000, Number(storedSettings.slowThresholdMs) || 2000));

      const fullRequest: NetworkRequest = {
        id: createEntityId('req'),
        sessionId: targetSessionId,
        method: raw.method,
        url: captureText(raw.url),
        pathname: captureText(raw.pathname || raw.url),
        status: raw.status,
        statusText: raw.statusText,
        startedAt: raw.startedAt,
        duration: raw.duration,
        requestHeaders: captureHeaders(raw.requestHeaders),
        requestBody: captureText(raw.requestBody),
        responseHeaders: captureHeaders(raw.responseHeaders),
        responseBody: captureText(raw.responseBody),
        mimeType: raw.mimeType,
        initiatorType: raw.initiatorType,
        error: captureText(raw.error),
        isError: raw.isError,
        isSlow: raw.duration > slowThresholdMs,
        isMocked: raw.isMocked,
        mockRuleId: raw.mockRuleId,
        requestId,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      };

      // 异常识别与因果关联
      const anomaly = AnomalyDetector.classifyNetworkRequest(fullRequest, recentActions, slowThresholdMs);
      if (anomaly?.relatedAction) {
        fullRequest.relatedActionId = anomaly.relatedAction.actionId;
      }

      await networkRepo.add(fullRequest);

      const isErrOrSlow = fullRequest.isError || fullRequest.isSlow;
      await sessionRepo.updateStats(targetSessionId, {
        apiCount: 1,
        errorCount: isErrOrSlow ? 1 : 0,
      });

      // 关键修复：Timeline 事件的 sessionId 严格等于归属的 targetSessionId，杜绝写入错误的 activeSession
      const timelineEvent: QAEvent = {
        id: `evt-net-${fullRequest.id}`,
        sessionId: targetSessionId,
        type: isErrOrSlow ? 'error' : 'custom',
        timestamp: fullRequest.startedAt,
        title: anomaly?.title || `${fullRequest.method} ${fullRequest.pathname}`,
        description: anomaly?.description || `HTTP ${fullRequest.status} · ${fullRequest.duration}ms`,
        url: fullRequest.url,
        payload: {
          timestamp: fullRequest.startedAt,
          url: fullRequest.url,
          method: fullRequest.method,
          status: fullRequest.status,
          duration: fullRequest.duration,
          kind: 'network',
          severity: anomaly?.severity,
        },
        relatedRequestId: fullRequest.id,
      };
      await eventRepo.add(timelineEvent);
      await snapshotRepo.appendNetworkToCapturingSnapshots(fullRequest);
      await snapshotRepo.appendEventToCapturingSnapshots(timelineEvent);

      const updatedSession = await sessionRepo.getById(targetSessionId);
      const stats = updatedSession?.stats || { actionCount: 0, apiCount: 1, errorCount: isErrOrSlow ? 1 : 0 };

      broadcastMessage({
        type: 'NETWORK_RECORDED',
        payload: {
          request: fullRequest,
          timelineEvent,
          sessionStats: stats,
        },
      });

      return { success: true, requestId: fullRequest.id };
    }

    case 'TAKE_SCREENSHOT': {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.windowId) {
          return { error: '未找到活动标签页窗口' };
        }
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const activeSession = await sessionRepo.getCurrentActive();
        if (activeSession && message.payload?.persistToSession !== false) {
          const screenshotId = createEntityId('shot');
          await screenshotRepo.add({
            id: screenshotId,
            sessionId: activeSession.id,
            createdAt: Date.now(),
            url: tab.url || activeSession.currentUrl,
            dataUrl,
          });
          const screenshotEvent: QAEvent = {
            id: createEntityId('evt-shot'),
            sessionId: activeSession.id,
            type: 'screenshot',
            timestamp: Date.now(),
            title: '页面截图',
            description: '已保存当前页面可视区域截图',
            url: tab.url || activeSession.currentUrl,
            payload: {
              timestamp: Date.now(),
              url: tab.url || activeSession.currentUrl,
              screenshotId,
            },
          };
          await eventRepo.add(screenshotEvent);
          const latestSession = await sessionRepo.getById(activeSession.id);
          broadcastMessage({
            type: 'EVENT_RECORDED',
            payload: { event: screenshotEvent, sessionStats: latestSession?.stats || activeSession.stats },
          });
        }
        return { dataUrl };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }

    case 'CREATE_SNAPSHOT': {
      const activeSession = await sessionRepo.getCurrentActive();
      if (!activeSession) {
        return { error: '当前没有进行中的测试 Session' };
      }
      if (message.payload.sessionId !== activeSession.id) {
        return { error: '当前测试 Session 已变化，请返回首页后重试' };
      }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isCapturablePageUrl(activeTab?.url) ||
        (activeSession.tabId !== undefined && activeTab?.id !== activeSession.tabId)) {
        return { error: activePageError(activeTab?.url) };
      }

      const now = Date.now();
      const snapshotId = createEntityId(`SNAP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
      const contextBeforeSec = Math.min(message.payload.windowDurationSec || 30, 120);
      const windowEvents = await eventRepo.getWindowEvents(
        activeSession.id,
        now,
        contextBeforeSec,
        0
      );

      const windowRequests = await networkRepo.getWindowRequests(
        activeSession.id,
        now,
        contextBeforeSec,
        0
      );

      let screenshotUrl: string | undefined;
      let screenshotId: string | undefined;
      try {
        if (activeTab?.windowId) {
          screenshotUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' });
          screenshotId = createEntityId('shot');
          await screenshotRepo.add({
            id: screenshotId,
            sessionId: activeSession.id,
            snapshotId,
            createdAt: now,
            url: activeSession.currentUrl,
            dataUrl: screenshotUrl,
          });
        }
      } catch (e) {
        console.warn('[QA Copilot SW] 截图异常:', e);
      }

      const errorEvents = windowEvents.filter(
        (e) => !e.relatedRequestId &&
          (e.type === 'error' || (e.type === 'console' && (e.payload as { level?: string })?.level === 'error'))
      );

      const snapshot: BugSnapshot = {
        id: snapshotId,
        sessionId: activeSession.id,
        createdAt: now,
        url: activeSession.currentUrl,
        environment: activeSession.environment,
        browserInfo: activeSession.browserInfo,
        windowDurationSec: contextBeforeSec,
        contextBeforeSec,
        contextAfterSec: 10,
        captureUntil: now + 10_000,
        screenshotUrl,
        screenshotId,
        events: windowEvents,
        networkRequests: windowRequests,
        consoleErrors: errorEvents,
        summary: {
          eventCount: windowEvents.length,
          requestCount: windowRequests.length,
          errorCount: errorEvents.length + windowRequests.filter((r) => r.isError).length,
        },
      };

      await snapshotRepo.createSnapshot(snapshot);

      broadcastMessage({
        type: 'SNAPSHOT_CREATED',
        payload: { snapshot },
      });

      return { snapshot };
    }

    default:
      return { ignored: true };
  }
}

function broadcastMessage(message: unknown) {
  try {
    // 传入 callback 并在其中访问 lastError，当 Side Panel 关闭无接收端时消除 Chrome 报红
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // 静默吞掉无接收端的合法状态
      }
    });
  } catch {}
}

taskCoordinator.setBroadcastFn((msg) => broadcastMessage(msg));

/**
 * IMP-05: 后台 Service Worker 启动时，恢复 storage.session 中的活跃任务并严格探活执行端
 */
export async function initTaskCoordinatorRecovery(): Promise<void> {
  const restored = await taskCoordinator.restoreFromStorage();
  if (restored && (restored.status === 'running' || restored.status === 'cancelling' || restored.status === 'queued')) {
    const targetTabId = restored.target.tabId;
    const cancelPageRemnants = async () => {
      if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage && targetTabId !== undefined) {
        if (restored.type === 'replay') {
          await stopReplayInTab(targetTabId);
        } else if (restored.type === 'form_fill') {
          await chrome.tabs.sendMessage(
            targetTabId,
            { type: 'CANCEL_FORM_FILL', payload: { runId: restored.runId, targetTabId } },
            { frameId: 0 }
          ).catch(() => {});
        }
      }
    };

    // IMP-05 (QA-P1): 回放循环运行在 Service Worker 内存中，Worker 重启后调度循环已丢失；
    // 即使页面探活仍有残留 ID，也不代表整段回放可以继续执行。
    // 因此后台重启后，对恢复出的回放任务统一停止页面残留动作，并标记 interrupted，立即释放任务占用！
    if (restored.type === 'replay') {
      taskCoordinator.finishTask(restored.runId, 'interrupted', '后台 Service Worker 重启，回放调度循环已终止');
      await cancelPageRemnants();
      return;
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
        const tab = await chrome.tabs.get(targetTabId).catch(() => null);
        if (!tab) {
          taskCoordinator.finishTask(restored.runId, 'interrupted', '后台重启后目标标签页已关闭');
          return;
        }
        // 向顶层 content script 探活
        const pong = (await chrome.tabs.sendMessage(
          targetTabId,
          { type: 'PING_TASK_STATUS', payload: { runId: restored.runId } },
          { frameId: 0 }
        ).catch(() => null)) as { isRunning?: boolean } | null;

        if (!pong || !pong.isRunning) {
          taskCoordinator.finishTask(restored.runId, 'interrupted', '后台重启后页面任务执行已断开');
          await cancelPageRemnants();
        }
      }
    } catch {
      taskCoordinator.finishTask(restored.runId, 'interrupted', '后台重启后无法确认页面执行状态');
      await cancelPageRemnants();
    }
  }
}
initTaskCoordinatorRecovery().catch(() => {});

async function ensureReplayContentReady(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const status = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_PING' }) as { ready?: boolean } | undefined;
      if (status?.ready) return;
    } catch {}

    if (attempt === 0 || attempt === 10) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
          world: 'ISOLATED',
          injectImmediately: true,
        });
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('回放脚本没有响应，请刷新被测页面后重试');
}

async function navigateReplayTab(tabId: number, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`页面加载超时：${url}`));
    }, 20_000);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

async function waitForTabNavigationComplete(tabId: number, settleDelayMs = 0): Promise<boolean> {
  if (settleDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  if (typeof chrome !== 'undefined' && typeof chrome.tabs?.get !== 'function') return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status !== 'loading') return false;

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;
    let listener: (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    timeout = setTimeout(() => finish(new Error(`等待标签页 ${tabId} 导航完成超时`)), 20_000);
    listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((currentTab) => {
      if (currentTab.status !== 'loading') finish();
    }).catch((error) => finish(error as Error));
  });
  return true;
}
