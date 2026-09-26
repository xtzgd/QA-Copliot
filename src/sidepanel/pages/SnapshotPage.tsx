/**
 * 发现问题 (快照成功反馈页) - 对齐设计图 3: 发现问题 (快照) 一键保存问题现场
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileCode2, History, Monitor, RefreshCw, Terminal } from 'lucide-react';
import { snapshotRepo } from '../../db/repositories/snapshotRepository';
import { screenshotRepo } from '../../db/repositories/screenshotRepository';
import { sendToBackground } from '../../shared/messages';
import { useAppStore } from '../store/useAppStore';
import { createEntityId } from '../../shared/utils/id';

export const SnapshotPage: React.FC = () => {
  const { currentSnapshot, setActiveView, setCurrentTab, setToastMessage } = useAppStore();
  const [isRetaking, setIsRetaking] = useState(false);
  const [isCollectingContext, setIsCollectingContext] = useState(
    Boolean(currentSnapshot?.captureUntil && currentSnapshot.captureUntil > Date.now())
  );

  useEffect(() => {
    if (!currentSnapshot?.captureUntil || currentSnapshot.captureUntil <= Date.now()) {
      setIsCollectingContext(false);
      return;
    }
    setIsCollectingContext(true);
    const delay = currentSnapshot.captureUntil - Date.now() + 100;
    const timer = setTimeout(async () => {
      const finalized = await snapshotRepo.getSnapshotById(currentSnapshot.id);
      if (finalized && useAppStore.getState().currentSnapshot?.id === finalized.id) {
        useAppStore.setState({ currentSnapshot: finalized });
      }
      setIsCollectingContext(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [currentSnapshot?.id, currentSnapshot?.captureUntil]);

  if (!currentSnapshot) {
    return (
      <div className="p-4 text-center text-slate-500 text-xs">
        <p>暂无快照数据</p>
        <button
          onClick={() => setActiveView('main')}
          className="mt-3 text-blue-600 font-medium"
        >
          返回首页
        </button>
      </div>
    );
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const operationEvents = currentSnapshot.events
    .filter((event) => ['click', 'input', 'navigation', 'screenshot'].includes(event.type))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const recentOperations = operationEvents.slice(-8);
  const recentRequests = currentSnapshot.networkRequests.slice(-8).reverse();
  const recentConsoleErrors = currentSnapshot.consoleErrors.slice(-8).reverse();

  const retakeScreenshot = async () => {
    setIsRetaking(true);
    const result = await sendToBackground<{ dataUrl?: string; error?: string }>({
      type: 'TAKE_SCREENSHOT',
      payload: { persistToSession: false },
    });
    if (result?.dataUrl) {
      const screenshotId = createEntityId('shot');
      await screenshotRepo.add({
        id: screenshotId,
        sessionId: currentSnapshot.sessionId,
        snapshotId: currentSnapshot.id,
        createdAt: Date.now(),
        url: currentSnapshot.url,
        dataUrl: result.dataUrl,
      });
      await snapshotRepo.updateSnapshot(currentSnapshot.id, { screenshotUrl: result.dataUrl, screenshotId });
      useAppStore.setState({ currentSnapshot: { ...currentSnapshot, screenshotUrl: result.dataUrl, screenshotId } });
      setToastMessage('截图已更新并关联至当前问题快照');
    } else {
      setToastMessage(result?.error || '截图失败，请切换到可截图的网页后重试');
    }
    setIsRetaking(false);
  };

  return (
    <div className="flex flex-col gap-3 p-4 pb-20">
      {/* 顶部返回 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveView('main')}
          className="p-1 text-slate-500 hover:text-slate-800 rounded-md"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-bold text-slate-900">发现问题</h2>
      </div>

      {/* 核心成功标志 */}
      <div className="flex flex-col items-center justify-center py-5 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mb-2">
          <CheckCircle2 className="w-9 h-9 stroke-[2.5]" />
        </div>
        <h3 className="text-base font-bold text-slate-900">已保存问题现场</h3>
        <p className="text-xs text-slate-500 mt-1">问题快照已保存，您可以继续测试</p>
        <span className={`mt-2 text-[10px] font-semibold px-2 py-1 rounded-full ${
          isCollectingContext ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-700'
        }`}>
          {isCollectingContext ? '正在补充问题后 10 秒上下文…' : '上下文采集已完成'}
        </span>
      </div>

      {/* 快照详情卡片 */}
      <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm flex flex-col gap-3 text-xs">
        <span className="font-bold text-slate-800">快照信息</span>

        <div className="grid grid-cols-3 gap-1.5 py-1 border-b border-slate-100 text-slate-600">
          <span className="text-slate-400">快照 ID</span>
          <span className="col-span-2 font-mono font-medium text-slate-800">{currentSnapshot.id}</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 py-1 border-b border-slate-100 text-slate-600">
          <span className="text-slate-400">发生时间</span>
          <span className="col-span-2 font-mono text-slate-800">{formatTime(currentSnapshot.createdAt)}</span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 py-1 border-b border-slate-100 text-slate-600">
          <span className="text-slate-400">上下文时长</span>
          <span className="col-span-2 text-slate-800">
            问题发生前 {currentSnapshot.contextBeforeSec ?? currentSnapshot.windowDurationSec} 秒
            {currentSnapshot.contextAfterSec ? ` + 后续 ${currentSnapshot.contextAfterSec} 秒` : ''}
          </span>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <span className="text-slate-400">包含内容</span>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="flex flex-col items-center p-2 rounded-lg bg-blue-50 text-blue-700">
              <History className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-medium">操作记录</span>
              <strong className="text-sm">{operationEvents.length}</strong>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-indigo-50 text-indigo-700">
              <Terminal className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-medium">接口请求</span>
              <strong className="text-sm">{currentSnapshot.networkRequests.length}</strong>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-red-50 text-red-700">
              <FileCode2 className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-medium">控制台日志</span>
              <strong className="text-sm">{currentSnapshot.consoleErrors.length}</strong>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-emerald-50 text-emerald-700">
              <Monitor className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-medium">页面截图</span>
              <strong className="text-sm">{currentSnapshot.screenshotUrl ? 1 : 0}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col gap-2 text-xs">
        <span className="font-bold text-slate-800">已保存数据明细</span>
        <details open className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <summary className="cursor-pointer font-semibold text-slate-700">操作记录（{operationEvents.length}）</summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {recentOperations.length > 0 ? recentOperations.map((event) => (
              <div key={event.id} className="rounded bg-white px-2 py-1.5 border border-slate-100">
                <div className="flex justify-between gap-2"><strong className="truncate">{event.title}</strong><span className="text-[10px] text-slate-400">{formatTime(event.timestamp).slice(11)}</span></div>
                <p className="mt-0.5 text-[10px] text-slate-500 break-all">{event.description}</p>
              </div>
            )) : <span className="text-[10px] text-amber-600">本时间窗口内没有采集到操作，请确认在被测网页上开始 Session。</span>}
          </div>
        </details>

        <details className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <summary className="cursor-pointer font-semibold text-slate-700">接口请求（{currentSnapshot.networkRequests.length}）</summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {recentRequests.length > 0 ? recentRequests.map((request) => (
              <div key={request.id} className="rounded bg-white px-2 py-1.5 border border-slate-100">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <strong className="text-blue-700">{request.method}</strong>
                  <span className={request.isError ? 'text-red-600 font-bold' : 'text-slate-600'}>{request.status || 'ERR'}</span>
                  <span className="truncate text-slate-700">{request.pathname}</span>
                  <span className="ml-auto shrink-0 text-slate-400">{request.duration}ms</span>
                </div>
                <div className="mt-1 text-[9px] text-slate-400">
                  Request Headers {request.requestHeaders?.length || 0} · Response Headers {request.responseHeaders?.length || 0}
                </div>
                {request.requestBody && <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-1.5 text-[9px] text-slate-200">请求：{request.requestBody.slice(0, 1_000)}</pre>}
                {request.responseBody && <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-1.5 text-[9px] text-slate-200">响应：{request.responseBody.slice(0, 1_000)}</pre>}
              </div>
            )) : <span className="text-[10px] text-slate-500">本时间窗口内没有 Fetch/XHR 请求。</span>}
          </div>
        </details>

        <details className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <summary className="cursor-pointer font-semibold text-slate-700">Console 错误（{currentSnapshot.consoleErrors.length}）</summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {recentConsoleErrors.length > 0 ? recentConsoleErrors.map((event) => (
              <div key={event.id} className="rounded bg-white px-2 py-1.5 border border-red-100 text-red-700">
                <strong>{event.title}</strong>
                <p className="mt-0.5 text-[10px] break-all">{event.description}</p>
              </div>
            )) : <span className="text-[10px] text-slate-500">本时间窗口内没有 Console 错误。</span>}
          </div>
        </details>
        {(operationEvents.length > 8 || currentSnapshot.networkRequests.length > 8 || currentSnapshot.consoleErrors.length > 8) && (
          <span className="text-[10px] text-slate-400 text-center">这里只预览最近 8 条，完整数据会用于 Bug 报告。</span>
        )}
      </div>

      {currentSnapshot.screenshotUrl && (
        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-slate-800">页面截图</div>
            <button
              onClick={retakeScreenshot}
              disabled={isRetaking}
              className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRetaking ? 'animate-spin' : ''}`} />
              {isRetaking ? '截图中' : '重新截图'}
            </button>
          </div>
          <img
            src={currentSnapshot.screenshotUrl}
            alt="问题发生时的页面截图"
            className="w-full rounded-lg border border-slate-200"
          />
        </div>
      )}

      {!currentSnapshot.screenshotUrl && (
        <button
          onClick={retakeScreenshot}
          disabled={isRetaking}
          className="w-full py-2.5 bg-white border border-slate-200 text-blue-600 font-semibold rounded-xl flex items-center justify-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRetaking ? 'animate-spin' : ''}`} />
          {isRetaking ? '正在截图…' : '补充页面截图'}
        </button>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-col gap-2 pt-2">
        <button
          onClick={() => {
            setCurrentTab('bug', 'bug_editor');
          }}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
        >
          查看详情并生成 Bug
        </button>
        <button
          onClick={() => setActiveView('main')}
          className="w-full py-2 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
        >
          继续测试
        </button>
      </div>
    </div>
  );
};
