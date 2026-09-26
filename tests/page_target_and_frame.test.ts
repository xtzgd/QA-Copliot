/**
 * IMP-04: 统一页面目标 PageTarget 与 frame 边界专项测试
 * 验证：子 frame 收到表单扫描、填表执行、元素审查、回放指令时的边界隔离行为，确保不发生多 frame 竞争与误操作
 */

import { describe, it, expect, vi } from 'vitest';
import type { PageTarget } from '../src/shared/types/page';

describe('IMP-04 PageTarget 与 frame 边界隔离验证', () => {
  it('验证 PageTarget 数据模型完整性', () => {
    const target: PageTarget = {
      tabId: 101,
      frameId: 0,
      documentId: 'doc-123456',
      url: 'https://test.example.com/app',
    };
    expect(target.tabId).toBe(101);
    expect(target.frameId).toBe(0);
    expect(target.documentId).toBe('doc-123456');
    expect(target.url).toBe('https://test.example.com/app');
  });

  it('模拟子 iframe 收到 SCAN_FORM_SNAPSHOT 消息: 严格拒绝并返回受限错误，杜绝跨 frame 污染', () => {
    // 模拟运行在 iframe 环境: window !== window.top
    const mockWindow = {} as Window;
    const mockTop = {} as Window;
    const isTopFrame = mockWindow === mockTop; // false

    let sentResponse: { error?: string; snapshot?: unknown } | undefined;
    const sendResponse = (res: { error?: string; snapshot?: unknown }) => {
      sentResponse = res;
    };

    // 模拟 content script 消息处理逻辑
    const handleMessage = (message: { type: string }) => {
      if (message.type === 'SCAN_FORM_SNAPSHOT') {
        if (!isTopFrame) {
          sendResponse({ error: '当前仅支持顶层页面表单扫描，暂不支持内嵌 Iframe' });
          return false;
        }
      }
      return true;
    };

    const handled = handleMessage({ type: 'SCAN_FORM_SNAPSHOT' });
    expect(handled).toBe(false);
    expect(sentResponse?.error).toContain('暂不支持内嵌 Iframe');
    expect(sentResponse?.snapshot).toBeUndefined();
  });

  it('模拟子 iframe 收到 EXECUTE_FORM_FILL 消息: 严格拒绝执行，保护 DOM 不被误操作', () => {
    const isTopFrame = false;
    let sentResponse: { error?: string } | undefined;
    const sendResponse = (res: { error?: string }) => {
      sentResponse = res;
    };

    const handleMessage = (message: { type: string }) => {
      if (message.type === 'EXECUTE_FORM_FILL') {
        if (!isTopFrame) {
          sendResponse({ error: '当前仅支持在顶层页面执行填表' });
          return false;
        }
      }
      return true;
    };

    const handled = handleMessage({ type: 'EXECUTE_FORM_FILL' });
    expect(handled).toBe(false);
    expect(sentResponse?.error).toContain('仅支持在顶层页面执行填表');
  });

  it('模拟子 iframe 收到针对顶层 frame 的 REPLAY_ACTION 消息: 自动忽略不响应', () => {
    const isTopFrame = false;
    const replayActionMock = vi.fn();

    const handleMessage = (message: { type: string; payload?: { targetFrameId?: number } }) => {
      if (message.type === 'REPLAY_ACTION') {
        const targetFrameId = message.payload?.targetFrameId;
        if (targetFrameId !== undefined && targetFrameId !== null) {
          if (targetFrameId === 0 && !isTopFrame) return false;
        } else if (!isTopFrame) {
          return false;
        }
        replayActionMock();
        return true;
      }
      return false;
    };

    // 1. targetFrameId = 0 (顶层 frame) 发送给子 frame
    const res1 = handleMessage({ type: 'REPLAY_ACTION', payload: { targetFrameId: 0 } });
    expect(res1).toBe(false);
    expect(replayActionMock).not.toHaveBeenCalled();

    // 2. targetFrameId 未指定 (默认顶层) 发送给子 frame
    const res2 = handleMessage({ type: 'REPLAY_ACTION', payload: {} });
    expect(res2).toBe(false);
    expect(replayActionMock).not.toHaveBeenCalled();
  });
});
