/**
 * 快捷登录与多环境配置组件 src/sidepanel/components/QuickLoginSettingsCard.tsx
 * 支持多项目、多环境、多账号的三级树状维护与本地持久化
 */

import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Eye,
  EyeOff,
  Globe,
  User,
  Sparkles,
  Layers,
} from 'lucide-react';
import {
  QuickLoginAccount,
  QuickLoginConfig,
  QuickLoginEnvironment,
  QuickLoginProject,
} from '../../shared/types/quickLogin';
import { createEntityId } from '../../shared/utils/id';

interface QuickLoginSettingsCardProps {
  onToast: (msg: string) => void;
}

export const QuickLoginSettingsCard: React.FC<QuickLoginSettingsCardProps> = ({ onToast }) => {
  const [projects, setProjects] = useState<QuickLoginProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [showPasswordMap, setShowPasswordMap] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // 初始化加载
  useEffect(() => {
    chrome.storage.local.get({ quickLoginConfig: null }, (res) => {
      const config = res.quickLoginConfig as QuickLoginConfig | null;
      if (config && Array.isArray(config.projects) && config.projects.length > 0) {
        setProjects(config.projects);
        const defaultProj =
          config.projects.find((p) => p.id === config.lastSelected?.projectId) || config.projects[0];
        setSelectedProjectId(defaultProj.id);
        const defaultEnv =
          defaultProj.environments.find((e) => e.id === config.lastSelected?.envId) ||
          defaultProj.environments[0];
        if (defaultEnv) {
          setSelectedEnvId(defaultEnv.id);
        }
      }
    });
  }, []);

  const currentProject = projects.find((p) => p.id === selectedProjectId);
  const currentEnv = currentProject?.environments.find((e) => e.id === selectedEnvId);

  const togglePasswordVisibility = (accountId: string) => {
    setShowPasswordMap((prev) => ({ ...prev, [accountId]: !prev[accountId] }));
  };

  // 保存至 storage
  const handleSave = async (updatedProjects?: QuickLoginProject[]) => {
    setSaving(true);
    try {
      const listToSave = updatedProjects || projects;
      const config: QuickLoginConfig = {
        projects: listToSave,
        lastSelected: {
          projectId: selectedProjectId,
          envId: selectedEnvId,
        },
      };
      await chrome.storage.local.set({ quickLoginConfig: config });
      onToast('快捷登录配置已成功保存！');
    } catch (err) {
      onToast(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 1. 项目操作
  const handleAddProject = () => {
    const newProjId = createEntityId('proj');
    const newEnvId = createEntityId('env');
    const newAccId = createEntityId('acc');
    const newProj: QuickLoginProject = {
      id: newProjId,
      name: `新项目 ${projects.length + 1}`,
      environments: [
        {
          id: newEnvId,
          name: '测试环境 (TEST)',
          url: 'http://',
          autoSubmit: false,
          accounts: [
            {
              id: newAccId,
              name: '测试管理员',
              username: 'admin',
              password: '',
            },
          ],
        },
      ],
    };
    const nextList = [...projects, newProj];
    setProjects(nextList);
    setSelectedProjectId(newProjId);
    setSelectedEnvId(newEnvId);
    handleSave(nextList);
  };

  const handleDeleteProject = (projId: string) => {
    const nextList = projects.filter((p) => p.id !== projId);
    setProjects(nextList);
    if (selectedProjectId === projId) {
      setSelectedProjectId(nextList[0]?.id || '');
      setSelectedEnvId(nextList[0]?.environments[0]?.id || '');
    }
    handleSave(nextList);
  };

  const handleUpdateProjectName = (name: string) => {
    if (!currentProject) return;
    const nextList = projects.map((p) => (p.id === currentProject.id ? { ...p, name } : p));
    setProjects(nextList);
  };

  // 2. 环境操作
  const handleAddEnvironment = () => {
    if (!currentProject) return;
    const newEnvId = createEntityId('env');
    const newAccId = createEntityId('acc');
    const newEnv: QuickLoginEnvironment = {
      id: newEnvId,
      name: `新环境 ${currentProject.environments.length + 1}`,
      url: 'http://',
      autoSubmit: false,
      accounts: [
        {
          id: newAccId,
          name: '默认账号',
          username: '',
          password: '',
        },
      ],
    };
    const nextEnvs = [...currentProject.environments, newEnv];
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
    setSelectedEnvId(newEnvId);
    handleSave(nextList);
  };

  const handleDeleteEnvironment = (envId: string) => {
    if (!currentProject) return;
    const nextEnvs = currentProject.environments.filter((e) => e.id !== envId);
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
    if (selectedEnvId === envId) {
      setSelectedEnvId(nextEnvs[0]?.id || '');
    }
    handleSave(nextList);
  };

  const handleUpdateEnvironment = (
    envId: string,
    field: keyof QuickLoginEnvironment,
    value: string | boolean | undefined
  ) => {
    if (!currentProject) return;
    const nextEnvs = currentProject.environments.map((e) =>
      e.id === envId ? { ...e, [field]: value } : e
    );
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
  };

  // 3. 账号操作
  const handleAddAccount = () => {
    if (!currentProject || !currentEnv) return;
    const newAccId = createEntityId('acc');
    const newAcc: QuickLoginAccount = {
      id: newAccId,
      name: `账号 ${currentEnv.accounts.length + 1}`,
      username: '',
      password: '',
    };
    const nextAccs = [...currentEnv.accounts, newAcc];
    const nextEnvs = currentProject.environments.map((e) =>
      e.id === currentEnv.id ? { ...e, accounts: nextAccs } : e
    );
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
    handleSave(nextList);
  };

  const handleDeleteAccount = (accId: string) => {
    if (!currentProject || !currentEnv) return;
    const nextAccs = currentEnv.accounts.filter((a) => a.id !== accId);
    const nextEnvs = currentProject.environments.map((e) =>
      e.id === currentEnv.id ? { ...e, accounts: nextAccs } : e
    );
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
    handleSave(nextList);
  };

  const handleUpdateAccount = (accId: string, field: keyof QuickLoginAccount, value: string) => {
    if (!currentProject || !currentEnv) return;
    const nextAccs = currentEnv.accounts.map((a) => (a.id === accId ? { ...a, [field]: value } : a));
    const nextEnvs = currentProject.environments.map((e) =>
      e.id === currentEnv.id ? { ...e, accounts: nextAccs } : e
    );
    const nextList = projects.map((p) =>
      p.id === currentProject.id ? { ...p, environments: nextEnvs } : p
    );
    setProjects(nextList);
  };

  return (
    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
          <Layers className="w-4 h-4 text-emerald-600" />
          <span>快捷登录与环境配置</span>
          <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
            一键直达
          </span>
        </div>
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={saving}
          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded text-[11px] flex items-center gap-1 transition-colors shadow-xs"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? '保存中...' : '保存配置'}</span>
        </button>
      </div>

      <span className="text-[11px] text-slate-500">
        配置各业务系统在不同环境下的入口地址与登录账号。配置后，在插件首页可一键跳转新标签页并自动填充凭据。
      </span>

      {/* 1. 项目列表维护 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-700 text-xs flex items-center gap-1">
            <span>选择项目</span>
            <span className="text-[10px] text-slate-400 font-normal">({projects.length} 个项目)</span>
          </label>
          <button
            type="button"
            onClick={handleAddProject}
            className="text-blue-600 hover:text-blue-700 text-[11px] flex items-center gap-0.5 font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增项目</span>
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="py-4 border border-dashed border-slate-200 rounded-lg text-center text-slate-400 text-xs flex flex-col items-center gap-1.5">
            <span>暂未配置任何项目</span>
            <button
              type="button"
              onClick={handleAddProject}
              className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 font-medium"
            >
              立即新增第一个项目
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                const proj = projects.find((p) => p.id === e.target.value);
                if (proj && proj.environments[0]) {
                  setSelectedEnvId(proj.environments[0].id);
                } else {
                  setSelectedEnvId('');
                }
              }}
              className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {currentProject && (
              <>
                <input
                  type="text"
                  value={currentProject.name}
                  onChange={(e) => handleUpdateProjectName(e.target.value)}
                  placeholder="项目名称"
                  className="w-36 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  title="重命名当前项目"
                />
                <button
                  type="button"
                  onClick={() => handleDeleteProject(currentProject.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="删除当前项目"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. 环境列表维护 */}
      {currentProject && (
        <div className="mt-1 flex flex-col gap-2 p-2.5 bg-slate-50/70 rounded-xl border border-slate-200/80">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5">
            <div className="flex items-center gap-1 font-semibold text-slate-700 text-xs">
              <Globe className="w-3.5 h-3.5 text-blue-600" />
              <span>环境列表 ({currentProject.environments.length})</span>
            </div>
            <button
              type="button"
              onClick={handleAddEnvironment}
              className="text-blue-600 hover:text-blue-700 text-[11px] flex items-center gap-0.5 font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加环境</span>
            </button>
          </div>

          {/* 环境选择 Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {currentProject.environments.map((env) => {
              const isSelected = env.id === selectedEnvId;
              return (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => setSelectedEnvId(env.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium shrink-0 transition-all border ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {env.name}
                </button>
              );
            })}
          </div>

          {/* 当前环境详情配置 */}
          {currentEnv && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">环境名称</span>
                  <input
                    type="text"
                    value={currentEnv.name}
                    onChange={(e) => handleUpdateEnvironment(currentEnv.id, 'name', e.target.value)}
                    placeholder="如: 测试环境 (TEST)"
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-500">登录入口 URL</span>
                  <input
                    type="text"
                    value={currentEnv.url}
                    onChange={(e) => handleUpdateEnvironment(currentEnv.id, 'url', e.target.value)}
                    placeholder="http://test.example.com"
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* 高级选项：弹窗登录选择器与自动提交开关 */}
              <div className="flex flex-col gap-1.5 p-2 bg-white/80 rounded-lg border border-slate-200/80">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[11px] font-semibold text-slate-700">登录弹窗与提交设置</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(currentEnv.autoSubmit)}
                      onChange={(e) =>
                        handleUpdateEnvironment(currentEnv.id, 'autoSubmit', e.target.checked)
                      }
                      className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span>填充后自动提交登录</span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 shrink-0">弹窗按钮选择器(可选):</span>
                  <input
                    type="text"
                    value={currentEnv.loginTriggerSelector || ''}
                    onChange={(e) =>
                      handleUpdateEnvironment(currentEnv.id, 'loginTriggerSelector', e.target.value)
                    }
                    placeholder="留空自动智能识别；如: #loginBtn 或 .nav-login"
                    className="flex-1 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono outline-none focus:border-blue-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* 3. 账号管理列表 */}
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 text-xs flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-blue-600" />
                    <span>账号列表 ({currentEnv.accounts.length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleAddAccount}
                    className="text-blue-600 hover:text-blue-700 text-[11px] flex items-center gap-0.5 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加账号</span>
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  {currentEnv.accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded-lg shadow-2xs"
                    >
                      <input
                        type="text"
                        value={acc.name}
                        onChange={(e) => handleUpdateAccount(acc.id, 'name', e.target.value)}
                        placeholder="账号备注 (如: 超管)"
                        className="w-24 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] outline-none focus:border-blue-500 focus:bg-white"
                        title="账号身份说明"
                      />
                      <input
                        type="text"
                        value={acc.username}
                        onChange={(e) => handleUpdateAccount(acc.id, 'username', e.target.value)}
                        placeholder="用户名 / 手机号"
                        className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] outline-none focus:border-blue-500 focus:bg-white"
                      />
                      <div className="relative w-28">
                        <input
                          type={showPasswordMap[acc.id] ? 'text' : 'password'}
                          value={acc.password}
                          onChange={(e) => handleUpdateAccount(acc.id, 'password', e.target.value)}
                          placeholder="密码"
                          className="w-full pl-2 pr-6 py-1 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono outline-none focus:border-blue-500 focus:bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(acc.id)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          title={showPasswordMap[acc.id] ? '隐藏密码' : '显示密码'}
                        >
                          {showPasswordMap[acc.id] ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                        title="删除账号"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 环境删除按钮 */}
              {currentProject.environments.length > 1 && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => handleDeleteEnvironment(currentEnv.id)}
                    className="text-[11px] text-red-500 hover:text-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>删除此环境 ({currentEnv.name})</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
