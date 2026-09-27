/**
 * 配置导出与导入工具模块 src/shared/utils/configBackup.ts
 * 提供一键导出、结构解析校验、扁平兼容与写入持久化
 */

import { aiProviderService, AIProviderMode } from '../../ai';

export interface AppConfigExportData {
  version: 1;
  appName: 'QA Copilot';
  exportedAt: string;
  settings: {
    ai: {
      aiProviderMode: AIProviderMode;
      aiBaseUrl: string;
      aiApiKey: string;
      aiModel: string;
      aiRemoteEndpoint?: string;
      aiBugAssistanceEnabled: boolean;
      aiVisionEnabled?: boolean;
    };
    zentao: {
      zentaoBaseUrl: string;
      zentaoAuthMode: 'cookie' | 'token';
      zentaoApiVersion: 'v1' | 'v2';
      zentaoProductId: number;
      zentaoOpenedBuild: string;
      zentaoProjectId?: number;
      zentaoExecutionId?: number;
      zentaoAssignedTo?: string;
      zentaoToken?: string;
    };
    quickLogin?: any;
    general: {
      slowThresholdMs: number;
    };
    networkMockRules?: any[];
  };
}

export interface ExtractedConfig {
  localSettings: Record<string, any>;
  sessionSettings: Record<string, any>;
  summary: string[];
}

export interface ParseResult {
  success: boolean;
  error?: string;
  extracted?: ExtractedConfig;
}

/**
 * 采集当前所有插件配置生成标准导出数据
 */
export async function buildExportPayload(): Promise<string> {
  const localKeys = {
    aiProviderMode: 'heuristic',
    aiBaseUrl: 'https://api.deepseek.com/v1',
    aiApiKey: '',
    aiModel: 'deepseek-chat',
    aiRemoteEndpoint: '',
    aiBugAssistanceEnabled: true,
    aiVisionEnabled: true,
    zentaoBaseUrl: 'https://zentao.hbisscm.com',
    zentaoAuthMode: 'cookie',
    zentaoApiVersion: 'v2',
    zentaoProductId: 0,
    zentaoOpenedBuild: 'trunk',
    zentaoProjectId: 0,
    zentaoExecutionId: 0,
    zentaoAssignedTo: '',
    slowThresholdMs: 2000,
    quickLoginConfig: null,
    networkMockRules: [],
  };

  const localRes = typeof chrome !== 'undefined' && chrome.storage?.local
    ? await chrome.storage.local.get(localKeys)
    : localKeys;

  let zentaoToken = '';
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      const sessionRes = await chrome.storage.session.get({ zentaoToken: '' });
      zentaoToken = sessionRes.zentaoToken || '';
    } catch {
      // 容错兼容
    }
  }

  const payload: AppConfigExportData = {
    version: 1,
    appName: 'QA Copilot',
    exportedAt: new Date().toISOString(),
    settings: {
      ai: {
        aiProviderMode: localRes.aiProviderMode || 'heuristic',
        aiBaseUrl: localRes.aiBaseUrl || 'https://api.deepseek.com/v1',
        aiApiKey: localRes.aiApiKey || '',
        aiModel: localRes.aiModel || 'deepseek-chat',
        aiRemoteEndpoint: localRes.aiRemoteEndpoint || localRes.aiBaseUrl || '',
        aiBugAssistanceEnabled: localRes.aiBugAssistanceEnabled !== false,
        aiVisionEnabled: localRes.aiVisionEnabled !== false,
      },
      zentao: {
        zentaoBaseUrl: localRes.zentaoBaseUrl || 'https://zentao.hbisscm.com',
        zentaoAuthMode: localRes.zentaoAuthMode || 'cookie',
        zentaoApiVersion: localRes.zentaoApiVersion || 'v2',
        zentaoProductId: Number(localRes.zentaoProductId) || 0,
        zentaoOpenedBuild: localRes.zentaoOpenedBuild || 'trunk',
        zentaoProjectId: localRes.zentaoProjectId ? Number(localRes.zentaoProjectId) : undefined,
        zentaoExecutionId: localRes.zentaoExecutionId ? Number(localRes.zentaoExecutionId) : undefined,
        zentaoAssignedTo: localRes.zentaoAssignedTo || '',
        zentaoToken,
      },
      quickLogin: localRes.quickLoginConfig || undefined,
      general: {
        slowThresholdMs: Number(localRes.slowThresholdMs) || 2000,
      },
      networkMockRules: Array.isArray(localRes.networkMockRules) ? localRes.networkMockRules : [],
    },
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * 解析并校验输入的配置 JSON 字符串
 * 支持标准分层格式与扁平键值对格式
 */
export function parseAndValidateConfig(jsonStr: string): ParseResult {
  if (!jsonStr || typeof jsonStr !== 'string' || !jsonStr.trim()) {
    return { success: false, error: '配置文件内容为空' };
  }

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    return { success: false, error: '文件内容不是合法的 JSON 格式' };
  }

  if (!data || typeof data !== 'object') {
    return { success: false, error: '配置格式不合法，根节点需为对象' };
  }

  const localSettings: Record<string, any> = {};
  const sessionSettings: Record<string, any> = {};
  const summary: string[] = [];

  // 判断是否为分层格式 (data.settings)
  const src = data.settings && typeof data.settings === 'object' ? data.settings : data;

  // 1. AI 配置解析
  const aiSrc = src.ai && typeof src.ai === 'object' ? src.ai : src;
  let hasAi = false;
  if ('aiProviderMode' in aiSrc) {
    localSettings.aiProviderMode = aiSrc.aiProviderMode;
    hasAi = true;
  }
  if ('aiBaseUrl' in aiSrc) {
    localSettings.aiBaseUrl = aiSrc.aiBaseUrl;
    localSettings.aiRemoteEndpoint = aiSrc.aiBaseUrl;
    hasAi = true;
  }
  if ('aiApiKey' in aiSrc) {
    localSettings.aiApiKey = aiSrc.aiApiKey;
    hasAi = true;
  }
  if ('aiModel' in aiSrc) {
    localSettings.aiModel = aiSrc.aiModel;
    hasAi = true;
  }
  if ('aiBugAssistanceEnabled' in aiSrc) {
    localSettings.aiBugAssistanceEnabled = aiSrc.aiBugAssistanceEnabled;
    hasAi = true;
  }
  if ('aiVisionEnabled' in aiSrc) {
    localSettings.aiVisionEnabled = Boolean(aiSrc.aiVisionEnabled);
    hasAi = true;
  }
  if (hasAi) {
    summary.push('AI 大模型配置');
  }

  // 2. 禅道配置解析
  const zentaoSrc = src.zentao && typeof src.zentao === 'object' ? src.zentao : src;
  let hasZentao = false;
  if ('zentaoBaseUrl' in zentaoSrc) {
    localSettings.zentaoBaseUrl = zentaoSrc.zentaoBaseUrl;
    hasZentao = true;
  }
  if ('zentaoAuthMode' in zentaoSrc) {
    localSettings.zentaoAuthMode = zentaoSrc.zentaoAuthMode;
    hasZentao = true;
  }
  if ('zentaoApiVersion' in zentaoSrc) {
    localSettings.zentaoApiVersion = zentaoSrc.zentaoApiVersion;
    hasZentao = true;
  }
  if ('zentaoProductId' in zentaoSrc) {
    localSettings.zentaoProductId = Number(zentaoSrc.zentaoProductId) || 0;
    hasZentao = true;
  }
  if ('zentaoOpenedBuild' in zentaoSrc) {
    localSettings.zentaoOpenedBuild = zentaoSrc.zentaoOpenedBuild;
    hasZentao = true;
  }
  if ('zentaoProjectId' in zentaoSrc) {
    localSettings.zentaoProjectId = zentaoSrc.zentaoProjectId ? Number(zentaoSrc.zentaoProjectId) : 0;
    hasZentao = true;
  }
  if ('zentaoExecutionId' in zentaoSrc) {
    localSettings.zentaoExecutionId = zentaoSrc.zentaoExecutionId ? Number(zentaoSrc.zentaoExecutionId) : 0;
    hasZentao = true;
  }
  if ('zentaoAssignedTo' in zentaoSrc) {
    localSettings.zentaoAssignedTo = zentaoSrc.zentaoAssignedTo;
    hasZentao = true;
  }
  if ('zentaoToken' in zentaoSrc && typeof zentaoSrc.zentaoToken === 'string') {
    sessionSettings.zentaoToken = zentaoSrc.zentaoToken;
    hasZentao = true;
  }
  if (hasZentao) {
    summary.push('禅道集成配置');
  }

  // 3. 快捷登录配置
  const qlSrc = src.quickLogin || src.quickLoginConfig;
  if (qlSrc && typeof qlSrc === 'object') {
    localSettings.quickLoginConfig = qlSrc;
    summary.push('快捷登录配置');
  }

  // 4. 通用监控与阈值
  const genSrc = src.general && typeof src.general === 'object' ? src.general : src;
  if ('slowThresholdMs' in genSrc) {
    localSettings.slowThresholdMs = Number(genSrc.slowThresholdMs) || 2000;
    summary.push('接口监控阈值');
  }

  // 5. Mock 规则
  if (Array.isArray(src.networkMockRules)) {
    localSettings.networkMockRules = src.networkMockRules;
    summary.push('网络 Mock 规则');
  }

  if (Object.keys(localSettings).length === 0 && Object.keys(sessionSettings).length === 0) {
    return {
      success: false,
      error: '文件中未包含任何可识别的 QA Copilot 配置项',
    };
  }

  return {
    success: true,
    extracted: {
      localSettings,
      sessionSettings,
      summary,
    },
  };
}

/**
 * 将解析出的配置实际写入 Chrome 存储并激活热更新
 */
export async function applyImportedConfig(extracted: ExtractedConfig): Promise<void> {
  const { localSettings, sessionSettings } = extracted;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    if (Object.keys(localSettings).length > 0) {
      await chrome.storage.local.set(localSettings);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    if (Object.keys(sessionSettings).length > 0) {
      await chrome.storage.session.set(sessionSettings);
    }
  }

  // 运行时热更新 AI 配置
  if (localSettings.aiProviderMode || localSettings.aiBaseUrl || localSettings.aiApiKey || localSettings.aiModel) {
    try {
      const mode = localSettings.aiProviderMode || 'heuristic';
      aiProviderService.configure(mode, {
        baseUrl: localSettings.aiBaseUrl || 'https://api.deepseek.com/v1',
        apiKey: localSettings.aiApiKey || '',
        model: localSettings.aiModel || 'deepseek-chat',
      });
    } catch {
      // 容错吸收
    }
  }
}

/**
 * 触发浏览器本地文件下载
 */
export function downloadConfigFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
