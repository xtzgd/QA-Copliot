/**
 * 首页快捷登录卡片 src/sidepanel/components/QuickLoginCard.tsx
 * 支持三级级联选择 [项目 - 环境 - 账号]，记忆上次选择，一键新标签页跳转并自适应自动填充
 */

import React, { useEffect, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Settings,
  Layers,
  ChevronRight,
  Check,
  FolderKanban,
  Globe,
  User,
  ChevronDown,
} from 'lucide-react';
import {
  QuickLoginConfig,
  QuickLoginProject,
} from '../../shared/types/quickLogin';
import { sendToBackground } from '../../shared/messages';

interface QuickLoginCardProps {
  onToast: (msg: string) => void;
  onNavigateToSettings: () => void;
}

export const QuickLoginCard: React.FC<QuickLoginCardProps> = ({
  onToast,
  onNavigateToSettings,
}) => {
  const [projects, setProjects] = useState<QuickLoginProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [isLaunching, setIsLaunching] = useState(false);

  // 加载配置并恢复记忆选择
  useEffect(() => {
    chrome.storage.local.get({ quickLoginConfig: null }, (res) => {
      const config = res.quickLoginConfig as QuickLoginConfig | null;
      if (config && Array.isArray(config.projects) && config.projects.length > 0) {
        setProjects(config.projects);

        // 恢复项目
        const proj =
          config.projects.find((p) => p.id === config.lastSelected?.projectId) || config.projects[0];
        setSelectedProjectId(proj.id);

        // 恢复环境
        const env =
          proj.environments.find((e) => e.id === config.lastSelected?.envId) || proj.environments[0];
        if (env) {
          setSelectedEnvId(env.id);

          // 恢复账号
          const acc =
            env.accounts.find((a) => a.id === config.lastSelected?.accountId) || env.accounts[0];
          if (acc) {
            setSelectedAccountId(acc.id);
          }
        }
      }
    });
  }, []);

  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const currentEnv = currentProject?.environments.find((e) => e.id === selectedEnvId);
  const currentAccount = currentEnv?.accounts.find((a) => a.id === selectedAccountId);

  // 记住当前选择
  const persistSelection = (projId: string, envId: string, accId: string) => {
    chrome.storage.local.get({ quickLoginConfig: null }, (res) => {
      const config = res.quickLoginConfig as QuickLoginConfig | null;
      if (config) {
        config.lastSelected = {
          projectId: projId,
          envId,
          accountId: accId,
        };
        chrome.storage.local.set({ quickLoginConfig: config }).catch(() => {});
      }
    });
  };

  const handleProjectChange = (projId: string) => {
    setSelectedProjectId(projId);
    const proj = projects.find((p) => p.id === projId);
    if (proj && proj.environments.length > 0) {
      const nextEnv = proj.environments[0];
      setSelectedEnvId(nextEnv.id);
      const nextAcc = nextEnv.accounts[0];
      const nextAccId = nextAcc ? nextAcc.id : '';
      setSelectedAccountId(nextAccId);
      persistSelection(projId, nextEnv.id, nextAccId);
    } else {
      setSelectedEnvId('');
      setSelectedAccountId('');
    }
  };

  const handleEnvChange = (envId: string) => {
    setSelectedEnvId(envId);
    const env = currentProject?.environments.find((e) => e.id === envId);
    if (env && env.accounts.length > 0) {
      const nextAccId = env.accounts[0].id;
      setSelectedAccountId(nextAccId);
      persistSelection(selectedProjectId, envId, nextAccId);
    } else {
      setSelectedAccountId('');
    }
  };

  const handleAccountChange = (accId: string) => {
    setSelectedAccountId(accId);
    persistSelection(selectedProjectId, selectedEnvId, accId);
  };

  // 一键直达并登录
  const handleLaunch = async () => {
    if (!currentEnv?.url || !currentEnv.url.startsWith('http')) {
      onToast('当前环境尚未配置有效的入口 URL，请先前往设置补全');
      return;
    }
    if (!currentAccount) {
      onToast('请先选择或添加要自动填写的登录账号');
      return;
    }

    setIsLaunching(true);
    onToast(`正在打开 ${currentEnv.name} 并准备自动填充凭据...`);

    try {
      const res = await sendToBackground<{ success?: boolean; message?: string; error?: string }>({
        type: 'TRIGGER_QUICK_LOGIN',
        payload: {
          url: currentEnv.url,
          username: currentAccount.username,
          password: currentAccount.password,
          loginTriggerSelector: currentEnv.loginTriggerSelector,
          autoSubmit: currentEnv.autoSubmit,
        },
      });

      if (res?.error) {
        onToast(`快捷登录提示: ${res.error}`);
      } else if (res?.message) {
        onToast(res.message);
      } else {
        onToast(`已打开并成功为 [${currentAccount.name}] 填充凭据！`);
      }
    } catch (err) {
      onToast(`快捷直达失败: ${(err as Error).message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  // 1. 无项目配置时的引导卡片
  if (projects.length === 0) {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-xl p-3 border border-dashed border-blue-200/80 shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-100/80 flex items-center justify-center text-blue-600 shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-800">快捷环境与登录直达</span>
            <span className="text-[10px] text-slate-500">配置项目与账号，一键新标签免密直达</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onNavigateToSettings}
          className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-blue-200 text-blue-600 rounded-md text-[11px] font-semibold flex items-center gap-0.5 shrink-0 transition-colors shadow-2xs"
        >
          <span>去配置</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // 2. 正常快捷直达面板
  return (
    <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex flex-col gap-2.5">
      {/* 头部标题与管理链接 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center text-blue-600">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-800">快捷环境直达</span>
          {currentEnv?.autoSubmit && (
            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded flex items-center gap-0.5">
              <Check className="w-2.5 h-2.5" />
              自动提交
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onNavigateToSettings}
          className="text-[11px] text-slate-400 hover:text-blue-600 flex items-center gap-0.5 transition-colors"
          title="管理环境与账号"
        >
          <Settings className="w-3 h-3" />
          <span>配置</span>
        </button>
      </div>

      {/* 级联选择区：两行宽敞排版，防止长名称被截断 */}
      <div className="flex flex-col gap-2">
        {/* 第一行：项目 + 环境并排 */}
        <div className="grid grid-cols-2 gap-2">
          {/* 项目下拉 */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <FolderKanban className="w-3 h-3 text-blue-500 shrink-0" />
              <span>项目</span>
            </label>
            <div className="relative flex items-center">
              <select
                value={selectedProjectId}
                onChange={(e) => handleProjectChange(e.target.value)}
                className="w-full pl-2.5 pr-6 py-1.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-blue-500 rounded-lg text-xs font-medium text-slate-800 outline-none appearance-none transition-all cursor-pointer truncate shadow-2xs"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 shrink-0" />
            </div>
          </div>

          {/* 环境下拉 */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
              <Globe className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>环境</span>
            </label>
            <div className="relative flex items-center">
              <select
                value={selectedEnvId}
                onChange={(e) => handleEnvChange(e.target.value)}
                className="w-full pl-2.5 pr-6 py-1.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-blue-500 rounded-lg text-xs font-medium text-slate-800 outline-none appearance-none transition-all cursor-pointer truncate shadow-2xs"
              >
                {currentProject?.environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 shrink-0" />
            </div>
          </div>
        </div>

        {/* 第二行：登录账号（全宽展示） */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
            <label className="flex items-center gap-1">
              <User className="w-3 h-3 text-indigo-500 shrink-0" />
              <span>登录身份 / 账号</span>
            </label>
            {currentAccount && (
              <span className="text-[10px] text-slate-400 font-mono">
                {currentAccount.username}
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <select
              value={selectedAccountId}
              onChange={(e) => handleAccountChange(e.target.value)}
              className="w-full pl-2.5 pr-6 py-1.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-blue-500 rounded-lg text-xs font-medium text-slate-800 outline-none appearance-none transition-all cursor-pointer truncate shadow-2xs"
            >
              {currentEnv?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} (${a.username})` : a.username}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 shrink-0" />
          </div>
        </div>
      </div>

      {/* 一键直达按钮 */}
      <button
        type="button"
        onClick={handleLaunch}
        disabled={isLaunching || !currentEnv}
        className="w-full py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.99] text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-60"
      >
        {isLaunching ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>正在打开并填充...</span>
          </>
        ) : (
          <>
            <ExternalLink className="w-3.5 h-3.5" />
            <span>一键直达并登录</span>
          </>
        )}
      </button>
    </div>
  );
};
