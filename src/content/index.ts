/**
 * Content Script (E1 操作/导航采集 + E2 网络/异常接收与中继)
 * 极致健壮性保护，杜绝任何未经处理的 DOM 异常与 Promise Rejection
 */

import { RecordEventMessage, sendToBackground } from '../shared/messages';
import { ElementInspectResult, LocatorGenerator } from '../shared/tools/locatorGenerator';
import { getCurrentFrameGeometry, initializeFrameGeometryRelay, mapPointToTopFrame } from '../shared/tools/frameGeometry';
import { CdpInputAction } from '../shared/types/cdp';
import { ClickEventPayload, InputEventPayload, QAEvent, ScrollEventPayload } from '../shared/types/event';
import { DomAnalyzer } from '../shared/tools/domAnalyzer';
import { describeClickElement, getElementLabel } from '../shared/tools/elementLabel';
import { FormScanner } from './formScanner';
import { FormExecutor } from './formExecutor';
import { QuickLoginExecutor } from './quickLoginExecutor';

console.log('[QA Copilot] Content Script 注入页面:', window.location.href);
initializeFrameGeometryRelay();

function publishMockRules(rules: unknown) {
  window.postMessage({ source: 'QA_COPILOT_CONTENT', type: 'MOCK_CONFIG', data: Array.isArray(rules) ? rules : [] }, '*');
}

let networkInterceptorReady = false;
let inspectionMode = false;
let inspectionOverlay: HTMLDivElement | null = null;
let lastLabelForwardClick: { control: Element; at: number } | null = null;
let replayCdpPending = false;
const pendingRecordMessages = new Set<Promise<void>>();

function sendFlushableRecord(message: RecordEventMessage) {
  const pending = sendToBackground(message).then(() => undefined, () => undefined);
  pendingRecordMessages.add(pending);
  void pending.finally(() => pendingRecordMessages.delete(pending));
}

async function waitForFlushableRecords(): Promise<void> {
  await Promise.all(Array.from(pendingRecordMessages));
}

function stopInspection() {
  inspectionMode = false;
  inspectionOverlay?.remove();
  inspectionOverlay = null;
}

function startInspection() {
  stopInspection();
  inspectionMode = true;
  inspectionOverlay = document.createElement('div');
  inspectionOverlay.dataset.qaCopilotRoot = 'true';
  Object.assign(inspectionOverlay.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    border: '2px solid #2563eb',
    background: 'rgba(37, 99, 235, 0.12)',
    borderRadius: '3px',
    display: 'none',
  });
  document.documentElement.appendChild(inspectionOverlay);
}

chrome.storage.local.get({ networkMockRules: [] }, (result) => publishMockRules(result.networkMockRules));

// QA-021: 注入时向 MAIN 发送 PING_INTERCEPTOR 同步就绪状态，无需刷新页面
window.postMessage({ source: 'QA_COPILOT_CONTENT', type: 'PING_INTERCEPTOR' }, '*');

let activeContentReplayId: string | null = null;

// Content Script 每次重新注入代表一次真实页面加载/刷新；无活动 Session 时 Background 会安全忽略。
sendToBackground({
  type: 'RECORD_EVENT',
  payload: {
    event: {
      type: 'navigation',
      timestamp: Date.now(),
      title: '页面加载',
      description: `加载 ${window.location.pathname}`,
      url: window.location.href,
      payload: {
        timestamp: Date.now(),
        url: window.location.href,
        fromUrl: document.referrer || '',
        toUrl: window.location.href,
        pageTitle: document.title || '',
        navigationType: 'reload',
      },
    },
  },
}).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isTopFrame = window === window.top;

  if (message?.type === 'CAPTURE_PING') {
    sendResponse({ ready: true, networkReady: networkInterceptorReady, url: window.location.href, title: document.title, isTopFrame });
    return false;
  }
  if (message?.type === 'START_ELEMENT_INSPECTION') {
    startInspection();
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'STOP_ELEMENT_INSPECTION') {
    stopInspection();
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'FLUSH_PENDING_RECORDS') {
    flushPendingInputRecords();
    flushPendingScrollRecords();
    waitForFlushableRecords().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message?.type === 'STOP_CONTENT_REPLAY') {
    activeContentReplayId = null;
    replayCdpPending = false;
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'REPLAY_ACTION_COMPLETE') {
    if (message.payload?.replayId === activeContentReplayId) {
      activeContentReplayId = null;
      replayCdpPending = false;
    }
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'REPLAY_ACTION') {
    const targetFrameId = message.payload?.targetFrameId;
    // IMP-04: frame 边界判定，若指定了 frameId 或未指定时仅顶层 frame 响应，防止子 iframe 重复误执行
    if (targetFrameId !== undefined && targetFrameId !== null) {
      if (targetFrameId === 0 && !isTopFrame) return false;
    } else if (!isTopFrame) {
      return false;
    }

    activeContentReplayId = message.payload?.replayId || `replay-${Date.now()}`;
    replayCdpPending = false;
    replayAction(message.payload?.event as QAEvent, activeContentReplayId, Boolean(message.payload?.useCdp))
      .then((res) => {
        if (res.cdpInput) replayCdpPending = true;
        else activeContentReplayId = null;
        sendResponse(res);
      })
      .catch((error) => {
        activeContentReplayId = null;
        replayCdpPending = false;
        sendResponse({ success: false, error: (error as Error).message });
      });
    return true;
  }
  if (message?.type === 'PING_TASK_STATUS') {
    if (!isTopFrame) return false;
    const activeFormRunId = FormExecutor.getActiveRunId();
    const isFormRunning = Boolean(activeFormRunId && activeFormRunId === message.payload?.runId);
    const isReplayRunning = Boolean(activeContentReplayId && activeContentReplayId === message.payload?.runId);
    const isRunning = isFormRunning || isReplayRunning;
    const activeRunId = isFormRunning ? activeFormRunId : isReplayRunning ? activeContentReplayId : null;
    sendResponse({ isRunning, activeRunId });
    return false;
  }
  if (message?.type === 'SCAN_FORM_SNAPSHOT') {
    // IMP-04: 非顶层 frame 严格静默忽略，杜绝抢占 sendResponse 导致顶层扫描或填表失败
    if (!isTopFrame) return false;
    try {
      const snapshot = FormScanner.scan(document);
      snapshot.frameId = 0;
      sendResponse({ snapshot });
    } catch (error) {
      sendResponse({ error: `表单扫描失败: ${(error as Error).message}` });
    }
    return false;
  }
  if (message?.type === 'EXECUTE_FORM_FILL') {
    // IMP-04: 非顶层 frame 严格静默忽略
    if (!isTopFrame) return false;
    FormExecutor.executePlan(
      message.payload.snapshotId,
      message.payload.assignments,
      message.payload.mode,
      message.payload.runId
    )
      .then((runRecord) => sendResponse({ runRecord }))
      .catch((error) => sendResponse({ error: (error as Error).message }));
    return true;
  }
  if (message?.type === 'CANCEL_FORM_FILL') {
    if (!isTopFrame) return false;
    FormExecutor.cancel(message.payload?.runId);
    sendResponse({ success: true });
    return false;
  }
  if (message?.type === 'UNDO_FORM_FILL') {
    if (!isTopFrame) return false;
    const fallback = message.payload?.steps
      ? { snapshotId: message.payload.snapshotId, steps: message.payload.steps }
      : undefined;
    FormExecutor.undo(message.payload.runId, fallback)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, restoredCount: 0, conflictCount: 0, error: (error as Error).message }));
    return true;
  }
  if (message?.type === 'COLLECT_AI_OBSERVATION') {
    if (!isTopFrame && message.payload?.allFrames === false) return false;
    try {
      sendResponse(collectAiObservation());
    } catch (error) {
      sendResponse({ error: (error as Error).message });
    }
    return false;
  }
  if (message?.type === 'EXECUTE_QUICK_LOGIN') {
    if (!isTopFrame) return false;
    QuickLoginExecutor.execute({
      username: message.payload.username,
      password: message.payload.password,
      loginTriggerSelector: message.payload.loginTriggerSelector,
      autoSubmit: message.payload.autoSubmit,
    })
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, message: (err as Error).message }));
    return true;
  }
  if (message?.type !== 'ANALYZE_PAGE') return false;
  try {
    sendResponse({ ...DomAnalyzer.parsePageContext(document), url: window.location.href, title: document.title });
  } catch (error) {
    sendResponse({ fields: [], actions: [], formCount: 0, url: window.location.href, title: document.title, error: (error as Error).message });
  }
  return false;
});

// 1. 接收来自 Injected Script (MAIN world) 的消息并中继给 Background
window.addEventListener('message', (event) => {
  try {
    if (event.source !== window || !event.data || event.data.source !== 'QA_COPILOT_INJECTED') {
      return;
    }

    if (event.data.type === 'INTERCEPTOR_HELLO') {
      window.postMessage({ source: 'QA_COPILOT_CONTENT', type: 'BRIDGE_READY' }, '*');
    } else if (event.data.type === 'NETWORK_START') {
      const data = event.data.data as { requestId: string; method: string; url: string; startedAt: number };
      sendToBackground({
        type: 'NETWORK_START',
        payload: {
          requestId: data.requestId,
          method: data.method,
          url: data.url,
          startedAt: data.startedAt,
        },
      }).catch(() => {});
    } else if (event.data.type === 'NETWORK_CAPTURE') {
      sendToBackground({
        type: 'RECORD_NETWORK',
        payload: {
          request: event.data.data,
        },
      }).catch(() => {});
    } else if (event.data.type === 'INTERCEPTOR_READY') {
      networkInterceptorReady = Boolean(event.data.data?.ready);
    } else if (event.data.type === 'CONSOLE_CAPTURE') {
      const captured = event.data.data as { message?: string; timestamp?: number; url?: string };
      sendToBackground({
        type: 'RECORD_EVENT',
        payload: {
          event: {
            type: 'console',
            timestamp: captured.timestamp || Date.now(),
            title: 'Console Error',
            description: captured.message || 'console.error',
            url: captured.url || window.location.href,
            payload: {
              timestamp: captured.timestamp || Date.now(),
              url: captured.url || window.location.href,
              level: 'error',
              message: captured.message || 'console.error',
            },
          },
        },
      }).catch(() => {});
    }
  } catch {}
});

// 通知 MAIN world：中继监听器已安装，可以补发 document_start 阶段暂存的请求。
window.postMessage({ source: 'QA_COPILOT_CONTENT', type: 'BRIDGE_READY' }, '*');

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.networkMockRules) publishMockRules(changes.networkMockRules.newValue);
});

function safeEscapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function collectAiObservation() {
  const selector = [
    'button', 'a[href]', 'input:not([type="password"]):not([type="hidden"])',
    'textarea', 'select', '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="option"]',
  ].join(',');
  const elements: Array<{
    id: string;
    tag: string;
    role?: string;
    name?: string;
    text?: string;
    placeholder?: string;
    testId?: string;
    ariaLabel?: string;
    selector: string;
    inputType?: string;
    options?: Array<{ label: string; value: string }>;
    disabled?: boolean;
  }> = [];
  const candidates = Array.from(document.querySelectorAll(selector));
  for (const [index, element] of candidates.entries()) {
    if (!(element instanceof HTMLElement) || !isElementVisible(element)) continue;
    if (element.matches(':disabled, [aria-disabled="true"]')) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' && (
      ['password', 'hidden', 'file'].includes((element as HTMLInputElement).type) ||
      (element as HTMLInputElement).readOnly
    )) continue;
    if (tag === 'textarea' && (element as HTMLTextAreaElement).readOnly) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const ariaLabel = element.getAttribute('aria-label') || undefined;
    const placeholder = element.getAttribute('placeholder') || undefined;
    const title = element.getAttribute('title') || undefined;
    const labels = 'labels' in element
      ? Array.from((element as HTMLInputElement).labels || []).map((label) => label.innerText.trim()).filter(Boolean).join(' ')
      : '';
    const name = ariaLabel || labels || placeholder || element.getAttribute('name') || title || undefined;
    const text = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
    const inferredRole = element.getAttribute('role') || (
      tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' :
      tag === 'textarea' ? 'textbox' : tag === 'input' ? (
        ['checkbox', 'radio', 'button', 'submit'].includes((element as HTMLInputElement).type)
          ? (element as HTMLInputElement).type
          : 'textbox'
      ) : undefined
    );
    elements.push({
      id: `el-${index + 1}`,
      tag,
      role: inferredRole,
      name: name?.slice(0, 120),
      text,
      placeholder: placeholder?.slice(0, 120),
      testId: element.getAttribute('data-testid')?.slice(0, 100) || undefined,
      ariaLabel: ariaLabel?.slice(0, 120),
      selector: getCssSelector(element),
      inputType: tag === 'input' ? (element as HTMLInputElement).type : undefined,
      options: tag === 'select'
        ? Array.from((element as HTMLSelectElement).options).slice(0, 20).map((option) => ({
            label: (option.label || option.textContent || '').trim().slice(0, 80),
            value: option.value.slice(0, 80),
          }))
        : undefined,
      disabled: false,
    });
    if (elements.length >= 80) break;
  }

  const statusText = Array.from(document.querySelectorAll('h1,h2,h3,[role="alert"],[aria-live="polite"],[aria-live="assertive"]'))
    .filter((element) => isElementVisible(element))
    .map((element) => (element as HTMLElement).innerText || element.textContent || '')
    .join('\n');
  const bodyText = (document.body?.innerText || '').slice(0, 1_500);
  return {
    url: window.location.href,
    title: document.title.slice(0, 160),
    text: `${statusText}\n${bodyText}`.trim().slice(0, 4_000),
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    elements,
  };
}

const DYNAMIC_STATE_CLASS_REGEX = /^(is-active|is-opened|is-focus|is-hover|is-expanded|active|open|opened|show|focused|hover|selected|ant-menu-submenu-open|ant-menu-submenu-active|ant-menu-item-selected|router-link-active|router-link-exact-active)$/i;

function getCssSelector(el: Element): string {
  try {
    if (el.id) return `#${safeEscapeCss(el.id)}`;
    const tag = (el.tagName || '').toLowerCase();
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${safeEscapeCss(testId)}"]`;
    const name = el.getAttribute('name');
    if (name) return `${tag}[name="${safeEscapeCss(name)}"]`;
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${safeEscapeCss(ariaLabel)}"]`;

    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.documentElement && parts.length < 5) {
      const currentTag = current.tagName.toLowerCase();
      const classes = typeof current.className === 'string'
        ? current.className
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .filter((item) => !DYNAMIC_STATE_CLASS_REGEX.test(item))
            .slice(0, 2)
            .map((item) => `.${safeEscapeCss(item)}`)
            .join('')
        : '';
      let part = `${currentTag}${classes}`;
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
        : [];
      const isPopperOrOverlay = current.parentElement === document.body || /popper|dropdown|modal|dialog|picker|tooltip/i.test(part);
      if (siblings.length > 1 && !isPopperOrOverlay) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      current = current.parentElement;
    }
    return parts.join(' > ') || tag;
  } catch {
    return 'element';
  }
}

function getXPath(el: Element): string {
  if (el.id) return `//*[@id=${xpathLiteral(el.id)}]`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
      : [];
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : '';
    parts.unshift(`${tag}${index}`);
    current = current.parentElement;
  }
  return `/html/${parts.join('/')}`;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part, index) => `${index ? `,"'",` : ''}'${part}'`).join('')})`;
}

async function inspectElement(target: Element): Promise<void> {
  const tag = target.tagName.toLowerCase();
  const text = ((target as HTMLElement).innerText || target.getAttribute('aria-label') || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const id = target.id || undefined;
  const name = target.getAttribute('name') || undefined;
  const role = target.getAttribute('role') || undefined;
  const testId = target.getAttribute('data-testid') || undefined;
  const placeholder = target.getAttribute('placeholder') || undefined;
  const ariaLabel = target.getAttribute('aria-label') || undefined;
  const label = getElementLabel(target) || undefined;
  const css = getCssSelector(target);
  const localXPath = getXPath(target);
  const frameGeometry = getCurrentFrameGeometry();
  const topFramePoint = await mapPointToTopFrame(0, 0);
  const frameXPath = topFramePoint?.frameXPath || frameGeometry.frameXPath;
  const frameCssPath = topFramePoint?.frameCssPath || frameGeometry.frameCssPath;
  const xpath = frameXPath.length
    ? `${frameXPath.join('|>>|')}|>>|${localXPath}`
    : localXPath;
  const playwright = LocatorGenerator.generate({
    tag, text, id, name, role, testId, placeholder, ariaLabel, label,
    frameCssPath,
    frameUrl: window.location.href,
    isChildFrame: window !== window.top,
  });
  const result: ElementInspectResult = {
    tag,
    text,
    id,
    name,
    role,
    testId,
    css,
    xpath,
    frame: {
      url: window.location.href,
      frameXPath,
      frameCssPath,
      offset: topFramePoint
        ? { left: topFramePoint.x, top: topFramePoint.y }
        : { left: frameGeometry.left, top: frameGeometry.top },
      zoom: topFramePoint?.zoom ?? frameGeometry.zoom,
      complete: Boolean(topFramePoint),
    },
    playwright,
  };
  sendToBackground({ type: 'ELEMENT_INSPECTED', payload: { element: result } }).catch(() => {});
}

function querySelectorSafe(selector?: string): Element | null {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function queryUniqueSelector(selector?: string): Element | null {
  if (!selector) return null;
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function findByXPath(xpath?: string): Element | null {
  if (!xpath) return null;
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null;
  } catch {
    return null;
  }
}

function findByText(tags: string, text?: string): Element | null {
  const expected = text?.trim().replace(/\s+/g, ' ');
  if (!expected) return null;
  const matches = Array.from(document.querySelectorAll(tags)).filter((element) =>
    ((element as HTMLElement).innerText || element.textContent || '').trim().replace(/\s+/g, ' ') === expected
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const visibleMatches = matches.filter((element) => {
      if (element instanceof HTMLElement) {
        return element.offsetParent !== null || element.getClientRects().length > 0;
      }
      return true;
    });
    if (visibleMatches.length === 1) return visibleMatches[0];
  }
  return null;
}

function isElementVisible(el: Element | null): boolean {
  if (!el) return false;
  const duck = el as any;
  if (duck.offsetParent !== undefined || typeof duck.getClientRects === 'function') {
    return duck.offsetParent !== null || (typeof duck.getClientRects === 'function' && duck.getClientRects().length > 0);
  }
  if (typeof HTMLElement !== 'undefined' && el instanceof HTMLElement) {
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }
  return false;
}

export function findClickTarget(payload: ClickEventPayload): Element | null {
  const isOption = payload.role === 'option' || payload.tag === 'OPTION';
  const isInputField = Boolean(payload.isInput || ['INPUT', 'TEXTAREA', 'SELECT'].includes(payload.tag?.toUpperCase() || ''));

  const expected = (payload.text || '').trim().replace(/\s+/g, ' ');
  const expectedFirstLine = (payload.text || '').split(/[\r\n]+/)[0]?.trim().replace(/\s+/g, ' ') || '';

  const matchesText = (element: Element | null, mode: 'exact' | 'partial' = 'exact'): boolean => {
    if (!element) return false;
    if (isInputField) return true;
    if (!expected) return true;
    const actual = ((element as HTMLElement).innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    if (actual === expected) return true;
    if (mode === 'exact') return false;

    // 宽松/子串匹配（解决菜单展开/收起、截断40字符、多级子文本拼接等情况）
    if (actual && expected) {
      if (actual.includes(expected) || expected.includes(actual)) return true;
      if (expected.startsWith(actual) || actual.startsWith(expected)) return true;
      if (expectedFirstLine && (actual === expectedFirstLine || actual.includes(expectedFirstLine) || expectedFirstLine.includes(actual))) {
        return true;
      }
    }
    return false;
  };

  if (payload.id) {
    const byId = document.getElementById(payload.id);
    if (byId && matchesText(byId, 'partial')) return byId;
  }
  if (payload.testId) {
    const byTestId = querySelectorSafe(`[data-testid="${safeEscapeCss(payload.testId)}"]`);
    if (byTestId && matchesText(byTestId, 'partial')) return byTestId;
  }
  if (payload.name) {
    const byName = querySelectorSafe(`[name="${safeEscapeCss(payload.name)}"]`);
    if (byName && matchesText(byName, 'partial')) return byName;
  }
  if (payload.ariaLabel) {
    const byAriaLabel = querySelectorSafe(`[aria-label="${safeEscapeCss(payload.ariaLabel)}"]`);
    if (byAriaLabel && matchesText(byAriaLabel, 'partial')) return byAriaLabel;
  }
  if (payload.role && expected) {
    const byRole = findByText(`[role="${safeEscapeCss(payload.role)}"]`, expected);
    if (byRole) return byRole;
  }

  // 1. 优先精准文本匹配
  const byText = findByText('button, a, option, li, [role="button"], [role="option"], [role="menuitem"]', expected);
  if (byText) return byText;

  // 2. 首行文本匹配（如多行文本中提取第一行主标题进行精准匹配）
  if (expectedFirstLine && expectedFirstLine !== expected) {
    const byFirstLine = findByText('button, a, option, li, span, [role="button"], [role="menuitem"]', expectedFirstLine);
    if (byFirstLine) return byFirstLine;
  }

  const bySelector = queryUniqueSelector(payload.selector);
  const byXPath = findByXPath(payload.xpath);

  // 3. Selector / XPath 先进行精确文本匹配
  if (bySelector && matchesText(bySelector, 'exact')) return bySelector;
  if (byXPath && matchesText(byXPath, 'exact')) return byXPath;

  // 4. Selector / XPath 宽松文本匹配（包含、前缀、首行一致）
  if (bySelector && matchesText(bySelector, 'partial')) return bySelector;
  if (byXPath && matchesText(byXPath, 'partial')) return byXPath;

  // 5. 常规元素结构定位保底：非 select 选项时，如果 selector 或 xpath 命中的节点在页面上且可见，优先信任结构定位
  if (!isOption) {
    if (bySelector && isElementVisible(bySelector)) return bySelector;
    if (byXPath && isElementVisible(byXPath)) return byXPath;
  }

  // 6. 坐标兜底（QA-001：下拉选项严禁按坐标猜测；常规元素必须通过文本宽松匹配校验）
  if (!isOption && payload.x !== undefined && payload.y !== undefined) {
    const byPoint = document.elementFromPoint(payload.x, payload.y);
    if (byPoint && (!payload.tag || byPoint.closest(payload.tag.toLowerCase()))) {
      const candidate = byPoint.closest(payload.tag.toLowerCase()) || byPoint;
      if (matchesText(candidate, 'partial')) {
        return candidate;
      }
    }
  }
  return null;
}

export function findScrollTarget(payload: ScrollEventPayload): Element | Window | null {
  if (payload.target === 'window') return window;
  if (!payload.selector) return null;

  // 1. 尝试原始选择器
  const directMatch = querySelectorSafe(payload.selector);
  if (directMatch) return directMatch;

  // 2. 清洗选择器：剥离容易失效的 :nth-of-type(...) 伪类
  if (payload.selector.includes(':nth-of-type')) {
    const cleanSelector = payload.selector.replace(/:nth-of-type\(\d+\)/g, '');
    try {
      const candidates = Array.from(document.querySelectorAll(cleanSelector));
      const visibleCandidate = candidates.find((el) => isElementVisible(el));
      if (visibleCandidate) return visibleCandidate;
      if (candidates.length > 0) return candidates[candidates.length - 1];
    } catch {}
  }

  // 3. 提取末级特征类名或容器选择器回退
  const segments = payload.selector.split('>').map((s) => s.trim()).filter(Boolean);
  const lastSegment = segments[segments.length - 1]?.replace(/:nth-of-type\(\d+\)/g, '');
  if (lastSegment) {
    try {
      const matched = Array.from(document.querySelectorAll(lastSegment));
      const visible = matched.find((el) => isElementVisible(el));
      if (visible) return visible;
      if (matched.length > 0) return matched[matched.length - 1];
    } catch {}
  }

  // 4. 下拉/浮层滚动容器智能探活（如 Element UI / Plus, AntD 等下拉框滚动区域）
  if (/el-select|el-scrollbar|dropdown|popper|rc-virtual-list|menu/i.test(payload.selector)) {
    try {
      const scrollWraps = Array.from(document.querySelectorAll(
        '.el-select-dropdown:not([style*="display: none"]) .el-scrollbar__wrap, ' +
        '.el-scrollbar__wrap, ' +
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .rc-virtual-list-holder, ' +
        '[class*="select-dropdown"] [class*="scrollbar__wrap"], ' +
        '[class*="dropdown__wrap"]'
      ));
      const visibleWrap = scrollWraps.find((el) => isElementVisible(el));
      if (visibleWrap) return visibleWrap;
    } catch {}
  }

  return null;
}

function findInputTarget(payload: InputEventPayload): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const isCheckable = payload.inputType === 'radio' || payload.inputType === 'checkbox';
  const name = payload.name || payload.fieldName;
  const targetOptionValue = payload.optionValue || (payload.value !== '已选中' && payload.value !== '未选中' ? payload.value : undefined);

  // 1. 如果有明确 id，优先根据 id 查找
  if (payload.id) {
    const byId = document.getElementById(payload.id);
    if (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement || byId instanceof HTMLSelectElement) {
      return byId;
    }
  }

  // 2. 如果是单选/复选框，优先按 name + value 唯一定位 (QA-017)
  if (isCheckable && name && targetOptionValue) {
    const escapedName = safeEscapeCss(name);
    const escapedVal = safeEscapeCss(targetOptionValue);
    const selector = `input[type="${payload.inputType || 'radio'}"][name="${escapedName}"][value="${escapedVal}"]`;
    const byNameAndValue = querySelectorSafe(selector);
    if (byNameAndValue instanceof HTMLInputElement) return byNameAndValue;
  }

  // 3. 通过 Label 精确查找（关联 control 或嵌套 input）
  if (payload.fieldLabel) {
    const matchedLabel = Array.from(document.querySelectorAll('label')).find((label) => label.textContent?.trim() === payload.fieldLabel);
    if (matchedLabel) {
      if (matchedLabel.control && (matchedLabel.control instanceof HTMLInputElement || matchedLabel.control instanceof HTMLTextAreaElement || matchedLabel.control instanceof HTMLSelectElement)) {
        return matchedLabel.control;
      }
      const nestedInput = matchedLabel.querySelector('input, textarea, select');
      if (nestedInput instanceof HTMLInputElement || nestedInput instanceof HTMLTextAreaElement || nestedInput instanceof HTMLSelectElement) {
        return nestedInput;
      }
    }
  }

  // 4. selector（针对录制时生成的唯一选择器，若是可选项则校验其 value 避免同组错配）
  if (payload.selector) {
    const bySelector = querySelectorSafe(payload.selector);
    if (bySelector instanceof HTMLInputElement || bySelector instanceof HTMLTextAreaElement || bySelector instanceof HTMLSelectElement) {
      if (!isCheckable || !targetOptionValue || (bySelector instanceof HTMLInputElement && bySelector.value === targetOptionValue)) {
        return bySelector;
      }
    }
  }

  // 5. 按 name 查找：单选项在有多个同名节点时必须按目标值筛选，不得无脑取第一个 (QA-017)
  if (name) {
    const escapedName = safeEscapeCss(name);
    if (isCheckable) {
      const candidates = Array.from(document.querySelectorAll(`input[name="${escapedName}"]`)).filter(
        (el): el is HTMLInputElement => el instanceof HTMLInputElement
      );
      if (targetOptionValue) {
        const matched = candidates.find((el) => el.value === targetOptionValue);
        if (matched) return matched;
      }
      if (candidates.length === 1) return candidates[0];
    } else {
      const byName = querySelectorSafe(`[name="${escapedName}"]`);
      if (byName instanceof HTMLInputElement || byName instanceof HTMLTextAreaElement || byName instanceof HTMLSelectElement) {
        return byName;
      }
    }
  }

  // 6. placeholder
  if (payload.placeholder) {
    const byPlaceholder = querySelectorSafe(`[placeholder="${safeEscapeCss(payload.placeholder)}"]`);
    if (byPlaceholder instanceof HTMLInputElement || byPlaceholder instanceof HTMLTextAreaElement || byPlaceholder instanceof HTMLSelectElement) {
      return byPlaceholder;
    }
  }

  return null;
}

function setNativeValue(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  if (target instanceof HTMLSelectElement) {
    target.value = value;
  } else {
    const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(target, value);
    else target.value = value;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function expandDropdownForElement(el: HTMLElement): boolean {
  try {
    const dropdown = el.closest?.('.el-select-dropdown, .ant-select-dropdown, [class*="select-dropdown"], [class*="select__popper"]') as HTMLElement | null;
    if (!dropdown) return false;

    // 1. 如果浮层处于隐藏状态
    if (dropdown.offsetParent === null || dropdown.style.display === 'none' || dropdown.classList.contains('is-hidden')) {
      if (dropdown.id) {
        const trigger = document.querySelector(`[aria-controls="${dropdown.id}"], [aria-owns="${dropdown.id}"], [aria-describedby*="${dropdown.id}"]`);
        if (trigger instanceof HTMLElement && isElementVisible(trigger)) {
          dispatchClick(trigger);
          return true;
        }
      }

      // 2. 页面上查找未展开或相关的下拉框（例如 .el-select, .ant-select）
      const selects = Array.from(document.querySelectorAll('.el-select, .ant-select, [role="combobox"], .n-select, .arco-select'));
      for (const sel of selects) {
        if (isElementVisible(sel)) {
          const trigger = (sel.querySelector?.('.el-input__inner, .ant-select-selector, .el-select__caret, input') || sel) as HTMLElement;
          dispatchClick(trigger);
          return true;
        }
      }
    }
  } catch {}
  return false;
}

function autoExpandAncestors(el: HTMLElement) {
  try {
    // 1. 优先检测是否属于挂在 body 上的独立下拉浮层（Element UI / Plus / Ant Design 等独立 popper）
    if (expandDropdownForElement(el)) {
      return;
    }

    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      // 2. Element Plus / Element UI 子菜单展开
      if (parent.classList?.contains('el-submenu') && !parent.classList.contains('is-opened')) {
        const title = parent.querySelector('.el-submenu__title') as HTMLElement | null;
        if (title) {
          dispatchClick(title);
          return;
        }
      }
      // 3. Ant Design 子菜单展开
      if (parent.classList?.contains('ant-menu-submenu') && !parent.classList.contains('ant-menu-submenu-open')) {
        const title = parent.querySelector('.ant-menu-submenu-title') as HTMLElement | null;
        if (title) {
          dispatchClick(title);
          return;
        }
      }
      // 4. 通用折叠项（如 el-collapse-item）
      if (parent.classList?.contains('el-collapse-item') && !parent.classList.contains('is-active')) {
        const header = parent.querySelector('.el-collapse-item__header') as HTMLElement | null;
        if (header) {
          dispatchClick(header);
          return;
        }
      }
      // 5. 通用 aria-expanded="false"
      if (parent.getAttribute('aria-expanded') === 'false') {
        const toggle = (parent.querySelector('[aria-expanded="false"], button, a') || parent) as HTMLElement;
        dispatchClick(toggle);
        return;
      }
      // 6. 原生 details
      if (parent.tagName === 'DETAILS' && !(parent as HTMLDetailsElement).open) {
        (parent as HTMLDetailsElement).open = true;
        return;
      }
      parent = parent.parentElement;
    }
  } catch {}
}

function isOptionEvent(event: QAEvent): boolean {
  if (event.type !== 'click') return false;
  const p = event.payload as ClickEventPayload;
  return Boolean(
    p?.role === 'option' ||
    p?.tag === 'OPTION' ||
    p?.selector?.includes('select-dropdown') ||
    p?.selector?.includes('el-select-dropdown') ||
    p?.selector?.includes('ant-select-dropdown') ||
    p?.selector?.includes('select-item') ||
    p?.selector?.includes('dropdown-menu')
  );
}

function tryHealAndOpenDropdown(event: QAEvent): boolean {
  try {
    const p = event.payload as ClickEventPayload;
    // 1. 如果有关联的 fieldLabel（如“客户类型”、“部门”），在页面上定位包含该标签的表单项中的下拉框
    if (p?.fieldLabel) {
      const formItems = Array.from(document.querySelectorAll('.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, [class*="form-item"]'));
      for (const item of formItems) {
        const text = (item.textContent || '').trim();
        if (text.includes(p.fieldLabel)) {
          const selectTrigger = item.querySelector(
            '.el-select, .ant-select, [role="combobox"], .el-select__wrapper, .select-trigger, .ant-select-selector, input'
          ) as HTMLElement | null;
          if (selectTrigger && isElementVisible(selectTrigger)) {
            console.warn(`[QA Copilot Replay] 触发前置表单项「${p.fieldLabel}」下拉框自愈展开`);
            dispatchClick(selectTrigger);
            return true;
          }
        }
      }
    }

    // 2. 如果页面上当前没有任何展开的下拉框，寻找页面上第一个可见且未禁用的下拉框触发器展开
    const activeDropdown = document.querySelector(
      '.el-select-dropdown:not([style*="display: none"]), .ant-select-dropdown:not(.ant-select-dropdown-hidden), [class*="select-dropdown"]:not([style*="display: none"])'
    );
    if (!activeDropdown) {
      const candidates = Array.from(document.querySelectorAll('.el-select, .ant-select, [role="combobox"], .arco-select'));
      for (const cand of candidates) {
        if (isElementVisible(cand)) {
          const trigger = (cand.querySelector('.el-select__wrapper, .select-trigger, .ant-select-selector, input') || cand) as HTMLElement;
          console.warn(`[QA Copilot Replay] 页面无展开浮层，触发候选下拉框自愈展开`);
          dispatchClick(trigger);
          return true;
        }
      }
    }
  } catch {}
  return false;
}

function dispatchClick(target: HTMLElement) {
  // 1. 如果点击的是折叠/菜单容器，优先点击其内部的标题交互节点
  let trigger = target.querySelector?.(
    '.el-submenu__title, .ant-menu-submenu-title, .arco-menu-inline-header, [class*="submenu__title"], [class*="submenu-title"], [class*="collapse-item__header"], [class*="collapse-header"]'
  ) as HTMLElement | null;

  // 2. 双向查找下拉框交互触发器（向上或向下）
  const selectContainer = target.closest?.(
    '.el-select, .ant-select, [role="combobox"], .n-select, .arco-select, [class*="select-trigger"]'
  ) as HTMLElement | null;

  if (!trigger && selectContainer) {
    trigger = (selectContainer.querySelector?.(
      '.el-select__wrapper, .select-trigger, .ant-select-selector, .arco-select-view, .el-input__inner, input'
    ) || selectContainer) as HTMLElement | null;
  } else if (!trigger && (target.classList?.contains('el-select') || target.classList?.contains('ant-select') || target.getAttribute?.('role') === 'combobox')) {
    trigger = target.querySelector?.(
      '.el-select__wrapper, .select-trigger, .ant-select-selector, .el-input__inner, input'
    ) as HTMLElement | null;
  }

  const clickNode = trigger || target;
  try {
    const focusable = (clickNode.querySelector?.('input') || clickNode) as HTMLElement;
    focusable.focus?.({ preventScroll: true });
  } catch {}

  // 3. 计算视口相对坐标，派发真实鼠标指针事件序列
  let clientX = 0;
  let clientY = 0;
  try {
    const rect = clickNode.getBoundingClientRect?.();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      clientX = Math.round(rect.left + rect.width / 2);
      clientY = Math.round(rect.top + rect.height / 2);
    }
  } catch {}

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    buttons: 1,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
  };

  const preEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'];
  for (const evName of preEvents) {
    try {
      let ev: Event;
      if (typeof PointerEvent !== 'undefined' && evName.startsWith('pointer')) {
        ev = new PointerEvent(evName, { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      } else {
        ev = new MouseEvent(evName, eventInit);
      }
      clickNode.dispatchEvent(ev);
    } catch {}
  }

  // 4. 关键：仅触发一次真正的 click 操作！优先使用原生 click()
  try {
    clickNode.click();
  } catch {
    try {
      clickNode.dispatchEvent(new MouseEvent('click', eventInit));
    } catch {}
  }
}

async function waitForReplayTarget(event: QAEvent, replayId?: string | null): Promise<Element | Window | null> {
  let lastFoundHiddenTarget: HTMLElement | null = null;
  const isScrollEvent = event.type === 'scroll';
  const isOption = isOptionEvent(event);
  const maxAttempts = isScrollEvent ? 15 : 80;
  let hiddenFoundCount = 0;
  let attemptedHeal = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // QA-005: 停止回放要取消正在等待的步骤
    if (replayId && activeContentReplayId !== replayId) {
      return null;
    }
    const target = event.type === 'click'
      ? findClickTarget(event.payload as ClickEventPayload)
      : event.type === 'input'
        ? findInputTarget(event.payload as InputEventPayload)
        : findScrollTarget(event.payload as ScrollEventPayload);

    if (target) {
      if (target === window) return window;
      const htmlEl = target as HTMLElement;
      if (isElementVisible(htmlEl)) {
        return htmlEl;
      }
      lastFoundHiddenTarget = htmlEl;
      hiddenFoundCount += 1;

      // 如果已在 DOM 中找到该节点但处于隐藏状态，尝试自动展开其父级菜单/折叠层/下拉框
      if (attempt >= 2 && attempt % 3 === 0) {
        autoExpandAncestors(htmlEl);
      }

      // 若节点已在 DOM 中且尝试多次展开依然未展示（如需要穿透点击的下拉选项），在约 1.5 秒后收敛交付 replayAction 处理
      if (hiddenFoundCount >= 15) {
        break;
      }
    } else if (isOption && !attemptedHeal && (attempt === 3 || attempt === 8)) {
      // 关键自愈：如果是在找下拉选项，且当前 DOM 中根本找不到该选项节点，说明下拉框未展开导致选项未挂载
      const healed = tryHealAndOpenDropdown(event);
      if (healed) {
        attemptedHeal = true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (lastFoundHiddenTarget) {
    autoExpandAncestors(lastFoundHiddenTarget);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return lastFoundHiddenTarget;
  }
  return null;
}

async function createCdpInputAction(
  target: HTMLElement,
  kind: CdpInputAction['kind'],
  text?: string
): Promise<CdpInputAction | null> {
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const localX = rect.left + rect.width / 2;
  const localY = rect.top + rect.height / 2;
  const topPoint = await mapPointToTopFrame(localX, localY);
  if (!topPoint) return null;
  return { kind, x: topPoint.x, y: topPoint.y, text };
}

let replayDispatching = false;
let replaySuppressedUntil = 0;

export async function replayAction(
  event: QAEvent,
  replayId?: string | null,
  useCdp = false
): Promise<{ success: boolean; error?: string; stopped?: boolean; cdpInput?: CdpInputAction }> {
  if (!event || (event.type !== 'click' && event.type !== 'input' && event.type !== 'scroll')) {
    return { success: false, error: '不支持的回放步骤' };
  }
  if (event.type === 'input' && (event.payload as InputEventPayload).sensitive) {
    return { success: false, error: '该密码值已脱敏，请在回放时手动填写' };
  }
  if (replayId && activeContentReplayId !== replayId) {
    return { success: false, error: '回放已停止', stopped: true };
  }
  const target = await waitForReplayTarget(event, replayId);
  if (replayId && activeContentReplayId !== replayId) {
    return { success: false, error: '回放已停止', stopped: true };
  }
  if (!target) {
    // 针对滚动事件，如果最终未能找到目标容器（常见于临时下拉弹窗已关闭、浮层已销毁或虚拟滚动等）：
    // 滚动是纯辅助型动作，后续的点击/输入均会自动调用 scrollIntoView 卷入视口，绝不能因辅助滚动未就绪而阻断整体业务回放！
    if (event.type === 'scroll') {
      console.warn(`[QA Copilot Replay] 滚动目标未就绪或已自动关闭，安全跳过该滚动步骤以保证主流程执行: ${event.description}`);
      return { success: true };
    }
    return { success: false, error: `找不到元素：${event.description}` };
  }

  if (event.type === 'scroll') {
    const payload = event.payload as ScrollEventPayload;
    replaySuppressedUntil = Date.now() + 1_500;
    try {
      if (target === window) {
        window.scrollTo({ top: payload.scrollTop, left: payload.scrollLeft, behavior: 'auto' });
      } else {
        (target as Element).scrollTo({ top: payload.scrollTop, left: payload.scrollLeft, behavior: 'auto' });
      }
    } catch (err) {
      console.warn('[QA Copilot Replay] 执行元素滚动失败，已安全放行:', err);
    }
    return { success: true };
  }

  const htmlTarget = target as HTMLElement;

  // QA-004: 检查可见性（若此时依然隐藏，做最后一次祖先/下拉框展开尝试）
  if (htmlTarget.offsetParent === null && htmlTarget.getClientRects().length === 0) {
    autoExpandAncestors(htmlTarget);
    if (htmlTarget.offsetParent === null && htmlTarget.getClientRects().length === 0) {
      // 针对下拉选项（Option）：Element UI / Plus / AntD 等组件在 DOM 存在 option 时直接点击即可完成选中
      const isDropdownOption = Boolean(
        (event.payload as ClickEventPayload)?.role === 'option' ||
        htmlTarget.getAttribute('role') === 'option' ||
        htmlTarget.classList?.contains('el-select-dropdown__item') ||
        htmlTarget.closest?.('.el-select-dropdown, .ant-select-dropdown, [class*="select-dropdown"]')
      );
      if (isDropdownOption) {
        console.warn(`[QA Copilot Replay] 下拉选项处于隐藏折叠中，执行穿透点击以触发组件选中: ${event.description}`);
        try {
          // A genuinely hidden option has no physical hit target, so this
          // virtualized-menu case keeps the existing DOM click fallback.
          dispatchClick(htmlTarget);
          return { success: true };
        } catch {}
      }
      return { success: false, error: `元素当前处于隐藏或不可见状态：${event.description}` };
    }
  }

  htmlTarget.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  const previousOutline = htmlTarget.style.outline;
  htmlTarget.style.outline = '3px solid #22c55e';

  replayDispatching = true;
  replaySuppressedUntil = Date.now() + 1_000;
  try {
    if (event.type === 'click') {
      if ('disabled' in htmlTarget && Boolean((htmlTarget as HTMLButtonElement).disabled)) {
        return { success: false, error: `元素已禁用不可点击：${event.description}` };
      }
      if (useCdp) {
        const cdpInput = await createCdpInputAction(htmlTarget, 'click');
        if (!cdpInput) return { success: false, error: '无法计算 iframe 内元素的顶层点击坐标' };
        return { success: true, cdpInput };
      }
      dispatchClick(htmlTarget);
    } else {
      const input = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const payload = event.payload as InputEventPayload;
      if ('disabled' in input && input.disabled) {
        return { success: false, error: `输入控件处于禁用状态：${event.description}` };
      }
      if ('readOnly' in input && (input as HTMLInputElement).readOnly) {
        return { success: false, error: `输入控件处于只读状态：${event.description}` };
      }
      input.focus({ preventScroll: true });
      if (input instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) {
        const shouldBeChecked = payload.checked !== undefined ? payload.checked : payload.value !== '未选中';
        if (input.checked !== shouldBeChecked) {
          if (useCdp) {
            const cdpInput = await createCdpInputAction(input, 'click');
            if (!cdpInput) return { success: false, error: '无法计算 iframe 内控件的顶层点击坐标' };
            return { success: true, cdpInput };
          }
          input.click();
        }
        if (input.checked !== shouldBeChecked) {
          input.checked = shouldBeChecked;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (input.checked !== shouldBeChecked) {
          return { success: false, error: `单选/复选框状态未成功更新: 期望 ${shouldBeChecked}` };
        }
      } else {
        const nativeTextInput = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement;
        const type = input instanceof HTMLInputElement ? input.type : '';
        if (useCdp && nativeTextInput && !['date', 'datetime-local', 'month', 'time', 'week'].includes(type)) {
          const cdpInput = await createCdpInputAction(input, 'type', payload.value);
          if (!cdpInput) return { success: false, error: '无法计算 iframe 内输入框的顶层点击坐标' };
          return { success: true, cdpInput };
        }
        setNativeValue(input, payload.value);
        // QA-004: 检查实际输入结果回读（非密码框）
        if (input.value !== payload.value && (input as HTMLInputElement).type !== 'password') {
          return { success: false, error: `输入值回读不一致：期望 "${payload.value}"，实际 "${input.value}"` };
        }
      }
    }
    return { success: true };
  } finally {
    replayDispatching = false;
    window.setTimeout(() => { htmlTarget.style.outline = previousOutline; }, 350);
  }
}

interface PendingScrollRecord {
  timer: ReturnType<typeof setTimeout>;
  event: Omit<QAEvent, 'id' | 'sessionId'>;
}

const pendingScrollRecords = new Map<EventTarget, PendingScrollRecord>();

function submitScrollRecord(target: EventTarget, event: Omit<QAEvent, 'id' | 'sessionId'>) {
  pendingScrollRecords.delete(target);
  sendFlushableRecord({ type: 'RECORD_EVENT', payload: { event } });
}

function flushPendingScrollRecords() {
  for (const [target, record] of pendingScrollRecords) {
    clearTimeout(record.timer);
    submitScrollRecord(target, record.event);
  }
}

document.addEventListener('scroll', (event) => {
  if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
  const rawTarget = event.target;
  if (!rawTarget) return;
  const isWindowScroll = rawTarget === document || rawTarget === document.documentElement || rawTarget === document.body;
  const element = isWindowScroll ? document.scrollingElement : rawTarget instanceof Element ? rawTarget : null;
  if (!element) return;
  const timestamp = Date.now();
  const scrollTop = isWindowScroll ? window.scrollY : element.scrollTop;
  const scrollLeft = isWindowScroll ? window.scrollX : element.scrollLeft;
  const selector = isWindowScroll ? undefined : getCssSelector(element);
  const pending = pendingScrollRecords.get(rawTarget);
  if (pending) clearTimeout(pending.timer);
  let readableTarget = '页面';
  if (!isWindowScroll) {
    const el = element as HTMLElement;
    if (el.closest?.('.el-select-dropdown, .ant-select-dropdown, [class*="select-dropdown"]')) {
      readableTarget = '下拉选项列表';
    } else if (el.closest?.('table, .el-table, .ant-table, [class*="table"]')) {
      readableTarget = '表格列表';
    } else if (el.getAttribute?.('aria-label')) {
      readableTarget = `「${el.getAttribute('aria-label')}」`;
    } else {
      const nearbyLabel = getElementLabel(el);
      readableTarget = nearbyLabel ? `「${nearbyLabel}」列表` : '列表';
    }
  }

  const recordedEvent: Omit<QAEvent, 'id' | 'sessionId'> = {
    type: 'scroll',
    timestamp,
    title: isWindowScroll ? '滚动页面' : '滚动列表',
    description: `${readableTarget} 滚动到 ${Math.round(scrollTop)}`,
    url: window.location.href,
    payload: {
      timestamp,
      url: window.location.href,
      target: isWindowScroll ? 'window' : 'element',
      selector,
      scrollTop,
      scrollLeft,
    } satisfies ScrollEventPayload,
  };
  const timer = setTimeout(() => submitScrollRecord(rawTarget, recordedEvent), 160);
  pendingScrollRecords.set(rawTarget, { timer, event: recordedEvent });
}, true);

document.addEventListener('mousemove', (event) => {
  if (!inspectionMode || !inspectionOverlay) return;
  const target = event.target;
  if (!(target instanceof Element) || target === inspectionOverlay) return;
  const rect = target.getBoundingClientRect();
  Object.assign(inspectionOverlay.style, {
    display: 'block',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}, true);

document.addEventListener('keydown', (event) => {
  if (inspectionMode && event.key === 'Escape') {
    stopInspection();
    sendToBackground({ type: 'STOP_ELEMENT_INSPECTION', payload: undefined }).catch(() => {});
  }
}, true);

// 3. 监听点击事件 (TASK-103)
document.addEventListener(
  'click',
  (event) => {
    try {
      if (!replayDispatching && !replayCdpPending && Date.now() >= replaySuppressedUntil) flushPendingScrollRecords();
      const rawTarget = event.target as Node;
      const element = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
      const target = element?.closest('button, a, input, select, textarea, option, li, [role], [data-testid]') || element;
      if (!target || !(target instanceof Element)) return;

      if (inspectionMode || event.altKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopInspection();
        inspectElement(target).catch(() => {});
        return;
      }

      if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;

      // Clicking a label dispatches a second browser click on its associated
      // control. Keep the human action and discard only that paired click.
      const now = Date.now();
      if (lastLabelForwardClick) {
        const paired = now - lastLabelForwardClick.at <= 150 &&
          (target === lastLabelForwardClick.control || lastLabelForwardClick.control.contains(target));
        lastLabelForwardClick = null;
        if (paired) return;
      }

      flushPendingInputRecords();

      if (typeof target.closest === 'function' && target.closest('[data-qa-copilot-root]')) {
        return;
      }

      const label = element?.closest('label');
      const associatedControl = label instanceof HTMLLabelElement ? label.control : null;
      const nestedAction = element?.closest('a, button, [role="button"]');
      if (associatedControl && element && !nestedAction && associatedControl !== element && !associatedControl.contains(element)) {
        lastLabelForwardClick = { control: associatedControl, at: now };
      }

      const { title, description: customDesc, fieldLabel, text, isInput, effectiveTarget } = describeClickElement(target);
      const tag = (effectiveTarget.tagName || '').toUpperCase();
      const selector = getCssSelector(effectiveTarget);
      const description = customDesc || (text ? `点击「${text}」` : `点击 ${selector}`);

      sendToBackground({
        type: 'RECORD_EVENT',
        payload: {
          event: {
            type: 'click',
            timestamp: Date.now(),
            title: title || (text ? `点击 ${text}` : `点击 ${tag}`),
            description,
            url: window.location.href,
            payload: {
              timestamp: Date.now(),
              url: window.location.href,
              tag,
              text,
              id: effectiveTarget.id || undefined,
              name: effectiveTarget.getAttribute?.('name') || undefined,
              role: effectiveTarget.getAttribute?.('role') || undefined,
              testId: effectiveTarget.getAttribute?.('data-testid') || undefined,
              ariaLabel: effectiveTarget.getAttribute?.('aria-label') || undefined,
              title: effectiveTarget.getAttribute?.('title') || undefined,
              fieldLabel,
              placeholder: effectiveTarget.getAttribute?.('placeholder') || undefined,
              isInput,
              selector,
              xpath: getXPath(effectiveTarget),
              x: event.clientX,
              y: event.clientY,
            },
          },
        },
      }).catch(() => {});
    } catch {}
  },
  true
);

// 4. 监听输入事件（Debounced，TASK-104）
const inputTimers = new Map<Element, ReturnType<typeof setTimeout>>();
const composingInputs = new WeakSet<Element>();

function flushPendingInputRecord(target: Element) {
  const timer = inputTimers.get(target);
  if (!timer) return;
  clearTimeout(timer);
  inputTimers.delete(target);
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) recordFormValue(target);
}

function flushPendingInputRecords() {
  for (const target of inputTimers.keys()) flushPendingInputRecord(target);
}

function queueInputRecord(target: HTMLInputElement | HTMLTextAreaElement) {
  const previous = inputTimers.get(target);
  if (previous) clearTimeout(previous);
  inputTimers.set(target, setTimeout(() => {
    inputTimers.delete(target);
    recordFormValue(target);
  }, 400));
}

function recordFormValue(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  try {
    const fieldLabel = getElementLabel(target);
    const fieldName = fieldLabel || target.getAttribute('placeholder') || target.name || target.id || '输入框';
    const sensitive = target instanceof HTMLInputElement && target.type === 'password';
    let rawValue = sensitive ? '*****' : target.value || '';
    let isChecked: boolean | undefined = undefined;
    let optionValue: string | undefined = undefined;

    if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
      isChecked = target.checked;
      optionValue = target.value || undefined;
      rawValue = target.checked ? target.value || '已选中' : '未选中';
    }
    const capturedValue = rawValue.length > 200 ? `${rawValue.slice(0, 200)}...[截断]` : rawValue;

    sendFlushableRecord({
      type: 'RECORD_EVENT',
      payload: {
        event: {
          type: 'input',
          timestamp: Date.now(),
          title: `输入「${fieldName}」`,
          description: `输入「${fieldName}」 = ${capturedValue}`,
          url: window.location.href,
          payload: {
            timestamp: Date.now(),
            url: window.location.href,
            tag: target.tagName.toUpperCase(),
            id: target.id || undefined,
            name: target.name || undefined,
            selector: getCssSelector(target),
            fieldLabel: fieldLabel || undefined,
            fieldName,
            placeholder: target.getAttribute('placeholder') || undefined,
            inputType: target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase(),
            value: rawValue,
            checked: isChecked,
            optionValue,
            sensitive,
          },
        },
      },
    });
  } catch {}
}

document.addEventListener(
  'input',
  (event) => {
    try {
      if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (composingInputs.has(target) || (event as InputEvent).isComposing) return;
      queueInputRecord(target);
    } catch {}
  },
  true
);

document.addEventListener('compositionstart', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  composingInputs.add(target);
  const timer = inputTimers.get(target);
  if (timer) clearTimeout(timer);
  inputTimers.delete(target);
}, true);

document.addEventListener('compositionend', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  composingInputs.delete(target);
  if (!replayDispatching && !replayCdpPending && Date.now() >= replaySuppressedUntil) queueInputRecord(target);
}, true);

// Select、Checkbox、Radio 以 change 后的最终值为准。
document.addEventListener('change', (event) => {
  if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
  const target = event.target;
  if (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio'))
  ) {
    recordFormValue(target);
  }
}, true);

// 页面跳转或快速切换焦点前，立即提交尚在 debounce 中的最终值。
document.addEventListener('blur', (event) => {
  if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  flushPendingInputRecord(target);
}, true);

// 5. SPA 路由与导航拦截 (TASK-102)
let lastUrl = window.location.href;

function notifyNavigation(toUrl: string, type: 'pushState' | 'replaceState' | 'popstate' | 'hashchange') {
  try {
    if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
    if (toUrl === lastUrl) return;
    flushPendingInputRecords();
    flushPendingScrollRecords();
    const fromUrl = lastUrl;
    lastUrl = toUrl;

    let path = toUrl;
    try {
      path = new URL(toUrl).pathname;
    } catch {}

    sendToBackground({
      type: 'RECORD_EVENT',
      payload: {
        event: {
          type: 'navigation',
          timestamp: Date.now(),
          title: '页面跳转',
          description: `跳转至 ${path}`,
          url: toUrl,
          payload: {
            timestamp: Date.now(),
            url: toUrl,
            fromUrl,
            toUrl,
            pageTitle: document.title || '',
            navigationType: type,
          },
        },
      },
    }).catch(() => {});
  } catch {}
}

window.addEventListener('popstate', () => notifyNavigation(window.location.href, 'popstate'));
window.addEventListener('hashchange', () => notifyNavigation(window.location.href, 'hashchange'));
window.addEventListener('pagehide', () => {
  if (replayDispatching || replayCdpPending || Date.now() < replaySuppressedUntil) return;
  flushPendingInputRecords();
  flushPendingScrollRecords();
});

(['pushState', 'replaceState'] as const).forEach((method) => {
  const original = history[method];
  history[method] = function (...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    notifyNavigation(window.location.href, method);
    return result;
  };
});

// 6. 监听全局 JS 错误与 Promise 未处理异常 (TASK-205)
window.addEventListener('error', (event) => {
  try {
    sendToBackground({
      type: 'RECORD_EVENT',
      payload: {
        event: {
          type: 'error',
          timestamp: Date.now(),
          title: 'JS 运行时异常',
          description: event.message || '未知错误',
          url: window.location.href,
          payload: {
            timestamp: Date.now(),
            url: window.location.href,
            message: event.message || '',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack,
          },
        },
      },
    }).catch(() => {});
  } catch {}
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    sendToBackground({
      type: 'RECORD_EVENT',
      payload: {
        event: {
          type: 'error',
          timestamp: Date.now(),
          title: 'Promise 未处理异常',
          description: String(event.reason?.message || event.reason || 'Unhandled Promise Rejection'),
          url: window.location.href,
          payload: {
            timestamp: Date.now(),
            url: window.location.href,
            message: String(event.reason?.message || event.reason || ''),
            stack: event.reason?.stack,
          },
        },
      },
    }).catch(() => {});
  } catch {}
});
