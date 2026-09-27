/**
 * Side Panel 首页 (对齐设计图 1: 首页 测试状态总览与快速入口)
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertOctagon,
  Bot,
  Camera,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Play,
  Settings,
  Sparkles,
  Square,
  Video,
  Pin,
  PinOff,
  PanelRightClose,
  ExternalLink,
} from 'lucide-react';
import { sendToBackground } from '../../shared/messages';
import { useAppStore } from '../store/useAppStore';
import { recordingService } from '../services/recordingService';
import { pipService } from '../services/pipService';
import { QuickLoginCard } from '../components/QuickLoginCard';

export const HomePage: React.FC = () => {
  const {
    activeTask,
    activeSession,
    recentAnomalies,
    isCapturing,
    startSession,
    stopSession,
    triggerSnapshot,
    setCurrentTab,
    setAiSubTab,
    setSettingsSubTab,
    setToastMessage,
  } = useAppStore();

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(pipService.isAlwaysOnTop());
  const [nlInstruction, setNlInstruction] = useState('');
  const [isNlRunning, setIsNlRunning] = useState(false);
  const hasActiveRun = activeTask?.type === 'runner_test' && ['running', 'cancelling', 'queued'].includes(activeTask.status);

  const handleQuickRunNl = async () => {
    const goal = nlInstruction.trim();
    if (!goal) {
      setToastMessage('请先描述要执行的测试目标');
      return;
    }
    useAppStore.setState({ lastRunnerTask: null });
    setIsNlRunning(true);
    try {
      const result = await sendToBackground<{ success?: boolean; error?: string; failedStep?: number; cancelled?: boolean }>({
        type: 'RUN_NATURAL_LANGUAGE_TEST',
        payload: { instruction: goal },
      });
      if (result?.error) {
        setToastMessage(`自动化执行失败：${result.error}`);
      } else if (result?.success) {
        setToastMessage('自然语言自动化任务完成');
      } else if (result?.cancelled) {
        setToastMessage('任务已取消');
      }
    } catch (error) {
      const message = (error as Error).message || '无法连接后台';
      setToastMessage(`自动化执行失败：${message}`);
    } finally {
      setIsNlRunning(false);
    }
  };

  const handleToggleAlwaysOnTop = async () => {
    const nextState = await pipService.toggleAlwaysOnTop();
    setIsAlwaysOnTop(nextState);
  };

  useEffect(() => {
    setIsAlwaysOnTop(pipService.isAlwaysOnTop());
    const unsub = pipService.subscribePip((win) => {
      setIsAlwaysOnTop(Boolean(win) || pipService.isAlwaysOnTop());
    });
    const handleAlwaysOnTopChanged = (e: any) => {
      if (typeof e.detail?.enabled === 'boolean') {
        setIsAlwaysOnTop(e.detail.enabled);
      } else {
        setIsAlwaysOnTop(pipService.isAlwaysOnTop());
      }
    };
    window.addEventListener('PIP_ALWAYS_ON_TOP_CHANGED', handleAlwaysOnTopChanged);
    return () => {
      unsub();
      window.removeEventListener('PIP_ALWAYS_ON_TOP_CHANGED', handleAlwaysOnTopChanged);
    };
  }, []);

  useEffect(() => {
    setIsRecording(recordingService.getStatus().active);
    return recordingService.subscribe((nextStatus) => setIsRecording(nextStatus.active));
  }, []);

  // 缺陷 3: 侧边栏打开或 Session 切换时，主动检查并自动恢复异常中断的录屏分片
  useEffect(() => {
    if (!activeSession?.id) return;
    let isMounted = true;
    recordingService
      .checkAndAutoRecover(activeSession.id, activeSession.tabId ?? 0, activeSession.currentUrl)
      .then((recovered) => {
        if (isMounted && recovered) {
          setToastMessage('🎉 检测到上次未完成的录屏分片，已自动恢复保存！');
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [activeSession?.id]);

  // 计时器
  useEffect(() => {
    if (!activeSession?.startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => {
      const diff = Math.floor((Date.now() - activeSession.startedAt) / 1000);
      setElapsedSeconds(Math.max(0, diff));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeSession?.startedAt]);

  const formatTimer = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  };

  const handleQuickScreenshot = async () => {
    setToastMessage('正在截取可视区域...');
    const res = await sendToBackground<{ dataUrl?: string; error?: string }>({
      type: 'TAKE_SCREENSHOT',
      payload: undefined,
    });
    if (res?.dataUrl) {
      setToastMessage('页面截图已成功截取并关联至当前 Session！');
    } else {
      setToastMessage(res?.error ? `截图提示: ${res.error}` : '已完成屏幕捕捉');
    }
  };

  const handleRecording = async () => {
    if (!isRecording) {
      if (!activeSession?.id || activeSession.tabId === undefined) {
        setToastMessage('请先开始测试 Session');
        return;
      }
      try {
        setToastMessage('请选择正在测试的网页标签页');
        const result = await recordingService.start({
          sessionId: activeSession.id,
          tabId: activeSession.tabId,
          url: activeSession.currentUrl,
        });
        if (result.active) {
          setIsRecording(true);
          setToastMessage('已开始录制所选网页标签页；请保持插件侧边栏打开');
        }
      } catch (error) {
        const domError = error as DOMException;
        setToastMessage(domError.name === 'NotAllowedError'
          ? '已取消录屏或未允许共享页面'
          : `无法开始录屏：${domError.message || '浏览器拒绝了录屏请求'}`);
      }
      return;
    }
    try {
      const recording = await recordingService.stop();
      setIsRecording(false);
      if (recording) {
        const url = URL.createObjectURL(recording.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `qa-recording-${recording.id}.webm`;
        link.click();
        URL.revokeObjectURL(url);
        setToastMessage('录屏已保存到 Session 并下载');
      }
    } catch (error) {
      setToastMessage((error as Error).message || '无法停止录屏');
    }
  };

  const handleStopSession = async () => {
    if (isRecording) await handleRecording();
    await stopSession();
  };

  return (
    <div className="flex flex-col gap-3 p-4 pb-20">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold shadow-sm">
            <span className="text-base tracking-tighter">Q</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">QA Copilot</h1>
            <span className="text-[11px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">V1.0.9</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 置顶按钮 (仅在小窗模式下显示，吸附状态不显示) */}
          {pipService.isDetachedMode() && (
            <button
              type="button"
              onClick={handleToggleAlwaysOnTop}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all border shadow-2xs ${
                isAlwaysOnTop
                  ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-amber-600 hover:border-amber-200'
              }`}
              title={
                isAlwaysOnTop
                  ? '已开启置顶 (小窗保持在屏幕最前端，点击取消置顶)'
                  : '开启小窗置顶 (保持小窗悬浮在最前)'
              }
            >
              {isAlwaysOnTop ? (
                <>
                  <PinOff className="w-3.5 h-3.5 text-amber-600" />
                  <span>已置顶</span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 text-slate-600" />
                  <span>置顶</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (pipService.isDetachedMode()) {
                pipService.attachToSidePanel();
              } else {
                pipService.detachToWindow();
              }
            }}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all border shadow-2xs ${
              pipService.isDetachedMode()
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200'
            }`}
            title={pipService.isDetachedMode() ? '恢复吸附到浏览器右边栏' : '脱离为独立桌面悬浮小窗并自动收起右侧栏'}
          >
            {pipService.isDetachedMode() ? (
              <>
                <PanelRightClose className="w-3.5 h-3.5 text-white" />
                <span>恢复吸附</span>
              </>
            ) : (
              <>
                <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                <span>悬浮小窗</span>
              </>
            )}
          </button>
          <button
            onClick={() => setCurrentTab('settings')}
            className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            title="系统设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 测试状态卡片 */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4 text-white shadow-md shadow-blue-500/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
            {activeSession ? (
              <span className="flex h-2.5 w-2.5 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
              </span>
            ) : (
              <span className="inline-flex rounded-full h-2.5 w-2.5 bg-slate-400 shrink-0" />
            )}
            <span
              className="text-sm font-semibold tracking-wide truncate"
              title={
                activeSession
                  ? (activeSession.title || '').replace(/\s*\((?:商城系统|默认项目)[-_]?(?:TEST|DEV|UAT|PROD)?\)/gi, '').trim() || activeSession.title
                  : undefined
              }
            >
              {activeSession
                ? (activeSession.title || '').replace(/\s*\((?:商城系统|默认项目)[-_]?(?:TEST|DEV|UAT|PROD)?\)/gi, '').trim() || activeSession.title
                : '未开始测试'}
            </span>
          </div>
          <span className="text-xs font-mono font-medium bg-blue-800/40 px-2 py-0.5 rounded text-blue-100 shrink-0">
            {formatTimer(elapsedSeconds)}
          </span>
        </div>

        {activeSession ? (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-blue-500/40 text-center">
            <div className="flex flex-col">
              <span className="text-[11px] text-blue-100/80">操作</span>
              <span className="text-lg font-bold">{activeSession.stats.actionCount}</span>
            </div>
            <div className="flex flex-col border-x border-blue-500/30">
              <span className="text-[11px] text-blue-100/80">API</span>
              <span className="text-lg font-bold">{activeSession.stats.apiCount}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] text-blue-100/80">异常</span>
              <span className={`text-lg font-bold ${activeSession.stats.errorCount > 0 ? 'text-amber-300' : ''}`}>
                {activeSession.stats.errorCount}
              </span>
            </div>
          </div>
        ) : (
          <div className="py-2 text-center text-xs text-blue-100/90">
            点击下方按钮开启全自动操作、接口与异常记录
          </div>
        )}
      </div>

      {/* 核心操作按钮 */}
      {activeSession ? (
        <div className="flex flex-col gap-2">
          {/* 主按钮：发现问题 */}
          <button
            onClick={triggerSnapshot}
            disabled={isCapturing}
            className="w-full py-3 px-4 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-bold rounded-xl shadow-md shadow-red-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-[0.99]"
          >
            <AlertOctagon className="w-5 h-5 animate-pulse" />
            <span className="text-sm tracking-wide">
              {isCapturing ? '正在固化现场...' : '🚨 发现问题'}
            </span>
          </button>

          {/* 次要操作行 */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleQuickScreenshot}
              className="py-2 px-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Camera className="w-4 h-4 text-slate-500" />
              <span>截图</span>
            </button>
            <button
              onClick={handleRecording}
              className={`py-2 px-2 border text-xs font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors shadow-sm ${
                isRecording ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              <Video className={`w-4 h-4 ${isRecording ? 'animate-pulse' : 'text-purple-600'}`} />
              <span>{isRecording ? '停止录屏' : '录屏'}</span>
            </button>
            <button
              onClick={handleStopSession}
              className="py-2 px-3 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-700 hover:text-red-600 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Square className="w-4 h-4 text-red-500" />
              <span>结束测试</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => startSession()}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-[0.99]"
        >
          <Play className="w-5 h-5 fill-current" />
          <span className="text-sm tracking-wide">开始测试</span>
        </button>
      )}

      {/* 快捷工具栏 */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            setAiSubTab('formFill');
            setCurrentTab('ai');
          }}
          className="flex flex-col items-center justify-center p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-blue-50/50 hover:border-blue-200 transition-colors shadow-xs text-center cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4 text-blue-600 mb-1" />
          <span className="text-[11px] font-medium text-slate-700">智能填表</span>
        </button>
        <button
          onClick={() => {
            setAiSubTab('agent');
            setCurrentTab('ai');
          }}
          className="flex flex-col items-center justify-center p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-violet-50/50 hover:border-violet-200 transition-colors shadow-xs text-center cursor-pointer"
        >
          <Bot className="w-4 h-4 text-violet-600 mb-1" />
          <span className="text-[11px] font-medium text-slate-700">自然语言测试</span>
        </button>
      </div>

      {/* 首页自然语言测试快捷卡片 */}
      <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md bg-violet-100 flex items-center justify-center text-violet-600">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-800">自然语言测试</span>
            <span className="text-[10px] font-semibold bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
              AI Agent
            </span>
          </div>
          <button
            onClick={() => {
              setAiSubTab('agent');
              setCurrentTab('ai');
            }}
            className="text-[11px] text-violet-600 hover:text-violet-700 flex items-center font-medium cursor-pointer"
          >
            完整面板 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={nlInstruction}
            onChange={(e) => setNlInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isNlRunning && !hasActiveRun) {
                handleQuickRunNl();
              }
            }}
            placeholder="描述测试目标，如：在搜索框中输入 QA Copilot 并提交"
            disabled={isNlRunning || hasActiveRun}
            className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 focus:bg-white placeholder:text-slate-400"
          />
          <button
            onClick={handleQuickRunNl}
            disabled={isNlRunning || hasActiveRun || !nlInstruction.trim()}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors shrink-0 shadow-xs cursor-pointer disabled:cursor-not-allowed"
          >
            {isNlRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>执行中</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>执行</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 最近异常模块 */}
      <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-800">最近异常</span>
            {recentAnomalies.length > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.2 rounded-full">
                {recentAnomalies.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setCurrentTab('test')}
            className="text-[11px] text-blue-600 hover:text-blue-700 flex items-center font-medium"
          >
            查看全部 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>

        {recentAnomalies.length === 0 ? (
          <div className="py-4 text-center text-slate-400 text-xs flex flex-col items-center gap-1">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 mb-0.5" />
            <span>当前没有检测到未处理异常</span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {recentAnomalies.map((ano) => (
              <div key={ano.id} className="py-2 flex items-start justify-between gap-2 text-xs">
                <div className="flex items-start gap-1.5 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-slate-800 truncate">{ano.title}</span>
                    <span className="text-[11px] text-slate-500 truncate">{ano.description}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                    {(ano.payload as { severity?: string }).severity === 'medium' ? '中' : '高'}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(ano.timestamp).toTimeString().slice(0, 8)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 快捷环境直达与登录 */}
      <QuickLoginCard
        onToast={setToastMessage}
        onNavigateToSettings={() => {
          setSettingsSubTab('quickLogin');
          setCurrentTab('settings');
        }}
      />
    </div>
  );
};
