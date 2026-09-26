/**
 * API 接口监控与请求详情页 (TASK-203 & TASK-204)
 * 实时展示当前 Session 捕获的 Fetch/XHR 请求，支持 4xx/5xx/慢接口过滤与 cURL 复制
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, Plus, SlidersHorizontal, Terminal, Trash2, Zap } from 'lucide-react';
import { NetworkRequest } from '../../shared/types/network';
import { buildCurlCommand } from '../../shared/formatters/curl';
import { NetworkMockRule } from '../../shared/types/mock';
import { createEntityId } from '../../shared/utils/id';
import { useAppStore } from '../store/useAppStore';
import { networkRepo } from '../../db/repositories/networkRepository';
import { executeApiRequest } from '../../shared/tools/apiRequestExecutor';
import { ApiReplayModal } from '../components/ApiReplayModal';

export const ApiPage: React.FC = () => {
  const { activeSession, setCurrentTab, networkRequests, setToastMessage } = useAppStore();
  const [filter, setFilter] = useState<'all' | '4xx' | '5xx' | 'slow' | 'fetch' | 'xhr'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedCurlId, setCopiedCurlId] = useState<string | null>(null);
  const [mockRules, setMockRules] = useState<NetworkMockRule[]>([]);
  const [showMockEditor, setShowMockEditor] = useState(false);
  const [mockPattern, setMockPattern] = useState('*/api/*');
  const [mockMethod, setMockMethod] = useState('*');
  const [mockStatus, setMockStatus] = useState(500);
  const [mockDelayMs, setMockDelayMs] = useState(0);
  const [mockBody, setMockBody] = useState('{"code":500,"message":"QA mock error"}');

  const [replayModalReq, setReplayModalReq] = useState<NetworkRequest | null>(null);
  const [quickResendingId, setQuickResendingId] = useState<string | null>(null);
  const [quickResendResults, setQuickResendResults] = useState<
    Record<string, { status: number; duration: number; isError: boolean }>
  >({});

  useEffect(() => {
    chrome.storage.local.get({ networkMockRules: [] }, (result) => {
      setMockRules(Array.isArray(result.networkMockRules) ? result.networkMockRules : []);
    });
  }, []);

  // Background 广播没有接收者或侧边栏刚完成重载时，从 IndexedDB 补齐请求列表。
  useEffect(() => {
    if (!activeSession?.id) return;
    let disposed = false;
    const refresh = async () => {
      const requests = await networkRepo.listBySession(activeSession.id);
      if (!disposed) useAppStore.setState({ networkRequests: requests.reverse() });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeSession?.id]);

  const saveMockRules = async (rules: NetworkMockRule[]) => {
    setMockRules(rules);
    await chrome.storage.local.set({ networkMockRules: rules });
  };

  const addMockRule = async () => {
    if (!mockPattern.trim()) {
      setToastMessage('请填写 URL 通配规则');
      return;
    }
    const rule: NetworkMockRule = {
      id: createEntityId('mock'),
      name: `${mockMethod} ${mockPattern}`,
      enabled: true,
      method: mockMethod,
      urlPattern: mockPattern.trim(),
      status: Math.max(100, Math.min(599, mockStatus)),
      delayMs: Math.max(0, Math.min(30_000, mockDelayMs)),
      responseBody: mockBody,
      contentType: 'application/json',
    };
    await saveMockRules([...mockRules, rule]);
    setShowMockEditor(false);
    setToastMessage('Mock 规则已生效，后续 Fetch/XHR 将按规则返回');
  };

  const slowCount = networkRequests.filter((r) => r.isSlow).length;

  const filtered = networkRequests.filter((r) => {
    if (filter === '4xx') return r.status >= 400 && r.status < 500;
    if (filter === '5xx') return r.status >= 500;
    if (filter === 'slow') return r.isSlow;
    if (filter === 'fetch' || filter === 'xhr') return r.initiatorType === filter;
    return true;
  });

  const copyAsCurl = async (req: NetworkRequest) => {
    try {
      await navigator.clipboard.writeText(buildCurlCommand(req));
      setCopiedCurlId(req.id);
      setToastMessage('已复制 cURL 调试命令到剪贴板');
      setTimeout(() => setCopiedCurlId(null), 2000);
    } catch {
      setToastMessage('剪贴板写入失败，请检查插件权限后重试');
    }
  };

  const formatBody = (body: string) => {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToastMessage(`已复制${label}`);
    } catch {
      setToastMessage('剪贴板写入失败，请检查插件权限后重试');
    }
  };

  const handleQuickResend = async (req: NetworkRequest) => {
    setQuickResendingId(req.id);
    try {
      const res = await executeApiRequest({
        method: req.method,
        url: req.url,
        headers: req.requestHeaders,
        body: req.requestBody,
      });
      setQuickResendResults((prev) => ({
        ...prev,
        [req.id]: { status: res.status, duration: res.duration, isError: res.isError },
      }));
      setToastMessage(res.isError ? `重发完成：HTTP ${res.status} 异常` : `重发成功：HTTP ${res.status} · ${res.duration}ms`);
    } finally {
      setQuickResendingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 pb-20 text-xs">
      {/* 顶部标题与返回 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTab('home')}
            className="p-1 text-slate-500 hover:text-slate-800 rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-900">API 接口请求监控</h2>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-lg font-medium text-slate-600">
        {([
          ['all', `全部 (${networkRequests.length})`],
          ['4xx', `4XX (${networkRequests.filter((r) => r.status >= 400 && r.status < 500).length})`],
          ['5xx', `5XX (${networkRequests.filter((r) => r.status >= 500).length})`],
          ['slow', `慢请求 (${slowCount})`],
          ['fetch', 'Fetch'],
          ['xhr', 'XHR'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`py-1 rounded-md transition-colors ${
              filter === value ? 'bg-white text-blue-600 font-bold shadow-xs' : 'hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-slate-800 flex items-center gap-1.5"><Zap className="w-4 h-4 text-purple-600" />Network Mock</span>
          <button onClick={() => setShowMockEditor(!showMockEditor)} className="text-[11px] text-blue-600 font-semibold flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" />新建规则
          </button>
        </div>
        {showMockEditor && (
          <div className="p-2.5 bg-slate-50 rounded-lg flex flex-col gap-2">
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <select value={mockMethod} onChange={(event) => setMockMethod(event.target.value)} className="p-1.5 border border-slate-200 rounded bg-white font-mono">
                {['*', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((method) => <option key={method}>{method}</option>)}
              </select>
              <input value={mockPattern} onChange={(event) => setMockPattern(event.target.value)} className="p-1.5 border border-slate-200 rounded font-mono" placeholder="https://test.example.com/api/*" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1 text-slate-500">状态 <input type="number" min="100" max="599" value={mockStatus} onChange={(event) => setMockStatus(Number(event.target.value))} className="w-full p-1.5 border border-slate-200 rounded font-mono" /></label>
              <label className="flex items-center gap-1 text-slate-500">延迟 <input type="number" min="0" max="30000" value={mockDelayMs} onChange={(event) => setMockDelayMs(Number(event.target.value))} className="w-full p-1.5 border border-slate-200 rounded font-mono" /></label>
            </div>
            <textarea rows={3} value={mockBody} onChange={(event) => setMockBody(event.target.value)} className="p-2 border border-slate-200 rounded font-mono text-[10px]" />
            <button onClick={addMockRule} className="py-2 bg-purple-600 text-white font-semibold rounded-lg">保存并启用</button>
          </div>
        )}
        {mockRules.length === 0 ? (
          <span className="text-[10px] text-slate-400">暂无规则。URL 支持 `*` 通配符，规则仅影响后续请求。</span>
        ) : mockRules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
            <input type="checkbox" checked={rule.enabled} onChange={() => saveMockRules(mockRules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} />
            <span className="flex-1 min-w-0">
              <span className="block font-mono text-[10px] text-slate-700 truncate">{rule.method} {rule.urlPattern}</span>
              <span className="block text-[9px] text-slate-400">HTTP {rule.status} · 延迟 {rule.delayMs}ms</span>
            </span>
            <button onClick={() => saveMockRules(mockRules.filter((item) => item.id !== rule.id))} className="p-1 text-slate-400 hover:text-red-500" aria-label={`删除 ${rule.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>

      {/* 请求列表 */}
      <div className="flex flex-col gap-2 pt-1">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <Terminal className="w-8 h-8 text-slate-300" />
            <span>暂无捕获的接口请求</span>
            <span className="text-[11px] text-slate-400 max-w-[200px]">
              开始测试后，在被测网页中执行操作，页面发出的 Fetch 与 XHR 将在此实时显示
            </span>
          </div>
        ) : (
          filtered.map((req) => {
            const isExpanded = expandedId === req.id;
            const timeStr = new Date(req.startedAt).toTimeString().slice(0, 8);
            const resendResult = quickResendResults[req.id];

            return (
              <div
                key={req.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs flex flex-col"
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                        req.method === 'POST'
                          ? 'bg-blue-100 text-blue-700'
                          : req.method === 'GET'
                          ? 'bg-emerald-100 text-emerald-700'
                          : req.method === 'DELETE'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {req.method}
                    </span>
                    <span className="font-mono text-slate-800 truncate font-medium">{req.pathname}</span>
                    {req.isMocked && <span className="px-1 py-0.5 rounded bg-purple-100 text-purple-700 text-[9px] font-bold">MOCK</span>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono font-bold text-[11px] ${
                        req.status >= 500
                          ? 'text-red-600 bg-red-50 px-1 rounded'
                          : req.status >= 400
                          ? 'text-amber-600 bg-amber-50 px-1 rounded'
                          : 'text-slate-600'
                      }`}
                    >
                      {req.status || 'ERR'}
                    </span>
                    <span
                      className={`font-mono text-[10px] ${
                        req.isSlow ? 'text-amber-600 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {req.duration}ms
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* 展开的详情面板 (TASK-204) */}
                {isExpanded && (
                  <div className="p-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-2.5 text-[11px]">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-[10px]">触发时间: {timeStr}</span>
                        {resendResult && (
                          <span
                            className={`px-1.5 py-0.2 rounded font-mono text-[10px] font-bold ${
                              resendResult.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            最新: {resendResult.status} ({resendResult.duration}ms)
                          </span>
                        )}
                      </div>

                      {/* 核心动作：一键重发、编辑重发、复制 cURL */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button onClick={() => copyValue(req.url, ' URL')} className="text-slate-500 hover:text-blue-600 text-[10px]">URL</button>
                        {req.requestBody && (
                          <button onClick={() => copyValue(req.requestBody || '', ' Request')} className="text-slate-500 hover:text-blue-600 text-[10px]">Req</button>
                        )}
                        {req.responseBody && (
                          <button onClick={() => copyValue(req.responseBody || '', ' Response')} className="text-slate-500 hover:text-blue-600 text-[10px]">Res</button>
                        )}
                        <button
                          onClick={() => handleQuickResend(req)}
                          disabled={quickResendingId === req.id}
                          className="px-2 py-0.5 bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold rounded flex items-center gap-1 text-[10px] transition-colors"
                          title="使用原始参数一键重发"
                        >
                          <Zap className="w-3 h-3" />
                          <span>{quickResendingId === req.id ? '发送中' : '一键重发'}</span>
                        </button>
                        <button
                          onClick={() => setReplayModalReq(req)}
                          className="px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold rounded flex items-center gap-1 text-[10px] transition-colors"
                          title="修改 Headers / Authorization / Body / Params 后重放"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>编辑重发</span>
                        </button>
                        <button
                          onClick={() => copyAsCurl(req)}
                          className="text-slate-600 hover:text-slate-800 font-semibold flex items-center gap-0.5 text-[10px] bg-slate-200/70 px-1.5 py-0.5 rounded"
                          title="复制为 cURL 命令"
                        >
                          {copiedCurlId === req.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          <span>cURL</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400 font-semibold">完整 URL</span>
                      <div className="p-1.5 bg-white border border-slate-200 rounded font-mono text-[10px] text-slate-700 break-all select-all">
                        {req.url}
                      </div>
                    </div>

                    {req.requestHeaders && req.requestHeaders.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">Request Headers</span>
                        <pre className="p-2 bg-white border border-slate-200 rounded font-mono text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap">
                          {req.requestHeaders.map((h) => `${h.name}: ${h.value}`).join('\n')}
                        </pre>
                      </div>
                    )}

                    {req.requestBody && (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">Request Payload</span>
                        <pre className="p-2 bg-slate-900 text-slate-100 rounded font-mono text-[10px] overflow-x-auto max-h-32">
                          {formatBody(req.requestBody)}
                        </pre>
                      </div>
                    )}

                    {req.responseBody && (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">Response Body</span>
                        <pre className="p-2 bg-slate-900 text-emerald-300 rounded font-mono text-[10px] overflow-x-auto max-h-40">
                          {formatBody(req.responseBody)}
                        </pre>
                      </div>
                    )}

                    {req.responseHeaders && req.responseHeaders.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">Response Headers</span>
                        <pre className="p-2 bg-white border border-slate-200 rounded font-mono text-[10px] overflow-x-auto max-h-32 whitespace-pre-wrap">
                          {req.responseHeaders.map((h) => `${h.name}: ${h.value}`).join('\n')}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* API 调试与重发抽屉 */}
      <ApiReplayModal
        isOpen={Boolean(replayModalReq)}
        onClose={() => setReplayModalReq(null)}
        request={replayModalReq}
        onSendSuccess={(res) => {
          if (replayModalReq) {
            setQuickResendResults((prev) => ({
              ...prev,
              [replayModalReq.id]: { status: res.status, duration: res.duration, isError: res.isError },
            }));
          }
        }}
      />
    </div>
  );
};
