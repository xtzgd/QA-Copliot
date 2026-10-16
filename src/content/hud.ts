/**
 * QA Copilot 页面悬浮 HUD 状态指示器
 * 在目标网页右上角直观展示自然语言测试的运行状态、通过 (PASS) 与未通过 (FAIL) 判定及依据
 */

export interface TestHudPayload {
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  title?: string;
  stepTitle?: string;
  stepIndex?: number;
  totalSteps?: number;
  detail?: string;
  reason?: string;
  error?: string;
}

let hudContainer: HTMLDivElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function getOrCreateHudContainer(): HTMLDivElement {
  if (hudContainer && document.documentElement.contains(hudContainer)) {
    return hudContainer;
  }
  hudContainer = document.createElement('div');
  hudContainer.dataset.qaCopilotRoot = 'true';
  hudContainer.dataset.qaCopilotHud = 'true';
  Object.assign(hudContainer.style, {
    position: 'fixed',
    top: '20px',
    right: '24px',
    zIndex: '2147483646',
    maxWidth: '420px',
    minWidth: '280px',
    boxSizing: 'border-box',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '13px',
    lineHeight: '1.4',
    pointerEvents: 'auto',
    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
    transform: 'translateY(-10px)',
    opacity: '0',
  });
  document.documentElement.appendChild(hudContainer);
  // 触发渐入过渡
  requestAnimationFrame(() => {
    if (hudContainer) {
      hudContainer.style.transform = 'translateY(0)';
      hudContainer.style.opacity = '1';
    }
  });
  return hudContainer;
}

export function dismissTestHud(instant = false): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (!hudContainer) return;
  if (instant) {
    hudContainer.remove();
    hudContainer = null;
    return;
  }
  hudContainer.style.transform = 'translateY(-10px)';
  hudContainer.style.opacity = '0';
  setTimeout(() => {
    hudContainer?.remove();
    hudContainer = null;
  }, 250);
}

export function updateTestHud(payload: TestHudPayload): void {
  // 只在顶层窗口渲染 HUD，防止 iframe 内重复堆叠
  if (window !== window.top) return;

  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  const container = getOrCreateHudContainer();
  const { status, title, stepTitle, stepIndex, totalSteps, detail, reason, error } = payload;

  let theme = {
    bg: '#ffffff',
    border: '#e2e8f0',
    titleColor: '#0f172a',
    badgeBg: '#f1f5f9',
    badgeText: '#475569',
    iconHtml: '',
    badgeHtml: '',
  };

  if (status === 'running') {
    theme = {
      bg: 'rgba(255, 255, 255, 0.95)',
      border: '#c7d2fe',
      titleColor: '#312e81',
      badgeBg: '#e0e7ff',
      badgeText: '#4338ca',
      iconHtml: `
        <svg style="width: 18px; height: 18px; animation: spin 1s linear infinite; color: #4f46e5; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
      `,
      badgeHtml: `<span style="background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 9999px;">执行中${totalSteps ? ` · ${Math.min((stepIndex ?? 0) + 1, totalSteps)}/${totalSteps}步` : ''}</span>`,
    };
  } else if (status === 'passed') {
    theme = {
      bg: '#f0fdf4',
      border: '#86efac',
      titleColor: '#14532d',
      badgeBg: '#dcfce7',
      badgeText: '#15803d',
      iconHtml: `
        <svg style="width: 20px; height: 20px; color: #16a34a; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      `,
      badgeHtml: `<span style="background: #22c55e; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; letter-spacing: 0.5px;">✓ PASS 测试通过</span>`,
    };
    // 自动在 7 秒后淡出
    dismissTimer = setTimeout(() => dismissTestHud(), 7000);
  } else if (status === 'failed') {
    theme = {
      bg: '#fff1f2',
      border: '#fca5a5',
      titleColor: '#881337',
      badgeBg: '#fee2e2',
      badgeText: '#b91c1c',
      iconHtml: `
        <svg style="width: 20px; height: 20px; color: #e11d48; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      `,
      badgeHtml: `<span style="background: #e11d48; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; letter-spacing: 0.5px;">✕ FAIL 测试未通过</span>`,
    };
    // 失败保留 12 秒
    dismissTimer = setTimeout(() => dismissTestHud(), 12000);
  } else if (status === 'cancelled') {
    theme = {
      bg: '#f8fafc',
      border: '#cbd5e1',
      titleColor: '#334155',
      badgeBg: '#f1f5f9',
      badgeText: '#64748b',
      iconHtml: `
        <svg style="width: 18px; height: 18px; color: #64748b; shrink-0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
      `,
      badgeHtml: `<span style="background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 9999px;">已取消</span>`,
    };
    dismissTimer = setTimeout(() => dismissTestHud(), 3500);
  }

  const heading = title || (status === 'passed' ? '测试通过' : status === 'failed' ? '测试失败' : '自然语言自动化测试');
  const mainReason = reason || error || '';
  const currentStepInfo = stepTitle ? `<div style="font-size: 12px; color: #475569; margin-top: 4px; word-break: break-all;"><strong>当前步骤：</strong>${stepTitle}</div>` : '';
  const detailInfo = detail ? `<div style="font-size: 11px; color: #64748b; margin-top: 3px; word-break: break-all; opacity: 0.9;">${detail}</div>` : '';
  const reasonInfo = mainReason ? `
    <div style="margin-top: 6px; padding: 6px 9px; background: rgba(0, 0, 0, 0.04); border-radius: 6px; font-size: 11px; line-height: 1.45; color: ${status === 'failed' ? '#9f1239' : status === 'passed' ? '#166534' : '#334155'}; word-break: break-all;">
      <strong>${status === 'failed' ? '原因说明：' : status === 'passed' ? '验证依据：' : '说明：'}</strong>${mainReason}
    </div>
  ` : '';

  container.innerHTML = `
    <style>
      @keyframes spin { 100% { transform: rotate(360deg); } }
    </style>
    <div style="background: ${theme.bg}; border: 1px solid ${theme.border}; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08); padding: 12px 14px; backdrop-filter: blur(8px);">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          ${theme.iconHtml}
          <span style="font-size: 13px; font-weight: 700; color: ${theme.titleColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${heading}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${theme.badgeHtml}
          <button id="qa-copilot-hud-close" style="background: none; border: none; padding: 2px 4px; cursor: pointer; color: #94a3b8; font-size: 14px; line-height: 1; border-radius: 4px;">✕</button>
        </div>
      </div>
      ${currentStepInfo}
      ${detailInfo}
      ${reasonInfo}
    </div>
  `;

  const closeBtn = container.querySelector('#qa-copilot-hud-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissTestHud();
    });
  }
}
