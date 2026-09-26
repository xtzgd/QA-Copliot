/**
 * Bug Markdown 导出生成器 (TASK-306)
 * 自动整合环境、复现步骤、接口证据和控制台日志
 */

import { Bug, BugSnapshot } from '../types/snapshot';

export class MarkdownBugExporter {
  /**
   * 生成标准 Bug Markdown 报告
   */
  static generate(
    bug: Pick<Bug, 'id' | 'title' | 'severity' | 'reproductionSteps' | 'expectedResult' | 'actualResult' | 'aiAnalysis'>,
    snapshot?: BugSnapshot
  ): string {
    const lines: string[] = [];

    lines.push(`# [${bug.severity}] ${bug.title}`);
    lines.push('');
    lines.push(`> **Bug ID**: \`${bug.id}\` | **状态**: 待处理 | **问题时间**: ${new Date(snapshot?.createdAt || Date.now()).toLocaleString()}`);
    lines.push('');

    // 1. 测试环境
    lines.push('## 🖥️ 测试环境');
    lines.push(`- **环境**: ${snapshot?.environment || '未知'}`);
    lines.push(`- **URL**: \`${snapshot?.url || '未知'}\``);
    if (snapshot?.browserInfo) {
      const b = snapshot.browserInfo;
      lines.push(`- **浏览器**: ${b.browserName} ${b.browserVersion}`);
      lines.push(`- **操作系统**: ${b.os}`);
      lines.push(`- **视口分辨率**: ${b.viewport.width} × ${b.viewport.height}`);
      lines.push(`- **User-Agent**: \`${b.userAgent}\``);
    }
    lines.push('');

    // 2. 复现步骤
    lines.push('## 📝 复现步骤');
    if (bug.reproductionSteps && bug.reproductionSteps.length > 0) {
      bug.reproductionSteps.forEach((step, idx) => {
        const cleanStep = step.replace(/^\d+\.\s*/, '');
        lines.push(`${idx + 1}. ${cleanStep}`);
      });
    } else {
      lines.push('1. 打开测试页面并登录');
      lines.push('2. 执行触发异常的操作');
    }
    lines.push('');

    // 3. 预期与实际结果
    lines.push('## 🎯 预期结果');
    lines.push(bug.expectedResult || '操作正常完成，无系统异常报错。');
    lines.push('');

    lines.push('## ❌ 实际结果');
    lines.push(bug.actualResult || '页面报错或异常中断。');
    lines.push('');

    // 4. 关键技术证据 (Network & Console)
    if (snapshot) {
      const errorReqs = snapshot.networkRequests.filter((r) => r.isError || r.isSlow);
      if (errorReqs.length > 0) {
        lines.push('## 🌐 异常网络请求');
        errorReqs.forEach((r) => {
          lines.push(`### \`${r.method}\` \`${r.pathname}\` (${r.status ? `HTTP ${r.status}` : '网络中断'})`);
          lines.push(`- **耗时**: ${r.duration}ms`);
          lines.push(`- **完整 URL**: \`${r.url}\``);
          if (r.requestBody) {
            lines.push('**Request Payload**:');
            lines.push('```json');
            lines.push(r.requestBody);
            lines.push('```');
          }
          if (r.responseBody) {
            lines.push('**Response**:');
            lines.push('```json');
            lines.push(r.responseBody);
            lines.push('```');
          }
        });
        lines.push('');
      }

      if (snapshot.consoleErrors.length > 0) {
        lines.push('## ⚠️ 控制台错误日志 (Console Errors)');
        snapshot.consoleErrors.forEach((e) => {
          lines.push(`- **${new Date(e.timestamp).toTimeString().slice(0, 8)}** \`${e.title}\`: ${e.description}`);
        });
        lines.push('');
      }

      lines.push('## 📎 附件与证据');
      lines.push(`- 页面截图：${snapshot.screenshotId ? `已保存（${snapshot.screenshotId}）` : '未获取'}`);
      lines.push(`- Session Timeline：${snapshot.events.length} 条事件`);
      lines.push(`- Network：${snapshot.networkRequests.length} 条请求`);
      lines.push(`- Console：${snapshot.consoleErrors.length} 条错误`);
      lines.push('');
    }

    // 5. AI 分析建议（仅供参考）
    if (bug.aiAnalysis) {
      lines.push('## 🤖 AI 初步排查建议 (仅供参考)');
      lines.push(`> ⚠️ *以下内容由 AI 辅助分析生成，供开发与测试快速定位，非最终事实认定。*`);
      lines.push('');
      lines.push(bug.aiAnalysis);
      lines.push('');
    }

    lines.push('---');
    lines.push('*由 QA Copilot Chrome 插件自动生成*');

    return lines.join('\n');
  }
}
