import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Copy, FileUp, Loader2, Play, Settings2, Sparkles } from 'lucide-react';
import { sendToBackground } from '../../shared/messages';
import { parseImportedTestSuite } from '../../shared/testCase/parser';
import { ImportedTestSuite } from '../../shared/types/testCase';
import { useAppStore } from '../store/useAppStore';

export const TEMPLATE_CRUD = `# 后台管理系统业务新增与验证模板（直接在当前已打开页面执行，无需跳转）
tasks:
  - name: 新增用户并验证
    flow:
      - ai: "点击页面表格上方的「+ 新增」按钮打开弹窗"
      - sleep: 800
      - ai: "在弹窗中依次填写：用户昵称输入 test_user，手机号码输入 13800000000"
      - ai: "点击弹窗底部的「确定」按钮保存"
      - sleep: 1000
      - aiAssert: "页面出现操作成功的轻提示，或用户列表中能看到 test_user"`;

export const TEMPLATE_WEB = `# 通用网站端到端测试模板（自动打开指定入口网址）
web:
  url: "https://example.com"
tasks:
  - name: 搜索流程与结果验证
    flow:
      - ai: "在搜索框中输入 QA Copilot，然后提交搜索"
      - sleep: 500
      - aiAssert: "页面显示与 QA Copilot 相关的搜索结果"`;

interface AiTestCasesPageProps {
  mode: 'cases' | 'agent';
}

export const AiTestCasesPage: React.FC<AiTestCasesPageProps> = ({ mode }) => {
  const { setToastMessage, activeTask, lastRunnerTask, setCurrentTab, setSettingsSubTab } = useAppStore();
  const [source, setSource] = useState(TEMPLATE_CRUD);
  const [fileName, setFileName] = useState('后台业务新增模板.yaml');
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<'crud' | 'web'>('crud');
  const [showGuide, setShowGuide] = useState(false);
  const [suite, setSuite] = useState<ImportedTestSuite | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runNotice, setRunNotice] = useState<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasActiveRun = activeTask?.type === 'runner_test' && ['running', 'cancelling', 'queued'].includes(activeTask.status);
  const runnerTask = activeTask?.type === 'runner_test' ? activeTask : lastRunnerTask;
  const runnerStep = runnerTask
    ? runnerTask.steps.find((step) => step.status === 'running') || runnerTask.steps[Math.max(0, runnerTask.currentStep - 1)]
    : undefined;
  const failedStep = runnerTask?.steps.find((step) => step.status === 'failed');

  useEffect(() => {
    const parsed = parseImportedTestSuite(TEMPLATE_CRUD);
    setSuite(parsed.suite || null);
    setErrors(parsed.errors);
  }, []);

  useEffect(() => {
    if (!hasActiveRun || !activeTask || activeTask.type !== 'runner_test') {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - activeTask.startedAt) / 1_000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, activeTask?.runId, activeTask?.startedAt]);

  useEffect(() => {
    if (!lastRunnerTask || ['running', 'cancelling', 'queued'].includes(lastRunnerTask.status)) return;
    setIsRunning(false);
    const failed = lastRunnerTask.steps.find((step) => step.status === 'failed');
    if (lastRunnerTask.status === 'failed') {
      setRunNotice({
        kind: 'error',
        message: `${failed ? `第 ${failed.stepIndex + 1} 步「${failed.title}」失败：` : ''}${failed?.error || lastRunnerTask.error || '执行失败'}`,
      });
    } else if (lastRunnerTask.status === 'cancelled') {
      setRunNotice({ kind: 'info', message: '任务已取消' });
    } else if (lastRunnerTask.status === 'completed') {
      setRunNotice({ kind: 'success', message: '任务执行完成；请查看步骤状态和页面结果' });
    }
  }, [lastRunnerTask]);

  const parseSource = (text = source) => {
    const parsed = parseImportedTestSuite(text);
    setSuite(parsed.suite || null);
    setErrors(parsed.errors);
    if (parsed.suite) setToastMessage(`已解析 ${parsed.suite.tasks.length} 个用例，可预览后执行`);
    return parsed.suite;
  };

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    event.target.value = '';
    if (file.size > 1_000_000) {
      setSuite(null);
      setErrors(['文件超过 1 MB 限制']);
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      parseSource(text);
    } catch (error) {
      setSuite(null);
      setErrors([`读取文件失败：${(error as Error).message}`]);
    }
  };

  const loadTemplate = (key: 'crud' | 'web') => {
    setSelectedTemplateKey(key);
    const content = key === 'crud' ? TEMPLATE_CRUD : TEMPLATE_WEB;
    setSource(content);
    setFileName(key === 'crud' ? '后台业务新增模板.yaml' : '通用网页测试模板.yaml');
    parseSource(content);
  };

  const copyTemplate = () => {
    navigator.clipboard.writeText(source).then(() => {
      setToastMessage('用例代码已复制到剪贴板');
    }).catch(() => {
      setToastMessage('复制失败，请在编辑框中手动复制');
    });
  };

  const runImported = async () => {
    const validatedSuite = parseSource();
    if (!validatedSuite) return;
    setRunNotice(null);
    useAppStore.setState({ lastRunnerTask: null });
    setIsRunning(true);
    try {
      const result = await sendToBackground<{ success?: boolean; error?: string; failedStep?: number; cancelled?: boolean }>({
        type: 'RUN_IMPORTED_TEST_SUITE',
        payload: { suite: validatedSuite },
      });
      if (result?.error) {
        setRunNotice({ kind: 'error', message: `${result.failedStep ? `第 ${result.failedStep} 步：` : ''}${result.error}` });
        setToastMessage(`用例执行失败：${result.error}`);
      } else if (result?.success) {
        setRunNotice({ kind: 'success', message: '导入用例执行完成' });
        setToastMessage('导入用例执行完成');
      } else if (result?.cancelled) {
        setRunNotice({ kind: 'info', message: '任务已取消' });
      } else {
        setRunNotice({ kind: 'error', message: '后台没有返回执行结果。请查看任务进度；如果阶段长时间不变，可以点击停止。' });
      }
    } catch (error) {
      const message = (error as Error).message || '无法连接后台';
      setRunNotice({ kind: 'error', message });
      setToastMessage(`用例执行失败：${message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runNaturalLanguage = async () => {
    const goal = instruction.trim();
    if (!goal) {
      setToastMessage('请先描述要执行的测试目标');
      return;
    }
    setRunNotice(null);
    useAppStore.setState({ lastRunnerTask: null });
    setIsRunning(true);
    try {
      const result = await sendToBackground<{ success?: boolean; error?: string; failedStep?: number; cancelled?: boolean }>({
        type: 'RUN_NATURAL_LANGUAGE_TEST',
        payload: { instruction: goal },
      });
      if (result?.error) {
        setRunNotice({ kind: 'error', message: `${result.failedStep ? `第 ${result.failedStep} 步：` : ''}${result.error}` });
        setToastMessage(`自动化执行失败：${result.error}`);
      } else if (result?.success) {
        setRunNotice({ kind: 'success', message: '自动化执行完成；请查看步骤状态和页面结果' });
        setToastMessage('自然语言自动化任务完成');
      } else if (result?.cancelled) {
        setRunNotice({ kind: 'info', message: '任务已取消' });
      } else {
        setRunNotice({ kind: 'error', message: '后台没有返回执行结果。请查看任务进度；如果阶段长时间不变，可以点击停止。' });
      }
    } catch (error) {
      const message = (error as Error).message || '无法连接后台';
      setRunNotice({ kind: 'error', message });
      setToastMessage(`自动化执行失败：${message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const disabled = isRunning || hasActiveRun;

  const runStatusPanel = (runnerTask || runNotice) && (
    <div
      role={runnerTask?.status === 'failed' || runNotice?.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`rounded-xl border p-3 text-[11px] leading-5 ${
        runnerTask?.status === 'failed' || runNotice?.kind === 'error'
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : runnerTask && ['running', 'cancelling', 'queued'].includes(runnerTask.status)
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}
    >
      {runnerTask ? (
        <>
          <div className="flex items-center justify-between gap-2 font-bold">
            <span>{['running', 'cancelling', 'queued'].includes(runnerTask.status)
              ? `正在执行 · ${elapsedSeconds} 秒`
              : runnerTask.status === 'failed' ? '执行失败' : runnerTask.status === 'cancelled' ? '任务已取消' : '执行完成'}</span>
            <span>{runnerTask.currentStep}/{runnerTask.totalSteps} 步</span>
          </div>
          {runnerStep && <div className="mt-1 break-words">当前步骤：{runnerStep.title}</div>}
          {runnerStep?.detail && <div className="break-words opacity-80">{runnerStep.detail}</div>}
          {(failedStep?.error || runnerTask.error) && (
            <div className="mt-1 break-words font-semibold">错误：{failedStep?.error || runnerTask.error}</div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold">查看 {runnerTask.steps.length} 步执行明细</summary>
            <div className="mt-1 flex flex-col gap-1">
              {runnerTask.steps.map((step) => (
                <div key={step.stepIndex} className="break-words rounded-md bg-white/70 px-2 py-1">
                  <div>{step.stepIndex + 1}. {step.status === 'failed' ? '失败' : step.status === 'success' ? '完成' : step.status === 'running' ? '进行中' : '等待中'} · {step.title}</div>
                  {step.detail && <div className="opacity-75">{step.detail}</div>}
                  {step.error && <div className="font-semibold">{step.error}</div>}
                </div>
              ))}
            </div>
          </details>
        </>
      ) : runNotice && (
        <div className="break-words font-semibold">{runNotice.message}</div>
      )}
    </div>
  );

  return mode === 'agent' ? (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-5 text-violet-900">
        描述要完成的网页测试目标。Agent 每轮只接收精简的可见控件与页面文字，再规划一个受限动作；密码框不会发给模型。
      </div>
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-slate-700">
        测试目标
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={4000}
          rows={5}
          placeholder="例如：搜索商品，打开第一个结果，确认详情页显示商品名称和价格"
          className="resize-y rounded-xl border border-slate-200 bg-white p-3 font-normal text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
      </label>
      <button
        onClick={runNaturalLanguage}
        disabled={disabled || !instruction.trim()}
        className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        执行自然语言测试
      </button>
      {runStatusPanel}
      <button
        onClick={() => { setCurrentTab('settings'); setSettingsSubTab('ai'); }}
        className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-slate-500 hover:text-violet-700"
      >
        <Settings2 className="h-3.5 w-3.5" /> 配置远程 AI
      </button>
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-5 text-blue-900">
        导入 Midscene 网页 YAML/JSON（<code>web/page + tasks + flow</code>）。支持 <code>ai</code>（操作）、<code>aiAssert</code>（断言）、<code>sleep</code>（等待）。
      </div>

      {/* 编写指南与说明折叠卡片 */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-[11px]">
        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="flex w-full items-center justify-between p-2.5 font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-blue-700">
            <BookOpen className="h-3.5 w-3.5" />
            <span>用例编写指南与语法说明</span>
          </div>
          {showGuide ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>
        {showGuide && (
          <div className="border-t border-slate-100 p-3 space-y-2.5 text-slate-600 leading-relaxed bg-slate-50/50">
            <div>
              <div className="font-bold text-slate-800 mb-1">1. 用例文件结构</div>
              <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                <li><code className="text-blue-600 font-mono">web.url</code>（可选）：测试入口网址；若不写则在当前已打开的网页直接执行。</li>
                <li><code className="text-blue-600 font-mono">tasks</code>：测试任务数组，每个任务包含 <code className="font-mono">name</code> 和 <code className="font-mono">flow</code> 步骤列表。</li>
              </ul>
            </div>
            <div>
              <div className="font-bold text-slate-800 mb-1">2. 支持的三大动作类型</div>
              <ul className="list-disc list-inside space-y-1 text-[10px]">
                <li>
                  <strong className="text-slate-800">ai (操作指令)</strong>：驱动 AI 执行点击、表单录入、下拉选择、滚动等。<br/>
                  <span className="text-slate-500 font-mono">示例: - ai: "点击「+ 新增」按钮打开弹窗"</span>
                </li>
                <li>
                  <strong className="text-slate-800">aiAssert (断言检查)</strong>：让 AI 结合页面视觉画面与文本核对业务结果，失败则停止并报错。<br/>
                  <span className="text-slate-500 font-mono">示例: - aiAssert: "页面弹出保存成功的消息提示"</span>
                </li>
                <li>
                  <strong className="text-slate-800">sleep (等待延时)</strong>：等待动画完成或接口响应，毫秒单位（0~30000ms）。<br/>
                  <span className="text-slate-500 font-mono">示例: - sleep: 800</span>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-bold text-slate-800 mb-1">3. 编写建议与技巧</div>
              <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                <li><strong>明确按钮文字</strong>：指明按钮上的具体文本（如「+ 新增」、「保存」、「查询」）。</li>
                <li><strong>弹窗动画等待</strong>：点击打开弹窗或提交接口后，建议插入 <code className="font-mono">sleep: 800</code> 确保动画和网络请求完成。</li>
                <li><strong>分步明确表单</strong>：表单项较多时，可以在指令中明确字段与值（如“用户昵称填 admin_test，手机号填 13800000000”）。</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* 快捷模板载入栏 */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-slate-500">快速载入模板:</span>
          <button
            type="button"
            onClick={() => loadTemplate('crud')}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              selectedTemplateKey === 'crud'
                ? 'bg-blue-50 border-blue-300 text-blue-700 font-bold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            后台业务 CRUD
          </button>
          <button
            type="button"
            onClick={() => loadTemplate('web')}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              selectedTemplateKey === 'web'
                ? 'bg-blue-50 border-blue-300 text-blue-700 font-bold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            通用网页测试
          </button>
        </div>
        <button
          type="button"
          onClick={copyTemplate}
          title="复制当前模板代码"
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-600 transition-colors p-1"
        >
          <Copy className="h-3 w-3" />
          <span>复制</span>
        </button>
      </div>

      <input ref={fileRef} type="file" accept=".yaml,.yml,.json,application/json,text/yaml" onChange={onFileSelected} className="hidden" />
      <div className="flex gap-2">
        <button onClick={() => fileRef.current?.click()} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 font-semibold text-slate-700 hover:bg-slate-50">
          <FileUp className="h-3.5 w-3.5" /> 导入本地 YAML / JSON 文件
        </button>
        <button onClick={() => parseSource()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">
          校验并预览
        </button>
      </div>
      <div className="text-[10px] text-slate-400">当前文件：{fileName}</div>
      <textarea
        value={source}
        onChange={(event) => { setSource(event.target.value); setSuite(null); }}
        rows={9}
        spellCheck={false}
        className="resize-y rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[10px] leading-4 text-emerald-200 outline-none focus:border-blue-400"
        aria-label="用例 YAML 或 JSON 内容"
      />

      {errors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800">
          <div className="mb-1 flex items-center gap-1.5 font-bold"><CircleAlert className="h-3.5 w-3.5" /> 校验失败，不能执行</div>
          {errors.map((error, index) => <div key={`${index}-${error}`}>{error}</div>)}
        </div>
      )}

      {suite && errors.length === 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-1.5 font-bold text-emerald-900">
            <CheckCircle2 className="h-3.5 w-3.5" /> 校验通过 · {suite.tasks.length} 个任务
          </div>
          {suite.pageUrl && <div className="break-all text-[10px] text-slate-600">入口：{suite.pageUrl}</div>}
          {suite.tasks.map((task, taskIndex) => (
            <div key={`${taskIndex}-${task.name}`} className="rounded-lg border border-white bg-white/80 p-2">
              <div className="mb-1 text-[11px] font-semibold text-slate-800">{task.name}</div>
              {task.steps.map((step, stepIndex) => (
                <div key={stepIndex} className="py-0.5 text-[10px] leading-4 text-slate-600">
                  {stepIndex + 1}. {step.type === 'ai' ? `AI 操作：${step.instruction}` : step.type === 'assert' ? `AI 断言：${step.instruction}` : step.type === 'sleep' ? `等待 ${step.milliseconds}ms` : `不支持：${step.key}`}
                </div>
              ))}
            </div>
          ))}
          <button onClick={runImported} disabled={disabled} className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            执行导入用例
          </button>
          {runStatusPanel}
        </div>
      )}
      {suite?.pageUrl && <div className="text-[10px] leading-4 text-slate-500">运行时会在当前活动标签页打开用例指定的网址。步骤失败后会立即停止，并在顶部显示当前进度。</div>}
      <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400">
        <Bot className="h-3 w-3" /> AI 操作需要在「设置 → AI」配置远程模型
      </div>
    </div>
  );
};
