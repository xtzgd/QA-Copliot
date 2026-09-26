import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, Plus, Send, Trash2, Wand2, X } from 'lucide-react';
import { NetworkRequest } from '../../shared/types/network';
import {
  ApiExecutionResult,
  executeApiRequest,
  HeaderParamItem,
  parseQueryParams,
  QueryParamItem,
  stringifyQueryParams,
} from '../../shared/tools/apiRequestExecutor';

interface ApiReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: NetworkRequest | null;
  onSendSuccess?: (result: ApiExecutionResult) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export const ApiReplayModal: React.FC<ApiReplayModalProps> = ({
  isOpen,
  onClose,
  request,
  onSendSuccess,
}) => {
  if (!isOpen || !request) return null;

  const [method, setMethod] = useState<string>('GET');
  const [url, setUrl] = useState<string>('');
  const [params, setParams] = useState<QueryParamItem[]>([]);
  const [headers, setHeaders] = useState<HeaderParamItem[]>([]);
  const [body, setBody] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body'>('params');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiExecutionResult | null>(null);
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);

  // 初始化填充数据
  useEffect(() => {
    if (request) {
      setMethod(request.method.toUpperCase());
      setUrl(request.url);
      setParams(parseQueryParams(request.url));

      // 提取 headers 并去除可能导致冲突的某些浏览器自动伪头
      const initialHeaders: HeaderParamItem[] = (request.requestHeaders || [])
        .filter((h) => !h.name.startsWith(':'))
        .map((h) => ({
          name: h.name,
          value: h.value,
          enabled: true,
        }));
      setHeaders(initialHeaders);

      setBody(request.requestBody || '');
      setResult(null);

      // 智能选中初始 Tab
      if (request.method.toUpperCase() === 'POST' || request.method.toUpperCase() === 'PUT') {
        setActiveTab(request.requestBody ? 'body' : 'params');
      } else {
        setActiveTab('params');
      }
    }
  }, [request]);

  // 修改 params 时自动同步回 url
  const handleParamsChange = (newParams: QueryParamItem[]) => {
    setParams(newParams);
    const updatedUrl = stringifyQueryParams(url, newParams);
    setUrl(updatedUrl);
  };

  // 用户手动在 input 中修改 url 时，同步解析回 params
  const handleUrlInputChange = (newUrl: string) => {
    setUrl(newUrl);
    setParams(parseQueryParams(newUrl));
  };

  const addParam = () => {
    handleParamsChange([...params, { key: '', value: '', enabled: true }]);
  };

  const removeParam = (idx: number) => {
    const updated = [...params];
    updated.splice(idx, 1);
    handleParamsChange(updated);
  };

  const addHeader = () => {
    setHeaders([...headers, { name: '', value: '', enabled: true }]);
  };

  const removeHeader = (idx: number) => {
    const updated = [...headers];
    updated.splice(idx, 1);
    setHeaders(updated);
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(body);
      setBody(JSON.stringify(parsed, null, 2));
    } catch {}
  };

  const handleSend = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await executeApiRequest({
        method,
        url,
        headers,
        body,
      });
      setResult(res);
      onSendSuccess?.(res);
    } finally {
      setLoading(false);
    }
  };

  const copyResponse = async () => {
    if (!result?.body) return;
    try {
      await navigator.clipboard.writeText(result.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const formatDisplayBody = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  const getMethodColor = (m: string) => {
    switch (m) {
      case 'POST':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'GET':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'PUT':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'DELETE':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-purple-100 text-purple-700 border-purple-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-end transition-all">
      <div className="bg-white w-full max-h-[92vh] h-[92vh] rounded-t-2xl shadow-2xl flex flex-col overflow-hidden text-xs animate-in slide-in-from-bottom duration-200">
        {/* 抽屉头部 */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-slate-800 text-sm">API 调试与重发</span>
            <span className="font-mono text-slate-400 text-[11px] truncate max-w-[200px]" title={url}>
              {request.pathname}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 请求配置主体，支持纵向滚动 */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {/* 请求行：Method + URL + 发送按钮 */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200/80">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={`px-2 py-1.5 rounded-lg font-mono font-bold text-xs border focus:outline-none cursor-pointer ${getMethodColor(
                method
              )}`}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => handleUrlInputChange(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 truncate"
            />
            <button
              onClick={handleSend}
              disabled={loading || !url.trim()}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-1 text-xs shrink-0 shadow-sm transition-all active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>发送中</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>发送</span>
                </>
              )}
            </button>
          </div>

          {/* 配置 Tab 切换栏 */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
            <button
              onClick={() => setActiveTab('params')}
              className={`flex-1 py-1 rounded-md transition-colors ${
                activeTab === 'params' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Params ({params.filter((p) => p.enabled && p.key).length})
            </button>
            <button
              onClick={() => setActiveTab('headers')}
              className={`flex-1 py-1 rounded-md transition-colors ${
                activeTab === 'headers' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Headers ({headers.filter((h) => h.enabled && h.name).length})
            </button>
            <button
              onClick={() => setActiveTab('body')}
              className={`flex-1 py-1 rounded-md transition-colors ${
                activeTab === 'body' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Body {body.trim() ? '•' : ''}
            </button>
          </div>

          {/* Tab 1: Params (Query 参数) */}
          {activeTab === 'params' && (
            <div className="flex flex-col gap-1.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                <span>URL Query 参数</span>
                <button
                  onClick={addParam}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> 添加参数
                </button>
              </div>

              {params.length === 0 ? (
                <div className="py-4 text-center text-slate-400 text-[11px]">
                  该 URL 当前没有 Query 参数，可点击右上角添加
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {params.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => {
                          const updated = [...params];
                          updated[idx].enabled = e.target.checked;
                          handleParamsChange(updated);
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                      />
                      <input
                        type="text"
                        value={item.key}
                        onChange={(e) => {
                          const updated = [...params];
                          updated[idx].key = e.target.value;
                          handleParamsChange(updated);
                        }}
                        placeholder="Key (如 page)"
                        className="flex-1 min-w-0 px-2 py-1 bg-white border border-slate-200 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <input
                        type="text"
                        value={item.value}
                        onChange={(e) => {
                          const updated = [...params];
                          updated[idx].value = e.target.value;
                          handleParamsChange(updated);
                        }}
                        placeholder="Value (如 2)"
                        className="flex-1 min-w-0 px-2 py-1 bg-white border border-slate-200 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      <button
                        onClick={() => removeParam(idx)}
                        className="p-1 text-slate-400 hover:text-red-500 rounded"
                        title="删除参数"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Headers (请求头) */}
          {activeTab === 'headers' && (
            <div className="flex flex-col gap-1.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                <span>请求头列表 (包含已捕获的 Authorization / Token)</span>
                <button
                  onClick={addHeader}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> 添加 Header
                </button>
              </div>

              {headers.length === 0 ? (
                <div className="py-4 text-center text-slate-400 text-[11px]">暂无请求头</div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {headers.map((item, idx) => {
                    const isAuth = item.name.toLowerCase() === 'authorization';
                    return (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) => {
                            const updated = [...headers];
                            updated[idx].enabled = e.target.checked;
                            setHeaders(updated);
                          }}
                          className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                        />
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => {
                            const updated = [...headers];
                            updated[idx].name = e.target.value;
                            setHeaders(updated);
                          }}
                          placeholder="Header Name"
                          className={`w-32 shrink-0 px-2 py-1 bg-white border rounded font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                            isAuth ? 'border-amber-300 font-bold text-amber-900 bg-amber-50/40' : 'border-slate-200'
                          }`}
                        />
                        <input
                          type="text"
                          value={item.value}
                          onChange={(e) => {
                            const updated = [...headers];
                            updated[idx].value = e.target.value;
                            setHeaders(updated);
                          }}
                          placeholder="Header Value"
                          className="flex-1 min-w-0 px-2 py-1 bg-white border border-slate-200 rounded font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400 truncate"
                        />
                        <button
                          onClick={() => removeHeader(idx)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded shrink-0"
                          title="删除 Header"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Body (请求体) */}
          {activeTab === 'body' && (
            <div className="flex flex-col gap-1.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                <span>Request Payload (JSON / 文本)</span>
                <button
                  onClick={handleFormatJson}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 text-[11px]"
                >
                  <Wand2 className="w-3 h-3" /> 格式化 JSON
                </button>
              </div>
              <textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"key": "value"}'
                className="w-full p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          )}

          {/* 实时响应结果面板 (Response Inspector) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-xs">响应结果</span>
                {result && (
                  <span
                    className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                      result.status >= 200 && result.status < 300
                        ? 'bg-emerald-100 text-emerald-700'
                        : result.status >= 400 && result.status < 500
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {result.status} {result.statusText}
                  </span>
                )}
                {result && (
                  <span className="font-mono text-slate-400 text-[10px]">
                    {result.duration}ms · {result.size > 1024 ? `${(result.size / 1024).toFixed(1)} KB` : `${result.size} B`}
                  </span>
                )}
              </div>

              {result?.body && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded text-[10px]">
                    <button
                      onClick={() => setResponseTab('body')}
                      className={`px-1.5 py-0.5 rounded ${
                        responseTab === 'body' ? 'bg-white font-bold text-slate-800 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Body
                    </button>
                    <button
                      onClick={() => setResponseTab('headers')}
                      className={`px-1.5 py-0.5 rounded ${
                        responseTab === 'headers' ? 'bg-white font-bold text-slate-800 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Headers ({result.headers.length})
                    </button>
                  </div>
                  <button
                    onClick={copyResponse}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-semibold"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>
                </div>
              )}
            </div>

            {!result ? (
              <div className="py-6 text-center text-slate-400 text-[11px]">
                修改上方参数后，点击「发送」即可在此处查看真实接口响应
              </div>
            ) : result.error ? (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-mono">
                {result.error}
              </div>
            ) : responseTab === 'body' ? (
              <pre className="p-2.5 bg-slate-900 text-emerald-300 rounded-lg font-mono text-[10px] overflow-x-auto max-h-56 leading-relaxed whitespace-pre-wrap select-all">
                {formatDisplayBody(result.body)}
              </pre>
            ) : (
              <div className="p-2.5 bg-white border border-slate-200 rounded-lg font-mono text-[10px] text-slate-700 max-h-56 overflow-y-auto flex flex-col gap-1">
                {result.headers.map((h, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="font-semibold text-slate-900 shrink-0">{h.name}:</span>
                    <span className="text-slate-600 break-all">{h.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
