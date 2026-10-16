import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ZentaoClient } from '../src/shared/integrations/zentao';
import { ZentaoFillExecutor } from '../src/content/zentaoFillExecutor';
import {
  ZENTAO_AUTOFILL_STORAGE_KEY,
  ZentaoPendingFillData,
  ZENTAO_PENDING_ATTACHMENT_KEY,
  ZentaoPendingAttachment,
} from '../src/shared/types/zentaoAutoFill';

describe('禅道网页端自动填单与步骤 HTML 格式化', () => {
  describe('ZentaoClient.buildZentaoStepsHtml 卡片化排版', () => {
    it('正确生成包含重现步骤、红绿结果卡片与环境信息的 HTML 结构', () => {
      const bug = {
        title: '测试商品下单异常',
        severity: 'Critical' as const,
        reproductionSteps: ['1. 打开商城首页', '2. 点击立即购买', '3. 提交订单报错'],
        expectedResult: '订单应创建成功并跳转支付页',
        actualResult: '页面弹出 500 系统繁忙提示',
        aiAnalysis: '可能是库存扣减接口分布式锁超时引发的空指针异常',
        currentUser: 'test-qa-user',
      };

      const snapshot: any = {
        url: 'https://mall.example.com/checkout',
        currentUser: 'test-qa-user',
        environment: 'SIT',
        browserInfo: { browserName: 'Chrome', browserVersion: '120.0', os: 'macOS' },
        networkRequests: [
          {
            method: 'POST',
            url: 'https://mall.example.com/api/order/create',
            pathname: '/api/order/create',
            status: 500,
            statusText: 'Internal Server Error',
            duration: 150,
            isError: true,
            requestBody: '{"skuId":1001,"count":1}',
            responseBody: '{"code":500,"message":"Stock lock timeout"}',
          },
        ],
        screenshotUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };

      const html = ZentaoClient.buildZentaoStepsHtml(bug, snapshot);

      // 验证核心卡片结构存在
      expect(html).toContain('[步骤] 重现流程');
      expect(html).toContain('<li>打开商城首页</li>');
      expect(html).toContain('<li>点击立即购买</li>');
      expect(html).toContain('❌ [结果] 现场异常现象');
      expect(html).toContain('页面弹出 500 系统繁忙提示');
      expect(html).toContain('✅ [期望] 预期正常行为');
      expect(html).toContain('订单应创建成功并跳转支付页');
      expect(html).toContain('💡 [疑似根因分析与排查建议]');
      expect(html).toContain('库存扣减接口分布式锁超时');
      expect(html).toContain('🖥️ [环境与页面信息]');
      expect(html).toContain('test-qa-user');
      expect(html).toContain('⚠️ [涉及的关键异常接口]');
      expect(html).toContain('/api/order/create');
      expect(html).toContain('500 Internal Server Error');
    });

    it('当传入 recordingDataUrl 或录屏文件名时，步骤 HTML 中生成录屏附件指引卡片且不生成易黑屏的 video 标签', () => {
      const bug = {
        title: '测试录屏附件指引',
        severity: 'Major' as const,
        reproductionSteps: ['1. 操作重现'],
        expectedResult: '正常',
        actualResult: '异常',
        recordingFileName: 'qa-recording-bug-123.webm',
      };
      const snapshot: any = {
        url: 'https://test.example.com',
        networkRequests: [],
      };

      const html = ZentaoClient.buildZentaoStepsHtml(bug, snapshot);

      expect(html).toContain('🎥 [问题现场录屏]');
      expect(html).toContain('qa-recording-bug-123.webm');
      expect(html).toContain('同步上传至本 Bug 附件');
      // 保证不产生容易被禅道过滤成死黑条的 video 标签
      expect(html).not.toContain('<video');
    });
  });

  describe('ZentaoFillExecutor 页面自动化填表执行器', () => {
    const originalChrome = (globalThis as any).chrome;
    const originalWindow = (globalThis as any).window;
    const originalDocument = (globalThis as any).document;

    beforeEach(() => {
      ZentaoFillExecutor.resetStateForTesting();
      // 模拟简单的 DOM 环境
      const elementsMap = new Map<string, any>();

      const mockDocument: any = {
        querySelector: vi.fn((sel: string) => elementsMap.get(sel) || null),
        querySelectorAll: vi.fn((sel: string) => {
          const found = elementsMap.get(sel);
          return found ? [found] : [];
        }),
        createElement: vi.fn((tag: string) => {
          const el: any = {
            tagName: tag.toUpperCase(),
            style: {},
            appendChild: vi.fn(),
            addEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            remove: vi.fn(),
            querySelector: vi.fn(() => ({
              addEventListener: vi.fn(),
            })),
          };
          return el;
        }),
        body: {
          appendChild: vi.fn(),
        },
        getElementById: vi.fn(() => null),
      };

      const mockWindow: any = {
        location: {
          href: 'https://zentao.example.com/bug-create-5.html',
        },
        top: null,
      };
      mockWindow.top = mockWindow;

      (globalThis as any).document = mockDocument;
      (globalThis as any).window = mockWindow;
      (globalThis as any).Event = class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };
    });

    afterEach(() => {
      (globalThis as any).chrome = originalChrome;
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
    });

    it('正确判断是否处于禅道提 Bug 页面 (根据 URL 与 DOM 特征)', () => {
      (globalThis as any).window.location.href = 'https://zentao.example.com/bug-create-5.html';
      expect(ZentaoFillExecutor.isZentaoCreateBugPage()).toBe(true);

      (globalThis as any).window.location.href = 'https://zentao.example.com/index.php?m=bug&f=create&productID=5';
      expect(ZentaoFillExecutor.isZentaoCreateBugPage()).toBe(true);

      (globalThis as any).window.location.href = 'https://zentao.example.com/my-work.html';
      expect(ZentaoFillExecutor.isZentaoCreateBugPage()).toBe(false);
    });

    it('自动消费 Storage 中的任务并填充表单各字段与步骤', async () => {
      const titleInput: any = { value: '', dispatchEvent: vi.fn() };
      const severitySelect: any = { value: '', dispatchEvent: vi.fn() };
      const priSelect: any = { value: '', dispatchEvent: vi.fn() };
      const assignedSelect: any = {
        value: '',
        options: [{ value: 'dev_leader', text: '研发组长 (dev_leader)' }],
        dispatchEvent: vi.fn(),
      };
      const stepsTextarea: any = { value: '', dispatchEvent: vi.fn() };

      const mockDoc = (globalThis as any).document;
      mockDoc.querySelector = vi.fn((sel: string) => {
        if (sel.includes('input#title')) return titleInput;
        if (sel.includes('select#severity')) return severitySelect;
        if (sel.includes('select#pri')) return priSelect;
        if (sel.includes('select#assignedTo')) return assignedSelect;
        if (sel.includes('textarea#steps')) return stepsTextarea;
        return null;
      });
      mockDoc.querySelectorAll = vi.fn((sel: string) => {
        if (sel.includes('textarea#steps')) return [stepsTextarea];
        return [];
      });

      const pendingData: ZentaoPendingFillData = {
        bugId: 'BUG-10086',
        title: '【自动填单测试】支付失败异常',
        severity: 2,
        pri: 1,
        assignedTo: 'dev_leader',
        openedBuild: 'trunk',
        stepsHtml: '<div>[步骤] 重现流程<ol><li>步骤A</li></ol></div>',
        screenshotUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        createdAt: Date.now(),
      };

      const removeMock = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ [ZENTAO_AUTOFILL_STORAGE_KEY]: pendingData }),
            remove: removeMock,
          },
        },
      };

      const executed = await ZentaoFillExecutor.checkAndExecute();
      expect(executed).toBe(true);

      // 验证已从 storage 消费任务
      expect(removeMock).toHaveBeenCalledWith(ZENTAO_AUTOFILL_STORAGE_KEY);

      // 验证表单各字段填充
      expect(titleInput.value).toBe('【自动填单测试】支付失败异常');
      expect(severitySelect.value).toBe('2');
      expect(priSelect.value).toBe('1');
      expect(assignedSelect.value).toBe('dev_leader');
      expect(stepsTextarea.value).toContain('[步骤] 重现流程');
    });

    it('支持通过 executeWithData 接收消息主动注入表单', async () => {
      const titleInput: any = { value: '', dispatchEvent: vi.fn() };
      const stepsTextarea: any = { value: '', dispatchEvent: vi.fn() };

      const mockDoc = (globalThis as any).document;
      mockDoc.querySelector = vi.fn((sel: string) => {
        if (sel.includes('input#title')) return titleInput;
        if (sel.includes('textarea#steps')) return stepsTextarea;
        return null;
      });
      mockDoc.querySelectorAll = vi.fn((sel: string) => {
        if (sel.includes('textarea#steps')) return [stepsTextarea];
        return [];
      });

      const pushData: ZentaoPendingFillData = {
        bugId: 'BUG-888',
        title: '【主动推送测试】库存同步延迟',
        severity: 3,
        pri: 2,
        openedBuild: 'trunk',
        stepsHtml: '<div>主动推送排版步骤</div>',
        createdAt: Date.now(),
      };

      const result = await ZentaoFillExecutor.executeWithData(pushData);
      expect(result).toBe(true);
      expect(titleInput.value).toBe('【主动推送测试】库存同步延迟');
      expect(stepsTextarea.value).toBe('<div>主动推送排版步骤</div>');
    });

    it('正确识别禅道 Bug 详情页与提取 Bug ID (方案 A)', () => {
      (globalThis as any).window.location.href = 'https://zentao.example.com/bug-view-2048.html';
      expect(ZentaoFillExecutor.isZentaoBugViewPage()).toBe(true);
      expect(ZentaoFillExecutor.getBugIdFromViewPage()).toBe(2048);

      (globalThis as any).window.location.href = 'https://zentao.example.com/index.php?m=bug&f=view&bugID=9527';
      expect(ZentaoFillExecutor.isZentaoBugViewPage()).toBe(true);
      expect(ZentaoFillExecutor.getBugIdFromViewPage()).toBe(9527);

      (globalThis as any).window.location.href = 'https://zentao.example.com/bug/view/1001';
      expect(ZentaoFillExecutor.isZentaoBugViewPage()).toBe(true);
      expect(ZentaoFillExecutor.getBugIdFromViewPage()).toBe(1001);

      (globalThis as any).window.location.href = 'https://zentao.example.com/bug-create-5.html';
      expect(ZentaoFillExecutor.isZentaoBugViewPage()).toBe(false);
    });

    it('方案 A：在 Bug 详情页自动检测并触发同源附件上传 (checkAndAttachOnBugViewPage)', async () => {
      (globalThis as any).window.location.href = 'https://zentao.example.com/bug-view-666.html';

      const pendingAttachment: ZentaoPendingAttachment = {
        bugId: 666,
        snapshotId: 'SNAP-1234',
        screenshotUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        fileName: 'qa-screenshot-bug-666.png',
        createdAt: Date.now(),
      };

      const removeMock = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ [ZENTAO_PENDING_ATTACHMENT_KEY]: pendingAttachment }),
            remove: removeMock,
          },
        },
      };

      // 模拟全局 fetch 为同源上传成功
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"result":"success","id":108}'),
      });
      (globalThis as any).fetch = fetchMock;

      const attached = await ZentaoFillExecutor.checkAndExecute();
      expect(attached).toBe(true);

      // 验证已尝试通过同源接口上传并包含对应 bug ID
      expect(fetchMock).toHaveBeenCalled();
      const firstCallUrl = fetchMock.mock.calls[0][0];
      expect(firstCallUrl).toContain('666');

      // 验证已从 storage 消费任务
      expect(removeMock).toHaveBeenCalledWith(ZENTAO_PENDING_ATTACHMENT_KEY);

      // 验证页面挂载了成功横幅
      const mockDoc = (globalThis as any).document;
      expect(mockDoc.body.appendChild).toHaveBeenCalled();
    });

    it('方案 A：当 storage 中的 bugId 为字符串时也能正确宽松匹配并触发', async () => {
      ZentaoFillExecutor.resetStateForTesting();
      (globalThis as any).window.location.href = 'https://zentao.example.com/bug-view-8888.html';

      const pendingAttachment: any = {
        bugId: '8888', // 字符串形式
        snapshotId: 'SNAP-8888',
        screenshotUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        fileName: 'qa-screenshot-bug-8888.png',
        createdAt: Date.now(),
      };

      const removeMock = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ [ZENTAO_PENDING_ATTACHMENT_KEY]: pendingAttachment }),
            remove: removeMock,
          },
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"result":"success"}'),
      });
      (globalThis as any).fetch = fetchMock;

      const attached = await ZentaoFillExecutor.checkAndExecute();
      expect(attached).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][0]).toContain('8888');
    });
  });
});
