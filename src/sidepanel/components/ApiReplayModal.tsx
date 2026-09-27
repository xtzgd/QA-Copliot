import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Braces,
  Check,
  CheckCircle2,
  Copy,
  FileCode,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
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

interface BodyKvItem {
  id: string;
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  enabled: boolean;
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function isLikelyJson(str: string): boolean {
  if (!str) return false;
  const t = str.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function isInvalidObjectString(str: string): boolean {
  if (!str) return false;
  return str === '[object Object]' || str.includes('[object Object]') || str.startsWith('[object ');
}

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

  // Body 编辑模式：Raw 文本 vs Key-Value 结构化键值对
  const [bodyMode, setBodyMode] = useState<'raw' | 'kv'>('raw');
  const [bodyKvItems, setBodyKvItems] = useState<BodyKvItem[]>([]);

  // 针对对象类型入参（Query 参数或 Body 嵌套对象）的专用弹窗编辑器状态
  const [objectModalOpen, setObjectModalOpen] = useState(false);
  const [objectModalTitle, setObjectModalTitle] = useState('');
  const [objectModalValue, setObjectModalValue] = useState('');
  const [objectModalCallback, setObjectModalCallback] = useState<((val: string) => void) | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiExecutionResult | null>(null);
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);

  // 解析 JSON 字符串为 Key-Value 列表
  const parseJsonToKv = (jsonStr: string): BodyKvItem[] => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return [];
      }
      return Object.entries(parsed).map(([k, v], idx) => {
        let type: BodyKvItem['type'] = 'string';
        let valStr = '';
        if (typeof v === 'number') {
          type = 'number';
          valStr = String(v);
        } else if (typeof v === 'boolean') {
          type = 'boolean';
          valStr = String(v);
        } else if (Array.isArray(v)) {
          type = 'array';
          valStr = JSON.stringify(v, null, 2);
        } else if (typeof v === 'object' && v !== null) {
          type = 'object';
          valStr = JSON.stringify(v, null, 2);
        } else {
          type = 'string';
          valStr = String(v ?? '');
        }
        return {
          id: `kv-${idx}-${Date.now()}-${Math.random()}`,
          key: k,
          value: valStr,
          type,
          enabled: true,
        };
      });
    } catch {
      return [];
    }
  };

  // 将 Key-Value 列表重新拼装为 JSON 字符串
  const syncKvToBody = (items: BodyKvItem[]) => {
    const obj: Record<string, unknown> = {};
    for (const item of items) {
      if (!item.enabled || !item.key.trim()) continue;
      const k = item.key.trim();
      if (item.type === 'number') {
        const num = Number(item.value);
        obj[k] = isNaN(num) ? item.value : num;
      } else if (item.type === 'boolean') {
        obj[k] = item.value === 'true';
      } else if (item.type === 'object' || item.type === 'array') {
        try {
          obj[k] = JSON.parse(item.value);
        } catch {
          obj[k] = item.value;
        }
      } else {
        obj[k] = item.value;
      }
    }
    const newBody = JSON.stringify(obj, null, 2);
    setBody(newBody);
  };

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

      // 智能规范化入参 Body：确保如果是 object 则安全格式化为美化 JSON，若为 [object Object] 则提供合法空模板
      let rawBody = request.requestBody;
      let bodyText = '';
      if (typeof rawBody === 'object' && rawBody !== null) {
        try {
          bodyText = JSON.stringify(rawBody, null, 2);
        } catch {
          bodyText = String(rawBody);
        }
      } else if (typeof rawBody === 'string') {
        if (isInvalidObjectString(rawBody)) {
          bodyText = '{\n  \n}';
        } else {
          try {
            const parsed = JSON.parse(rawBody);
            if (typeof parsed === 'object' && parsed !== null) {
              bodyText = JSON.stringify(parsed, null, 2);
            } else {
              bodyText = rawBody;
            }
          } catch {
            bodyText = rawBody;
          }
        }
      }
      setBody(bodyText);
      setBodyKvItems(parseJsonToKv(bodyText));
      setResult(null);

      // 智能选中初始 Tab：POST/PUT/PATCH 优先聚焦 Body 便于直接修改入参，GET 聚焦 Params
      const m = request.method.toUpperCase();
      if (m === 'POST' || m === 'PUT' || m === 'PATCH') {
        setActiveTab('body');
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

  // 打开通用对象/JSON 入参编辑弹窗
  const openObjectModal = (
    title: string,
    initialVal: string,
    onSave: (val: string) => void
  ) => {
    setObjectModalTitle(title);
    let formatted = initialVal;
    if (isInvalidObjectString(initialVal) || !initialVal.trim()) {
      formatted = '{\n  "key": "value"\n}';
    } else {
      try {
        const parsed = JSON.parse(initialVal);
        formatted = JSON.stringify(parsed, null, 2);
      } catch {
        formatted = initialVal;
      }
    }
    setObjectModalValue(formatted);
    setObjectModalCallback(() => onSave);
    setObjectModalOpen(true);
  };

  // Body 格式化
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(body);
      const formatted = JSON.stringify(parsed, null, 2);
      setBody(formatted);
      setBodyKvItems(parseJsonToKv(formatted));
    } catch {}
  };

  // Body 压缩
  const handleMinifyJson = () => {
    try {
      const parsed = JSON.parse(body);
      const minified = JSON.stringify(parsed);
      setBody(minified);
    } catch {}
  };

  // Body 语法校验状态
  const bodyJsonStatus = useMemo(() => {
    if (!body || !body.trim()) return { isValid: true, isJson: false };
    const trimmed = body.trim();
    if (isInvalidObjectString(trimmed)) {
      return { isValid: false, isJson: false, isInvalidObject: true, error: '入参被序列化为 [object Object]，无法发送' };
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return { isValid: true, isJson: true };
      } catch (e: unknown) {
        return { isValid: false, isJson: true, error: (e as Error).message || 'JSON 语法错误' };
      }
    }
    return { isValid: true, isJson: false };
  }, [body]);

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
              disabled={loading || !url.trim() || bodyJsonStatus.isInvalidObject}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-1 text-xs shrink-0 shadow-sm transition-all active:scale-95 cursor-pointer"
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
              className={`flex-1 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'params' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Params ({params.filter((p) => p.enabled && p.key).length})
            </button>
            <button
              onClick={() => setActiveTab('headers')}
              className={`flex-1 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'headers' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Headers ({headers.filter((h) => h.enabled && h.name).length})
            </button>
            <button
              onClick={() => {
                setActiveTab('body');
                // 同步初始化 KV 列表
                if (body && !bodyKvItems.length) {
                  setBodyKvItems(parseJsonToKv(body));
                }
              }}
              className={`flex-1 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'body' ? 'bg-white text-blue-600 shadow-xs font-bold' : 'hover:text-slate-900'
              }`}
            >
              Body {body.trim() ? '•' : ''}
            </button>
          </div>

          {/* Tab 1: Params (Query 参数，针对 Object 类型的入参提供专用高亮与编辑按钮) */}
          {activeTab === 'params' && (
            <div className="flex flex-col gap-1.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                <span>URL Query 参数</span>
                <button
                  onClick={addParam}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 cursor-pointer"
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
                  {params.map((item, idx) => {
                    const isObj = isLikelyJson(item.value);
                    const isInvalidObj = isInvalidObjectString(item.value);

                    return (
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
                          placeholder="Key (如 filter)"
                          className="w-28 shrink-0 px-2 py-1 bg-white border border-slate-200 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <div className="flex-1 min-w-0 relative flex items-center">
                          <input
                            type="text"
                            value={item.value}
                            onChange={(e) => {
                              const updated = [...params];
                              updated[idx].value = e.target.value;
                              handleParamsChange(updated);
                            }}
                            placeholder="Value (支持普通文本或 JSON 对象)"
                            className={`w-full px-2 py-1 bg-white border rounded font-mono text-[11px] focus:outline-none focus:ring-1 ${
                              isInvalidObj
                                ? 'border-amber-400 bg-amber-50/40 text-amber-900 focus:ring-amber-400 pr-24'
                                : isObj
                                ? 'border-indigo-300 bg-indigo-50/20 text-indigo-900 focus:ring-indigo-400 pr-20'
                                : 'border-slate-200 focus:ring-blue-400'
                            }`}
                          />
                          {/* 针对 Object 类型的入参提供一键展开编辑或修复按钮 */}
                          {isInvalidObj ? (
                            <button
                              type="button"
                              onClick={() => {
                                openObjectModal(
                                  `修复并编辑 Query 参数「${item.key || '未命名'}」的对象入参`,
                                  '{\n  \n}',
                                  (newVal) => {
                                    const updated = [...params];
                                    updated[idx].value = newVal;
                                    handleParamsChange(updated);
                                  }
                                );
                              }}
                              className="absolute right-1 px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded font-semibold text-[10px] flex items-center gap-0.5 cursor-pointer shadow-2xs"
                              title="检测到无效的 [object Object]，点击重置并编辑合法 JSON 对象"
                            >
                              <AlertCircle className="w-3 h-3 text-amber-600" />
                              <span>修复对象</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                openObjectModal(
                                  `编辑 Query 参数「${item.key || '未命名'}」的对象入参 (JSON)`,
                                  item.value,
                                  (newVal) => {
                                    const updated = [...params];
                                    updated[idx].value = newVal;
                                    handleParamsChange(updated);
                                  }
                                );
                              }}
                              className={`absolute right-1 px-1.5 py-0.5 rounded font-semibold text-[10px] flex items-center gap-0.5 cursor-pointer shadow-2xs transition-colors ${
                                isObj
                                  ? 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                              }`}
                              title="点击展开全功能 JSON 对象编辑器"
                            >
                              <Braces className="w-3 h-3" />
                              <span>{isObj ? '编辑对象' : '转为对象'}</span>
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => removeParam(idx)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded cursor-pointer"
                          title="删除参数"
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

          {/* Tab 2: Headers (请求头) */}
          {activeTab === 'headers' && (
            <div className="flex flex-col gap-1.5 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium px-1">
                <span>请求头列表 (包含已捕获的 Authorization / Token)</span>
                <button
                  onClick={addHeader}
                  className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 cursor-pointer"
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
                          className="p-1 text-slate-400 hover:text-red-500 rounded shrink-0 cursor-pointer"
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

          {/* Tab 3: Body (请求体，支持 Raw 文本与结构化 Key-Value 双模式，完备支持 Object 对象入参) */}
          {activeTab === 'body' && (
            <div className="flex flex-col gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/60">
              {/* 子模式切换头 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-[11px] font-semibold">
                  <button
                    onClick={() => setBodyMode('raw')}
                    className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                      bodyMode === 'raw' ? 'bg-white text-blue-600 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    JSON 文本 (Raw)
                  </button>
                  <button
                    onClick={() => {
                      setBodyMode('kv');
                      setBodyKvItems(parseJsonToKv(body));
                    }}
                    className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                      bodyMode === 'kv' ? 'bg-white text-blue-600 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    键值对 (Key-Value)
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {bodyMode === 'raw' && (
                    <>
                      <button
                        onClick={handleMinifyJson}
                        className="text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-0.5 text-[11px] cursor-pointer"
                        title="压缩为单行 JSON"
                      >
                        <FileCode className="w-3 h-3" /> 压缩
                      </button>
                      <button
                        onClick={handleFormatJson}
                        className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 text-[11px] cursor-pointer"
                        title="格式化与美化 JSON"
                      >
                        <Wand2 className="w-3 h-3" /> 格式化 JSON
                      </button>
                    </>
                  )}
                  {bodyMode === 'kv' && (
                    <button
                      onClick={() => {
                        const newItem: BodyKvItem = {
                          id: `kv-${Date.now()}`,
                          key: '',
                          value: '',
                          type: 'string',
                          enabled: true,
                        };
                        const updated = [...bodyKvItems, newItem];
                        setBodyKvItems(updated);
                        syncKvToBody(updated);
                      }}
                      className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5 text-[11px] cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> 添加入参字段
                    </button>
                  )}
                </div>
              </div>

              {/* 检测并提示 [object Object] 修复 */}
              {bodyJsonStatus.isInvalidObject && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-800 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>检测到原始请求体被序列化为 [object Object]，无法正常编辑和发送</span>
                  </div>
                  <button
                    onClick={() => {
                      const template = '{\n  "key": "value"\n}';
                      setBody(template);
                      setBodyKvItems(parseJsonToKv(template));
                    }}
                    className="px-2 py-0.5 bg-amber-200 hover:bg-amber-300 text-amber-900 rounded font-semibold text-[10px] cursor-pointer"
                  >
                    重置为标准 JSON
                  </button>
                </div>
              )}

              {/* 模式 1: Raw 文本编辑器 */}
              {bodyMode === 'raw' && (
                <div className="flex flex-col gap-1">
                  <textarea
                    rows={8}
                    value={body}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBody(val);
                      // 保持后台 KV 同步解析
                      setBodyKvItems(parseJsonToKv(val));
                    }}
                    placeholder='{"name": "test", "user": {"id": 1, "role": "admin"}}'
                    className="w-full p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {/* JSON 语法实时反馈 */}
                  <div className="flex items-center justify-between text-[10px] px-1 text-slate-400">
                    <div>
                      {bodyJsonStatus.isJson && bodyJsonStatus.isValid && (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> JSON 语法有效
                        </span>
                      )}
                      {bodyJsonStatus.isJson && !bodyJsonStatus.isValid && (
                        <span className="text-red-500 font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {bodyJsonStatus.error}
                        </span>
                      )}
                    </div>
                    <span>{body.length} 字符</span>
                  </div>
                </div>
              )}

              {/* 模式 2: Key-Value 结构化入参编辑器 (重点解决嵌套 Object 无法编辑问题) */}
              {bodyMode === 'kv' && (
                <div className="flex flex-col gap-1.5">
                  {bodyKvItems.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 text-[11px] flex flex-col items-center gap-2">
                      <span>当前请求体尚未解析出键值对（需为合法的顶层 JSON 对象）</span>
                      <button
                        onClick={() => {
                          const initial = '{\n  "name": "test",\n  "filter": {\n    "status": 1\n  }\n}';
                          setBody(initial);
                          setBodyKvItems(parseJsonToKv(initial));
                        }}
                        className="px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg font-semibold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Wand2 className="w-3 h-3" /> 生成常用入参模板（含嵌套对象）
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                      {bodyKvItems.map((item, idx) => {
                        const isNestedObj = item.type === 'object' || item.type === 'array';
                        return (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(e) => {
                                const updated = [...bodyKvItems];
                                updated[idx].enabled = e.target.checked;
                                setBodyKvItems(updated);
                                syncKvToBody(updated);
                              }}
                              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            {/* Key 输入 */}
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) => {
                                const updated = [...bodyKvItems];
                                updated[idx].key = e.target.value;
                                setBodyKvItems(updated);
                                syncKvToBody(updated);
                              }}
                              placeholder="入参字段名 (Key)"
                              className="w-28 shrink-0 px-2 py-1 bg-white border border-slate-200 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                            {/* 类型选择 */}
                            <select
                              value={item.type}
                              onChange={(e) => {
                                const newType = e.target.value as BodyKvItem['type'];
                                const updated = [...bodyKvItems];
                                updated[idx].type = newType;
                                if (newType === 'object' && !isLikelyJson(updated[idx].value)) {
                                  updated[idx].value = '{\n  "key": "value"\n}';
                                } else if (newType === 'array' && !isLikelyJson(updated[idx].value)) {
                                  updated[idx].value = '[]';
                                }
                                setBodyKvItems(updated);
                                syncKvToBody(updated);
                              }}
                              className="w-18 shrink-0 px-1.5 py-1 bg-slate-100 border border-slate-200 rounded font-sans text-[10px] text-slate-700 cursor-pointer"
                            >
                              <option value="string">String</option>
                              <option value="number">Number</option>
                              <option value="boolean">Boolean</option>
                              <option value="object">Object</option>
                              <option value="array">Array</option>
                            </select>

                            {/* Value 输入与编辑对象按钮 */}
                            <div className="flex-1 min-w-0 relative flex items-center">
                              <input
                                type="text"
                                value={item.value}
                                onChange={(e) => {
                                  const updated = [...bodyKvItems];
                                  updated[idx].value = e.target.value;
                                  setBodyKvItems(updated);
                                  syncKvToBody(updated);
                                }}
                                placeholder={isNestedObj ? '点击右侧「编辑对象」' : '入参值 (Value)'}
                                className={`w-full px-2 py-1 bg-white border rounded font-mono text-[11px] focus:outline-none focus:ring-1 ${
                                  isNestedObj
                                    ? 'border-indigo-300 bg-indigo-50/20 text-indigo-900 focus:ring-indigo-400 pr-20'
                                    : 'border-slate-200 focus:ring-blue-400'
                                }`}
                              />
                              {isNestedObj && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    openObjectModal(
                                      `编辑入参字段「${item.key || '未命名'}」的对象 (JSON)`,
                                      item.value,
                                      (newVal) => {
                                        const updated = [...bodyKvItems];
                                        updated[idx].value = newVal;
                                        setBodyKvItems(updated);
                                        syncKvToBody(updated);
                                      }
                                    );
                                  }}
                                  className="absolute right-1 px-1.5 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded font-semibold text-[10px] flex items-center gap-0.5 cursor-pointer shadow-2xs"
                                  title="打开全功能编辑器编辑此对象入参"
                                >
                                  <Braces className="w-3 h-3" />
                                  <span>编辑对象</span>
                                </button>
                              )}
                            </div>

                            <button
                              onClick={() => {
                                const updated = [...bodyKvItems];
                                updated.splice(idx, 1);
                                setBodyKvItems(updated);
                                syncKvToBody(updated);
                              }}
                              className="p-1 text-slate-400 hover:text-red-500 rounded shrink-0 cursor-pointer"
                              title="删除字段"
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
                      className={`px-1.5 py-0.5 rounded cursor-pointer ${
                        responseTab === 'body' ? 'bg-white font-bold text-slate-800 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Body
                    </button>
                    <button
                      onClick={() => setResponseTab('headers')}
                      className={`px-1.5 py-0.5 rounded cursor-pointer ${
                        responseTab === 'headers' ? 'bg-white font-bold text-slate-800 shadow-2xs' : 'text-slate-500'
                      }`}
                    >
                      Headers ({result.headers.length})
                    </button>
                  </div>
                  <button
                    onClick={copyResponse}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
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

      {/* 专用对象入参/嵌套 JSON 弹窗编辑器 (Object Param Editor Modal) */}
      {objectModalOpen && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150 text-xs">
            {/* 弹窗头部 */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-1.5 min-w-0">
                <Braces className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="font-bold text-slate-800 text-xs truncate max-w-[320px]">
                  {objectModalTitle}
                </span>
              </div>
              <button
                onClick={() => setObjectModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 编辑区操作栏 */}
            <div className="px-4 py-2 bg-slate-100/70 border-b border-slate-200/60 flex items-center justify-between flex-wrap gap-2 text-[11px]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(objectModalValue);
                      setObjectModalValue(JSON.stringify(parsed, null, 2));
                    } catch {}
                  }}
                  className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  <Wand2 className="w-3 h-3 text-blue-600" /> 格式化
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(objectModalValue);
                      setObjectModalValue(JSON.stringify(parsed));
                    } catch {}
                  }}
                  className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                >
                  <FileCode className="w-3 h-3 text-slate-500" /> 压缩
                </button>
                <button
                  type="button"
                  onClick={() => setObjectModalValue('{\n  "key": "value"\n}')}
                  className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="插入空对象模板"
                >
                  <RotateCcw className="w-3 h-3 text-slate-500" /> 模板
                </button>
              </div>

              {/* 语法检查提示 */}
              <div>
                {(() => {
                  try {
                    JSON.parse(objectModalValue);
                    return (
                      <span className="text-emerald-600 font-semibold flex items-center gap-1 text-[10px]">
                        <CheckCircle2 className="w-3 h-3" /> 合法 JSON 对象
                      </span>
                    );
                  } catch (e: unknown) {
                    return (
                      <span className="text-amber-600 font-semibold flex items-center gap-1 text-[10px]">
                        <AlertCircle className="w-3 h-3" /> 格式异常
                      </span>
                    );
                  }
                })()}
              </div>
            </div>

            {/* JSON 多行代码编辑区 */}
            <div className="p-4 flex flex-col gap-2 flex-1 min-h-[220px]">
              <textarea
                rows={10}
                value={objectModalValue}
                onChange={(e) => setObjectModalValue(e.target.value)}
                placeholder='{\n  "key": "value"\n}'
                className="w-full flex-1 p-3 bg-slate-900 text-emerald-300 rounded-xl font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400 select-all"
              />
            </div>

            {/* 弹窗底部操作 */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setObjectModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 font-semibold text-slate-600 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  objectModalCallback?.(objectModalValue);
                  setObjectModalOpen(false);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 font-bold text-white flex items-center gap-1 cursor-pointer shadow-sm active:scale-95 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存并应用</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
