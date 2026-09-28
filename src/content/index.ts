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
    FormScanner.scanWithProbe(document)
      .then((snapshot) => {
        snapshot.frameId = 0;
        sendResponse({ snapshot });
      })
      .catch((error) => {
        sendResponse({ error: `表单扫描失败: ${(error as Error).message}` });
      });
    return true;
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

/**
 * 识别当前页面中所有处于活动/展示状态的弹窗、抽屉与浮层容器
 */
function getActiveModalContainers(): HTMLElement[] {
  const modalSelectors = [
    'dialog[open]',
    '.el-overlay:not([style*="display: none"]):not([style*="display:none"]) .el-dialog',
    '.el-dialog:not([style*="display: none"]):not([style*="display:none"])',
    '.el-drawer:not([style*="display: none"]):not([style*="display:none"])',
    '.el-message-box:not([style*="display: none"]):not([style*="display:none"])',
    '.ant-modal:not([style*="display: none"]):not([style*="display:none"])',
    '.ant-modal-content',
    '.ant-drawer:not(.ant-drawer-hidden)',
    '.arco-modal',
    '.arco-drawer',
    '.t-dialog',
    '.t-drawer',
    '.n-modal',
    '.n-drawer',
    '.modal.show',
    '.modal.in',
    '[class*="modal"][class*="open"]',
    '[class*="dialog"][class*="open"]',
    '[class*="drawer"][class*="open"]',
    '[role="dialog"]:not([role="tooltip"]):not(.el-popper):not([class*="popper"]):not([class*="tooltip"])',
    '[role="alertdialog"]',
  ];

  const containers: HTMLElement[] = [];
  try {
    const rawElements = Array.from(document.querySelectorAll(modalSelectors.join(',')));
    for (const el of rawElements) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isElementVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 50 || rect.height <= 50) continue;
      if (!containers.some((c) => c.contains(el))) {
        containers.push(el);
      }
    }
  } catch {}
  return containers;
}

function getActiveDropdownPoppers(): HTMLElement[] {
  const popperSelectors = [
    // Element Plus / Element UI
    '.el-select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
    '.el-cascader__dropdown:not([style*="display: none"]):not([style*="display:none"])',
    '.el-tree-select__popper:not([style*="display: none"]):not([style*="display:none"])',
    '.el-select__popper:not([style*="display: none"]):not([style*="display:none"])',
    '.el-popper:not(.el-tooltip__popper):not([role="tooltip"]):not([style*="display: none"]):not([style*="display:none"])',
    'div[x-placement]:not([style*="display: none"]):not(.el-tooltip__popper)',
    'div[data-popper-placement]:not([style*="display: none"]):not(.el-tooltip__popper)',
    // @riophae/vue-treeselect (若依等管理后台常见组件)
    '.vue-treeselect__menu-container:not([style*="display: none"])',
    '.vue-treeselect__portal-container',
    '.vue-treeselect__menu:not([style*="display: none"])',
    '[class*="treeselect"][class*="menu"]:not([style*="display: none"])',
    '[class*="tree-select"][class*="popper"]:not([style*="display: none"])',
    '[class*="tree-select"][class*="dropdown"]:not([style*="display: none"])',
    // Ant Design
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '.ant-select-tree-dropdown:not(.ant-select-tree-dropdown-hidden):not(.ant-select-dropdown-hidden)',
    '.ant-tree-select-dropdown:not(.ant-select-dropdown-hidden)',
    '.ant-cascader-menus:not(.ant-cascader-menus-hidden)',
    // Arco Design
    '.arco-select-dropdown:not([style*="display: none"]):not([style*="display:none"])',
    '.arco-tree-select-popup:not([style*="display: none"])',
    '.arco-trigger-popup:not([style*="display: none"])',
    // Naive UI / TDesign / Semi
    '.n-select-menu:not([style*="display: none"])',
    '.t-select__dropdown:not([style*="display: none"])',
    '.semi-select-option-list:not([style*="display: none"])',
    // ARIA Listbox
    '[role="listbox"]:not([style*="display: none"]):not([style*="display:none"])',
  ];
  const poppers: HTMLElement[] = [];
  try {
    const raw = Array.from(document.querySelectorAll(popperSelectors.join(',')));
    for (const el of raw) {
      if (!el || !isElementVisible(el as Element)) continue;
      if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') continue;
      const rect = (el as any).getBoundingClientRect?.() ||
        (typeof (el as any).getClientRects === 'function' && (el as any).getClientRects()[0]) ||
        { width: 100, height: 100 };
      if (rect.width <= 20 || rect.height <= 20) continue;
      if (!poppers.some((p) => p.contains?.(el))) poppers.push(el as HTMLElement);
    }
  } catch {}
  return poppers;
}

/**
 * 识别当前页面中所有处于活动/展开展示状态的日期与日历选择器浮层容器
 */
function getActiveDatePickerPoppers(): HTMLElement[] {
  const popperSelectors = [
    // Element Plus / Element UI
    '.el-picker__popper:not([style*="display: none"]):not([style*="display:none"])',
    '.el-picker-panel:not([style*="display: none"]):not([style*="display:none"])',
    '.el-date-picker:not([style*="display: none"]):not([style*="display:none"])',
    '.el-date-range-picker:not([style*="display: none"]):not([style*="display:none"])',
    // Ant Design
    '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
    '.ant-picker-panel-container',
    '.ant-picker-panel',
    // Arco Design
    '.arco-picker-popup:not([style*="display: none"]):not([style*="display:none"])',
    '.arco-picker-panel',
    // Naive UI
    '.n-date-panel:not([style*="display: none"]):not([style*="display:none"])',
    // TDesign
    '.t-date-picker__panel:not([style*="display: none"]):not([style*="display:none"])',
    // 通用与常见类名
    '[class*="date-picker-dropdown"]:not([style*="display: none"])',
    '[class*="picker-panel"]:not([style*="display: none"])',
    '[class*="date-table"]:not([style*="display: none"])',
  ];
  const poppers: HTMLElement[] = [];
  try {
    const raw = Array.from(document.querySelectorAll(popperSelectors.join(',')));
    for (const el of raw) {
      if (!el || !isElementVisible(el as Element)) continue;
      const rect = (el as any).getBoundingClientRect?.() || { width: 100, height: 100 };
      if (rect.width <= 30 || rect.height <= 30) continue;
      if (!poppers.some((p) => p.contains(el))) poppers.push(el as HTMLElement);
    }
  } catch {}
  return poppers;
}

/**
 * Agent 页面观察节点强引用缓存（借鉴 Midscene nodeCacheMap 机制）
 * 杜绝规划 ID 与实际 DOM 节点失联导致回退到模糊选择器命中第一个 input 的致命问题
 */
const observationElementCache = new Map<string, HTMLElement>();

export function collectAiObservation() {
  const selector = [
    'button', 'a[href]', 'input:not([type="hidden"])',
    'textarea', 'select', '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="option"]',
    '[role="treeitem"]', '[role="menuitem"]',
    // 现代 UI 库下拉框组件触发器容器 (Element Plus, Ant Design, Arco, Naive, vue-treeselect 等)
    '.el-select', '.el-select__wrapper', '.el-cascader', '.el-tree-select',
    '.ant-select', '.ant-select-selector', '.arco-select', '.n-select',
    '.vue-treeselect', '.vue-treeselect__control',
    '[class*="select-trigger"]', '[class*="select__wrapper"]',
    // 现代 UI 库下拉选项、树节点、级联节点与菜单项
    '.el-select-dropdown__item', '.ant-select-item-option', '.arco-select-option',
    '.n-select-option', '.t-select-option',
    '.vue-treeselect__option', '.vue-treeselect__label',
    '.ant-select-tree-node-content-wrapper', '.ant-select-tree-title',
    '.el-tree-node__content', '.el-tree-node', '.el-cascader-node',
    '.el-select-dropdown li', '[class*="select-dropdown"] li',
  ].join(',');

  const activeModals = getActiveModalContainers();
  const hasActiveModal = activeModals.length > 0;
  const activePoppers = getActiveDropdownPoppers();
  const hasActivePopper = activePoppers.length > 0;

  const allRaw = Array.from(document.querySelectorAll(selector));

  // 区域感知辅助判断
  const isHeaderEl = (el: HTMLElement | Element) => Boolean(
    el.closest?.('header, .navbar, .top-bar, .topbar, .right-menu, .header-tools, .header-right, #screenfull, #size-select, .global-header, .ant-layout-header, .el-header')
  );
  const isSidebarEl = (el: HTMLElement | Element) => Boolean(
    el.closest?.('aside, nav, .sidebar, .sidebar-container, .left-aside, .ant-layout-sider, .el-aside')
  );
  const isTreeSideEl = (el: HTMLElement | Element) => Boolean(
    el.closest?.('.org-tree, .dept-tree, .left-tree, .tree-container, .aside-tree')
  );
  const isMainActionOrContent = (el: HTMLElement | Element) => Boolean(
    el.closest?.('main, [role="main"], .app-main, .main-content, #app-main, .content-container, .page-container, .ant-layout-content, .el-main, .table-toolbar, .action-bar, .handle-box, .crud-opts, .toolbar')
  );

  // 关键分层优先原则：
  // 1. 若有活动弹窗/下拉浮层：浮层/弹窗 > 主内容区 > 其它背景
  // 2. 无活动弹窗时：主业务内容区与操作工具栏（新增/修改/查询等）最优先，避免被顶部工具栏与几十个侧栏/树节点挤出视线
  let orderedCandidates: HTMLElement[];
  if (hasActiveModal || hasActivePopper) {
    const popperCandidates: HTMLElement[] = [];
    const modalCandidates: HTMLElement[] = [];
    const mainCandidates: HTMLElement[] = [];
    const backgroundCandidates: HTMLElement[] = [];
    for (const el of allRaw) {
      if (!el) continue;
      const inPopper = hasActivePopper && activePoppers.some((p) => p.contains?.(el));
      const inModal = hasActiveModal && activeModals.some((m) => m.contains?.(el));
      if (inPopper) {
        popperCandidates.push(el as HTMLElement);
      } else if (inModal) {
        modalCandidates.push(el as HTMLElement);
      } else if (isMainActionOrContent(el)) {
        mainCandidates.push(el as HTMLElement);
      } else {
        backgroundCandidates.push(el as HTMLElement);
      }
    }
    orderedCandidates = [...popperCandidates, ...modalCandidates, ...mainCandidates, ...backgroundCandidates];
  } else {
    const mainCandidates: HTMLElement[] = [];
    const treeCandidates: HTMLElement[] = [];
    const sidebarCandidates: HTMLElement[] = [];
    const headerCandidates: HTMLElement[] = [];
    const otherCandidates: HTMLElement[] = [];

    for (const el of allRaw) {
      if (!el) continue;
      if (isHeaderEl(el)) {
        headerCandidates.push(el as HTMLElement);
      } else if (isSidebarEl(el)) {
        sidebarCandidates.push(el as HTMLElement);
      } else if (isTreeSideEl(el)) {
        treeCandidates.push(el as HTMLElement);
      } else if (isMainActionOrContent(el)) {
        mainCandidates.push(el as HTMLElement);
      } else {
        otherCandidates.push(el as HTMLElement);
      }
    }
    // 左侧筛选树采样前 15 个，防止几十个部门节点挤占核心业务按钮
    orderedCandidates = [
      ...mainCandidates,
      ...otherCandidates,
      ...treeCandidates.slice(0, 15),
      ...sidebarCandidates,
      ...headerCandidates,
    ];
  }

  observationElementCache.clear();

  const elements: Array<{
    id: string;
    tag: string;
    role?: string;
    name?: string;
    text?: string;
    placeholder?: string;
    value?: string;
    testId?: string;
    ariaLabel?: string;
    selector: string;
    inputType?: string;
    options?: Array<{ label: string; value: string }>;
    disabled?: boolean;
    inModal?: boolean;
  }> = [];

  for (const [index, element] of orderedCandidates.entries()) {
    if (!isElementVisible(element)) continue;
    if (element.matches(':disabled, [aria-disabled="true"]')) continue;
    const tag = element.tagName.toLowerCase();

    // 只读输入框：若属于下拉框触发器（如 el-select、el-tree-select、el-cascader），绝不能跳过！
    const isDropdownTrigger = Boolean(
      element.closest('.el-select, .ant-select, .arco-select, .n-select, .el-cascader, .el-tree-select, .vue-treeselect, [class*="select-trigger"], [class*="select__wrapper"]') ||
      element.getAttribute('role') === 'combobox' ||
      element.classList?.contains('el-select__wrapper') ||
      element.classList?.contains('ant-select-selector')
    );

    if (tag === 'input') {
      const inputEl = element as HTMLInputElement;
      if (inputEl.type === 'hidden' || inputEl.type === 'file') continue;
      // 真实纯展示不可点只读输入框跳过，下拉框触发器必须保留供点击展开
      if (inputEl.readOnly && !isDropdownTrigger) continue;
    }
    if (tag === 'textarea' && (element as HTMLTextAreaElement).readOnly) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const inPopper = hasActivePopper && activePoppers.some((p) => p.contains(element));
    const inModal = activeModals.some((m) => m.contains(element));

    // 严谨判断是否为真正的下拉/树选择项：
    // 1. 处于活动下拉浮层内，或明确属于已知下拉/树选择/级联选择组件的选项类名/结构
    // 2. 绝对严禁将页面普通侧边栏、组织机构树（aside, nav, .sidebar 等）的普通 treeitem 误判为下拉选项！
    const isInSidebar = Boolean(
      element.closest('aside, nav, .sidebar, .sidebar-container, .left-aside, .org-tree, [class*="sidebar"]')
    );

    const isDropdownOption = !isInSidebar && (
      inPopper ||
      Boolean(
        element.closest('.el-select-dropdown, .ant-select-dropdown, .arco-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, .vue-treeselect__portal-container, .el-tree-select__popper, .el-cascader__dropdown, [class*="select-dropdown"], [class*="treeselect__menu"]') ||
        element.classList?.contains('el-select-dropdown__item') ||
        element.classList?.contains('ant-select-item-option') ||
        element.classList?.contains('arco-select-option') ||
        element.classList?.contains('vue-treeselect__option') ||
        element.classList?.contains('vue-treeselect__label') ||
        element.classList?.contains('el-cascader-node') ||
        (element.getAttribute('role') === 'option' && !element.closest('aside, .sidebar'))
      )
    );

    // 如果是包含子级选项项的大容器，避免重复提取上层大容器，只保留具体选项/叶子节点
    if (isDropdownOption && element.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"], [role="treeitem"]')) {
      continue;
    }

    const obsId = `el-${index + 1}`;
    observationElementCache.set(obsId, element);
    try {
      element.setAttribute('data-qa-obs-id', obsId);
    } catch {}

    const isClickableAction = tag === 'button' || tag === 'a' ||
      element.getAttribute('role') === 'button' || element.getAttribute('role') === 'link' || element.getAttribute('role') === 'tab';

    const rawText = (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const ariaLabel = element.getAttribute('aria-label') || undefined;
    const title = element.getAttribute('title') || undefined;
    const inHeader = isHeaderEl(element);

    const placeholder = element.getAttribute('placeholder') ||
      element.querySelector('input')?.getAttribute('placeholder') ||
      element.querySelector('.el-select__placeholder, .ant-select-selection-placeholder, [class*="placeholder"]')?.textContent?.trim() ||
      undefined;

    let name: string | undefined;
    if (isClickableAction && rawText) {
      // 核心修复：操作类按钮/链接，自身可见文字（如“+ 新增”、“查询”、“删除”）是最高优先级的名称！
      name = rawText;
    } else {
      const intelligentLabel = getElementLabel(element);
      const labels = 'labels' in element
        ? Array.from((element as HTMLInputElement).labels || []).map((label) => label.innerText.trim()).filter(Boolean).join(' ')
        : '';
      name = intelligentLabel || ariaLabel || labels || placeholder || element.getAttribute('name') || title || undefined;
    }

    if (inHeader) {
      const headerTitle = title || ariaLabel || rawText || '系统辅助设置';
      name = `[顶部工具栏] ${headerTitle}`;
    } else if (isClickableAction && !name && !rawText) {
      name = '[图标按钮]';
    }

    let val: string | undefined;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const isPassword = tag === 'input' && (element as HTMLInputElement).type === 'password';
      if (!isPassword) {
        val = (element as HTMLInputElement).value?.trim() || undefined;
      } else {
        val = (element as HTMLInputElement).value ? '******' : undefined;
      }
    }
    // 读取现代组件库已选中的回显文字 (如 "科技" 或 "男")
    if (isDropdownTrigger && !val) {
      const selectedItemEl = element.querySelector(
        '.el-select__selected-item, .ant-select-selection-item, .arco-select-view-value, [class*="selected-item"]'
      );
      if (selectedItemEl) {
        const selText = selectedItemEl.textContent?.trim();
        if (selText && !selText.startsWith('请选择')) {
          val = selText;
        }
      }
    }

    let text: string | undefined;
    let inferredRole = element.getAttribute('role') || undefined;

    if (isDropdownOption) {
      inferredRole = 'option';
      name = `[当前下拉选项] ${rawText || name || '选项'}`;
      text = `[当前下拉选项] ${rawText || name || '选项'}`;
    } else if (isDropdownTrigger) {
      inferredRole = 'combobox';
      if (name && !name.includes('下拉框') && !name.includes('选择')) {
        name = `[下拉框] ${name}`;
      }
      text = rawText ? (inModal ? `[弹窗内] ${rawText}` : rawText) : undefined;
    } else {
      text = rawText ? (inModal ? `[弹窗内] ${rawText}` : rawText) : undefined;
      if (!inferredRole) {
        inferredRole = tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' :
          tag === 'textarea' ? 'textbox' : tag === 'input' ? (
            ['checkbox', 'radio', 'button', 'submit'].includes((element as HTMLInputElement).type)
              ? (element as HTMLInputElement).type
              : 'textbox'
          ) : undefined;
      }
    }

    if (inModal && name && !name.startsWith('[弹窗内]') && !name.startsWith('[当前下拉选项]')) {
      name = `[弹窗内] ${name}`;
    } else if (!inModal && !inPopper && (hasActiveModal || hasActivePopper) && name) {
      // 当页面存在弹窗或浮层时，背景元素明确标出 [背景页面]，提示 AI 此时不要误点
      if (!name.startsWith('[背景页面]')) {
        name = `[背景页面] ${name}`;
      }
      if (text && !text.startsWith('[背景页面]')) {
        text = `[背景页面] ${text}`;
      }
    }

    elements.push({
      id: obsId,
      tag,
      role: inferredRole,
      name: name?.slice(0, 120),
      text,
      placeholder: placeholder?.slice(0, 120),
      value: val?.slice(0, 100),
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
      inModal,
    });
    // 提升上限至 150，确保弹窗与展开的下拉选项绝不丢失
    if (elements.length >= 150) break;
  }

  // 浮层与弹窗文本摘要提取置顶
  let popperTextSection = '';
  if (hasActivePopper) {
    const popperSummaries = activePoppers.map((popper, idx) => {
      const text = (popper.innerText || popper.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 600);
      return `【当前展开的下拉/树选择浮层选项 ${idx + 1}】\n${text}`;
    }).join('\n\n');
    popperTextSection = `${popperSummaries}\n`;
  }

  let modalTextSection = '';
  if (hasActiveModal) {
    const modalSummaries = activeModals.map((modal, idx) => {
      const titleEl = modal.querySelector(
        '.el-dialog__title, .ant-modal-title, .modal-title, [class*="title"], [class*="header"], h1, h2, h3, h4'
      );
      const title = titleEl?.textContent?.trim() || `活动弹窗/抽屉 ${idx + 1}`;
      const text = (modal.innerText || modal.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 1_200);
      return `【当前活动弹窗: ${title}】\n${text}`;
    }).join('\n\n');
    modalTextSection = `${modalSummaries}\n--- 背景页面内容 ---\n`;
  }

  const statusText = Array.from(document.querySelectorAll('h1,h2,h3,[role="alert"],[aria-live="polite"],[aria-live="assertive"]'))
    .filter((element) => isElementVisible(element))
    .map((element) => (element as HTMLElement).innerText || element.textContent || '')
    .join('\n');
  const bodyText = (document.body?.innerText || '').slice(0, 1_500);
  return {
    url: window.location.href,
    title: document.title.slice(0, 160),
    text: `${popperTextSection}${modalTextSection}${statusText}\n${bodyText}`.trim().slice(0, 4_000),
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
      const isTopLevelOverlay = current.parentElement === document.body;
      if (siblings.length > 1 && !isTopLevelOverlay) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
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
    if (visibleMatches.length > 1) {
      // 若存在活动浮层（下拉/日期）或活动弹窗，优先返回最顶层活动容器内部的匹配项
      const activeContainers = [
        ...getActiveDropdownPoppers(),
        ...getActiveDatePickerPoppers(),
        ...getActiveModalContainers(),
      ];
      for (const container of activeContainers) {
        const inContainer = visibleMatches.filter((el) => container.contains(el));
        if (inContainer.length === 1) return inContainer[0];
        if (inContainer.length > 1) {
          const leaf = inContainer.find((el) => !inContainer.some((other) => other !== el && el.contains(other)));
          if (leaf) return leaf;
          return inContainer[0];
        }
      }
    }
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

/**
 * 针对日期选择器（Date Picker / Date Range Picker）组件及其日历浮层的专门定位器
 * 准确处理日期数字（1~31）的多月同号、上月末/下月初干扰、日期范围左右面板、快捷按钮等
 */
function findDatePickerTarget(payload: ClickEventPayload): Element | null {
  const activePoppers = getActiveDatePickerPoppers();
  if (activePoppers.length === 0) return null;

  const expected = (payload.text || '').trim().replace(/\s+/g, ' ');
  const isDayNumber = /^(?:[1-9]|[12]\d|3[01])$/.test(expected);

  for (const popper of activePoppers) {
    // 1. 如果查找的是日历中的日期数字 (1 ~ 31)
    if (isDayNumber) {
      const preferRight = (payload.selector || '').includes('is-right') ||
        (payload.xpath || '').includes('content[2]') ||
        (payload.xpath || '').includes('is-right');
      const preferLeft = (payload.selector || '').includes('is-left') ||
        (payload.xpath || '').includes('content[1]') ||
        (payload.xpath || '').includes('is-left');

      // 提取日历面板中的分月份容器（如范围选择器有左右两边）
      const panels = Array.from(popper.querySelectorAll(
        '.el-date-range-picker__content, .el-picker-panel__content, .ant-picker-panel, .arco-picker-panel, table'
      ));

      let searchContainers: Element[] = [];
      if (panels.length > 1) {
        if (preferRight) {
          searchContainers = [panels[panels.length - 1], ...panels];
        } else if (preferLeft) {
          searchContainers = [panels[0], ...panels];
        } else {
          searchContainers = panels;
        }
      } else if (panels.length === 1) {
        searchContainers = panels;
      } else {
        searchContainers = [popper];
      }

      for (const container of searchContainers) {
        // 查找所有候选单元格
        const cells = Array.from(container.querySelectorAll(
          'td, [role="gridcell"], .ant-picker-cell, .arco-picker-cell, .n-date-panel-date, .el-date-table-cell'
        ));

        // 优先筛选非禁用、属于当月（非 prev-month / next-month / out-view）的单元格
        const validCells = cells.filter((cell) => {
          const classList = cell.className || '';
          if (typeof classList === 'string') {
            if (/\b(?:disabled|is-disabled|ant-picker-cell-disabled)\b/.test(classList)) return false;
            if (/\b(?:prev-month|next-month|ant-picker-cell-out-view)\b/.test(classList)) return false;
          }
          return true;
        });

        // 在当月有效单元格中精确查找文本等于 expected 的单元格
        const matchedValid = validCells.find((cell) => {
          const t = ((cell as HTMLElement).innerText || cell.textContent || '').trim().replace(/\s+/g, ' ');
          return t === expected;
        });

        if (matchedValid) {
          const innerClickable = matchedValid.querySelector('span, div') || matchedValid;
          return innerClickable;
        }

        // 次选：如果当月没有匹配，在所有非禁用单元格中查找
        const fallbackCell = cells.find((cell) => {
          const classList = cell.className || '';
          if (typeof classList === 'string' && /\b(?:disabled|is-disabled|ant-picker-cell-disabled)\b/.test(classList)) return false;
          const t = ((cell as HTMLElement).innerText || cell.textContent || '').trim().replace(/\s+/g, ' ');
          return t === expected;
        });

        if (fallbackCell) {
          const innerClickable = fallbackCell.querySelector('span, div') || fallbackCell;
          return innerClickable;
        }
      }
    }

    // 2. 如果匹配的是操作按钮或快捷项（如 "确定", "清空", "此刻", "今天", "最近一周"）
    if (expected) {
      const buttons = Array.from(popper.querySelectorAll(
        'button, a, .el-picker-panel__shortcut, [class*="shortcut"], [class*="footer"] button, [class*="btn"], [role="button"]'
      ));
      const matchedBtn = buttons.find((btn) => {
        const t = ((btn as HTMLElement).innerText || btn.textContent || '').trim().replace(/\s+/g, ' ');
        return t === expected;
      });
      if (matchedBtn && isElementVisible(matchedBtn)) return matchedBtn;
    }

    // 3. 结构 Selector / XPath 在 popper 范围内的查找
    if (payload.selector) {
      try {
        const bySel = popper.querySelector(payload.selector);
        if (bySel && isElementVisible(bySel)) return bySel;
      } catch {}
    }
  }

  return null;
}

/**
 * 针对各类下拉选择与树形下拉（Select / TreeSelect / Cascader）活动浮层的专门定位器
 * 优先在当前打开的下拉/树选择浮层中精准匹配具体选项节点，彻底阻断误命中页面背景或左侧菜单树
 */
function findDropdownOptionTarget(payload: ClickEventPayload): Element | null {
  const activePoppers = getActiveDropdownPoppers();
  if (activePoppers.length === 0) return null;

  const expected = (payload.text || '').trim().replace(/\s+/g, ' ');
  const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
  if (!cleanExpected) return null;

  for (const popper of activePoppers) {
    if (payload.obsId || payload.id) {
      const targetId = payload.obsId || payload.id;
      const byObs = popper.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetId!)}"]`);
      if (byObs && isElementVisible(byObs)) return byObs;
    }
    if (payload.selector) {
      try {
        const bySel = popper.querySelector(payload.selector);
        if (bySel && isElementVisible(bySel)) return bySel;
      } catch {}
    }

    const optionCandidateSelectors = [
      '.el-select-dropdown__item',
      '.ant-select-item-option',
      '.arco-select-option',
      '.n-select-option',
      '.t-select-option',
      '.vue-treeselect__option',
      '.vue-treeselect__label',
      '.el-tree-node__content',
      '.el-cascader-node',
      '.ant-select-tree-node-content-wrapper',
      '.ant-select-tree-title',
      '[role="option"]',
      '[role="treeitem"]',
      'li',
      'span',
      'div',
    ].join(',');

    const candidates = Array.from(popper.querySelectorAll(optionCandidateSelectors))
      .filter((el): el is HTMLElement => Boolean(el && isElementVisible(el as Element)));

    // A. 文本严格相等匹配
    for (const el of candidates) {
      if (typeof el.querySelector === 'function' && el.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]')) {
        continue;
      }
      const text = ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text === cleanExpected || text === expected) {
        return el;
      }
    }

    // B. 前缀/包含关系匹配（解决带计数后缀，如 "科技 (2)" 或 "研发部门"）
    for (const el of candidates) {
      if (typeof el.querySelector === 'function' && el.querySelector('.el-select-dropdown__item, .el-tree-node__content, .vue-treeselect__label, [role="option"]')) {
        continue;
      }
      const text = ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && (text.startsWith(cleanExpected) || cleanExpected.startsWith(text) || text.includes(cleanExpected))) {
        return el;
      }
    }
  }

  return null;
}

export function findClickTarget(payload: ClickEventPayload): Element | null {
  const isOption = payload.role === 'option' ||
    payload.tag === 'OPTION' ||
    Boolean(payload.text && /\[(?:当前下拉选项|下拉选项)\]/.test(payload.text)) ||
    Boolean(payload.selector && /select-dropdown|ant-select-item|arco-select-option|vue-treeselect|tree-select/i.test(payload.selector));
  const isInputField = Boolean(payload.isInput || ['INPUT', 'TEXTAREA', 'SELECT'].includes(payload.tag?.toUpperCase() || ''));

  const expected = (payload.text || '').trim().replace(/\s+/g, ' ');
  const expectedFirstLine = (payload.text || '').split(/[\r\n]+/)[0]?.trim().replace(/\s+/g, ' ') || '';

  const matchesText = (element: Element | null, mode: 'exact' | 'partial' = 'exact'): boolean => {
    if (!element) return false;
    if (isInputField) return true;
    if (!expected) return true;
    const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
    const actual = ((element as HTMLElement).innerText || element.textContent || '').trim().replace(/\s+/g, ' ');
    const cleanActual = actual.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
    if (actual === expected || actual === cleanExpected || cleanActual === cleanExpected || cleanActual === expected) return true;
    if (mode === 'exact') return false;

    // 宽松/子串匹配（解决菜单展开/收起、截断40字符、多级子文本拼接等情况）
    if (actual && (expected || cleanExpected)) {
      if (cleanActual.includes(cleanExpected) || cleanExpected.includes(cleanActual)) return true;
      if (actual.includes(cleanExpected) || cleanExpected.includes(actual)) return true;
      if (cleanExpected.startsWith(cleanActual) || cleanActual.startsWith(cleanExpected)) return true;
      if (expectedFirstLine && (cleanActual === expectedFirstLine || cleanActual.includes(expectedFirstLine) || expectedFirstLine.includes(cleanActual))) {
        return true;
      }
    }
    return false;
  };

  // 0. 最高优先级：Agent 观察节点缓存 / ID 精准匹配（借鉴 Midscene nodeCacheMap 机制）
  const targetObsId = payload.obsId || payload.id;
  if (targetObsId) {
    const cached = observationElementCache.get(targetObsId);
    if (cached && document.contains(cached) && isElementVisible(cached)) {
      const activePoppers = getActiveDropdownPoppers();
      const inPopper = activePoppers.some((p) => p.contains(cached));
      // 安全拦截：如果当前页面存在活动的下拉浮层且动作针对下拉选项，但缓存节点不在浮层内（例如误中了背景侧栏），
      // 放弃该缓存，转入下拉浮层专用匹配，杜绝误点击背景侧栏
      if (isOption && activePoppers.length > 0 && !inPopper) {
        console.warn('[QA Copilot] 观察节点缓存命中了非浮层背景节点，转为下拉浮层精准匹配');
      } else {
        return cached;
      }
    }
    try {
      const byDataAttr = document.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetObsId)}"]`);
      if (byDataAttr && isElementVisible(byDataAttr as HTMLElement)) {
        const activePoppers = getActiveDropdownPoppers();
        const inPopper = activePoppers.some((p) => p.contains(byDataAttr));
        if (isOption && activePoppers.length > 0 && !inPopper) {
          // 转向下拉浮层匹配
        } else {
          return byDataAttr as HTMLElement;
        }
      }
    } catch {}
  }

  // 0.05 下拉选项优先：若当前页面存在活动下拉/树形选择浮层，优先在浮层中精准匹配选项
  const dropdownOptionTarget = findDropdownOptionTarget(payload);
  if (dropdownOptionTarget) return dropdownOptionTarget;

  // 0.1 日历与日期选择器优先：若页面上存在活动日历浮层，优先从日历浮层中精准匹配单元格或控制项
  const dateTarget = findDatePickerTarget(payload);
  if (dateTarget) return dateTarget;

  // 1. 弹窗优先：如果页面存在活动弹窗，优先在弹窗容器内查找匹配控件
  const activeModals = getActiveModalContainers();
  if (activeModals.length > 0) {
    const cleanExpected = expected.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
    for (const modal of activeModals) {
      if (payload.id) {
        const byId = modal.querySelector(`#${safeEscapeCss(payload.id)}`);
        if (byId && matchesText(byId, 'partial')) return byId;
      }
      if (payload.testId) {
        const byTestId = modal.querySelector(`[data-testid="${safeEscapeCss(payload.testId)}"]`);
        if (byTestId && matchesText(byTestId, 'partial')) return byTestId;
      }
      if (payload.name) {
        const cleanName = payload.name.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
        const byName = modal.querySelector(`[name="${safeEscapeCss(cleanName)}"], [name="${safeEscapeCss(payload.name)}"]`);
        if (byName && matchesText(byName, 'partial')) return byName;
      }
      if (payload.ariaLabel) {
        const cleanAria = payload.ariaLabel.replace(/^(\[(?:当前下拉选项|下拉选项|弹窗内|浮层|展开节点|背景页面)\]\s*)+/, '');
        const byAriaLabel = modal.querySelector(`[aria-label="${safeEscapeCss(cleanAria)}"], [aria-label="${safeEscapeCss(payload.ariaLabel)}"]`);
        if (byAriaLabel && matchesText(byAriaLabel, 'partial')) return byAriaLabel;
      }
      if (payload.selector) {
        try {
          const bySel = modal.querySelector(payload.selector);
          if (bySel && matchesText(bySel, 'partial')) return bySel;
        } catch {}
      }
      if (cleanExpected) {
        const modalButtons = Array.from(modal.querySelectorAll('button, a, option, li, [role="button"], [role="option"], [role="menuitem"], input[type="button"], input[type="submit"]'));
        const matchedBtn = modalButtons.find((el) => {
          const t = ((el as HTMLElement).innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          return t === cleanExpected || t === expected;
        });
        if (matchedBtn) return matchedBtn;
      }
    }
  }

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

  // 1.1 单元格与文本节点保底匹配（支持日历单元格、表格单元格等 td/span/div 控件）
  if (expected) {
    const byCellText = findByText('td, span, div, [role="gridcell"]', expected);
    if (byCellText) return byCellText;
  }

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

  // 0. 最高优先级：Agent 观察节点缓存 / ID 精准匹配（借鉴 Midscene nodeCacheMap 机制）
  const targetObsId = payload.obsId || payload.id;
  if (targetObsId) {
    const cached = observationElementCache.get(targetObsId);
    if (cached && document.contains(cached) && isElementVisible(cached)) {
      if (cached instanceof HTMLInputElement || cached instanceof HTMLTextAreaElement || cached instanceof HTMLSelectElement) {
        return cached;
      }
      const nested = cached.querySelector('input, textarea, select');
      if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
        return nested;
      }
    }
    try {
      const byDataAttr = document.querySelector(`[data-qa-obs-id="${safeEscapeCss(targetObsId)}"]`);
      if (byDataAttr && isElementVisible(byDataAttr as HTMLElement)) {
        if (byDataAttr instanceof HTMLInputElement || byDataAttr instanceof HTMLTextAreaElement || byDataAttr instanceof HTMLSelectElement) {
          return byDataAttr;
        }
        const nested = byDataAttr.querySelector('input, textarea, select');
        if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
          return nested;
        }
      }
    } catch {}
  }

  // 1. 弹窗优先：如果页面存在活动弹窗，优先在弹窗容器内查找输入控件
  const activeModals = getActiveModalContainers();
  if (activeModals.length > 0) {
    for (const modal of activeModals) {
      if (payload.id) {
        const byId = modal.querySelector(`#${safeEscapeCss(payload.id)}`);
        if (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement || byId instanceof HTMLSelectElement) {
          return byId;
        }
      }
      if (payload.placeholder) {
        const cleanPh = payload.placeholder.replace(/^\[弹窗内\]\s*/, '');
        const byPh = modal.querySelector(`[placeholder="${safeEscapeCss(cleanPh)}"], [placeholder="${safeEscapeCss(payload.placeholder)}"]`);
        if (byPh instanceof HTMLInputElement || byPh instanceof HTMLTextAreaElement || byPh instanceof HTMLSelectElement) {
          return byPh;
        }
      }
      if (name) {
        const cleanName = name.replace(/^\[弹窗内\]\s*/, '');
        const byName = modal.querySelector(`[name="${safeEscapeCss(cleanName)}"], [name="${safeEscapeCss(name)}"]`);
        if (byName instanceof HTMLInputElement || byName instanceof HTMLTextAreaElement || byName instanceof HTMLSelectElement) {
          return byName;
        }
      }
      if (payload.fieldLabel) {
        const cleanLabel = payload.fieldLabel.replace(/^\[弹窗内\]\s*/, '');
        const matchedLabel = Array.from(modal.querySelectorAll('label')).find((l) => {
          const t = l.textContent?.trim();
          return t === cleanLabel || t === payload.fieldLabel;
        });
        if (matchedLabel) {
          if (matchedLabel.control && (matchedLabel.control instanceof HTMLInputElement || matchedLabel.control instanceof HTMLTextAreaElement || matchedLabel.control instanceof HTMLSelectElement)) {
            return matchedLabel.control;
          }
          const nested = matchedLabel.querySelector('input, textarea, select');
          if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement || nested instanceof HTMLSelectElement) {
            return nested;
          }
        }
      }
      if (payload.selector) {
        try {
          const bySel = modal.querySelector(payload.selector);
          if (bySel instanceof HTMLInputElement || bySel instanceof HTMLTextAreaElement || bySel instanceof HTMLSelectElement) {
            return bySel;
          }
        } catch {}
      }
    }
  }

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
    p?.selector?.includes('dropdown-menu') ||
    p?.selector?.includes('vue-treeselect') ||
    p?.selector?.includes('tree-select') ||
    Boolean(p?.text && /\[(?:当前下拉选项|下拉选项)\]/.test(p.text))
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

export function isDatePickerEvent(event: QAEvent): boolean {
  if (event.type !== 'click') return false;
  const p = event.payload as ClickEventPayload;
  if (!p) return false;

  const selector = (p.selector || '').toLowerCase();
  const xpath = (p.xpath || '').toLowerCase();
  const isDateSelector = /picker|date|calendar|month-table|year-table|time-panel|datetime|range-picker|el-date|ant-picker/i.test(selector) ||
    /picker|date|calendar|month-table|year-table|time-panel|datetime|range-picker/i.test(xpath);

  const text = (p.text || '').trim();
  const desc = (event.description || '').toLowerCase();
  const title = (event.title || '').toLowerCase();
  const isDateLabel = Boolean(
    p.fieldLabel && /日期|时间|date|time/i.test(p.fieldLabel)
  );
  const isDateTextOrDesc = /日期|时间|date|time|开始日期|结束日期/i.test(desc) || /日期|时间|date|time/i.test(title);
  const isDayNumber = /^(?:[1-9]|[12]\d|3[01])$/.test(text);

  return Boolean(
    isDateSelector ||
    p.isDatePicker ||
    (isDayNumber && (isDateLabel || isDateTextOrDesc || isDateSelector))
  );
}

function tryHealAndOpenDatePicker(event: QAEvent): boolean {
  try {
    const p = event.payload as ClickEventPayload;

    // 1. 如果有关联的 fieldLabel（如“创建时间”、“开始日期”），在页面上定位包含该标签的表单项中的日期控件
    if (p?.fieldLabel) {
      const formItems = Array.from(document.querySelectorAll(
        '.el-form-item, .ant-form-item, .arco-form-item, .n-form-item, [class*="form-item"]'
      ));
      for (const item of formItems) {
        const text = (item.textContent || '').trim();
        if (text.includes(p.fieldLabel)) {
          const dateTrigger = item.querySelector(
            '.el-date-editor, .el-range-editor, .ant-picker, .arco-picker, input.el-range-input, input[placeholder*="日期"], input[placeholder*="时间"], [class*="picker"]'
          ) as HTMLElement | null;
          if (dateTrigger && isElementVisible(dateTrigger)) {
            console.warn(`[QA Copilot Replay] 触发前置表单项「${p.fieldLabel}」日期选择器自愈展开`);
            dispatchClick(dateTrigger);
            return true;
          }
        }
      }
    }

    // 2. 检查页面上是否存在已有的日期选择器输入框或范围触发器
    const activeDatePopper = document.querySelector(
      '.el-picker__popper:not([style*="display: none"]), .el-picker-panel:not([style*="display: none"]), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden), [class*="date-picker-dropdown"]:not([style*="display: none"])'
    );
    if (!activeDatePopper) {
      const candidates = Array.from(document.querySelectorAll(
        '.el-date-editor, .el-range-editor, .ant-picker, .arco-picker, input.el-range-input, input[placeholder*="开始日期"], input[placeholder*="日期"], input[placeholder*="时间"]'
      ));
      for (const cand of candidates) {
        if (isElementVisible(cand)) {
          const trigger = (cand.querySelector('input') || cand) as HTMLElement;
          console.warn(`[QA Copilot Replay] 页面无展开日历浮层，触发候选日期组件自愈展开`);
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
  const isDate = isDatePickerEvent(event);
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
    } else if (isDate && !attemptedHeal && (attempt === 3 || attempt === 8)) {
      // 关键自愈：如果是在找日历/日期选项，且当前页面日历浮层未展开，自愈点击对应日期输入框展开
      const healed = tryHealAndOpenDatePicker(event);
      if (healed) {
        attemptedHeal = true;
        await new Promise((resolve) => setTimeout(resolve, 300));
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
        htmlTarget.classList?.contains('vue-treeselect__option') ||
        htmlTarget.classList?.contains('vue-treeselect__label') ||
        htmlTarget.closest?.('.el-select-dropdown, .ant-select-dropdown, .vue-treeselect__menu, .vue-treeselect__menu-container, .vue-treeselect__portal-container, .el-tree-select__popper, [class*="select-dropdown"], [class*="treeselect"]')
      );
      const isDateCell = Boolean(
        isDatePickerEvent(event) ||
        htmlTarget.closest?.('.el-picker-panel, .el-date-picker, .el-date-range-picker, .ant-picker-dropdown, .arco-picker-popup, [class*="date-table"]')
      );
      if (isDropdownOption || isDateCell) {
        console.warn(`[QA Copilot Replay] 日期选项/下拉选项处于特殊渲染层，执行穿透点击以触发组件选中: ${event.description}`);
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

  htmlTarget.scrollIntoView?.({ behavior: 'auto', block: 'center', inline: 'center' });
  const previousOutline = htmlTarget.style?.outline || '';
  if (htmlTarget.style) {
    htmlTarget.style.outline = '3px solid #22c55e';
  }

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

      // 智能识别是否点击了日历/日期组件浮层中的内容
      const inDatePicker = Boolean(
        target.closest?.(
          '.el-picker__popper, .el-picker-panel, .el-date-picker, .el-date-range-picker, .ant-picker-dropdown, .arco-picker-popup, .n-date-panel, [class*="date-table"], [class*="picker-panel"]'
        )
      );
      let dateFieldLabel = fieldLabel;
      if (inDatePicker && !dateFieldLabel) {
        const activeDateTrigger = document.querySelector(
          '.el-date-editor.is-active, .el-range-editor.is-active, .el-input.is-focus, .ant-picker-focused, .arco-picker-focused, [class*="date"].is-active'
        );
        if (activeDateTrigger) {
          dateFieldLabel = getElementLabel(activeDateTrigger) || undefined;
        }
      }

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
              fieldLabel: dateFieldLabel || fieldLabel,
              placeholder: effectiveTarget.getAttribute?.('placeholder') || undefined,
              isInput,
              isDatePicker: inDatePicker || undefined,
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
