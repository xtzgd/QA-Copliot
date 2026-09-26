import { describe, it, expect } from 'vitest';
import { MarkdownBugExporter } from '../src/shared/formatters/markdownExport';
import { BugSnapshot } from '../src/shared/types/snapshot';

describe('Bug Markdown 报告生成测试 (TASK-305 & TASK-306)', () => {
  const mockSnapshot: BugSnapshot = {
    id: 'SNAP-20260903-001',
    sessionId: 'sess-1',
    createdAt: 1700000000000,
    url: 'https://test.xxx.com/order/create',
    environment: 'TEST',
    screenshotId: 'shot-1',
    browserInfo: {
      userAgent: 'Chrome 120 macOS',
      browserName: 'Chrome',
      browserVersion: '120.0',
      os: 'macOS',
      viewport: { width: 1920, height: 1080 },
    },
    windowDurationSec: 60,
    events: [],
    networkRequests: [
      {
        id: 'req-1',
        sessionId: 'sess-1',
        method: 'POST',
        url: 'https://test.xxx.com/api/order/create',
        pathname: '/api/order/create',
        status: 500,
        startedAt: 1700000005000,
        duration: 438,
        requestBody: '{"phone":"13812345678","token":"Bearer eyJhbGciOi..."}',
        responseBody: '{"code":50001,"message":"stock error"}',
        isError: true,
        isSlow: false,
      },
    ],
    consoleErrors: [
      {
        id: 'err-1',
        sessionId: 'sess-1',
        type: 'error',
        timestamp: 1700000005200,
        title: 'TypeError',
        description: 'Cannot read properties of undefined',
        url: 'https://test.xxx.com/order/create',
        payload: { timestamp: 1700000005200, url: 'https://test.xxx.com/order/create' },
      },
    ],
    summary: { eventCount: 2, requestCount: 1, errorCount: 2 },
  };

  it('成功生成结构化 Markdown 报告并保留原始数据', () => {
    const md = MarkdownBugExporter.generate(
      {
        id: 'BUG-20260903-001',
        title: '手机号 13812345678 提交订单 500 异常',
        severity: 'Blocker',
        reproductionSteps: ['1. 打开页面', '2. 输入手机号 13812345678', '3. 点击提交订单'],
        expectedResult: '订单创建成功',
        actualResult: '页面提示系统异常',
      },
      mockSnapshot
    );

    // 检查结构
    expect(md).toContain('# [Blocker]');
    expect(md).toContain('## 🖥️ 测试环境');
    expect(md).toContain('## 📝 复现步骤');
    expect(md).toContain('## 🎯 预期结果');
    expect(md).toContain('## ❌ 实际结果');
    expect(md).toContain('## 🌐 异常网络请求');
    expect(md).toContain('## ⚠️ 控制台错误日志');
    expect(md).toContain('**环境**: TEST');
    expect(md).toContain('## 📎 附件与证据');
    expect(md).toContain('shot-1');
    expect(md).toContain(`**问题时间**: ${new Date(mockSnapshot.createdAt).toLocaleString()}`);

    expect(md).toContain('13812345678');
    expect(md).toContain('eyJhbGciOi...');
    expect(md).toContain('1. 打开页面');
    expect(md).toContain('2. 输入手机号 13812345678');
  });
});
