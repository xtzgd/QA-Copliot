import { CdpInputAction } from '../../shared/types/cdp';

/** Chrome DevTools Protocol input for browser-trusted mouse and keyboard events. */
export class CdpInputSession {
  private attachedTabId: number | null = null;

  constructor() {
    if (typeof chrome !== 'undefined' && chrome.debugger?.onDetach?.addListener) {
      chrome.debugger.onDetach.addListener((source) => {
        if (source.tabId === this.attachedTabId) this.attachedTabId = null;
      });
    }
  }

  get isAttached(): boolean {
    return this.attachedTabId !== null;
  }

  async attach(tabId: number): Promise<void> {
    if (this.attachedTabId === tabId) return;
    if (this.attachedTabId !== null) await this.detach();
    await chrome.debugger.attach({ tabId }, '1.3');
    this.attachedTabId = tabId;
  }

  async dispatch(tabId: number, action: CdpInputAction): Promise<void> {
    if (this.attachedTabId !== tabId) throw new Error('CDP 输入尚未附加到目标标签页');
    if (action.kind === 'click') {
      await this.click(tabId, action.x, action.y);
      return;
    }

    await this.click(tabId, action.x, action.y);
    const { modifierName, modifierMask, keyCode, virtualKeyCode } = await this.getSelectAllKey();
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: modifierName,
      code: keyCode,
      modifiers: modifierMask,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    });
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: modifierMask,
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        modifiers: modifierMask,
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: action.text || '' });
    } finally {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: modifierName,
        code: keyCode,
        modifiers: 0,
        windowsVirtualKeyCode: virtualKeyCode,
        nativeVirtualKeyCode: virtualKeyCode,
      }).catch(() => {});
    }
  }

  async detach(): Promise<void> {
    const tabId = this.attachedTabId;
    this.attachedTabId = null;
    if (tabId === null) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Chrome may already have detached the target after navigation or tab close.
    }
  }

  private async click(tabId: number, x: number, y: number): Promise<void> {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    }).catch(() => {});
  }

  private async getSelectAllKey(): Promise<{
    modifierName: string;
    modifierMask: number;
    keyCode: string;
    virtualKeyCode: number;
  }> {
    try {
      const { os } = await chrome.runtime.getPlatformInfo();
      if (os === 'mac') {
        return { modifierName: 'Meta', modifierMask: 4, keyCode: 'MetaLeft', virtualKeyCode: 91 };
      }
    } catch {}
    return { modifierName: 'Control', modifierMask: 2, keyCode: 'ControlLeft', virtualKeyCode: 17 };
  }
}
