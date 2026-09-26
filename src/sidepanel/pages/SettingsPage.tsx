/**
 * 设置页面 src/sidepanel/pages/SettingsPage.tsx
 * 重构：禅道与智能生成独立解耦、一键获取浏览器禅道信息、动态产品与版本选择器 (CFG-01 / CFG-02 / CFG-05)
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PlayCircle,
  Save,
  Search,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Building2,
  Sparkles,
  Package,
  Layers,
  GitBranch,
  User,
  Eye,
  EyeOff,
  Bot,
  Sliders,
  Download,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { AIProviderMode, aiProviderService } from '../../ai';
import { ZentaoClient, ZentaoProductItem, ZentaoProjectItem, ZentaoBuildItem, ZentaoUserItem } from '../../shared/integrations/zentao';
import {
  normalizeZentaoUrl,
  detectBrowserZentao,
  isSameZentaoSite,
  DetectedZentaoInfo,
} from '../../shared/integrations/zentaoHelper';
import { SearchableSelect } from '../components/SearchableSelect';
import { QuickLoginSettingsCard } from '../components/QuickLoginSettingsCard';
import {
  buildExportPayload,
  parseAndValidateConfig,
  applyImportedConfig,
  downloadConfigFile,
} from '../../shared/utils/configBackup';

export const SettingsPage: React.FC = () => {
  const { setCurrentTab, setToastMessage, settingsSubTab, setSettingsSubTab } = useAppStore();

  // 1. 采集设置
  const [slowThresholdMs, setSlowThresholdMs] = useState(2000);

  // 2. 智能生成大模型配置 (Base URL + API Key + Model)
  const [aiProviderMode, setAiProviderMode] = useState<AIProviderMode>('heuristic');
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.deepseek.com/v1');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('deepseek-chat');
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiBugAssistanceEnabled, setAiBugAssistanceEnabled] = useState(true);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const aiProbeIdRef = useRef(0);

  // 3. 禅道集成配置
  const [zentaoBaseUrl, setZentaoBaseUrl] = useState('https://zentao.hbisscm.com');
  const [zentaoAuthMode, setZentaoAuthMode] = useState<'cookie' | 'token'>('cookie');
  const [zentaoApiVersion, setZentaoApiVersion] = useState<'v1' | 'v2'>('v2');
  const [zentaoToken, setZentaoToken] = useState('');
  const [zentaoProductId, setZentaoProductId] = useState<number>(0);
  const [zentaoOpenedBuild, setZentaoOpenedBuild] = useState('trunk');
  const [zentaoProjectId, setZentaoProjectId] = useState<number | undefined>(undefined);
  const [zentaoExecutionId, setZentaoExecutionId] = useState<number | undefined>(undefined);
  const [zentaoAssignedTo, setZentaoAssignedTo] = useState('');

  // 禅道动态状态与世代保护 (CFG-01 / P2 竞态防护)
  const [zentaoTesting, setZentaoTesting] = useState(false);
  const [zentaoTestResult, setZentaoTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const zentaoProbeIdRef = useRef(0);
  const productProbeIdRef = useRef(0);
  const projectProbeIdRef = useRef(0);
  const buildProbeIdRef = useRef(0);
  const userProbeIdRef = useRef(0);

  // 一键探测与动态列表
  const [detecting, setDetecting] = useState(false);
  const [detectedInfo, setDetectedInfo] = useState<DetectedZentaoInfo | null>(null);
  const [productList, setProductList] = useState<ZentaoProductItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [projectList, setProjectList] = useState<ZentaoProjectItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [buildList, setBuildList] = useState<ZentaoBuildItem[]>([{ id: 'trunk', name: 'trunk (主干)' }]);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [userList, setUserList] = useState<ZentaoUserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [manualProductInput, setManualProductInput] = useState(false);
  const [manualProjectInput, setManualProjectInput] = useState(false);
  const [isCustomBuild, setIsCustomBuild] = useState(false);

  const selectedProduct = productList.find((p) => p.id === zentaoProductId);
  const selectedProject = projectList.find((p) => p.id === zentaoProjectId);

  // 一键导出/导入配置状态与引用
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [quickLoginNonce, setQuickLoginNonce] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 任何配置项变动时，即刻将旧的异步检测与加载结果失效作废 (CFG-01)
  const invalidateZentaoChecks = () => {
    zentaoProbeIdRef.current++;
    productProbeIdRef.current++;
    projectProbeIdRef.current++;
    buildProbeIdRef.current++;
    setZentaoTesting(false);
    setZentaoTestResult(null);
  };

  useEffect(() => {
    chrome.storage.local.get(
      {
        slowThresholdMs: 2000,
        aiProviderMode: 'heuristic',
        aiBaseUrl: 'https://api.deepseek.com/v1',
        aiApiKey: '',
        aiModel: 'deepseek-chat',
        aiRemoteEndpoint: '',
        aiBugAssistanceEnabled: true,
        zentaoBaseUrl: 'https://zentao.hbisscm.com',
        zentaoAuthMode: 'cookie',
        zentaoApiVersion: 'v2',
        zentaoProductId: 0,
        zentaoOpenedBuild: 'trunk',
        zentaoProjectId: 0,
        zentaoExecutionId: 0,
        zentaoAssignedTo: '',
      },
      (result) => {
        setSlowThresholdMs(Number(result.slowThresholdMs) || 2000);
        setAiProviderMode(['disabled', 'remote'].includes(result.aiProviderMode) ? result.aiProviderMode : 'heuristic');
        const effectiveBaseUrl = String(result.aiBaseUrl || result.aiRemoteEndpoint || 'https://api.deepseek.com/v1');
        setAiBaseUrl(effectiveBaseUrl);
        setAiApiKey(String(result.aiApiKey || ''));
        setAiModel(String(result.aiModel || 'deepseek-chat'));
        setAiBugAssistanceEnabled(result.aiBugAssistanceEnabled !== false);
        const savedUrl = String(result.zentaoBaseUrl || 'https://zentao.hbisscm.com');
        const savedAuthMode = (result.zentaoAuthMode === 'token' ? 'token' : 'cookie') as 'cookie' | 'token';
        const savedVer = (result.zentaoApiVersion === 'v1' ? 'v1' : 'v2') as 'v1' | 'v2';
        setZentaoBaseUrl(savedUrl);
        setZentaoAuthMode(savedAuthMode);
        setZentaoApiVersion(savedVer);
        setZentaoProductId(Number(result.zentaoProductId) || 0);
        setZentaoOpenedBuild(String(result.zentaoOpenedBuild || 'trunk'));
        setZentaoProjectId(result.zentaoProjectId ? Number(result.zentaoProjectId) : undefined);
        setZentaoExecutionId(result.zentaoExecutionId ? Number(result.zentaoExecutionId) : undefined);
        setZentaoAssignedTo(String(result.zentaoAssignedTo || ''));

        // 如果已有 token 或处于 cookie 模式，尝试静默拉取一次产品列表并自动加载版本
        chrome.storage.session.get({ zentaoToken: '' }, (sessionRes) => {
          const tok = String(sessionRes.zentaoToken || '');
          setZentaoToken(tok);
          if (savedUrl && (savedAuthMode === 'cookie' || tok)) {
            loadProductsSilent(
              savedUrl,
              tok,
              Number(result.zentaoProductId) || 0,
              result.zentaoProjectId ? Number(result.zentaoProjectId) : undefined,
              savedVer,
              savedAuthMode
            );
          }
        });
      }
    );
  }, []);

  // 静默加载产品与版本 (带世代检查)
  const loadProductsSilent = async (
    baseUrl: string,
    token: string,
    activeProductId: number,
    savedProjectId?: number,
    apiVersion: 'v1' | 'v2' = 'v2',
    authMode: 'cookie' | 'token' = 'cookie'
  ) => {
    const probeId = ++productProbeIdRef.current;
    setLoadingProducts(true);
    try {
      const client = new ZentaoClient({
        baseUrl,
        authMode,
        token,
        apiVersion,
        productId: activeProductId,
        openedBuild: ['trunk'],
        projectId: savedProjectId,
      });
      const res = await client.fetchProducts();
      if (probeId !== productProbeIdRef.current) return;
      if (res.success && res.products && res.products.length > 0) {
        setProductList(res.products);
        const effectiveId = res.products.some((p) => p.id === activeProductId)
          ? activeProductId
          : res.products[0].id;
        setZentaoProductId(effectiveId);
        loadProjectsForProduct(baseUrl, token, effectiveId, apiVersion, authMode, savedProjectId);
      }
    } catch {
      // 容错吸收
    } finally {
      if (probeId === productProbeIdRef.current) {
        setLoadingProducts(false);
      }
    }
  };

  // 1. 保存智能生成配置 (大模型直连 / 本地规则)
  const handleSaveAi = async () => {
    if (aiProviderMode === 'remote' && !aiBaseUrl.trim()) {
      setToastMessage('请先填写大模型 API 地址 (Base URL)');
      return;
    }
    await chrome.storage.local.set({
      aiProviderMode,
      aiBaseUrl: aiBaseUrl.trim(),
      aiApiKey: aiApiKey.trim(),
      aiModel: aiModel.trim() || 'deepseek-chat',
      aiRemoteEndpoint: aiBaseUrl.trim(), // 保持旧字段同步
      aiBugAssistanceEnabled,
    });
    aiProviderService.configure(aiProviderMode, {
      baseUrl: aiBaseUrl.trim(),
      apiKey: aiApiKey.trim(),
      model: aiModel.trim() || 'deepseek-chat',
    });
    setToastMessage('智能生成大模型配置已成功保存！');
  };

  // 2. 保存禅道配置 (独立保存，持久化 authMode 与 apiVersion)
  const handleSaveZentao = async () => {
    const norm = normalizeZentaoUrl(zentaoBaseUrl, zentaoApiVersion);
    if (!norm.isValid) {
      setToastMessage(norm.error || '禅道地址格式不正确');
      return;
    }
    if (zentaoAuthMode === 'token' && !zentaoToken.trim()) {
      setToastMessage('Token 鉴权模式下必须填写禅道 Token');
      return;
    }
    await chrome.storage.local.set({
      zentaoBaseUrl: norm.baseUrl,
      zentaoAuthMode,
      zentaoApiVersion: norm.apiVersion,
      zentaoProductId,
      zentaoOpenedBuild: zentaoOpenedBuild.trim() || 'trunk',
      zentaoProjectId: zentaoProjectId || 0,
      zentaoExecutionId: zentaoExecutionId || 0,
      zentaoAssignedTo: zentaoAssignedTo.trim(),
    });
    await chrome.storage.session.set({ zentaoToken: zentaoToken.trim() });
    setZentaoApiVersion(norm.apiVersion);
    setToastMessage(
      `禅道集成配置已成功保存！(${zentaoAuthMode === 'cookie' ? '免 Token 网页登录态' : 'API Token 模式'}, API ${norm.apiVersion.toUpperCase()})`
    );
  };

  // 3. 保存采集阈值
  const handleSaveCapture = async () => {
    await chrome.storage.local.set({ slowThresholdMs });
    setToastMessage('慢接口判定阈值已更新');
  };

  // 4. 一键导出全部系统配置
  const handleExportConfig = async () => {
    setExporting(true);
    try {
      const payload = await buildExportPayload();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `qa-copilot-config-${dateStr}.json`;
      downloadConfigFile(filename, payload);
      setToastMessage(`配置已成功导出为文件：${filename}`);
    } catch (err) {
      setToastMessage(`导出配置失败: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // 5. 触发导入文件选择
  const handleTriggerImport = () => {
    fileInputRef.current?.click();
  };

  // 6. 处理导入文件解析与热更新
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const parseRes = parseAndValidateConfig(text);
      if (!parseRes.success || !parseRes.extracted) {
        setToastMessage(parseRes.error || '导入失败，配置文件格式不正确');
        return;
      }

      await applyImportedConfig(parseRes.extracted);

      // 同步刷新本地 React 状态
      const { localSettings, sessionSettings, summary } = parseRes.extracted;
      if ('slowThresholdMs' in localSettings) setSlowThresholdMs(Number(localSettings.slowThresholdMs) || 2000);
      if ('aiProviderMode' in localSettings) setAiProviderMode(localSettings.aiProviderMode);
      if ('aiBaseUrl' in localSettings) setAiBaseUrl(localSettings.aiBaseUrl);
      if ('aiApiKey' in localSettings) setAiApiKey(localSettings.aiApiKey);
      if ('aiModel' in localSettings) setAiModel(localSettings.aiModel);
      if ('aiBugAssistanceEnabled' in localSettings) setAiBugAssistanceEnabled(localSettings.aiBugAssistanceEnabled !== false);
      if ('zentaoBaseUrl' in localSettings) setZentaoBaseUrl(localSettings.zentaoBaseUrl);
      if ('zentaoAuthMode' in localSettings) setZentaoAuthMode(localSettings.zentaoAuthMode);
      if ('zentaoApiVersion' in localSettings) setZentaoApiVersion(localSettings.zentaoApiVersion);
      if ('zentaoProductId' in localSettings) setZentaoProductId(Number(localSettings.zentaoProductId) || 0);
      if ('zentaoOpenedBuild' in localSettings) setZentaoOpenedBuild(localSettings.zentaoOpenedBuild || 'trunk');
      if ('zentaoProjectId' in localSettings) setZentaoProjectId(localSettings.zentaoProjectId || undefined);
      if ('zentaoExecutionId' in localSettings) setZentaoExecutionId(localSettings.zentaoExecutionId || undefined);
      if ('zentaoAssignedTo' in localSettings) setZentaoAssignedTo(localSettings.zentaoAssignedTo || '');
      if ('zentaoToken' in sessionSettings) setZentaoToken(sessionSettings.zentaoToken || '');
      if ('quickLoginConfig' in localSettings) setQuickLoginNonce((prev) => prev + 1);

      setToastMessage(`配置导入成功！已同步更新：${summary.join('、')}`);
    } catch (err) {
      setToastMessage(`读取文件失败: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  // 测试大模型 AI 连接
  const handleTestAi = async () => {
    const probeId = ++aiProbeIdRef.current;
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const res = await aiProviderService.testRemoteConnection({
        baseUrl: aiBaseUrl.trim(),
        apiKey: aiApiKey.trim(),
        model: aiModel.trim() || 'deepseek-chat',
      });
      if (probeId !== aiProbeIdRef.current) return;
      if (res.success) {
        setAiTestResult({
          success: true,
          message: res.message || `连接成功 (响应耗时 ${res.latencyMs}ms)`,
        });
      } else {
        setAiTestResult({
          success: false,
          message: res.error || '连接失败',
        });
      }
    } finally {
      if (probeId === aiProbeIdRef.current) {
        setAiTesting(false);
      }
    }
  };

  // 测试禅道连接并刷新资源 (带 probeId 保护)
  const handleTestZentao = async () => {
    const probeId = ++zentaoProbeIdRef.current;
    setZentaoTesting(true);
    setZentaoTestResult(null);

    const norm = normalizeZentaoUrl(zentaoBaseUrl, zentaoApiVersion);
    if (!norm.isValid) {
      setZentaoTesting(false);
      setZentaoTestResult({ success: false, message: norm.error || '禅道地址无效' });
      return;
    }

    if (zentaoAuthMode === 'token' && !zentaoToken.trim()) {
      setZentaoTesting(false);
      setZentaoTestResult({ success: false, message: 'Token 鉴权模式下必须输入 Token' });
      return;
    }

    try {
      const client = new ZentaoClient({
        baseUrl: norm.baseUrl,
        authMode: zentaoAuthMode,
        token: zentaoToken,
        apiVersion: norm.apiVersion,
        productId: zentaoProductId,
        openedBuild: [zentaoOpenedBuild],
      });

      const res = await client.testConnection();
      if (probeId !== zentaoProbeIdRef.current) return; // 过期响应直接丢弃

      if (res.success) {
        setZentaoTestResult({
          success: true,
          message: `连接成功！已验证${zentaoAuthMode === 'cookie' ? '网页登录态' : 'Token'}与产品: ${res.productName} (API ${norm.apiVersion.toUpperCase()})`,
        });

        // 联动刷新产品列表 (带产品世代检查)
        setLoadingProducts(true);
        const prodProbeId = ++productProbeIdRef.current;
        const prodRes = await client.fetchProducts();
        if (prodProbeId !== productProbeIdRef.current || probeId !== zentaoProbeIdRef.current) return;
        if (prodRes.success && prodRes.products && prodRes.products.length > 0) {
          setProductList(prodRes.products);
          // 若当前未选择 productId，默认选中第一个并拉取项目与版本
          const targetId = zentaoProductId || prodRes.products[0].id;
          setZentaoProductId(targetId);
          loadProjectsForProduct(norm.baseUrl, zentaoToken, targetId, norm.apiVersion, zentaoAuthMode, zentaoProjectId);
        }
        setLoadingProducts(false);
      } else {
        setZentaoTestResult({
          success: false,
          message: res.error || '连接失败',
        });
      }
    } finally {
      if (probeId === zentaoProbeIdRef.current) {
        setZentaoTesting(false);
      }
    }
  };

  // 动态加载特定产品的关联项目 (带项目世代检查)
  const loadProjectsForProduct = async (
    baseUrl: string,
    token: string,
    prodId: number,
    apiVersion: 'v1' | 'v2' = 'v2',
    authMode: 'cookie' | 'token' = 'cookie',
    preferProjectId?: number
  ) => {
    if (!prodId) return;
    const probeId = ++projectProbeIdRef.current;
    setLoadingProjects(true);
    try {
      const client = new ZentaoClient({
        baseUrl,
        authMode,
        token,
        apiVersion,
        productId: prodId,
        openedBuild: ['trunk'],
      });
      const res = await client.fetchProjects(prodId);
      if (probeId !== projectProbeIdRef.current) return;
      if (res.success && res.projects && res.projects.length > 0) {
        setProjectList(res.projects);
        const effectiveProjId =
          preferProjectId ||
          (res.projects.some((p) => p.id === zentaoProjectId) ? zentaoProjectId : res.projects[0].id);
        setZentaoProjectId(effectiveProjId);
        loadBuildsForProduct(baseUrl, token, prodId, apiVersion, authMode, effectiveProjId);
      } else {
        setProjectList([]);
        loadBuildsForProduct(baseUrl, token, prodId, apiVersion, authMode, preferProjectId || zentaoProjectId);
      }
    } catch {
      setProjectList([]);
      loadBuildsForProduct(baseUrl, token, prodId, apiVersion, authMode, preferProjectId || zentaoProjectId);
    } finally {
      if (probeId === projectProbeIdRef.current) {
        setLoadingProjects(false);
      }
    }
  };

  // 动态加载特定产品的版本 (带版本世代检查，多源并发聚合，始终确保包含 trunk)
  const loadBuildsForProduct = async (
    baseUrl: string,
    token: string,
    prodId: number,
    apiVersion: 'v1' | 'v2' = 'v2',
    authMode: 'cookie' | 'token' = 'cookie',
    projId?: number
  ) => {
    if (!prodId) return;
    const probeId = ++buildProbeIdRef.current;
    setLoadingBuilds(true);
    try {
      const client = new ZentaoClient({
        baseUrl,
        authMode,
        token,
        apiVersion,
        productId: prodId,
        openedBuild: ['trunk'],
        projectId: projId,
      });
      const res = await client.fetchProductBuilds(prodId, projId);
      if (probeId !== buildProbeIdRef.current) return;
      if (res.success && res.builds && res.builds.length > 0) {
        setBuildList(res.builds);
        // 若当前选中的版本不在列表中，保持 trunk
        if (!res.builds.some((b) => String(b.id) === zentaoOpenedBuild)) {
          setZentaoOpenedBuild('trunk');
        }
      } else {
        setBuildList([{ id: 'trunk', name: 'trunk (主干)' }]);
      }
    } catch {
      setBuildList([{ id: 'trunk', name: 'trunk (主干)' }]);
    } finally {
      if (probeId === buildProbeIdRef.current) {
        setLoadingBuilds(false);
      }
    }
  };

  // 动态加载指派人列表 (带世代检查)
  const loadUsersForTarget = async (
    baseUrl: string,
    token: string,
    prodId?: number,
    projId?: number,
    apiVersion: 'v1' | 'v2' = 'v2',
    authMode: 'cookie' | 'token' = 'cookie'
  ) => {
    const probeId = ++userProbeIdRef.current;
    setLoadingUsers(true);
    try {
      const client = new ZentaoClient({
        baseUrl,
        authMode,
        token,
        apiVersion,
        productId: prodId || 0,
        openedBuild: ['trunk'],
        projectId: projId,
      });
      const res = await client.fetchUsers({ projectId: projId, productId: prodId });
      if (probeId !== userProbeIdRef.current) return;
      if (res.success && res.users && res.users.length > 0) {
        setUserList(res.users);
        chrome.storage.local.set({ zentaoRecentUsers: res.users });
      }
    } catch {
      // 容错吸收
    } finally {
      if (probeId === userProbeIdRef.current) {
        setLoadingUsers(false);
      }
    }
  };

  // 一键获取当前浏览器禅道信息 (方案2：免 Token 零配置直连 + 自动拉取产品、项目与版本)
  const handleDetectBrowserZentao = async () => {
    const probeId = ++zentaoProbeIdRef.current;
    setDetecting(true);
    setDetectedInfo(null);
    try {
      const info = await detectBrowserZentao(zentaoBaseUrl);
      if (probeId !== zentaoProbeIdRef.current) return;
      setDetectedInfo(info);

      if (info.found) {
        const isSameSite = isSameZentaoSite(info.siteUrl, zentaoBaseUrl);
        const targetUrl = info.siteUrl || zentaoBaseUrl;
        const norm = normalizeZentaoUrl(targetUrl);
        const detectedVer = norm.apiVersion || 'v2';

        if (info.siteUrl) {
          setZentaoBaseUrl(info.siteUrl);
          setZentaoApiVersion(detectedVer);
        }

        // 方案 2 核心：探测到浏览器禅道时，自动优先启用免 Token 模式！
        setZentaoAuthMode('cookie');

        let effectiveToken = '';
        if (info.token) {
          effectiveToken = info.token;
          setZentaoToken(info.token);
        } else if (isSameSite) {
          effectiveToken = zentaoToken;
        } else {
          // 探测到了不同站点且无新 Token：清空原 Token
          setZentaoToken('');
          setProductList([]);
          setProjectList([]);
          setBuildList([{ id: 'trunk', name: 'trunk (主干)' }]);
          setZentaoProductId(0);
          setZentaoProjectId(undefined);
        }

        // 1. 若探针在页面 DOM 提取到了下拉选项产品与项目，立即先赋值确保界面秒级呈现
        let activeProducts: ZentaoProductItem[] = [];
        if (info.domProducts && info.domProducts.length > 0) {
          activeProducts = info.domProducts.map((p) => ({ id: p.id, name: p.name }));
          setProductList(activeProducts);
        }
        if (info.domProjects && info.domProjects.length > 0) {
          setProjectList(info.domProjects.map((p) => ({ id: p.id, name: p.name })));
        }

        if (info.currentProductId) {
          setZentaoProductId(info.currentProductId);
        }
        if (info.currentProjectId) {
          setZentaoProjectId(info.currentProjectId);
        }
        if (info.currentBuild) {
          setZentaoOpenedBuild(info.currentBuild);
        }
        if (info.currentAssignedTo) {
          setZentaoAssignedTo(info.currentAssignedTo);
        } else if (info.account && !zentaoAssignedTo) {
          setZentaoAssignedTo(info.account);
        }
        if (info.domUsers && info.domUsers.length > 0) {
          setUserList(info.domUsers.map((u) => ({ account: u.account, realname: u.realname })));
        }

        // 2. 自动通过 API 拉取完整产品列表
        if (targetUrl) {
          setLoadingProducts(true);
          const prodProbeId = ++productProbeIdRef.current;
          const client = new ZentaoClient({
            baseUrl: targetUrl,
            authMode: 'cookie',
            token: effectiveToken,
            apiVersion: detectedVer,
            productId: info.currentProductId || zentaoProductId || 0,
            openedBuild: ['trunk'],
            projectId: info.currentProjectId || zentaoProjectId,
          });
          const prodRes = await client.fetchProducts().catch(() => ({ success: false, products: [] }));
          if (prodProbeId === productProbeIdRef.current && probeId === zentaoProbeIdRef.current) {
            if (prodRes.success && prodRes.products && prodRes.products.length > 0) {
              activeProducts = prodRes.products;
              setProductList(prodRes.products);
            }
          }
          setLoadingProducts(false);

          // 3. 核心联动：立即确定当前选中的产品，并自动触发拉取其对应的所属项目、影响版本与指派人列表！
          const targetProdId =
            info.currentProductId ||
            (activeProducts.length > 0 ? activeProducts[0].id : (zentaoProductId || 0));
          const targetProjId = info.currentProjectId || zentaoProjectId;

          if (targetProdId) {
            setZentaoProductId(targetProdId);
            loadProjectsForProduct(
              targetUrl,
              effectiveToken,
              targetProdId,
              detectedVer,
              'cookie',
              targetProjId
            );
          }
          loadUsersForTarget(targetUrl, effectiveToken, targetProdId, targetProjId, detectedVer, 'cookie');
          setToastMessage('已成功识别浏览器登录态，并自动加载产品、项目、版本与指派人！');
        }
      } else {
        setToastMessage(info.message || '未在当前打开的标签页中检测到禅道');
      }
    } finally {
      if (probeId === zentaoProbeIdRef.current) {
        setDetecting(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 pb-20 text-xs">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCurrentTab('home')}
          className="p-1 text-slate-500 hover:text-slate-800 rounded-md transition-colors"
          title="返回主页"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-bold text-slate-900">系统集成与快捷登录设置</h2>
      </div>

      {/* 顶部分段式 Tab 切换器 */}
      <div className="grid grid-cols-4 p-1 bg-slate-200/80 rounded-xl gap-1 text-[11px] font-medium select-none shadow-2xs">
        <button
          type="button"
          onClick={() => setSettingsSubTab('zentao')}
          className={`py-1.5 px-1 rounded-lg flex items-center justify-center gap-1 transition-all ${
            settingsSubTab === 'zentao'
              ? 'bg-white text-blue-700 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">禅道集成</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsSubTab('ai')}
          className={`py-1.5 px-1 rounded-lg flex items-center justify-center gap-1 transition-all ${
            settingsSubTab === 'ai'
              ? 'bg-white text-purple-700 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">AI 大模型</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsSubTab('quickLogin')}
          className={`py-1.5 px-1 rounded-lg flex items-center justify-center gap-1 transition-all ${
            settingsSubTab === 'quickLogin'
              ? 'bg-white text-emerald-700 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">快捷登录</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsSubTab('general')}
          className={`py-1.5 px-1 rounded-lg flex items-center justify-center gap-1 transition-all ${
            settingsSubTab === 'general'
              ? 'bg-white text-slate-800 font-bold shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">通用设置</span>
        </button>
      </div>

      {/* 模块 0: 快捷登录与多环境配置 */}
      {settingsSubTab === 'quickLogin' && (
        <QuickLoginSettingsCard key={quickLoginNonce} onToast={setToastMessage} />
      )}

      {/* 模块 1: 禅道 Bug 集成 */}
      {settingsSubTab === 'zentao' && (
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
            <Building2 className="w-4 h-4 text-blue-600" />
            <span>禅道 Bug 系统集成</span>
          </div>
          <button
            type="button"
            onClick={handleDetectBrowserZentao}
            disabled={detecting}
            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded text-[11px] flex items-center gap-1 transition-colors border border-blue-200 shadow-sm"
            title="自动从当前已打开的禅道标签页中读取登录态、地址、Token与当前产品"
          >
            {detecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            ) : (
              <Search className="w-3.5 h-3.5 text-blue-600" />
            )}
            <span>一键从当前浏览器获取</span>
          </button>
        </div>

        {/* 浏览器探测提示卡 */}
        {detectedInfo && (
          <div
            className={`p-2.5 rounded-lg text-[11px] flex flex-col gap-1.5 border ${
              detectedInfo.found
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-amber-50 text-amber-900 border-amber-200'
            }`}
          >
            <div className="flex items-center justify-between font-medium">
              <div className="flex items-center gap-1.5">
                {detectedInfo.found ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span>{detectedInfo.message}</span>
              </div>
            </div>

            {detectedInfo.found && (
              <div className="text-[11px] text-emerald-800 flex flex-col gap-0.5 pl-5 pt-0.5">
                {detectedInfo.account && (
                  <div>
                    登录账号: <strong className="font-mono">{detectedInfo.account}</strong>
                    {detectedInfo.realname ? ` (${detectedInfo.realname})` : ''}
                  </div>
                )}
                {detectedInfo.currentProductId ? (
                  <div>
                    识别产品: <strong className="font-mono">#{detectedInfo.currentProductId}</strong>
                    {detectedInfo.currentProductName ? ` - ${detectedInfo.currentProductName}` : ''}
                  </div>
                ) : null}
                {detectedInfo.currentBuild && (
                  <div>
                    影响版本: <strong className="font-mono">{detectedInfo.currentBuild}</strong>
                  </div>
                )}
                {detectedInfo.token && (
                  <div className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>同时提取到 API Token</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 站点地址 */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-slate-600 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>禅道站点地址 (Base URL)</span>
              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-mono text-[10px] font-semibold">
                API {zentaoApiVersion.toUpperCase()}
              </span>
            </span>
            <span className="text-[10px] text-slate-400">自动防重复拼接 /api.php</span>
          </label>
          <input
            type="url"
            value={zentaoBaseUrl}
            onChange={(event) => {
              const val = event.target.value;
              setZentaoBaseUrl(val);
              const norm = normalizeZentaoUrl(val);
              if (norm.isValid) {
                setZentaoApiVersion(norm.apiVersion);
              }
              invalidateZentaoChecks();
              setProductList([]);
              setBuildList([]);
            }}
            placeholder="https://zentao.hbisscm.com"
            className="p-2 border border-slate-200 rounded-lg text-xs bg-slate-50 font-mono focus:bg-white transition-colors"
          />
        </div>

        {/* 鉴权模式切换 (方案2：基于网页登录态 Cookie 免 Token 模式) */}
        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700">鉴权模式</span>
            <div className="flex rounded-md bg-slate-200/80 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setZentaoAuthMode('cookie');
                  invalidateZentaoChecks();
                }}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all ${
                  zentaoAuthMode === 'cookie'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                网页登录态直连 (免 Token)
              </button>
              <button
                type="button"
                onClick={() => {
                  setZentaoAuthMode('token');
                  invalidateZentaoChecks();
                }}
                className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all ${
                  zentaoAuthMode === 'token'
                    ? 'bg-white text-blue-600 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                API Token
              </button>
            </div>
          </div>

          {zentaoAuthMode === 'cookie' ? (
            <div className="p-2 rounded bg-emerald-50 text-emerald-800 text-[11px] flex flex-col gap-0.5 border border-emerald-200">
              <div className="flex items-center gap-1 font-semibold text-emerald-900">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>免 Token 模式生效中：零配置·直接使用浏览器登录态</span>
              </div>
              <span className="text-[10px] text-emerald-700 leading-relaxed">
                无需在禅道个人中心翻找或输入 Token，插件直接复用您在 Chrome 浏览器中已登录的禅道会话进行提单与读取。
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 pt-1 border-t border-slate-200/60 mt-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-600">禅道 API Token</label>
                <a
                  href={`${zentaoBaseUrl.replace(/\/$/, '')}/my-profile.html`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                >
                  <span>前往个人中心查看 Token</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                value={zentaoToken}
                onChange={(event) => {
                  setZentaoToken(event.target.value);
                  invalidateZentaoChecks();
                }}
                placeholder="请输入您的禅道 API Token"
                autoComplete="off"
                className="p-2 border border-slate-200 rounded-lg text-xs bg-white font-mono focus:bg-white transition-colors"
              />
            </div>
          )}
        </div>

        {/* 动态产品选择器 (CFG-05) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl transition-all hover:border-slate-300/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 text-xs">
              <Package className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>关联产品 (Product)</span>
              {loadingProducts ? (
                <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>获取产品中...</span>
                </span>
              ) : productList.length > 0 ? (
                <span className="text-[10px] text-blue-700 bg-blue-50/80 border border-blue-100 px-1.5 py-0.5 rounded-full font-sans">
                  共 {productList.length} 个产品
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (zentaoBaseUrl && (zentaoAuthMode === 'cookie' || zentaoToken)) {
                    setLoadingProducts(true);
                    const prodProbeId = ++productProbeIdRef.current;
                    new ZentaoClient({
                      baseUrl: zentaoBaseUrl,
                      authMode: zentaoAuthMode,
                      token: zentaoToken,
                      apiVersion: zentaoApiVersion,
                      productId: 0,
                      openedBuild: [],
                    })
                      .fetchProducts()
                      .then((res) => {
                        if (prodProbeId !== productProbeIdRef.current) return;
                        if (res.success && res.products && res.products.length > 0) {
                          setProductList(res.products);
                          setToastMessage(`成功获取 ${res.products.length} 个产品`);
                          const targetId = zentaoProductId || res.products[0].id;
                          setZentaoProductId(targetId);
                          loadProjectsForProduct(zentaoBaseUrl, zentaoToken, targetId, zentaoApiVersion, zentaoAuthMode, zentaoProjectId);
                        } else {
                          setToastMessage(res.error || '获取产品列表失败');
                        }
                      })
                      .finally(() => {
                        if (prodProbeId === productProbeIdRef.current) setLoadingProducts(false);
                      });
                  } else {
                    setToastMessage(zentaoAuthMode === 'token' ? '请先配置禅道地址和 Token' : '请先填写禅道地址');
                  }
                }}
                disabled={loadingProducts || !zentaoBaseUrl || (zentaoAuthMode === 'token' && !zentaoToken)}
                className="text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-slate-200/60 transition-colors disabled:opacity-40"
                title="刷新产品列表"
              >
                <RefreshCw className={`w-3 h-3 ${loadingProducts ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setManualProductInput(!manualProductInput)}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline"
              >
                {manualProductInput ? '使用列表选择' : '手动输入 ID'}
              </button>
            </div>
          </div>

          {/* 产品主选择器 (支持输入模糊搜索) */}
          <SearchableSelect
            options={productList.map((p) => ({
              id: p.id,
              name: p.name,
              code: p.code,
            }))}
            value={zentaoProductId}
            onChange={(val) => {
              const id = Number(val) || 0;
              setZentaoProductId(id);
              invalidateZentaoChecks();
              if (id > 0) {
                loadProjectsForProduct(zentaoBaseUrl, zentaoToken, id, zentaoApiVersion, zentaoAuthMode);
              }
            }}
            placeholder="-- 点击展开搜索并选择产品 --"
            disabled={loadingProducts}
            loading={loadingProducts}
            emptyText="暂未获取到产品列表（点击右上角刷新获取）"
          />

          {/* 选中产品即时反馈卡片 */}
          {selectedProduct && (
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-blue-50/80 border border-blue-100 rounded-lg text-[11px] text-blue-900 animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="font-semibold text-blue-950">#{selectedProduct.id}</span>
                <span className="truncate">{selectedProduct.name}</span>
              </div>
              {selectedProduct.code && (
                <span className="shrink-0 px-1.5 py-0.5 text-[9px] bg-blue-200/50 text-blue-700 font-mono rounded">
                  {selectedProduct.code}
                </span>
              )}
            </div>
          )}

          {/* 手动输入数字 ID 折叠区域 */}
          {manualProductInput && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 text-xs animate-in fade-in duration-150">
              <span className="text-[11px] text-slate-500 shrink-0">自定义 ID:</span>
              <input
                type="number"
                min="1"
                value={zentaoProductId || ''}
                onChange={(event) => {
                  const id = Number(event.target.value) || 0;
                  setZentaoProductId(id);
                  invalidateZentaoChecks();
                  if (id > 0) loadProjectsForProduct(zentaoBaseUrl, zentaoToken, id, zentaoApiVersion, zentaoAuthMode);
                }}
                placeholder="输入产品 ID 数字"
                className="flex-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* 动态所属项目选择器 (CFG-05) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl transition-all hover:border-slate-300/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 text-xs">
              <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>所属项目 (Project)</span>
              {loadingProjects ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>加载项目中...</span>
                </span>
              ) : projectList.length > 0 ? (
                <span className="text-[10px] text-emerald-700 bg-emerald-50/80 border border-emerald-100 px-1.5 py-0.2 rounded-full font-sans">
                  共 {projectList.length} 个项目
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (zentaoProductId) {
                    loadProjectsForProduct(zentaoBaseUrl, zentaoToken, zentaoProductId, zentaoApiVersion, zentaoAuthMode, zentaoProjectId);
                  } else {
                    setToastMessage('请先选择一个产品以获取其关联项目');
                  }
                }}
                disabled={loadingProjects || !zentaoProductId}
                className="text-slate-400 hover:text-emerald-600 p-1 rounded hover:bg-slate-200/60 transition-colors disabled:opacity-40"
                title="刷新当前产品的项目列表"
              >
                <RefreshCw className={`w-3 h-3 ${loadingProjects ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setManualProjectInput(!manualProjectInput)}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline"
              >
                {manualProjectInput ? '使用列表选择' : '手动输入 ID'}
              </button>
            </div>
          </div>

          {/* 项目主选择器 (支持输入模糊搜索) */}
          <SearchableSelect
            options={projectList.map((p) => ({
              id: p.id,
              name: p.name,
              code: p.code,
            }))}
            value={zentaoProjectId || ''}
            onChange={(val) => {
              const id = Number(val) || undefined;
              setZentaoProjectId(id);
              invalidateZentaoChecks();
              loadBuildsForProduct(zentaoBaseUrl, zentaoToken, zentaoProductId, zentaoApiVersion, zentaoAuthMode, id);
            }}
            placeholder="-- 点击展开搜索并选择所属项目 --"
            disabled={loadingProjects}
            loading={loadingProjects}
            emptyText="暂未获取到关联项目（可点击右上角刷新或手动输入 ID）"
          />

          {/* 选中项目即时反馈卡片 */}
          {selectedProject && (
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-emerald-50/80 border border-emerald-100 rounded-lg text-[11px] text-emerald-900 animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-semibold text-emerald-950">#{selectedProject.id}</span>
                <span className="truncate">{selectedProject.name}</span>
              </div>
              {selectedProject.code && (
                <span className="shrink-0 px-1.5 py-0.5 text-[9px] bg-emerald-200/50 text-emerald-700 font-mono rounded">
                  {selectedProject.code}
                </span>
              )}
            </div>
          )}

          {/* 手动输入数字 ID 折叠区域 */}
          {manualProjectInput && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 text-xs animate-in fade-in duration-150">
              <span className="text-[11px] text-slate-500 shrink-0">项目 ID:</span>
              <input
                type="number"
                min="1"
                value={zentaoProjectId || ''}
                onChange={(event) => {
                  const id = Number(event.target.value) || undefined;
                  setZentaoProjectId(id);
                  invalidateZentaoChecks();
                  loadBuildsForProduct(zentaoBaseUrl, zentaoToken, zentaoProductId, zentaoApiVersion, zentaoAuthMode, id);
                }}
                placeholder="输入项目 ID 数字"
                className="flex-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>

        {/* 动态影响版本选择器 (CFG-05) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl transition-all hover:border-slate-300/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 text-xs">
              <GitBranch className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>影响版本 (Build)</span>
              {loadingBuilds ? (
                <span className="flex items-center gap-1 text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>加载版本中...</span>
                </span>
              ) : buildList.length > 0 ? (
                <span className="text-[10px] text-indigo-700 bg-indigo-50/80 border border-indigo-100 px-1.5 py-0.2 rounded-full font-sans">
                  共 {buildList.length} 个版本
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (zentaoProductId) {
                    loadBuildsForProduct(zentaoBaseUrl, zentaoToken, zentaoProductId, zentaoApiVersion, zentaoAuthMode, zentaoProjectId);
                  } else {
                    setToastMessage('请先选择一个产品以获取其版本列表');
                  }
                }}
                disabled={loadingBuilds || !zentaoProductId}
                className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-slate-200/60 transition-colors disabled:opacity-40"
                title="刷新当前产品和项目的版本列表"
              >
                <RefreshCw className={`w-3 h-3 ${loadingBuilds ? 'animate-spin' : ''}`} />
              </button>
              <span className="text-[10px] text-slate-400">建议 trunk</span>
            </div>
          </div>

          {/* 版本选择器 (支持搜索与快捷选择) */}
          <SearchableSelect
            options={[
              ...buildList.map((b) => ({
                id: b.id,
                name: b.name,
              })),
              { id: '__custom__', name: '+ 手动指定其他自定义版本号...' },
            ]}
            value={isCustomBuild ? '__custom__' : (buildList.some((b) => String(b.id) === zentaoOpenedBuild) ? zentaoOpenedBuild : '__custom__')}
            onChange={(val) => {
              if (val === '__custom__') {
                setIsCustomBuild(true);
              } else {
                setIsCustomBuild(false);
                setZentaoOpenedBuild(String(val));
                invalidateZentaoChecks();
              }
            }}
            placeholder="-- 请输入或选择影响版本 --"
            disabled={loadingBuilds}
            loading={loadingBuilds}
            emptyText="暂无可用版本"
          />

          {/* 自定义版本号输入框 */}
          {isCustomBuild && (
            <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 text-xs animate-in fade-in duration-150">
              <span className="text-[11px] text-slate-500 shrink-0">自定义版本:</span>
              <input
                type="text"
                value={zentaoOpenedBuild}
                onChange={(event) => {
                  setZentaoOpenedBuild(event.target.value);
                  invalidateZentaoChecks();
                }}
                placeholder="例如：trunk 或 2.0.0-rc1"
                className="flex-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* 默认指派人选择器 (支持下拉搜索与自由输入) */}
        <div className="flex flex-col gap-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl transition-all hover:border-slate-300/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 text-xs">
              <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>默认指派给 (Assigned To)</span>
              <span className="text-[10px] text-slate-400 font-normal">预设指派人</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (zentaoBaseUrl) {
                  loadUsersForTarget(zentaoBaseUrl, zentaoToken, zentaoProductId, zentaoProjectId, zentaoApiVersion, zentaoAuthMode);
                  setToastMessage('正在刷新指派人候选列表…');
                }
              }}
              disabled={loadingUsers || !zentaoBaseUrl}
              className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-slate-200/60 transition-colors disabled:opacity-40"
              title="刷新指派人列表"
            >
              <RefreshCw className={`w-3 h-3 ${loadingUsers ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <SearchableSelect
            options={userList.map((u) => ({
              id: u.account,
              name: u.realname || u.account,
              subText: u.account,
            }))}
            value={zentaoAssignedTo}
            onChange={(val) => {
              setZentaoAssignedTo(String(val || '').trim());
              invalidateZentaoChecks();
            }}
            placeholder="-- 搜索选择或直接输入账号 (如 admin, zhangsan) --"
            allowCustomInput={true}
            disabled={loadingUsers}
            loading={loadingUsers}
            emptyText="未拉取到列表时，可直接在搜索框输入账号后选用"
          />

          <p className="text-[10px] text-slate-400">
            设置提 Bug 时默认预选的经办人账号，提单时仍可灵活修改。
          </p>
        </div>

        {/* 测试与独立保存按钮 (CFG-01 / CFG-02) */}
        <div className="flex items-center justify-between pt-1 gap-2">
          <button
            type="button"
            onClick={handleTestZentao}
            disabled={zentaoTesting || !zentaoBaseUrl.trim() || (zentaoAuthMode === 'token' && !zentaoToken.trim())}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium rounded-lg text-[11px] flex items-center gap-1.5 transition-colors border border-slate-200"
          >
            {zentaoTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5 text-blue-600" />}
            <span>测试只读连接</span>
          </button>

          <button
            type="button"
            onClick={handleSaveZentao}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[11px] flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存禅道设置</span>
          </button>
        </div>

        {/* 测试反馈结果 */}
        {zentaoTestResult && (
          <div
            className={`p-2.5 rounded-lg text-[11px] flex items-start gap-1.5 border ${
              zentaoTestResult.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            {zentaoTestResult.success ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{zentaoTestResult.message}</span>
          </div>
        )}

        <div className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-100 pt-2 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>安全声明：{zentaoAuthMode === 'cookie' ? '免 Token 模式使用当前浏览器已有的同源会话安全通信，零额外凭据泄露风险。' : 'Token 仅在浏览器本地安全保存，仅用于创建 Bug 与上传附件，绝不发送给第三方。'}</span>
        </div>
      </div>
      )}

      {/* 模块 2: 智能生成 Provider */}
      {settingsSubTab === 'ai' && (
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span>智能生成 Provider</span>
          </div>
          <button
            type="button"
            onClick={handleSaveAi}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 transition-colors shadow-sm"
          >
            <Save className="w-3 h-3" />
            <span>保存 AI 设置</span>
          </button>
        </div>

        <select
          value={aiProviderMode}
          onChange={(event) => {
            setAiProviderMode(event.target.value as AIProviderMode);
            aiProbeIdRef.current++;
            setAiTesting(false);
            setAiTestResult(null);
          }}
          className="p-2 border border-slate-200 rounded-lg bg-slate-50 text-xs font-medium"
        >
          <option value="heuristic">本地启发式规则（推荐：离线免配置，不调用外部模型）</option>
          <option value="remote">大模型 API（支持 DeepSeek / OpenAI / 阿里百炼等兼容接口）</option>
          <option value="disabled">关闭智能生成</option>
        </select>

        {/* AI 介入 Bug 提交流程开关 */}
        <div className="flex items-center justify-between p-3 bg-purple-50/50 rounded-xl border border-purple-100">
          <div className="flex flex-col gap-0.5 pr-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Bot className="w-3.5 h-3.5 text-purple-600" />
              <span>AI 介入 Bug 提交流程</span>
            </div>
            <span className="text-[11px] text-slate-500 leading-relaxed">
              开启后，自动将现场背景（操作路径、异常接口响应体、控制台报错）发给大模型，推断可能造成 Bug 的原因并写入禅道描述。
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={aiBugAssistanceEnabled}
              onChange={(event) => setAiBugAssistanceEnabled(event.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </div>

        {aiProviderMode === 'remote' && (
          <div className="flex flex-col gap-2.5 pt-1">
            {/* 1. Base URL */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span>大模型接口地址 (Base URL)</span>
                <span className="text-[10px] text-slate-400">自动补齐 /chat/completions</span>
              </div>
              <input
                type="url"
                value={aiBaseUrl}
                onChange={(event) => {
                  setAiBaseUrl(event.target.value);
                  aiProbeIdRef.current++;
                  setAiTesting(false);
                  setAiTestResult(null);
                }}
                placeholder="https://api.deepseek.com/v1"
                className="p-2 border border-slate-200 rounded-lg text-xs bg-slate-50 font-mono focus:bg-white focus:border-purple-500 transition-colors"
              />
              <span className="text-[10px] text-slate-400">
                支持标准 OpenAI 协议网关，如 DeepSeek、OpenAI、阿里云百炼、Kimi、Local Ollama 等。
              </span>
            </div>

            {/* 2. API Key */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span>大模型 API Key</span>
                <span className="text-[10px] text-emerald-600 font-medium">本地加密保存</span>
              </div>
              <div className="relative flex items-center">
                <input
                  type={showAiKey ? 'text' : 'password'}
                  value={aiApiKey}
                  onChange={(event) => {
                    setAiApiKey(event.target.value);
                    aiProbeIdRef.current++;
                    setAiTesting(false);
                    setAiTestResult(null);
                  }}
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                  className="w-full pl-2.5 pr-8 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 font-mono focus:bg-white focus:border-purple-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowAiKey(!showAiKey)}
                  className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5"
                  title={showAiKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showAiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* 3. Model 名称与快捷预选 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                <div className="flex items-center gap-1">
                  <Bot className="w-3.5 h-3.5 text-purple-600" />
                  <span>模型名称 (Model)</span>
                </div>
                <span className="text-[10px] text-slate-400">可手动输入或点击下方快速选用</span>
              </div>
              <input
                type="text"
                value={aiModel}
                onChange={(event) => {
                  setAiModel(event.target.value);
                  aiProbeIdRef.current++;
                  setAiTesting(false);
                  setAiTestResult(null);
                }}
                placeholder="如: deepseek-chat, gpt-4o-mini, qwen-plus"
                className="p-2 border border-slate-200 rounded-lg text-xs bg-slate-50 font-mono focus:bg-white focus:border-purple-500 transition-colors"
              />
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                {[
                  { name: 'deepseek-chat', label: 'DeepSeek-V3' },
                  { name: 'deepseek-reasoner', label: 'DeepSeek-R1' },
                  { name: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                  { name: 'qwen-plus', label: '通义千问 Plus' },
                  { name: 'qwen2.5', label: 'Ollama 本地' },
                ].map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => {
                      setAiModel(item.name);
                      aiProbeIdRef.current++;
                      setAiTesting(false);
                      setAiTestResult(null);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                      aiModel === item.name
                        ? 'bg-purple-100 text-purple-800 border-purple-300 font-semibold'
                        : 'bg-slate-100/80 text-slate-600 border-slate-200 hover:bg-slate-200/80'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. 测试大模型连接按钮 */}
            <div className="flex items-center justify-start pt-1">
              <button
                type="button"
                onClick={handleTestAi}
                disabled={aiTesting || !aiBaseUrl.trim()}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium rounded-lg text-[11px] flex items-center gap-1.5 transition-colors border border-slate-200"
              >
                {aiTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3 text-purple-600" />}
                <span>测试大模型连接</span>
              </button>
            </div>

            {aiTestResult && (
              <div
                className={`p-2 rounded-lg text-[11px] flex items-start gap-1.5 border ${
                  aiTestResult.success
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-red-50 text-red-800 border-red-200'
                }`}
              >
                {aiTestResult.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{aiTestResult.message}</span>
              </div>
            )}
          </div>
        )}

        <span className="text-[10px] text-slate-400">
          关闭后依然保留时间线捕获、问题快照、人工编辑 Bug 和标准 Markdown 导出功能。
        </span>
      </div>
      )}

      {/* 模块 3: 接口性能阈值 */}
      {settingsSubTab === 'general' && (
        <>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="font-bold text-slate-800">接口性能监控阈值</span>
              <button
                type="button"
                onClick={handleSaveCapture}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] flex items-center gap-1 transition-colors"
              >
                <Save className="w-3 h-3 text-blue-600" />
                <span>保存阈值</span>
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">慢接口判定阈值</span>
              <span className="font-mono font-bold text-blue-600">{slowThresholdMs} ms</span>
            </div>
            <input
              type="range"
              min="500"
              max="5000"
              step="100"
              value={slowThresholdMs}
              onChange={(event) => setSlowThresholdMs(Number(event.target.value))}
              className="w-full cursor-pointer accent-blue-600"
            />
            <span className="text-[10px] text-slate-400">
              超过此阈值的 HTTP 请求将被标记为慢接口，并在问题快照与时间线中重点标注。
            </span>
          </div>

          {/* 模块 4: 配置备份与一键迁移专区 */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span>配置备份与一键迁移</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">JSON 格式</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              一键打包备份您配置的 AI 大模型、禅道系统、快捷登录账号与多环境、接口监控阈值及 Mock 规则。支持团队分发、多设备同步或一键恢复。
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleExportConfig}
                disabled={exporting}
                className="flex-1 py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>一键导出配置文件</span>
              </button>
              <button
                type="button"
                onClick={handleTriggerImport}
                disabled={importing}
                className="flex-1 py-2 px-3 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>导入本地配置文件</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </>
      )}
    </div>
  );
};
