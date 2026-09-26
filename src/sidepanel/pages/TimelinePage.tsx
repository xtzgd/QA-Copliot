/**
 * 测试 Session 时间线与历史会话 (E1 - TASK-106 & PRD 第 34 节)
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Check,
  Clock,
  Compass,
  Download,
  FileCode2,
  History,
  MousePointer2,
  MoveVertical,
  Pencil,
  PenTool,
  PlayCircle,
  Send,
  Square,
  X,
} from 'lucide-react';
import { eventRepo } from '../../db/repositories/eventRepository';
import { snapshotRepo } from '../../db/repositories/snapshotRepository';
import { QAEvent } from '../../shared/types/event';
import { BugSnapshot } from '../../shared/types/snapshot';
import { PlaywrightSessionExporter } from '../../shared/formatters/playwrightExport';
import { sendToBackground } from '../../shared/messages';
import { useAppStore } from '../store/useAppStore';

export const TimelinePage: React.FC = () => {
  const { activeSession, pastSessions, events, setCurrentTab, setToastMessage, activeTask, updateSessionTitle } = useAppStore();
  const [filter, setFilter] = useState<'all' | 'action' | 'api' | 'error'>('all');
  const [viewingPastSessionId, setViewingPastSessionId] = useState<string | null>(null);
  const [pastEvents, setPastEvents] = useState<QAEvent[]>([]);
  const [pastSnapshots, setPastSnapshots] = useState<BugSnapshot[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayInProgress = isReplaying || (activeTask?.type === 'replay' && (activeTask.status === 'running' || activeTask.status === 'cancelling'));
  const [replayFailures, setReplayFailures] = useState<Array<{ eventId: string; error: string }>>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState('');
  const [replayStartIndex, setReplayStartIndex] = useState<number>(0);
  const [replayEndIndex, setReplayEndIndex] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleStartEdit = (e: React.MouseEvent, sessId: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingSessionId(sessId);
    setEditTitleInput(currentTitle);
  };

  const handleSaveTitle = async (sessId: string) => {
    const trimmed = editTitleInput.trim();
    if (!trimmed) {
      setToastMessage('会话名称不能为空');
      return;
    }
    await updateSessionTitle(sessId, trimmed);
    setEditingSessionId(null);
  };

  const handleSelectPastSession = async (sessId: string) => {
    setViewingPastSessionId(sessId);
    setReplayStartIndex(0);
    setReplayEndIndex(null);
    const [evts, snapshots] = await Promise.all([
      eventRepo.listBySession(sessId),
      snapshotRepo.listSnapshotsBySession(sessId),
    ]);
    setPastEvents(evts);
    setPastSnapshots(snapshots);
  };

  const openPastSnapshot = (snapshot: BugSnapshot) => {
    useAppStore.setState({ currentSnapshot: snapshot, activeView: 'snapshot_result' });
  };

  const currentEventsList = viewingPastSessionId ? pastEvents : events;
  const viewedSession = viewingPastSessionId
    ? pastSessions.find((session) => session.id === viewingPastSessionId)
    : activeSession;
  // 核心：操作步骤必须严格按发生时间先后（升序）排序，最早操作为第 1 步，最后操作为最后一步
  const replayableEvents = currentEventsList
    .filter((event) =>
      event.type === 'navigation' || event.type === 'click' || event.type === 'input' || event.type === 'scroll'
    )
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const maxReplayIndex = Math.max(0, replayableEvents.length - 1);
  const effectiveStartIndex = Math.min(Math.max(0, replayStartIndex), maxReplayIndex);
  const effectiveEndIndex = replayEndIndex === null
    ? maxReplayIndex
    : Math.min(Math.max(effectiveStartIndex, replayEndIndex), maxReplayIndex);
  const selectedReplayCount = replayableEvents.length > 0 ? effectiveEndIndex - effectiveStartIndex + 1 : 0;

  const replaySession = async (customEvents?: QAEvent[]) => {
    let replayable: QAEvent[] = [];
    if (customEvents && customEvents.length > 0) {
      replayable = customEvents.slice().sort((a, b) => a.timestamp - b.timestamp);
    } else {
      const sessionId = viewedSession?.id;
      let allSessionEvents = currentEventsList;
      if (sessionId) {
        try {
          const fullEvents = await eventRepo.listBySession(sessionId);
          if (fullEvents.length > 0) allSessionEvents = fullEvents;
        } catch {}
      }
      const allReplayable = allSessionEvents
        .filter((event) =>
          event.type === 'navigation' || event.type === 'click' || event.type === 'input' || event.type === 'scroll'
        )
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);
      const start = Math.min(effectiveStartIndex, Math.max(0, allReplayable.length - 1));
      const end = Math.min(effectiveEndIndex, Math.max(0, allReplayable.length - 1));
      replayable = allReplayable.slice(start, end + 1);
    }

    if (replayable.length === 0) {
      setToastMessage('所选范围内没有可回放的操作');
      return;
    }
    setReplayFailures([]);
    setIsReplaying(true);
    setToastMessage(`开始严格回放 ${replayable.length} 个操作...`);

    let targetTabId = viewedSession?.tabId ?? activeSession?.tabId;
    const sessionUrl = viewedSession?.currentUrl || viewedSession?.initialUrl || replayable[0]?.url;

    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      try {
        let isBoundTabAlive = false;
        if (targetTabId !== undefined && chrome.tabs.get) {
          try {
            const boundTab = await chrome.tabs.get(targetTabId);
            if (boundTab?.id !== undefined) {
              isBoundTabAlive = true;
            }
          } catch {
            isBoundTabAlive = false;
          }
        }

        if (!isBoundTabAlive) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const isCapturable = (u?: string) => Boolean(u && (u.startsWith('http://') || u.startsWith('https://')));
          const candidateTab = tabs.find((t) => {
            if (!t.url) return false;
            if (sessionUrl && t.url.startsWith(sessionUrl)) return true;
            return isCapturable(t.url);
          });

          if (candidateTab?.id !== undefined) {
            targetTabId = candidateTab.id;
            if (!candidateTab.active && chrome.tabs.update) {
              await chrome.tabs.update(candidateTab.id, { active: true }).catch(() => {});
            }
          } else if (sessionUrl && isCapturable(sessionUrl) && chrome.tabs.create) {
            const newTab = await chrome.tabs.create({ url: sessionUrl, active: true });
            if (newTab?.id !== undefined) {
              targetTabId = newTab.id;
              await new Promise((resolve) => setTimeout(resolve, 800));
            }
          } else {
            targetTabId = undefined;
          }
        }
      } catch (err) {
        console.warn('[QA Copilot] 探测回放目标标签页失败:', err);
      }
    }

    const result = await sendToBackground<{
      success?: boolean;
      stopped?: boolean;
      failedStep?: number;
      completed?: number;
      total?: number;
      failures?: Array<{ eventId: string; error: string }>;
      error?: string;
    }>({
      type: 'REPLAY_SESSION',
      payload: { events: replayable, stepDelayMs: 700, targetTabId },
    });
    setIsReplaying(false);
    setReplayFailures(result?.failures || []);
    if (result?.success) {
      setToastMessage(`回放完成：${replayable.length} 个操作步骤全部严格执行成功`);
    } else {
      const errorMsg = result?.error || (result?.stopped ? '回放已停止' : '回放执行失败');
      setToastMessage(errorMsg);
    }
  };

  const stopReplay = async () => {
    await sendToBackground({ type: 'STOP_REPLAY', payload: undefined });
    setToastMessage('正在停止回放…');
  };

  const exportPlaywright = async () => {
    const sessionId = viewedSession?.id;
    let allSessionEvents = currentEventsList;
    if (sessionId) {
      try {
        const fullEvents = await eventRepo.listBySession(sessionId);
        if (fullEvents.length > 0) allSessionEvents = fullEvents;
      } catch {}
    }
    if (allSessionEvents.length === 0) {
      setToastMessage('当前 Session 没有可导出的操作事件');
      return;
    }
    const source = PlaywrightSessionExporter.generate(allSessionEvents, viewedSession?.title || 'QA Copilot recorded flow');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/typescript;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `qa-session-${viewedSession?.id || Date.now()}.spec.ts`;
    link.click();
    URL.revokeObjectURL(url);
    setToastMessage(`已导出包含 ${allSessionEvents.length} 步的 Playwright 脚本，请补充业务断言后运行`);
  };

  const filteredEvents = currentEventsList
    .slice()
    .sort((a, b) => (sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp))
    .filter((e) => {
      if (filter === 'action') return e.type === 'click' || e.type === 'input' || e.type === 'scroll' || e.type === 'navigation';
      if (filter === 'api') return (e.payload as { kind?: string }).kind === 'network';
      if (filter === 'error') return e.type === 'error' || (e.type === 'console' && (e.payload as { level?: string })?.level === 'error');
      return true;
    });

  const getEventIcon = (event: QAEvent) => {
    switch (event.type) {
      case 'navigation':
        return <Compass className="w-3.5 h-3.5 text-blue-500" />;
      case 'click':
        return <MousePointer2 className="w-3.5 h-3.5 text-indigo-500" />;
      case 'input':
        return <PenTool className="w-3.5 h-3.5 text-purple-500" />;
      case 'scroll':
        return <MoveVertical className="w-3.5 h-3.5 text-cyan-600" />;
      case 'error':
        return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
      case 'console':
        return <FileCode2 className="w-3.5 h-3.5 text-amber-500" />;
      default:
        return <Send className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 pb-20">
      {/* 顶部标题与返回 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (viewingPastSessionId) {
                setViewingPastSessionId(null);
              } else {
                setCurrentTab('home');
              }
            }}
            className="p-1 text-slate-500 hover:text-slate-800 rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-900">
            {viewingPastSessionId ? '历史 Session 时间线' : activeSession ? '当前测试时间线' : '历史测试会话'}
          </h2>
        </div>
        {(activeSession || viewingPastSessionId) && (
          <div className="flex items-center gap-2">
            <button onClick={exportPlaywright} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600">
              <Download className="w-3.5 h-3.5" /> Playwright
            </button>
          </div>
        )}
      </div>

      {(activeSession || viewingPastSessionId) && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-indigo-900">操作录制与回放</div>
              <div className="text-[10px] text-indigo-700 mt-0.5">
                已录制 {replayableEvents.length} 个操作步骤，点击一键严格复现
              </div>
            </div>
            {replayInProgress ? (
              <button
                onClick={stopReplay}
                className="shrink-0 px-3 py-2 bg-red-600 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shadow-sm"
              >
                <Square className="w-3.5 h-3.5" />停止
              </button>
            ) : (
              <button
                onClick={() => replaySession()}
                disabled={replayableEvents.length === 0}
                className="shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shadow-sm transition-all active:scale-95"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                <span>
                  {selectedReplayCount === replayableEvents.length
                    ? '一键回放'
                    : `回放 (${effectiveStartIndex + 1}~${effectiveEndIndex + 1}) 步`}
                </span>
              </button>
            )}
          </div>

          {/* 步骤范围选择器 */}
          {replayableEvents.length > 1 && (
            <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-indigo-200/80 text-[11px] text-indigo-950 flex-wrap">
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-semibold shrink-0 text-indigo-900">范围:</span>
                <select
                  value={effectiveStartIndex}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setReplayStartIndex(val);
                    if (val > effectiveEndIndex) setReplayEndIndex(val);
                  }}
                  className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[10px] font-mono text-indigo-900 focus:outline-none max-w-[110px] truncate"
                >
                  {replayableEvents.map((evt, idx) => (
                    <option key={evt.id} value={idx}>
                      第{idx + 1}步: {evt.title}
                    </option>
                  ))}
                </select>
                <span className="text-indigo-400">~</span>
                <select
                  value={effectiveEndIndex}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setReplayEndIndex(val);
                    if (val < effectiveStartIndex) setReplayStartIndex(val);
                  }}
                  className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[10px] font-mono text-indigo-900 focus:outline-none max-w-[110px] truncate"
                >
                  {replayableEvents.map((evt, idx) => (
                    <option key={evt.id} value={idx}>
                      第{idx + 1}步: {evt.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(effectiveStartIndex !== 0 || effectiveEndIndex !== replayableEvents.length - 1) && (
                  <button
                    onClick={() => {
                      setReplayStartIndex(0);
                      setReplayEndIndex(replayableEvents.length - 1);
                    }}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-semibold"
                  >
                    重置全选
                  </button>
                )}
                <span className="text-[10px] font-mono font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                  选定 {selectedReplayCount} 步
                </span>
              </div>
            </div>
          )}

          {replayFailures.length > 0 && (
            <div className="border-t border-rose-200 pt-2 text-[10px]">
              <div className="font-semibold text-rose-700 mb-1">回放失败详情:</div>
              <div className="flex flex-col gap-1">
                {replayFailures.map((failure) => {
                  const event = replayableEvents.find((item) => item.id === failure.eventId);
                  return (
                    <div key={failure.eventId} className="rounded bg-rose-50 border border-rose-200 p-1.5 text-rose-800 font-medium">
                      {event?.title || event?.description || failure.eventId}：{failure.error}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 活动 Session 或历史切换 */}
      {activeSession && !viewingPastSessionId ? (
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col gap-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            {editingSessionId === activeSession.id ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editTitleInput}
                  onChange={(e) => setEditTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle(activeSession.id);
                    if (e.key === 'Escape') setEditingSessionId(null);
                  }}
                  autoFocus
                  className="px-2 py-0.5 text-xs font-bold border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                />
                <button
                  onClick={() => handleSaveTitle(activeSession.id)}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  title="保存"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setEditingSessionId(null)}
                  className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                  title="取消"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="font-bold text-slate-900 truncate">{activeSession.title}</span>
                <button
                  onClick={(e) => handleStartEdit(e, activeSession.id, activeSession.title)}
                  className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors shrink-0"
                  title="修改会话名称"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full shrink-0">
              进行中
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500 text-[11px] pt-1 border-t border-slate-100">
            <span>环境: <strong className="text-slate-700">{activeSession.environment}</strong></span>
            <span>浏览器: <strong className="text-slate-700">{activeSession.browserInfo.browserName}</strong></span>
          </div>
        </div>
      ) : viewingPastSessionId ? (
        <div className="bg-slate-100 p-2.5 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
            <span className="text-slate-600 shrink-0">历史会话:</span>
            <strong className="text-slate-800 truncate">{viewedSession?.title || viewingPastSessionId}</strong>
            {viewedSession && (
              <button
                onClick={(e) => handleStartEdit(e, viewedSession.id, viewedSession.title)}
                className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors shrink-0"
                title="修改会话名称"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={() => setViewingPastSessionId(null)}
            className="text-blue-600 hover:text-blue-700 font-semibold text-[11px] shrink-0"
          >
            退出历史
          </button>
        </div>
      ) : (
        /* 展示历史 Session 列表 */
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <History className="w-4 h-4 text-blue-600" />
              <span>历史测试会话 (近期)</span>
            </span>
            <span className="text-[11px] text-slate-400">{pastSessions.length} 条</span>
          </div>

          {pastSessions.length === 0 ? (
            <div className="py-4 text-center text-slate-400 text-xs">
              暂无历史测试 Session，在首页点击「开始测试」开启
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {pastSessions.map((ps) => (
                <div
                  key={ps.id}
                  onClick={() => handleSelectPastSession(ps.id)}
                  className="py-2 flex items-center justify-between hover:bg-slate-50 px-1 rounded cursor-pointer transition-colors group"
                >
                  <div className="flex flex-col min-w-0 flex-1 mr-2">
                    {editingSessionId === ps.id ? (
                      <div className="flex items-center gap-1.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editTitleInput}
                          onChange={(e) => setEditTitleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTitle(ps.id);
                            if (e.key === 'Escape') setEditingSessionId(null);
                          }}
                          autoFocus
                          className="px-2 py-0.5 text-xs font-semibold border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                        />
                        <button
                          onClick={() => handleSaveTitle(ps.id)}
                          className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                          title="保存"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingSessionId(null)}
                          className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                          title="取消"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-slate-800 truncate">{ps.title}</span>
                        <button
                          onClick={(e) => handleStartEdit(e, ps.id, ps.title)}
                          className="p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 rounded transition-all shrink-0"
                          title="修改会话名称"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(ps.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                      操作 {ps.stats.actionCount}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${ps.stats.errorCount > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                      异常 {ps.stats.errorCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {viewingPastSessionId && (
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 text-xs">问题快照</span>
            <span className="text-[10px] text-slate-400">{pastSnapshots.length} 条</span>
          </div>
          {pastSnapshots.length === 0 ? (
            <span className="text-[11px] text-slate-400 py-2">该 Session 没有问题快照</span>
          ) : (
            pastSnapshots.map((snapshot) => (
              <button
                key={snapshot.id}
                onClick={() => openPastSnapshot(snapshot)}
                className="flex items-center justify-between gap-2 p-2 bg-slate-50 hover:bg-blue-50 rounded-lg text-left"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] text-slate-700 truncate">{snapshot.id}</span>
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {new Date(snapshot.createdAt).toLocaleString()} · 事件 {snapshot.summary.eventCount}
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                  snapshot.summary.errorCount > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-200 text-slate-500'
                }`}>
                  异常 {snapshot.summary.errorCount}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 仅在测试进行中或查看历史 Session 详情时，才展示时间线过滤 Tabs 与事件流 */}
      {(activeSession || viewingPastSessionId) && (
        <>
          {/* 过滤切换 Tabs 与时间排序 */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg text-xs font-medium text-slate-600 flex-1 min-w-0">
              <button
                onClick={() => setFilter('all')}
                className={`flex-1 py-1 rounded-md transition-colors ${
                  filter === 'all' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'hover:text-slate-900'
                }`}
              >
                时间线
              </button>
              <button
                onClick={() => setFilter('action')}
                className={`flex-1 py-1 rounded-md transition-colors ${
                  filter === 'action' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'hover:text-slate-900'
                }`}
              >
                操作 ({currentEventsList.filter((e) => e.type === 'click' || e.type === 'input' || e.type === 'scroll' || e.type === 'navigation').length})
              </button>
              <button
                onClick={() => setFilter('api')}
                className={`flex-1 py-1 rounded-md transition-colors ${
                  filter === 'api' ? 'bg-white text-blue-600 shadow-sm font-bold' : 'hover:text-slate-900'
                }`}
              >
                接口 ({currentEventsList.filter((e) => (e.payload as { kind?: string }).kind === 'network').length})
              </button>
              <button
                onClick={() => setFilter('error')}
                className={`flex-1 py-1 rounded-md transition-colors ${
                  filter === 'error' ? 'bg-white text-red-600 shadow-sm font-bold' : 'hover:text-slate-900'
                }`}
              >
                异常 ({currentEventsList.filter((e) => e.type === 'error').length})
              </button>
            </div>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-mono shrink-0 flex items-center gap-1 transition-colors border border-slate-200"
              title={sortOrder === 'asc' ? '当前时间正序 (1→N)，点击切换倒序' : '当前时间倒序 (最新在顶)，点击切换正序'}
            >
              <ArrowUpDown className="w-3 h-3 text-slate-500" />
              <span>{sortOrder === 'asc' ? '1→N' : '最新'}</span>
            </button>
          </div>

          {/* 时间线列表 */}
          <div className="flex flex-col gap-2 pt-1">
            {filteredEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                暂无事件，操作页面后将在此处实时显示
              </div>
            ) : (
              <div className="relative pl-6 flex flex-col gap-3 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {filteredEvents.map((evt) => {
                  const timeStr = new Date(evt.timestamp).toTimeString().slice(0, 8);
                  const isErr = evt.type === 'error' || (evt.type === 'console' && (evt.payload as { level?: string })?.level === 'error');
                  const severity = (evt.payload as { severity?: 'high' | 'medium' | 'low' }).severity;
                  const replayStepIdx = replayableEvents.findIndex((item) => item.id === evt.id);

                  return (
                    <div key={evt.id} className="relative flex items-start justify-between gap-2 text-xs group">
                      <div
                        className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-xs ${
                          isErr ? 'bg-red-100' : 'bg-slate-100'
                        }`}
                      >
                        {getEventIcon(evt)}
                      </div>

                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-semibold text-slate-800">{evt.title}</span>
                          <span className="text-[10px] font-mono text-slate-400">{timeStr}</span>
                          {replayStepIdx !== -1 && (
                            <span className="text-[9px] font-mono text-indigo-500 bg-indigo-50/80 px-1 rounded">
                              步 {replayStepIdx + 1}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500 truncate mt-0.5">
                          {evt.description}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {replayStepIdx !== -1 && (
                          <button
                            onClick={() => {
                              setReplayStartIndex(replayStepIdx);
                              setReplayEndIndex(replayableEvents.length - 1);
                              replaySession(replayableEvents.slice(replayStepIdx));
                            }}
                            className="opacity-0 group-hover:opacity-100 text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1 transition-all font-medium"
                            title={`从第 ${replayStepIdx + 1} 步开始回放到结尾`}
                          >
                            <PlayCircle className="w-3 h-3" />
                            <span>此处回放</span>
                          </button>
                        )}

                        {isErr && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                            <AlertCircle className="w-3 h-3" />
                            {severity === 'medium' ? '中' : severity === 'low' ? '低' : '高'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
