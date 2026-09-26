/**
 * 悬浮小窗与侧边栏吸附服务 src/sidepanel/services/pipService.ts
 * 支持在「Chrome 右侧边栏吸附」与「独立桌面悬浮小窗」之间无缝流转：
 * 1. 悬浮时：开启独立小窗，右侧边栏自动彻底关闭收起 (0 占位，网页恢复全屏宽)
 * 2. 恢复时：重新唤起 Chrome 右侧边栏，当前独立小窗自动关闭
 */

export class PipService {
  private static instance: PipService;

  static getInstance(): PipService {
    if (!this.instance) {
      this.instance = new PipService();
    }
    return this.instance;
  }

  /**
   * 判断当前页面是否处于独立悬浮小窗运行中
   */
  isDetachedMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('mode') === 'detached';
    } catch {
      return false;
    }
  }

  /**
   * 独立悬浮脱离：
   * 1. 弹出独立的小窗运行 (无地址栏、自由拖拽缩放)
   * 2. 当前右侧栏立即执行 window.close() 自动收回，右侧 0 占位
   */
  async detachToWindow(): Promise<boolean> {
    if (typeof chrome !== 'undefined' && chrome.windows?.create) {
      try {
        let hostWindowId = '';
        if (chrome.windows?.getCurrent) {
          const currentWin = await chrome.windows.getCurrent();
          if (currentWin?.id) hostWindowId = String(currentWin.id);
        }

        await chrome.windows.create({
          url: chrome.runtime.getURL(
            `sidepanel/index.html?mode=detached${hostWindowId ? `&hostWindowId=${hostWindowId}` : ''}`
          ),
          type: 'popup',
          width: 420,
          height: 750,
          focused: true,
        });

        // 延迟 50ms 确保新窗口成功拉起后，当前侧边栏立即自我关闭收起
        setTimeout(() => {
          if (typeof window !== 'undefined') {
            window.close();
          }
        }, 50);

        return true;
      } catch (err) {
        console.error('[PipService] 脱离为独立浮窗失败:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * 恢复吸附：
   * 1. 重新唤出 Chrome 原生右侧栏 sidePanel
   * 2. 关闭当前独立小浮窗
   */
  async attachToSidePanel(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.sidePanel?.open) {
        const url = new URL(window.location.href);
        const hostWindowId = url.searchParams.get('hostWindowId');

        if (hostWindowId) {
          await chrome.sidePanel.open({ windowId: Number(hostWindowId) });
        } else {
          const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
          const targetWin = wins[0];
          if (targetWin?.id) {
            await chrome.sidePanel.open({ windowId: targetWin.id });
          }
        }
      }
    } catch (err) {
      console.warn('[PipService] 重新唤起侧边栏失败:', err);
    } finally {
      if (typeof window !== 'undefined') {
        window.close();
      }
    }
  }

  // 兼容旧接口命名
  isPipActive(): boolean {
    return this.isDetachedMode();
  }

  isPipSupported(): boolean {
    return true;
  }

  async enterPip(): Promise<boolean> {
    return this.detachToWindow();
  }

  exitPip(): void {
    this.attachToSidePanel();
  }
}

export const pipService = PipService.getInstance();
