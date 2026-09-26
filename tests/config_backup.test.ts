/**
 * 配置备份与导入导出测试套件 tests/config_backup.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildExportPayload,
  parseAndValidateConfig,
  applyImportedConfig,
} from '../src/shared/utils/configBackup';
import { aiProviderService } from '../src/ai';

describe('配置导出与导入工具模块 (configBackup)', () => {
  let fakeLocalStorage: Record<string, any> = {};
  let fakeSessionStorage: Record<string, any> = {};

  beforeEach(() => {
    fakeLocalStorage = {
      aiProviderMode: 'remote',
      aiBaseUrl: 'https://api.openai.com/v1',
      aiApiKey: 'sk-test-key-123456',
      aiModel: 'gpt-4o-mini',
      aiBugAssistanceEnabled: true,
      zentaoBaseUrl: 'https://zentao.test.com',
      zentaoAuthMode: 'token',
      zentaoApiVersion: 'v2',
      zentaoProductId: 42,
      zentaoOpenedBuild: 'v1.0.0',
      zentaoProjectId: 101,
      zentaoExecutionId: 202,
      zentaoAssignedTo: 'tester_zhang',
      slowThresholdMs: 3000,
      quickLoginConfig: {
        projects: [
          {
            id: 'proj_1',
            name: '核心电商平台',
            environments: [
              {
                id: 'env_1',
                name: '测试环境',
                url: 'https://test.shop.com',
                accounts: [{ id: 'acc_1', name: '管理员', username: 'admin', password: '123' }],
              },
            ],
          },
        ],
      },
      networkMockRules: [
        {
          id: 'mock_1',
          name: '模拟500错误',
          urlPattern: '/api/v1/user',
          status: 500,
          responseBody: '{"error":"server error"}',
          enabled: true,
        },
      ],
    };

    fakeSessionStorage = {
      zentaoToken: 'session_token_xyz',
    };

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (defaults: any) => {
            return { ...defaults, ...fakeLocalStorage };
          }),
          set: vi.fn(async (data: any) => {
            fakeLocalStorage = { ...fakeLocalStorage, ...data };
          }),
        },
        session: {
          get: vi.fn(async (defaults: any) => {
            return { ...defaults, ...fakeSessionStorage };
          }),
          set: vi.fn(async (data: any) => {
            fakeSessionStorage = { ...fakeSessionStorage, ...data };
          }),
        },
      },
    };
  });

  it('1. buildExportPayload 导出完整合法 JSON 与当前所有核心配置', async () => {
    const jsonString = await buildExportPayload();
    expect(typeof jsonString).toBe('string');

    const parsed = JSON.parse(jsonString);
    expect(parsed.appName).toBe('QA Copilot');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBeDefined();

    // 校验 settings
    expect(parsed.settings.ai.aiBaseUrl).toBe('https://api.openai.com/v1');
    expect(parsed.settings.ai.aiApiKey).toBe('sk-test-key-123456');
    expect(parsed.settings.ai.aiModel).toBe('gpt-4o-mini');
    expect(parsed.settings.zentao.zentaoBaseUrl).toBe('https://zentao.test.com');
    expect(parsed.settings.zentao.zentaoToken).toBe('session_token_xyz');
    expect(parsed.settings.zentao.zentaoProductId).toBe(42);
    expect(parsed.settings.general.slowThresholdMs).toBe(3000);
    expect(parsed.settings.quickLogin.projects).toHaveLength(1);
    expect(parsed.settings.networkMockRules).toHaveLength(1);
  });

  it('2. parseAndValidateConfig 正确解析标准结构并生成中文摘要', () => {
    const validJson = JSON.stringify({
      version: 1,
      appName: 'QA Copilot',
      settings: {
        ai: {
          aiProviderMode: 'remote',
          aiBaseUrl: 'https://api.deepseek.com/v1',
          aiApiKey: 'sk-999',
          aiModel: 'deepseek-chat',
        },
        zentao: {
          zentaoBaseUrl: 'https://zentao.mycompany.com',
          zentaoAuthMode: 'cookie',
          zentaoProductId: 12,
        },
        general: {
          slowThresholdMs: 1500,
        },
      },
    });

    const result = parseAndValidateConfig(validJson);
    expect(result.success).toBe(true);
    expect(result.extracted).toBeDefined();
    expect(result.extracted!.localSettings.aiBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(result.extracted!.localSettings.zentaoProductId).toBe(12);
    expect(result.extracted!.localSettings.slowThresholdMs).toBe(1500);
    expect(result.extracted!.summary).toContain('AI 大模型配置');
    expect(result.extracted!.summary).toContain('禅道集成配置');
    expect(result.extracted!.summary).toContain('接口监控阈值');
  });

  it('3. parseAndValidateConfig 向下兼容扁平键值对配置', () => {
    const flatJson = JSON.stringify({
      aiBaseUrl: 'https://ollama.local/v1',
      aiModel: 'qwen2.5',
      zentaoBaseUrl: 'https://zentao.hbisscm.com',
      slowThresholdMs: 4000,
    });

    const result = parseAndValidateConfig(flatJson);
    expect(result.success).toBe(true);
    expect(result.extracted!.localSettings.aiBaseUrl).toBe('https://ollama.local/v1');
    expect(result.extracted!.localSettings.aiModel).toBe('qwen2.5');
    expect(result.extracted!.localSettings.zentaoBaseUrl).toBe('https://zentao.hbisscm.com');
    expect(result.extracted!.localSettings.slowThresholdMs).toBe(4000);
  });

  it('4. parseAndValidateConfig 拦截无效 JSON、空内容与非目标数据', () => {
    expect(parseAndValidateConfig('').success).toBe(false);
    expect(parseAndValidateConfig('not a json').success).toBe(false);
    expect(parseAndValidateConfig('{}').success).toBe(false);
    expect(parseAndValidateConfig('{"foo":"bar"}').success).toBe(false);
  });

  it('5. applyImportedConfig 正确更新 storage 与运行时 AI 配置', async () => {
    const configureSpy = vi.spyOn(aiProviderService, 'configure');

    const extracted = {
      localSettings: {
        aiProviderMode: 'remote' as const,
        aiBaseUrl: 'https://new-api.com',
        aiApiKey: 'sk-new-key',
        aiModel: 'qwen-plus',
        slowThresholdMs: 2500,
      },
      sessionSettings: {
        zentaoToken: 'new_token_777',
      },
      summary: ['AI 大模型配置', '接口监控阈值'],
    };

    await applyImportedConfig(extracted);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(extracted.localSettings);
    expect(chrome.storage.session.set).toHaveBeenCalledWith(extracted.sessionSettings);
    expect(configureSpy).toHaveBeenCalledWith('remote', {
      baseUrl: 'https://new-api.com',
      apiKey: 'sk-new-key',
      model: 'qwen-plus',
    });
  });
});
