/**
 * Side Panel 主容器与底部导航栏 (对齐设计图底部 Tab 栏)
 */

import React, { useEffect } from 'react';
import {
  Activity,
  Bot,
  Bug,
  CheckCircle2,
  Home,
  Settings,
  Terminal,
  X,
  Loader2,
  StopCircle,
  PanelRightClose,
} from 'lucide-react';
import { NavTab, useAppStore } from './store/useAppStore';
import { pipService } from './services/pipService';
import { HomePage } from './pages/HomePage';
import { TimelinePage } from './pages/TimelinePage';
import { SnapshotPage } from './pages/SnapshotPage';
import { BugEditPage } from './pages/BugEditPage';
import { BugPage } from './pages/BugPage';
import { AiCasesPage } from './pages/AiCasesPage';
import { ApiPage } from './pages/ApiPage';
import { SettingsPage } from './pages/SettingsPage';
import { ExtensionMessage } from '../shared/messages';
import { AIProviderMode, aiProviderService } from '../ai';

export const App: React.FC = () => {
  const {
    currentTab,
    activeView,
    toastMessage,
    activeTask,
    setCurrentTab,
    setToastMessage,
    cancelActiveTask,
    initSession,
    handleIncomingEvent,
  } = useAppStore();

  const isDetached = pipService.isDetachedMode();
  const activeTaskStep = activeTask
    ? activeTask.steps.find((step) => step.status === 'running') || activeTask.steps[Math.max(0, activeTask.currentStep - 1)]
    : null;

  const togglePipMode = async () => {
    if (isDetached) {
      await pipService.attachToSidePanel();
    } else {
      await pipService.detachToWindow();
    }
  };

  useEffect(() => {
    const handleToggleEvent = () => {
      togglePipMode();
    };
    window.addEventListener('TOGGLE_PIP_MODE', handleToggleEvent);
    return () => {
      window.removeEventListener('TOGGLE_PIP_MODE', handleToggleEvent);
    };
  }, [isDetached]);

  useEffect(() => {
    // 初始化检查 AI Provider 配置
    chrome.storage?.local?.get?.([
      'aiProviderMode',
      'aiBaseUrl',
      'aiApiKey',
      'aiModel',
      'aiRemoteEndpoint',
      'enterpriseGatewayUrl',
    ])?.then?.((items) => {
      if (items?.aiProviderMode) {
        aiProviderService.configure(
          items.aiProviderMode as AIProviderMode,
          {
            baseUrl: items.aiBaseUrl || items.aiRemoteEndpoint || items.enterpriseGatewayUrl,
            apiKey: items.aiApiKey,
            model: items.aiModel,
          }
        );
      }
    });
    initSession();

    // 监听 Background 广播的消息
    const messageListener = (message: ExtensionMessage) => {
      if (message.type === 'EVENT_RECORDED') {
        handleIncomingEvent(message.payload.event, message.payload.sessionStats);
      } else if (message.type === 'NETWORK_RECORDED') {
        useAppStore.getState().handleIncomingNetwork(
          message.payload.request,
          message.payload.timelineEvent,
          message.payload.sessionStats
        );
      } else if (message.type === 'CURRENT_SESSION_RESPONSE') {
        useAppStore.setState({ activeSession: message.payload.session });
      } else if (message.type === 'SNAPSHOT_CREATED') {
        useAppStore.setState({
          currentSnapshot: message.payload.snapshot,
          activeView: 'snapshot_result',
        });
      } else if (message.type === 'ELEMENT_INSPECTED') {
        useAppStore.setState({
          inspectedElement: message.payload.element,
          currentTab: 'ai',
          aiSubTab: 'dom',
          activeView: 'main',
          toastMessage: '已解析页面元素并生成 Locator',
        });
      } else if (message.type === 'TASK_STATUS_UPDATED') {
        const task = message.payload.task;
        const isAlive = task.status === 'running' || task.status === 'cancelling' || task.status === 'queued';
        useAppStore.setState((state) => ({
          activeTask: isAlive ? task : null,
          ...(task.type === 'runner_test'
            ? { lastRunnerTask: isAlive ? null : task }
            : { lastRunnerTask: state.lastRunnerTask }),
        }));
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };
  }, [initSession, handleIncomingEvent]);

  // 自动隐藏 Toast
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, setToastMessage]);

  const navItems: { tab: NavTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'home', label: '首页', icon: <Home className="w-4 h-4" /> },
    { tab: 'test', label: '测试', icon: <Activity className="w-4 h-4" /> },
    { tab: 'bug', label: 'Bug', icon: <Bug className="w-4 h-4" /> },
    { tab: 'api', label: 'API', icon: <Terminal className="w-4 h-4" /> },
    { tab: 'ai', label: 'AI助手', icon: <Bot className="w-4 h-4" /> },
    { tab: 'settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
  ];

  const renderContent = () => {
    if (activeView === 'snapshot_result') {
      return <SnapshotPage />;
    }
    if (activeView === 'bug_editor') {
      return <BugEditPage />;
    }

    switch (currentTab) {
      case 'home':
        return <HomePage />;
      case 'test':
        return <TimelinePage />;
      case 'bug':
        return <BugPage />;
      case 'api':
        return <ApiPage />;
      case 'ai':
        return <AiCasesPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="relative flex flex-col min-h-screen bg-slate-50">
      {/* 独立悬浮窗模式下的顶部状态与恢复吸附条 */}
      {isDetached && (
        <div className="sticky top-0 z-50 bg-slate-900 text-white px-3 py-1.5 text-[11px] flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-1.5 text-blue-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>独立悬浮运行中 (右侧栏已收起)</span>
          </div>
          <button
            type="button"
            onClick={togglePipMode}
            className="text-slate-200 hover:text-white flex items-center gap-1 text-[10px] bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 transition-colors font-medium shadow-xs"
            title="关闭独立浮窗并重新吸附到浏览器右侧栏"
          >
            <PanelRightClose className="w-3.5 h-3.5 text-blue-400" />
            <span>恢复吸附到右边</span>
          </button>
        </div>
      )}

        {/* Toast 提示浮条 */}
        {toastMessage && (
          <div className="fixed top-3 left-4 right-4 z-50 flex items-center justify-between p-2.5 bg-slate-900/90 text-white rounded-xl shadow-lg backdrop-blur-xs text-xs animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-medium">{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 全局活动任务指示条 (Replay / Form Fill / etc.) */}
        {activeTask && (
          <div className="sticky top-0 z-40 bg-blue-600 text-white px-3 py-2 text-xs flex items-center justify-between shadow-xs transition-all">
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-blue-200" />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="font-semibold mr-1.5">
                    {activeTask.type === 'replay' ? '回放中' : activeTask.type === 'form_fill' ? '填表中' : '执行中'}:
                  </span>
                  <span className="text-blue-100">{activeTask.title}</span>
                  {activeTask.totalSteps ? (
                    <span className="ml-1.5 text-blue-200 text-[11px]">
                      ({activeTask.currentStep}/{activeTask.totalSteps})
                    </span>
                  ) : null}
                </div>
                {activeTask.type === 'runner_test' && activeTaskStep?.detail && (
                  <div className="truncate text-[10px] text-blue-100" title={activeTaskStep.detail}>
                    {activeTaskStep.detail}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => cancelActiveTask()}
              disabled={activeTask.status === 'cancelling'}
              className="flex items-center gap-1 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white px-2 py-1 rounded text-[11px] font-medium shrink-0 transition-colors"
            >
              <StopCircle className="w-3 h-3" />
              <span>{activeTask.status === 'cancelling' ? '正在停止...' : '停止'}</span>
            </button>
          </div>
        )}

        {/* 主视图内容 */}
        <main className="flex-1 overflow-y-auto">
          {renderContent()}
        </main>

        {/* 底部固定导航栏 */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 flex items-center justify-around py-1.5 px-2">
          {navItems.map((item) => {
            const isActive = currentTab === item.tab && activeView === 'main';
            return (
              <button
                key={item.tab}
                onClick={() => setCurrentTab(item.tab)}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors text-[10px] font-medium ${
                  isActive
                    ? 'text-blue-600 font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <div className="mb-0.5">{item.icon}</div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
  );
};
