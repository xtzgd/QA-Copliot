/**
 * AI 工具箱：智能填表与页面定位器
 */

import React from 'react';
import {
  ArrowLeft,
  Code2,
  Copy,
  FileSpreadsheet,
  Bot,
} from 'lucide-react';
import { sendToBackground } from '../../shared/messages';
import { useAppStore } from '../store/useAppStore';
import { AiFillPage } from './AiFillPage';
import { AiTestCasesPage } from './AiTestCasesPage';

export const AiCasesPage: React.FC = () => {
  const { setCurrentTab, setToastMessage, aiSubTab, setAiSubTab, inspectedElement } = useAppStore();

  const copyText = (val: string, label: string) => {
    navigator.clipboard.writeText(val);
    setToastMessage(`已复制 ${label}: ${val}`);
  };

  const startElementInspection = async () => {
    const result = await sendToBackground<{ success?: boolean; error?: string }>({
      type: 'START_ELEMENT_INSPECTION',
      payload: undefined,
    });
    setToastMessage(result?.success
      ? '元素选择已开启，请在被测网页中点击目标元素；按 Esc 取消'
      : result?.error || '无法开启元素选择，请刷新被测页面后重试');
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
          <h2 className="text-sm font-bold text-slate-900">AI 助手与工具箱</h2>
        </div>
      </div>

      {/* 选项卡 */}
      <div className="flex items-center overflow-x-auto border-b border-slate-200">
        <button
          onClick={() => setAiSubTab('formFill')}
          className={`py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 ${
            aiSubTab === 'formFill' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>智能填表</span>
        </button>
        <button
          onClick={() => setAiSubTab('dom')}
          className={`py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 ${
            aiSubTab === 'dom' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>页面定位器</span>
        </button>
        <button
          onClick={() => setAiSubTab('cases')}
          className={`shrink-0 py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 ${
            aiSubTab === 'cases' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>导入用例</span>
        </button>
        <button
          onClick={() => setAiSubTab('agent')}
          className={`shrink-0 py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 ${
            aiSubTab === 'agent' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>自然语言</span>
        </button>
      </div>

      {/* 视图: 智能填表 (QA-013) */}
      {aiSubTab === 'formFill' && <AiFillPage />}
      {aiSubTab === 'cases' && <AiTestCasesPage mode="cases" />}
      {aiSubTab === 'agent' && <AiTestCasesPage mode="agent" />}

      {/* 视图: 页面定位器生成器 (TASK-501 & TASK-502) */}
      {aiSubTab === 'dom' && (
        <div className="flex flex-col gap-3">
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-800 text-[11px]">
            点击下方按钮进入选择模式，再到被测网页普通点击目标元素；按 <strong>Esc</strong> 可取消。
          </div>
          <button
            onClick={startElementInspection}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center justify-center gap-1.5"
          >
            <Code2 className="w-4 h-4" />
            开始选择元素
          </button>
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">Playwright 推荐定位器</span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                getByRole 优先
              </span>
            </div>

            <p className="text-slate-500 text-[11px]">
              遵循 Playwright 官方最佳实践，优先采用无障碍角色和语义文本，避免脆性 XPath。
            </p>

            {inspectedElement ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-[58px_1fr] gap-1 text-[10px]">
                  <span className="text-slate-400">Element</span><span className="font-mono text-slate-700">&lt;{inspectedElement.tag}&gt; {inspectedElement.text}</span>
                  <span className="text-slate-400">CSS</span><span className="font-mono text-slate-700 break-all">{inspectedElement.css}</span>
                  <span className="text-slate-400">XPath</span><span className="font-mono text-slate-700 break-all">{inspectedElement.xpath}</span>
                  {inspectedElement.frame && (
                    <>
                      <span className="text-slate-400">Frame</span>
                      <span className="font-mono text-slate-700 break-all">
                        #{inspectedElement.frame.frameId ?? 0} · {inspectedElement.frame.url}
                        {inspectedElement.frame.frameXPath.length > 0 && ` · ${inspectedElement.frame.complete ? '跨层坐标' : '部分跨层坐标'} ${Math.round(inspectedElement.frame.offset.left)},${Math.round(inspectedElement.frame.offset.top)} / zoom ${inspectedElement.frame.zoom.toFixed(3)}`}
                      </span>
                    </>
                  )}
                </div>
                <div className="p-2.5 bg-slate-900 text-slate-100 rounded-xl flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[9px] text-blue-300 mb-1">{inspectedElement.playwright.strategy}</div>
                    <code className="font-mono text-emerald-400 text-[11px] break-all">{inspectedElement.playwright.recommended}</code>
                  </div>
                  <button onClick={() => copyText(inspectedElement.playwright.recommended, 'Playwright Locator')} className="p-1 text-slate-400 hover:text-white shrink-0">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => copyText(inspectedElement.css, 'CSS Locator')} className="py-2 border border-slate-200 rounded-lg text-slate-600">复制 CSS</button>
                  <button onClick={() => copyText(inspectedElement.xpath, 'XPath')} className="py-2 border border-slate-200 rounded-lg text-slate-600">复制 XPath</button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 text-[11px]">尚未选择页面元素</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
