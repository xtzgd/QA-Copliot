/**
 * AI 助手：智能填表、自然语言测试与导入用例测试
 */

import React from 'react';
import {
  ArrowLeft,
  Bot,
  FileSpreadsheet,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { AiFillPage } from './AiFillPage';
import { AiTestCasesPage } from './AiTestCasesPage';

export const AiCasesPage: React.FC = () => {
  const { setCurrentTab, aiSubTab, setAiSubTab } = useAppStore();

  return (
    <div className="flex flex-col gap-3 p-4 pb-20 text-xs">
      {/* 顶部标题与返回 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTab('home')}
            className="p-1 text-slate-500 hover:text-slate-800 rounded-md cursor-pointer"
            title="返回首页"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-900">AI 助手</h2>
        </div>
      </div>

      {/* 选项卡 (顺序: 智能填表 -> 自然语言测试 -> 导入用例测试) */}
      <div className="flex items-center overflow-x-auto border-b border-slate-200">
        <button
          onClick={() => setAiSubTab('formFill')}
          className={`py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 shrink-0 cursor-pointer ${
            aiSubTab === 'formFill'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>智能填表</span>
        </button>
        <button
          onClick={() => setAiSubTab('agent')}
          className={`shrink-0 py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 cursor-pointer ${
            aiSubTab === 'agent'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>自然语言测试</span>
        </button>
        <button
          onClick={() => setAiSubTab('cases')}
          className={`shrink-0 py-2 px-3 font-semibold border-b-2 transition-colors flex items-center gap-1 cursor-pointer ${
            aiSubTab === 'cases'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>导入用例测试</span>
        </button>
      </div>

      {/* 视图分发 */}
      {aiSubTab === 'formFill' && <AiFillPage />}
      {aiSubTab === 'agent' && <AiTestCasesPage mode="agent" />}
      {aiSubTab === 'cases' && <AiTestCasesPage mode="cases" />}
      {aiSubTab !== 'formFill' && aiSubTab !== 'agent' && aiSubTab !== 'cases' && <AiFillPage />}
    </div>
  );
};
