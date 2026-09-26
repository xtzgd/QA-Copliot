/**
 * Side Panel 全局状态管理 (Zustand)
 */

import { create } from 'zustand';
import { eventRepo } from '../../db/repositories/eventRepository';
import { networkRepo } from '../../db/repositories/networkRepository';
import { sessionRepo } from '../../db/repositories/sessionRepository';
import { snapshotRepo } from '../../db/repositories/snapshotRepository';
import { projectRepo } from '../../db/repositories/projectRepository';
import { sendToBackground } from '../../shared/messages';
import { QAEvent } from '../../shared/types/event';
import { NetworkRequest } from '../../shared/types/network';
import { Environment, Project, TestSession } from '../../shared/types/session';
import { BugSnapshot } from '../../shared/types/snapshot';
import { ElementInspectResult } from '../../shared/tools/locatorGenerator';
import { TaskRunRecord } from '../../shared/types/task';

export type NavTab = 'home' | 'test' | 'bug' | 'api' | 'ai' | 'settings';
export type ActiveView = 'main' | 'snapshot_result' | 'bug_editor';
export type AiSubTab = 'formFill' | 'dom' | 'cases' | 'agent';
export type SettingsSubTab = 'zentao' | 'ai' | 'quickLogin' | 'general';

interface AppState {
  currentTab: NavTab;
  activeView: ActiveView;
  aiSubTab: AiSubTab;
  settingsSubTab: SettingsSubTab;
  activeSession: TestSession | null;
  pastSessions: TestSession[];
  events: QAEvent[];
  networkRequests: NetworkRequest[];
  recentAnomalies: QAEvent[];
  currentSnapshot: BugSnapshot | null;
  projects: Project[];
  environments: Environment[];
  inspectedElement: ElementInspectResult | null;
  selectedProject: string;
  selectedEnvironment: string;
  currentUrl: string;
  isCapturing: boolean;
  toastMessage: string | null;
  activeTask: TaskRunRecord | null;
  lastRunnerTask: TaskRunRecord | null;
  isPipActive: boolean;

  // 操作
  setCurrentTab: (tab: NavTab, activeView?: ActiveView) => void;
  setActiveView: (view: ActiveView) => void;
  setAiSubTab: (subTab: AiSubTab) => void;
  setSettingsSubTab: (subTab: SettingsSubTab) => void;
  setSelectedProject: (proj: string) => void;
  setCurrentUrl: (url: string) => void;
  setToastMessage: (msg: string | null) => void;
  setActiveTask: (task: TaskRunRecord | null) => void;
  setIsPipActive: (active: boolean) => void;
  reloadProjectConfig: () => Promise<void>;

  // 业务动作
  initSession: () => Promise<void>;
  refreshActiveTask: () => Promise<void>;
  cancelActiveTask: () => Promise<void>;
  startSession: (title?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  updateSessionTitle: (sessionId: string, newTitle: string) => Promise<void>;
  triggerSnapshot: () => Promise<void>;
  handleIncomingEvent: (event: QAEvent, stats: TestSession['stats']) => void;
  handleIncomingNetwork: (req: NetworkRequest, timelineEvent: QAEvent, stats: TestSession['stats']) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentTab: 'home',
  activeView: 'main',
  aiSubTab: 'formFill',
  settingsSubTab: 'zentao',
  activeSession: null,
  pastSessions: [],
  events: [],
  networkRequests: [],
  recentAnomalies: [],
  currentSnapshot: null,
  projects: [],
  environments: [],
  inspectedElement: null,
  selectedProject: '商城系统',
  selectedEnvironment: 'TEST',
  currentUrl: 'https://test.xxx.com/order/create',
  isCapturing: false,
  toastMessage: null,
  activeTask: null,
  lastRunnerTask: null,
  isPipActive: false,

  setCurrentTab: (tab, activeView = 'main') => set({ currentTab: tab, activeView }),
  setActiveView: (view) => set({ activeView: view }),
  setAiSubTab: (aiSubTab) => set({ aiSubTab }),
  setSettingsSubTab: (settingsSubTab) => set({ settingsSubTab }),
  setSelectedProject: (selectedProject) => {
    set({ selectedProject });
    const project = get().projects.find((item) => item.name === selectedProject);
    if (project) {
      projectRepo.listEnvironments(project.id).then((environments) => set({ environments }));
    }
  },
  setCurrentUrl: (currentUrl) => set({ currentUrl }),
  setToastMessage: (toastMessage) => set({ toastMessage }),
  setActiveTask: (activeTask) => set({ activeTask }),
  setIsPipActive: (isPipActive) => set({ isPipActive }),

  refreshActiveTask: async () => {
    const res = await sendToBackground<{ task: TaskRunRecord | null }>({
      type: 'GET_ACTIVE_TASK',
      payload: undefined,
    });
    if (res?.task && (res.task.status === 'running' || res.task.status === 'cancelling' || res.task.status === 'queued')) {
      set({ activeTask: res.task });
    } else {
      set({ activeTask: null });
    }
  },

  cancelActiveTask: async () => {
    const { activeTask } = get();
    if (!activeTask) return;
    set({ activeTask: { ...activeTask, status: 'cancelling' } });
    await sendToBackground({
      type: 'CANCEL_ACTIVE_TASK',
      payload: { runId: activeTask.runId },
    });
    set({ activeTask: null, toastMessage: '已发送取消指令' });
  },

  reloadProjectConfig: async () => {
    await projectRepo.ensureDefaults();
    const projects = await projectRepo.listProjects();
    const selectedName = get().selectedProject;
    const selected = projects.find((project) => project.name === selectedName) || projects[0];
    const environments = selected ? await projectRepo.listEnvironments(selected.id) : [];
    set({
      projects,
      environments,
      selectedProject: selected?.name || selectedName,
    });
  },

  initSession: async () => {
    await get().reloadProjectConfig();
    await get().refreshActiveTask();
    // 获取历史会话列表
    const [past, latestSnapshot] = await Promise.all([
      sessionRepo.listRecent(10),
      snapshotRepo.getLatestSnapshot(),
    ]);
    set({ pastSessions: past, currentSnapshot: latestSnapshot || null });

    // 1. 获取当前活动会话
    const res = await sendToBackground<{ session: TestSession | null }>({
      type: 'GET_CURRENT_SESSION',
      payload: undefined,
    });

    if (res?.session) {
      const events = (await eventRepo.listRecentBySession(res.session.id, 50)).sort((a, b) => a.timestamp - b.timestamp);
      const reqs = await networkRepo.listBySession(res.session.id);
      const errors = await eventRepo.listErrorsBySession(res.session.id);
      set({
        activeSession: res.session,
        events,
        networkRequests: reqs,
        recentAnomalies: errors.slice(0, 5),
        currentUrl: res.session.currentUrl,
        selectedProject: res.session.projectName,
        selectedEnvironment: res.session.environment,
      });
    } else {
      set({ activeSession: null, events: [], networkRequests: [], recentAnomalies: [] });
    }

    // 获取当前活动标签页的 URL
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          set({ currentUrl: tab.url });
        }
      } catch {}
    }
  },

  startSession: async (title) => {
    const { selectedProject, selectedEnvironment, currentUrl, projects } = get();
    const projectId = projects.find((project) => project.name === selectedProject)?.id || 'proj-default';
    set({ isCapturing: true });

    // 方案 3：智能生成会话标题。若未显式指定，优先提取页面标题 + (项目-环境)
    let sessionTitle = title;
    if (!sessionTitle && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const rawTabTitle = (tab?.title || '').trim();
        const cleanTitle = rawTabTitle
          .replace(/\s*[-_—|]\s*(?:Google Chrome|Chromium|Firefox|Edge)$/i, '')
          .trim();
        const isValidTitle = cleanTitle &&
          !cleanTitle.startsWith('http://') &&
          !cleanTitle.startsWith('https://') &&
          cleanTitle !== 'New Tab';
        if (isValidTitle) {
          const shortTitle = cleanTitle.length > 24 ? `${cleanTitle.slice(0, 24)}…` : cleanTitle;
          sessionTitle = `${shortTitle} (${selectedProject}-${selectedEnvironment})`;
        }
      } catch {}
    }
    if (!sessionTitle) {
      sessionTitle = `${selectedProject} (${selectedEnvironment})`;
    }

    const res = await sendToBackground<{ session?: TestSession; error?: string }>({
      type: 'START_SESSION',
      payload: {
        projectId,
        projectName: selectedProject,
        environment: selectedEnvironment,
        title: sessionTitle,
      },
    });

    if (res?.session) {
      const initialEvents = await eventRepo.listBySession(res.session.id);
      set({
        activeSession: res.session,
        events: initialEvents.sort((a, b) => a.timestamp - b.timestamp),
        networkRequests: [],
        recentAnomalies: [],
        currentUrl: res.session.currentUrl || currentUrl,
        isCapturing: false,
        toastMessage: '测试 Session 已开始，正在自动记录',
      });
    } else {
      set({ isCapturing: false, toastMessage: res?.error || '无法开始测试，请刷新被测页面后重试' });
    }
  },

  stopSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return;

    await sendToBackground({
      type: 'STOP_SESSION',
      payload: { sessionId: activeSession.id },
    });

    const past = await sessionRepo.listRecent(10);
    set({
      activeSession: null,
      pastSessions: past,
      toastMessage: '测试 Session 已结束',
    });
  },

  updateSessionTitle: async (sessionId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    await sessionRepo.updateTitle(sessionId, trimmed);
    const { activeSession, pastSessions } = get();
    if (activeSession && activeSession.id === sessionId) {
      set({ activeSession: { ...activeSession, title: trimmed } });
      await sendToBackground({
        type: 'UPDATE_SESSION_TITLE',
        payload: { sessionId, title: trimmed },
      });
    }
    set({
      pastSessions: pastSessions.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s)),
      toastMessage: '会话名称已更新',
    });
  },

  triggerSnapshot: async () => {
    const { activeSession } = get();
    if (!activeSession) {
      set({ toastMessage: '请先点击「开始测试」开启 Session' });
      return;
    }

    set({ isCapturing: true });

    const res = await sendToBackground<{ snapshot?: BugSnapshot; error?: string }>({
      type: 'CREATE_SNAPSHOT',
      payload: {
        sessionId: activeSession.id,
        windowDurationSec: 30,
      },
    });

    set({ isCapturing: false });

    if (res?.snapshot) {
      set({
        currentSnapshot: res.snapshot,
        activeView: 'snapshot_result',
        toastMessage: '问题现场已保存！',
      });
    } else {
      set({ toastMessage: res?.error || '问题现场保存失败，请确认正在测试的页面仍处于活动状态' });
    }
  },

  handleIncomingEvent: (event, stats) => {
    const { activeSession, events, recentAnomalies, currentSnapshot } = get();
    if (!activeSession) return;

    const isError = event.type === 'error' || 
      (event.type === 'console' && (event.payload as { level?: string })?.level === 'error');

    const nextEvents = [...events, event];
    const nextErrors = isError ? [event, ...recentAnomalies] : recentAnomalies;

    const shouldAppendToSnapshot = Boolean(
      currentSnapshot?.captureUntil &&
      event.timestamp > currentSnapshot.createdAt &&
      event.timestamp <= currentSnapshot.captureUntil
    );
    const isSnapshotConsoleError = isError && !event.relatedRequestId;
    const updatedSnapshot = shouldAppendToSnapshot && currentSnapshot
      ? {
          ...currentSnapshot,
          events: currentSnapshot.events.some((item) => item.id === event.id)
            ? currentSnapshot.events
            : [...currentSnapshot.events, event],
          consoleErrors: isSnapshotConsoleError && !currentSnapshot.consoleErrors.some((item) => item.id === event.id)
            ? [...currentSnapshot.consoleErrors, event]
            : currentSnapshot.consoleErrors,
          summary: {
            ...currentSnapshot.summary,
            eventCount: currentSnapshot.events.some((item) => item.id === event.id)
              ? currentSnapshot.summary.eventCount
              : currentSnapshot.summary.eventCount + 1,
            errorCount: isSnapshotConsoleError && !currentSnapshot.consoleErrors.some((item) => item.id === event.id)
              ? currentSnapshot.summary.errorCount + 1
              : currentSnapshot.summary.errorCount,
          },
        }
      : currentSnapshot;

    set({
      events: nextEvents,
      recentAnomalies: nextErrors.slice(0, 5),
      currentSnapshot: updatedSnapshot,
      activeSession: {
        ...activeSession,
        stats,
      },
    });
  },

  handleIncomingNetwork: (req, timelineEvent, stats) => {
    const { activeSession, networkRequests, events, recentAnomalies, currentSnapshot } = get();
    if (!activeSession) return;
    // IMP-03: 严格校验归属 Session，非当前会话的晚到响应由后台落库，不直接插入当前会话面板
    if (req.sessionId !== activeSession.id) return;

    const isAnomaly = timelineEvent.type === 'error';
    const shouldAppendToSnapshot = Boolean(
      currentSnapshot?.captureUntil &&
      req.startedAt > currentSnapshot.createdAt &&
      req.startedAt <= currentSnapshot.captureUntil
    );
    const alreadyIncluded = currentSnapshot?.networkRequests.some((item) => item.id === req.id) || false;
    const updatedSnapshot = shouldAppendToSnapshot && currentSnapshot
      ? {
          ...currentSnapshot,
          events: currentSnapshot.events.some((item) => item.id === timelineEvent.id)
            ? currentSnapshot.events
            : [...currentSnapshot.events, timelineEvent],
          networkRequests: alreadyIncluded
            ? currentSnapshot.networkRequests
            : [...currentSnapshot.networkRequests, req],
          summary: {
            ...currentSnapshot.summary,
            eventCount: currentSnapshot.events.some((item) => item.id === timelineEvent.id)
              ? currentSnapshot.summary.eventCount
              : currentSnapshot.summary.eventCount + 1,
            requestCount: alreadyIncluded
              ? currentSnapshot.summary.requestCount
              : currentSnapshot.summary.requestCount + 1,
            errorCount: !alreadyIncluded && (req.isError || req.isSlow)
              ? currentSnapshot.summary.errorCount + 1
              : currentSnapshot.summary.errorCount,
          },
        }
      : currentSnapshot;

    set({
      networkRequests: [req, ...networkRequests],
      events: [...events, timelineEvent],
      recentAnomalies: isAnomaly ? [timelineEvent, ...recentAnomalies].slice(0, 5) : recentAnomalies,
      currentSnapshot: updatedSnapshot,
      activeSession: {
        ...activeSession,
        stats,
      },
    });
  },
}));
