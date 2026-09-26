/**
 * Bug 详情编辑与 Markdown 导出 (E3 - TASK-304, TASK-305, TASK-306)
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileCode2, Image, Save, Send, Sparkles, Terminal, Trash2, Upload, Video, ExternalLink, AlertTriangle, User } from 'lucide-react';
import { aiProviderService } from '../../ai';
import { snapshotRepo } from '../../db/repositories/snapshotRepository';
import { MarkdownBugExporter } from '../../shared/formatters/markdownExport';
import { Bug, BugSeverity, BugSubmissionRecord } from '../../shared/types/snapshot';
import { isSameZentaoSite, normalizeZentaoUrl } from '../../shared/integrations/zentaoHelper';
import { useAppStore } from '../store/useAppStore';
import { ZentaoClient } from '../../shared/integrations/zentao';
import { recordingRepo } from '../../db/repositories/recordingRepository';
import { RecordingEvidence } from '../../shared/types/recording';
import { SearchableSelect, SearchableOption } from '../components/SearchableSelect';

const severityLevelMap: Record<BugSeverity, number> = {
  Blocker: 1,
  Critical: 2,
  Major: 3,
  Minor: 4,
  Suggestion: 4,
};

const severityOptions = [
  { level: 1, label: '致命', mappedSeverity: 'Blocker' as BugSeverity, color: 'border-red-200 text-red-700 hover:bg-red-50', activeColor: 'bg-red-600 text-white border-red-600 shadow-xs' },
  { level: 2, label: '严重', mappedSeverity: 'Critical' as BugSeverity, color: 'border-orange-200 text-orange-700 hover:bg-orange-50', activeColor: 'bg-orange-500 text-white border-orange-500 shadow-xs' },
  { level: 3, label: '一般', mappedSeverity: 'Major' as BugSeverity, color: 'border-blue-200 text-blue-700 hover:bg-blue-50', activeColor: 'bg-blue-600 text-white border-blue-600 shadow-xs' },
  { level: 4, label: '轻微', mappedSeverity: 'Minor' as BugSeverity, color: 'border-slate-200 text-slate-600 hover:bg-slate-50', activeColor: 'bg-slate-600 text-white border-slate-600 shadow-xs' },
];

const priorityOptions = [
  { level: 1, label: '紧急', color: 'border-red-200 text-red-700 hover:bg-red-50', activeColor: 'bg-red-600 text-white border-red-600 shadow-xs' },
  { level: 2, label: '高', color: 'border-orange-200 text-orange-700 hover:bg-orange-50', activeColor: 'bg-orange-500 text-white border-orange-500 shadow-xs' },
  { level: 3, label: '中', color: 'border-blue-200 text-blue-700 hover:bg-blue-50', activeColor: 'bg-blue-600 text-white border-blue-600 shadow-xs' },
  { level: 4, label: '低', color: 'border-slate-200 text-slate-600 hover:bg-slate-50', activeColor: 'bg-slate-600 text-white border-slate-600 shadow-xs' },
];

export const BugEditPage: React.FC = () => {
  const { currentSnapshot, activeSession, setActiveView, setCurrentTab, setSettingsSubTab, setToastMessage } = useAppStore();

  const [bugTitle, setBugTitle] = useState('【异常记录】系统操作出现未预期异常');
  const [severity, setSeverity] = useState<BugSeverity>('Major');
  const [severityLevel, setSeverityLevel] = useState<number>(3);
  const [pri, setPri] = useState<number>(3);
  const [steps, setSteps] = useState<string[]>([]);
  const [expected, setExpected] = useState('系统应正常处理业务操作，无报错提示。');
  const [actual, setActual] = useState('操作后页面提示异常，相关请求返回错误。');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bugStatus, setBugStatus] = useState<Bug['status']>('draft');
  const [externalUrl, setExternalUrl] = useState('');
  const [isSubmittingZentao, setIsSubmittingZentao] = useState(false);
  const [isRetryingAttachment, setIsRetryingAttachment] = useState(false);
  const [submissionRecord, setSubmissionRecord] = useState<BugSubmissionRecord | null>(null);
  const [showRecreateConfirm, setShowRecreateConfirm] = useState(false);
  const [recordings, setRecordings] = useState<RecordingEvidence[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [targetProduct, setTargetProduct] = useState<number>(0);
  const [targetProject, setTargetProject] = useState<number | undefined>(undefined);
  const [targetBuild, setTargetBuild] = useState<string>('trunk');
  const [screenshotCopied, setScreenshotCopied] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedToTouched, setAssignedToTouched] = useState(false);
  const [aiBugAssistanceEnabled, setAiBugAssistanceEnabled] = useState(true);
  const [userOptions, setUserOptions] = useState<SearchableOption[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      {
        zentaoProductId: 0,
        zentaoProjectId: 0,
        zentaoOpenedBuild: 'trunk',
        zentaoAssignedTo: '',
        zentaoRecentUsers: [],
        aiBugAssistanceEnabled: true,
      },
      async (res) => {
        setAiBugAssistanceEnabled(res.aiBugAssistanceEnabled !== false);
        const prodId = Number(res.zentaoProductId) || 0;
        const projId = res.zentaoProjectId ? Number(res.zentaoProjectId) : undefined;
        setTargetProduct(prodId);
        setTargetProject(projId);
        setTargetBuild(String(res.zentaoOpenedBuild || 'trunk'));
        if (res.zentaoAssignedTo) {
          setAssignedTo(String(res.zentaoAssignedTo).trim());
        }

        if (Array.isArray(res.zentaoRecentUsers) && res.zentaoRecentUsers.length > 0) {
          setUserOptions(
            res.zentaoRecentUsers.map((u: any) => ({
              id: u.account,
              name: u.realname || u.account,
              subText: u.account,
            }))
          );
        }

        try {
          setIsLoadingUsers(true);
          const client = await ZentaoClient.fromChromeStorage();
          const userRes = await client.fetchUsers({ projectId: projId, productId: prodId });
          if (userRes.success && userRes.users && userRes.users.length > 0) {
            const opts: SearchableOption[] = userRes.users.map((u) => ({
              id: u.account,
              name: u.realname || u.account,
              subText: u.account,
            }));
            setUserOptions(opts);
            chrome.storage.local.set({ zentaoRecentUsers: userRes.users });
          }
        } catch {
          // 容错吸收
        } finally {
          setIsLoadingUsers(false);
        }
      }
    );
  }, []);

  const handleCopyScreenshot = async () => {
    if (!currentSnapshot?.screenshotUrl) {
      setToastMessage('当前快照无截图数据');
      return;
    }
    try {
      const [metadata, encoded] = currentSnapshot.screenshotUrl.split(',', 2);
      const mimeType = metadata.match(/^data:([^;]+)/)?.[1] || 'image/png';
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mimeType });

      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ [mimeType]: blob }),
        ]);
        setScreenshotCopied(true);
        setToastMessage('截图已复制到系统剪贴板！在禅道详情中按 Ctrl+V (Cmd+V) 即可直接粘贴');
        setTimeout(() => setScreenshotCopied(false), 2500);
      } else {
        setToastMessage('当前浏览器环境不支持直接向剪贴板写入图片，可在证据区右键保存图片');
      }
    } catch {
      setToastMessage('向剪贴板写入图片失败，请检查浏览器权限');
    }
  };

  const bugId = currentSnapshot ? `BUG-${currentSnapshot.id.replace('SNAP-', '')}` : '';

  const applyDraft = (
    draft: Pick<Bug, 'title' | 'severity' | 'reproductionSteps' | 'expectedResult' | 'actualResult' | 'aiAnalysis'> & { pri?: number }
  ) => {
    setBugTitle(draft.title);
    setSeverity(draft.severity);
    const lvl = severityLevelMap[draft.severity] || 3;
    setSeverityLevel(lvl);
    if (draft.pri && [1, 2, 3, 4].includes(draft.pri)) {
      setPri(draft.pri);
    }
    setSteps(draft.reproductionSteps);
    setExpected(draft.expectedResult);
    setActual(draft.actualResult);
    setAiAnalysis(draft.aiAnalysis || '');
  };

  const handleSelectSeverityLevel = (level: number) => {
    setSeverityLevel(level);
    const found = severityOptions.find((opt) => opt.level === level);
    if (found) {
      setSeverity(found.mappedSeverity);
    }
  };

  const handleAiGenerate = async () => {
    if (!currentSnapshot) {
      setToastMessage('当前没有关联的问题快照');
      return;
    }
    setIsGenerating(true);
    setToastMessage(`${aiProviderService.activeProvider.label} 正在分析现场事件与接口证据...`);
    try {
      const draft = await aiProviderService.generateBug(currentSnapshot);
      applyDraft(draft);
      setToastMessage(`${aiProviderService.activeProvider.label} 已生成标题、严重度、复现步骤与排查建议`);
    } catch {
      setToastMessage('智能生成失败，已保留当前编辑内容');
    } finally {
      setIsGenerating(false);
    }
  };

  // 优先恢复人工草稿；仅在首次无草稿时生成启发式初稿。
  useEffect(() => {
    if (!currentSnapshot || !bugId) return;
    let cancelled = false;
    snapshotRepo.getBugById(bugId).then(async (saved) => {
      if (cancelled) return;
      if (saved) {
        applyDraft(saved);
        setBugStatus(saved.status);
        setExternalUrl(saved.externalUrl || '');
        if (saved.assignedTo) {
          setAssignedTo(saved.assignedTo);
        }
        if (saved.submission) {
          setSubmissionRecord(saved.submission);
          setExternalUrl(saved.submission.externalUrl);
        }
        return;
      }
      try {
        const draft = await aiProviderService.generateBug(currentSnapshot);
        if (!cancelled) applyDraft(draft);
      } catch {
        if (!cancelled) {
          setSteps(currentSnapshot.events
            .filter((event) => ['navigation', 'click', 'input'].includes(event.type))
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((event) => event.description));
        }
      }
    });
    return () => { cancelled = true; };
  }, [currentSnapshot]);

  useEffect(() => {
    if (!currentSnapshot) return;
    let cancelled = false;
    // 提交禅道 Bug 时默认不选择录屏附件
    setSelectedRecordingId(null);
    Promise.all([
      recordingRepo.listBySession(currentSnapshot.sessionId),
      recordingRepo.listRecent(10),
    ]).then(([sessionRecs, recentRecs]) => {
      if (cancelled) return;
      const map = new Map<string, RecordingEvidence>();
      sessionRecs.forEach((r) => map.set(r.id, r));
      recentRecs.forEach((r) => {
        if (!map.has(r.id)) map.set(r.id, r);
      });
      const allRecs = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
      setRecordings(allRecs);
    });
    return () => { cancelled = true; };
  }, [currentSnapshot?.sessionId, currentSnapshot?.id]);

  const downloadRecording = (recording: RecordingEvidence) => {
    const url = URL.createObjectURL(recording.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qa-recording-${recording.id}.webm`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const persistDraft = async (): Promise<boolean> => {
    if (!currentSnapshot || !bugId) {
      setToastMessage('请先在测试过程中创建问题快照');
      return false;
    }
    if (!bugTitle.trim()) {
      setToastMessage('请先填写 Bug 标题');
      return false;
    }
    const now = Date.now();
    const existing = await snapshotRepo.getBugById(bugId);
    const draft: Bug = {
      id: bugId,
      snapshotId: currentSnapshot.id,
      sessionId: currentSnapshot.sessionId,
      title: bugTitle.trim(),
      severity,
      pri,
      status: existing?.status || bugStatus,
      reproductionSteps: steps,
      expectedResult: expected,
      actualResult: actual,
      aiAnalysis,
      assignedTo: assignedTo.trim() || existing?.assignedTo,
      externalPlatform: existing?.externalPlatform,
      externalId: existing?.externalId,
      externalUrl: existing?.externalUrl,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) await snapshotRepo.updateBug(bugId, draft);
    else await snapshotRepo.createBug(draft);
    return true;
  };

  const handleSaveDraft = async () => {
    if (!await persistDraft()) return;
    setToastMessage('Bug 草稿已保存，可在重新打开插件后继续编辑');
  };

  const handleCopyMarkdown = async () => {
    if (!currentSnapshot || !bugId) {
      setToastMessage('请先在测试过程中创建问题快照');
      return;
    }
    if (!await persistDraft()) return;
    const md = MarkdownBugExporter.generate(
      {
        id: bugId,
        title: bugTitle,
        severity,
        reproductionSteps: steps,
        expectedResult: expected,
        actualResult: actual,
        aiAnalysis,
      },
      currentSnapshot || undefined
    );

    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setToastMessage('Bug 草稿已保存，Markdown 已复制到剪贴板');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setToastMessage('草稿已保存，但剪贴板写入失败，请检查插件权限后重试');
    }
  };

  const handleSubmitZentao = async () => {
    if (!currentSnapshot || !bugId) return;

    // 必填校验：指派给谁
    if (!assignedTo || !assignedTo.trim()) {
      setAssignedToTouched(true);
      setToastMessage('提交失败：请选择或输入指派给谁（必填）');
      return;
    }

    if (!targetProduct) {
      setToastMessage('请先在系统设置中配置关联的禅道产品与所属项目');
      setSettingsSubTab('zentao');
      setCurrentTab('settings');
      return;
    }

    if (!(await persistDraft())) return;

    setIsSubmittingZentao(true);
    setToastMessage('正在提交至禅道…');
    try {
      const local = await chrome.storage.local.get({
        zentaoBaseUrl: 'https://zentao.hbisscm.com',
        zentaoApiVersion: 'v2',
      });
      const norm = normalizeZentaoUrl(String(local.zentaoBaseUrl || ''), local.zentaoApiVersion as any);

      const chosenRecording = selectedRecordingId
        ? recordings.find((r) => r.id === selectedRecordingId)
        : undefined;

      const client = await ZentaoClient.fromChromeStorage();
      const result = await client.createBug(
        {
          title: bugTitle,
          severity,
          severityLevel,
          pri,
          aiAnalysis: aiBugAssistanceEnabled && aiAnalysis ? aiAnalysis : undefined,
          recordingBlob: chosenRecording?.blob,
          recordingFileName: chosenRecording ? `qa-recording-${chosenRecording.id}.webm` : undefined,
          reproductionSteps: steps,
          expectedResult: expected,
          actualResult: actual,
          assignedTo: assignedTo.trim(),
        },
        currentSnapshot
      );

      // 成功提交后自动记住指派人
      chrome.storage.local.set({ zentaoAssignedTo: assignedTo.trim() });

      let attachmentStatus: BugSubmissionRecord['attachmentStatus'] = 'none';
      if (currentSnapshot.screenshotUrl) {
        if (result.attachmentUploaded) {
          attachmentStatus = 'uploaded';
        } else if (norm.apiVersion === 'v1' && result.attachmentError?.includes('未开放')) {
          attachmentStatus = 'unsupported';
        } else {
          attachmentStatus = 'failed';
        }
      }

      const newSubmission: BugSubmissionRecord = {
        platform: 'zentao',
        siteUrl: norm.baseUrl,
        apiVersion: norm.apiVersion,
        externalId: String(result.id),
        externalUrl: result.url,
        submittedAt: Date.now(),
        attachmentStatus,
        attachmentError: result.attachmentError,
      };

      await snapshotRepo.updateBug(bugId, {
        status: 'submitted',
        externalPlatform: 'zentao',
        externalId: String(result.id),
        externalUrl: result.url,
        submission: newSubmission,
      });

      setSubmissionRecord(newSubmission);
      setBugStatus('submitted');
      setExternalUrl(result.url);
      setShowRecreateConfirm(false);

      const uploadedParts: string[] = [];
      if (result.attachmentUploaded) uploadedParts.push('截图');
      if (result.recordingUploaded) uploadedParts.push('录屏');

      if (attachmentStatus === 'unsupported') {
        setToastMessage(`已创建禅道 Bug #${result.id}（注意：API v1 暂无统一附件接口，Bug 已成功提交）`);
      } else if (attachmentStatus === 'failed') {
        if (result.attachmentError?.includes('not allowed') || result.attachmentError?.includes('权限')) {
          setToastMessage(`已成功创建禅道 Bug #${result.id}！(API 附件权限受限，已就绪复制截图，可在禅道中直接粘贴)`);
        } else {
          setToastMessage(`已创建禅道 Bug #${result.id}，但截图上传失败：${result.attachmentError}。可点击“仅重试截图”或“复制截图”。`);
        }
      } else {
        const attachInfo = uploadedParts.length > 0 ? `（含${uploadedParts.join('与')}附件）` : '';
        setToastMessage(`已提交禅道 Bug #${result.id}${attachInfo}`);
      }
    } catch (error) {
      const msg = (error as Error).message || '';
      if (msg.toLowerCase().includes('not allowed')) {
        setToastMessage('禅道提交失败：权限受限 (not allowed)。请确认已在浏览器中登录禅道并拥有该产品提单权限；也可点击下方“复制 Markdown”直接在禅道粘贴。');
      } else {
        setToastMessage(`禅道提交失败：${msg}`);
      }
    } finally {
      setIsSubmittingZentao(false);
    }
  };

  const handleRetryAttachmentOnly = async () => {
    if (!currentSnapshot?.screenshotUrl) {
      setToastMessage('当前快照没有截图数据，无法上传');
      return;
    }
    const existing = await snapshotRepo.getBugById(bugId);
    const sub = existing?.submission || submissionRecord;
    if (!sub || !sub.externalId) {
      setToastMessage('该 Bug 尚未在禅道创建，请先点击“提交到禅道”');
      return;
    }

    if (sub.attachmentStatus === 'unsupported') {
      setToastMessage('该 Bug 提交于禅道 API v1 站点，官方 REST 未开放统一附件上传接口，无需重复尝试');
      return;
    }

    // 关键安全防护：严格校验当前活动站点与原提交站点是否同源！
    const [local, session] = await Promise.all([
      chrome.storage.local.get({ zentaoBaseUrl: '' }),
      chrome.storage.session.get({ zentaoToken: '' }),
    ]);
    const currentBaseUrl = String(local.zentaoBaseUrl || '').trim();

    if (!isSameZentaoSite(currentBaseUrl, sub.siteUrl)) {
      setToastMessage(`跨站拦截：当前配置的禅道站点「${currentBaseUrl || '未配置'}」与该 Bug 提交的原站点「${sub.siteUrl}」不一致！为防串单已阻止上传，请切换回原站点。`);
      return;
    }

    const currentToken = String(session.zentaoToken || '').trim();
    if (!currentToken) {
      setToastMessage('当前缺少禅道 Token，请在设置中配置原站点的有效 Token 后重试');
      return;
    }

    setIsRetryingAttachment(true);
    setToastMessage(`正在向原站点 ${sub.siteUrl} 重试上传截图至 Bug #${sub.externalId}…`);
    try {
      // 严格使用原站点的 siteUrl 与 apiVersion 构建客户端
      const client = new ZentaoClient({
        baseUrl: sub.siteUrl,
        token: currentToken,
        apiVersion: sub.apiVersion,
        productId: 0,
        openedBuild: ['trunk'],
      });

      await client.uploadScreenshot(Number(sub.externalId), currentSnapshot.screenshotUrl);

      const updatedSub: BugSubmissionRecord = {
        ...sub,
        attachmentStatus: 'uploaded',
        attachmentError: undefined,
      };

      await snapshotRepo.updateBug(bugId, { submission: updatedSub });
      setSubmissionRecord(updatedSub);
      setToastMessage(`截图重试上传成功！已附加至原站点禅道 Bug #${sub.externalId}`);
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('not allowed') || msg.includes('权限')) {
        setToastMessage(`截图重试受阻：禅道限制了 API 附件权限 (not allowed)。可直接点击下方“复制截图”，在禅道详情中粘贴。`);
      } else {
        setToastMessage(`截图上传失败：${msg}`);
      }
    } finally {
      setIsRetryingAttachment(false);
    }
  };

  if (!currentSnapshot) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 pt-16 text-center text-xs">
        <div className="text-sm font-bold text-slate-800">暂无问题快照</div>
        <p className="text-slate-500">开始测试并点击“发现问题”后，可在这里编辑和保存 Bug 草稿。</p>
        <button
          onClick={() => setCurrentTab('home')}
          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 pb-20 text-xs">
      {/* 顶部标题与返回 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView('main')}
            className="p-1 text-slate-500 hover:text-slate-800 rounded-md"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-slate-900">Bug 详情</h2>
        </div>
        <button
          onClick={handleCopyMarkdown}
          className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? '已复制' : '复制 Markdown'}</span>
        </button>
      </div>

      {/* Bug ID 与状态 */}
      <div className="flex items-center justify-between py-1 bg-white px-3 py-2 rounded-xl border border-slate-200">
        <div className="flex flex-col">
          <span className="font-mono font-bold text-slate-800 text-sm">{bugId}</span>
          <span className="text-[10px] text-slate-400">
            来源快照: {currentSnapshot?.id || '手动创建'}
          </span>
        </div>
        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
          bugStatus === 'submitted' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {bugStatus === 'submitted' ? '已提交禅道' : '未提交'}
        </span>
      </div>
      {externalUrl && (
        <a href={externalUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 underline break-all">查看禅道 Bug：{externalUrl}</a>
      )}

      {/* 标题 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-700 flex items-center gap-1">
            <span>标题</span>
            <span className="text-red-500">*</span>
            <span className="text-[10px] bg-blue-50 text-blue-600 px-1 rounded flex items-center gap-0.5 font-normal">
              <Sparkles className="w-2.5 h-2.5" /> AI
            </span>
          </label>
          <span className="text-[10px] text-slate-400">{bugTitle.length}/200</span>
        </div>
        <input
          type="text"
          value={bugTitle}
          maxLength={200}
          onChange={(e) => setBugTitle(e.target.value)}
          className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
        />
      </div>

      {/* 严重程度 与 优先级 (1~4级) */}
      <div className="grid grid-cols-2 gap-2">
        {/* 严重程度 1~4 级 */}
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-slate-700 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <span>严重程度</span>
              <span className="text-red-500">*</span>
            </span>
            <span className="text-[10px] text-slate-400 font-normal">
              {severityLevel}级 ({severityOptions.find((o) => o.level === severityLevel)?.label})
            </span>
          </label>
          <div className="grid grid-cols-4 gap-1 text-center">
            {severityOptions.map((opt) => {
              const active = severityLevel === opt.level;
              return (
                <button
                  key={opt.level}
                  type="button"
                  onClick={() => handleSelectSeverityLevel(opt.level)}
                  className={`py-1 px-0.5 rounded-md text-[11px] font-semibold border transition-all flex flex-col items-center justify-center ${
                    active ? opt.activeColor : `bg-white ${opt.color}`
                  }`}
                  title={`${opt.level}级 (${opt.label})`}
                >
                  <span className="leading-tight">{opt.level}级</span>
                  <span className={`text-[9px] scale-90 ${active ? 'text-white/90' : 'opacity-75'}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 优先级 1~4 级 */}
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-slate-700 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <span>优先级</span>
              <span className="text-red-500">*</span>
            </span>
            <span className="text-[10px] text-slate-400 font-normal">
              {pri}级 ({priorityOptions.find((o) => o.level === pri)?.label})
            </span>
          </label>
          <div className="grid grid-cols-4 gap-1 text-center">
            {priorityOptions.map((opt) => {
              const active = pri === opt.level;
              return (
                <button
                  key={opt.level}
                  type="button"
                  onClick={() => setPri(opt.level)}
                  className={`py-1 px-0.5 rounded-md text-[11px] font-semibold border transition-all flex flex-col items-center justify-center ${
                    active ? opt.activeColor : `bg-white ${opt.color}`
                  }`}
                  title={`${opt.level}级 (${opt.label})`}
                >
                  <span className="leading-tight">{opt.level}级</span>
                  <span className={`text-[9px] scale-90 ${active ? 'text-white/90' : 'opacity-75'}`}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 指派给谁 (必填) */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-700 flex items-center gap-1">
            <User className="w-3.5 h-3.5 text-indigo-600" />
            <span>指派给</span>
            <span className="text-red-500 font-bold">*</span>
            <span className="text-[10px] text-slate-400 font-normal">(必填)</span>
          </label>
          {assignedTo && (
            <span className="text-[10px] text-slate-400 font-mono">
              账号: <span className="text-slate-700 font-semibold">{assignedTo}</span>
            </span>
          )}
        </div>
        <SearchableSelect
          options={userOptions}
          value={assignedTo}
          onChange={(val) => {
            setAssignedTo(String(val || '').trim());
            setAssignedToTouched(false);
          }}
          placeholder="选择或输入指派人账号 (如 admin, zhangsan)..."
          allowCustomInput={true}
          loading={isLoadingUsers}
          className={!assignedTo.trim() && assignedToTouched ? 'ring-2 ring-red-500/80 rounded-lg' : ''}
          emptyText={isLoadingUsers ? '正在拉取用户列表…' : '暂未拉取到用户，可直接输入账号后选用'}
        />
        {!assignedTo.trim() && assignedToTouched && (
          <span className="text-[10px] text-red-500 font-medium">请必须指定 Bug 指派人/经办人后提交</span>
        )}
      </div>

      {/* 复现步骤 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-700 flex items-center gap-1">
            <span>复现步骤</span>
            <span className="text-red-500">*</span>
            <span className="text-[10px] text-slate-400 font-normal">({steps.length} 步)</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAiGenerate}
              disabled={isGenerating}
              className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md hover:bg-blue-100 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              <span>{isGenerating ? '分析中...' : '重新生成'}</span>
            </button>
            <button
              onClick={() => setSteps([...steps, '新增操作步骤'])}
              className="text-[11px] text-slate-500 hover:underline"
            >
              + 增加步骤
            </button>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-col gap-1 shadow-2xs">
          {steps.map((st, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="text-slate-400 font-mono text-[11px] w-4 shrink-0">{idx + 1}.</span>
              <input
                type="text"
                value={st}
                onChange={(e) => {
                  const next = [...steps];
                  next[idx] = e.target.value;
                  setSteps(next);
                }}
                className="flex-1 py-1 px-1.5 bg-transparent text-slate-800 text-xs border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSteps(steps.filter((_, stepIndex) => stepIndex !== idx))}
                className="p-1 text-slate-300 hover:text-red-500"
                aria-label={`删除第 ${idx + 1} 步`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 预期与实际结果 */}
      <div className="grid grid-cols-1 gap-2">
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-slate-700">预期结果 *</label>
          <textarea
            rows={2}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none shadow-2xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-semibold text-slate-700">实际结果 *</label>
          <textarea
            rows={2}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none shadow-2xs"
          />
        </div>
      </div>

      {/* AI 分析排查建议 (TASK-405) */}
      {aiAnalysis && (
        <div className="bg-blue-50/70 border border-blue-200/80 p-2.5 rounded-xl flex flex-col gap-1.5 text-[11px] text-blue-950 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-blue-700 font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI 疑似根因与排查建议</span>
            </div>
            {aiBugAssistanceEnabled ? (
              <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                将写入禅道描述
              </span>
            ) : (
              <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                已在设置中关闭写入
              </span>
            )}
          </div>
          <div className="whitespace-pre-line text-blue-900 leading-relaxed font-sans pl-1">
            {aiAnalysis}
          </div>
        </div>
      )}

      {/* 技术上下文预览 (TASK-305) */}
      <div className="bg-slate-100 p-2.5 rounded-xl flex flex-col gap-1 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-700">技术上下文（已自动提取）</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>环境: <strong className="text-slate-800">{currentSnapshot?.environment || activeSession?.environment || '未知'}</strong></span>
          <span>浏览器: <strong className="text-slate-800">{currentSnapshot?.browserInfo.browserName || 'Chrome'}</strong></span>
          <span>异常接口数: <strong className="text-red-600">{currentSnapshot?.summary.errorCount || 0}</strong></span>
        </div>
      </div>

      {/* 来自 Snapshot 的真实证据，不经过生成器改写 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
        <span className="font-semibold text-slate-800">问题证据</span>

        {currentSnapshot.screenshotUrl && (
          <details className="group">
            <summary className="cursor-pointer list-none flex items-center justify-between text-slate-700 font-medium">
              <span className="flex items-center gap-1.5">
                <Image className="w-3.5 h-3.5 text-emerald-600" />页面截图
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyScreenshot();
                }}
                className="text-[11px] px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center gap-1 transition-colors"
                title="复制截图到剪贴板，支持直接粘贴到禅道富文本框中"
              >
                {screenshotCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{screenshotCopied ? '已复制' : '复制图片'}</span>
              </button>
            </summary>
            <img
              src={currentSnapshot.screenshotUrl}
              alt="问题截图"
              className="mt-2 w-full rounded-lg border border-slate-200"
            />
          </details>
        )}

        {currentSnapshot.networkRequests.filter((request) => request.isError || request.isSlow).map((request) => (
          <details key={request.id} className="group border-t border-slate-100 pt-2">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0 font-medium text-slate-700">
                <Terminal className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <span className="font-mono truncate">{request.method} {request.pathname}</span>
              </span>
              <span className="font-mono text-red-600 shrink-0">{request.status || 'ERR'} · {request.duration}ms</span>
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="font-mono text-[10px] text-slate-500 break-all">{request.url}</div>
              {request.requestBody && (
                <pre className="p-2 bg-slate-900 text-slate-100 rounded overflow-x-auto max-h-28 text-[10px]">{request.requestBody}</pre>
              )}
              {request.responseBody && (
                <pre className="p-2 bg-slate-900 text-emerald-300 rounded overflow-x-auto max-h-32 text-[10px]">{request.responseBody}</pre>
              )}
            </div>
          </details>
        ))}

        {currentSnapshot.consoleErrors.map((event) => (
          <details key={event.id} className="group border-t border-slate-100 pt-2">
            <summary className="cursor-pointer list-none flex items-center gap-1.5 font-medium text-slate-700">
              <FileCode2 className="w-3.5 h-3.5 text-amber-500" />
              <span className="truncate">{event.title}</span>
            </summary>
            <pre className="mt-2 p-2 bg-slate-900 text-amber-200 rounded overflow-x-auto max-h-32 whitespace-pre-wrap text-[10px]">
              {event.description}{(event.payload as { stack?: string }).stack ? `\n${(event.payload as { stack?: string }).stack}` : ''}
            </pre>
          </details>
        ))}

        {/* 录屏附件选择与随单提交控制 */}
        <div className="border-t border-slate-100 pt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 text-xs">
              <Video className="w-3.5 h-3.5 text-purple-600" />
              <span>录屏附件</span>
              <span className="text-[10px] text-slate-400">({recordings.length} 个可用)</span>
            </div>
            {recordings.length > 0 && selectedRecordingId && (
              <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded font-medium">
                将随单提交至禅道
              </span>
            )}
          </div>

          {recordings.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {recordings.map((recording) => {
                const isSelected = selectedRecordingId === recording.id;
                const isCurrentSession = recording.sessionId === currentSnapshot.sessionId;
                const timeStr = new Date(recording.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const sizeKb = Math.round(recording.size / 1024);
                const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`;

                return (
                  <div
                    key={recording.id}
                    onClick={() => setSelectedRecordingId(isSelected ? null : recording.id)}
                    className={`p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-purple-50/70 border-purple-300 shadow-2xs'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSelectedRecordingId(isSelected ? null : recording.id)}
                        className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 w-3.5 h-3.5"
                      />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800 text-[11px]">
                          <span>{timeStr} 录屏</span>
                          {isCurrentSession && (
                            <span className="text-[9px] bg-blue-100 text-blue-700 px-1 rounded font-normal">
                              当前会话
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          时长 {Math.round(recording.durationMs / 1000)}s · 体积 {sizeStr}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadRecording(recording);
                      }}
                      className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors ml-2 shrink-0"
                      title="下载/本地预览该录像"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-2 bg-slate-50 rounded-lg text-slate-400 text-[11px] text-center">
              暂未检测到录屏文件（测试期间开启录屏后将在此展示）
            </div>
          )}
        </div>

        {!currentSnapshot.screenshotUrl &&
          currentSnapshot.networkRequests.every((request) => !request.isError && !request.isSlow) &&
          currentSnapshot.consoleErrors.length === 0 &&
          recordings.length === 0 && (
            <span className="text-slate-400 text-[11px]">该快照未捕获到截图或异常技术证据。</span>
          )}
      </div>

      {/* 底部按钮 */}
      <div className="pt-2 flex flex-col gap-2">
        <button
          onClick={handleSaveDraft}
          className="w-full py-2.5 bg-white hover:bg-slate-50 border border-blue-200 text-blue-700 font-bold rounded-xl flex items-center justify-center gap-1.5"
        >
          <Save className="w-4 h-4" />
          <span>保存草稿</span>
        </button>
        <button
          onClick={handleCopyMarkdown}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Copy className="w-4 h-4" />
          <span>一键复制 Markdown</span>
        </button>
        {/* 禅道提交状态与操作 (CFG-06 提交闭环) */}
        {/* 提单目标展示与快速修改入口 */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 border border-slate-200/80 rounded-lg text-[11px] text-slate-600">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-slate-700">提单目标:</span>
            <span>产品 #{targetProduct || '未选'}</span>
            <span>·</span>
            <span>项目 #{targetProject || '未选'}</span>
            <span>·</span>
            <span className="font-mono text-indigo-700">{targetBuild}</span>
            <span>·</span>
            <span className={assignedTo ? 'text-emerald-700 font-medium' : 'text-amber-600 font-medium'}>
              指派: {assignedTo || '待指派*'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('zentao');
              setCurrentTab('settings');
            }}
            className="text-blue-600 hover:text-blue-800 text-[10px] underline shrink-0 font-medium"
          >
            修改目标
          </button>
        </div>

        {bugStatus === 'submitted' && submissionRecord ? (
          <div className="flex flex-col gap-2 p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>已提交至禅道 Bug #{submissionRecord.externalId}</span>
              </span>
              <span className="text-[10px] text-emerald-700 font-mono">
                API {submissionRecord.apiVersion.toUpperCase()}
              </span>
            </div>

            {/* 附件状态呈现 */}
            {submissionRecord.attachmentStatus === 'failed' ? (
              <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded-lg flex flex-col gap-2 text-[11px]">
                <div className="flex items-start gap-1.5 text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-snug">
                    {submissionRecord.attachmentError?.includes('not allowed') || submissionRecord.attachmentError?.includes('权限')
                      ? '截图自动关联受阻：禅道服务端限制了 API 附件上传权限 (not allowed)。Bug 已成功建单，推荐一键复制截图到禅道直接粘贴。'
                      : `截图上传未成功: ${submissionRecord.attachmentError || '未知错误'}`}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={handleCopyScreenshot}
                    className="px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded font-medium text-[11px] flex items-center gap-1 transition-colors shadow-2xs"
                    title="复制截图到剪贴板，打开禅道直接 Ctrl+V / Cmd+V 粘贴"
                  >
                    {screenshotCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-amber-700" />}
                    <span>{screenshotCopied ? '已复制到剪贴板' : '复制截图 (推荐直接粘贴)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRetryAttachmentOnly}
                    disabled={isRetryingAttachment}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded font-bold text-[11px] flex items-center gap-1 shrink-0 transition-colors shadow-2xs"
                  >
                    <Upload className="w-3 h-3" />
                    <span>{isRetryingAttachment ? '重试中…' : '重试接口'}</span>
                  </button>
                </div>
              </div>
            ) : submissionRecord.attachmentStatus === 'unsupported' ? (
              <div className="p-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-blue-800 flex items-center gap-1">
                <span>提示：原站点为 API v1，官方未提供统一附件接口，Bug 已成功建单</span>
              </div>
            ) : submissionRecord.attachmentStatus === 'uploaded' ? (
              <div className="text-[11px] text-emerald-700 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>截图附件已成功关联至该 Bug</span>
              </div>
            ) : null}

            {/* 主要操作：在禅道中查看 */}
            <button
              type="button"
              onClick={() => {
                if (submissionRecord.externalUrl) {
                  if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.create({ url: submissionRecord.externalUrl });
                  } else {
                    window.open(submissionRecord.externalUrl, '_blank');
                  }
                }
              }}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>在禅道中查看 Bug #{submissionRecord.externalId}</span>
            </button>

            {/* 防重复建单确认门禁 */}
            {showRecreateConfirm ? (
              <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg flex flex-col gap-2 text-xs animate-in fade-in duration-200">
                <div className="flex items-start gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-snug">
                    该问题已在禅道创建 Bug #{submissionRecord.externalId}。再次提交将在禅道生成一条<strong>全新的重复 Bug 单</strong>。确定要继续吗？
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRecreateConfirm(false)}
                    className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 rounded text-[11px] font-medium hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitZentao}
                    disabled={isSubmittingZentao}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold flex items-center gap-1"
                  >
                    {isSubmittingZentao ? '提交中…' : '确认创建新单'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowRecreateConfirm(true)}
                  className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                >
                  需要再次提交为新 Bug？点击重新建单
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleSubmitZentao}
            disabled={isSubmittingZentao}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>{isSubmittingZentao ? '正在提交…' : '提交到禅道'}</span>
          </button>
        )}

        <button
          onClick={() => {
            setActiveView('main');
            setCurrentTab('home');
          }}
          className="w-full py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold rounded-xl"
        >
          返回首页继续测试
        </button>
      </div>
    </div>
  );
};
