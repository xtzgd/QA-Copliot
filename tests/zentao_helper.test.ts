import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeZentaoUrl, detectBrowserZentao } from '../src/shared/integrations/zentaoHelper';

describe('禅道辅助工具 zentaoHelper', () => {
  describe('normalizeZentaoUrl 地址规范化与防护', () => {
    it('标准 HTTPS 域名正确解析', () => {
      const res = normalizeZentaoUrl('https://zentao.hbisscm.com');
      expect(res.isValid).toBe(true);
      expect(res.baseUrl).toBe('https://zentao.hbisscm.com');
      expect(res.apiRoot).toBe('https://zentao.hbisscm.com/api.php/v2');
      expect(res.apiVersion).toBe('v2');
    });

    it('自动补全缺失的 https 协议头并去除末尾斜杠', () => {
      const res = normalizeZentaoUrl('zentao.hbisscm.com/');
      expect(res.isValid).toBe(true);
      expect(res.baseUrl).toBe('https://zentao.hbisscm.com');
      expect(res.apiRoot).toBe('https://zentao.hbisscm.com/api.php/v2');
    });

    it('智能剥离重复粘贴的 /api.php/v2 或 /api.php 并给出 warning', () => {
      const res1 = normalizeZentaoUrl('https://zentao.hbisscm.com/api.php/v2');
      expect(res1.isValid).toBe(true);
      expect(res1.baseUrl).toBe('https://zentao.hbisscm.com');
      expect(res1.apiRoot).toBe('https://zentao.hbisscm.com/api.php/v2');
      expect(res1.warning).toContain('/api.php/v2');

      const res2 = normalizeZentaoUrl('https://zentao.hbisscm.com/api.php');
      expect(res2.isValid).toBe(true);
      expect(res2.baseUrl).toBe('https://zentao.hbisscm.com');
      expect(res2.warning).toContain('/api.php');
    });

    it('正确保留部署子目录路径', () => {
      const res = normalizeZentaoUrl('https://mycompany.com/zentao/api.php/v2');
      expect(res.isValid).toBe(true);
      expect(res.baseUrl).toBe('https://mycompany.com/zentao');
      expect(res.apiRoot).toBe('https://mycompany.com/zentao/api.php/v2');
    });

    it('安全拦截嵌入在 URL 中的用户名密码凭据', () => {
      const res = normalizeZentaoUrl('https://admin:secret123@zentao.hbisscm.com');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('禁止包含账号密码');
    });

    it('非 localhost 的明文 HTTP 协议被拦截并要求 HTTPS', () => {
      const res = normalizeZentaoUrl('http://zentao.hbisscm.com');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('HTTPS');
    });

    it('本地开发环境的 HTTP 允许通过 (localhost 与 127.0.0.1)', () => {
      const res1 = normalizeZentaoUrl('http://localhost:8080');
      expect(res1.isValid).toBe(true);
      expect(res1.baseUrl).toBe('http://localhost:8080');

      const res2 = normalizeZentaoUrl('http://127.0.0.1:8888');
      expect(res2.isValid).toBe(true);
      expect(res2.baseUrl).toBe('http://127.0.0.1:8888');
    });
  });

  describe('detectBrowserZentao 浏览器会话与标签页探测', () => {
    const originalChrome = (globalThis as any).chrome;

    afterEach(() => {
      (globalThis as any).chrome = originalChrome;
    });

    it('在匹配到禅道标签页时通过 scripting 探针成功提取信息', async () => {
      (globalThis as any).chrome = {
        tabs: {
          query: vi.fn().mockResolvedValue([
            { id: 101, url: 'https://zentao.hbisscm.com/bug-browse-5.html', title: '禅道 Bug 列表' },
          ]),
        },
        scripting: {
          executeScript: vi.fn().mockResolvedValue([
            {
              result: {
                account: 'zhangguida',
                realname: '张贵达',
                currentProductId: 5,
                currentProductName: '核心供应链平台',
                currentBuild: 'trunk',
                token: 'mock-token-abc',
              },
            },
          ]),
        },
        cookies: {
          getAll: vi.fn().mockResolvedValue([{ name: 'zentaosid', value: 'sess-123456' }]),
        },
      };

      const result = await detectBrowserZentao('https://zentao.hbisscm.com');
      expect(result.found).toBe(true);
      expect(result.siteUrl).toBe('https://zentao.hbisscm.com');
      expect(result.account).toBe('zhangguida');
      expect(result.realname).toBe('张贵达');
      expect(result.currentProductId).toBe(5);
      expect(result.currentProductName).toBe('核心供应链平台');
      expect(result.currentBuild).toBe('trunk');
      expect(result.token).toBe('mock-token-abc');
      expect(result.cookieSessionId).toBe('sess-123456');
    });

    it('未找到禅道标签页时返回友好提示', async () => {
      (globalThis as any).chrome = {
        tabs: {
          query: vi.fn().mockResolvedValue([
            { id: 201, url: 'https://www.google.com', title: 'Google' },
          ]),
        },
        cookies: {
          getAll: vi.fn().mockResolvedValue([]),
        },
      };

      const result = await detectBrowserZentao('https://zentao.hbisscm.com');
      expect(result.found).toBe(false);
      expect(result.message).toContain('未在当前打开的标签页中发现禅道');
    });

    it('[P1 回归] 绝不误匹配含有搜索参数或跳转参数的外部网站 (如 ?next=禅道域名)', async () => {
      // 模拟外部网站如 https://attacker.com/?next=https://zentao.hbisscm.com
      (globalThis as any).chrome = {
        tabs: {
          query: vi.fn().mockResolvedValue([
            { id: 301, url: 'https://attacker.com/?next=https://zentao.hbisscm.com', title: '外部跳转页' },
            { id: 302, url: 'https://www.baidu.com/s?wd=zentao.hbisscm.com', title: '百度搜索' },
          ]),
        },
        cookies: {
          getAll: vi.fn().mockResolvedValue([]),
        },
      };

      // 1. 传入 presetUrl 验证：绝对不误匹配
      const resWithPreset = await detectBrowserZentao('https://zentao.hbisscm.com');
      expect(resWithPreset.found).toBe(false);

      // 2. 未传 presetUrl 验证：绝对不在 query 参数里匹配关键词
      const resNoPreset = await detectBrowserZentao();
      expect(resNoPreset.found).toBe(false);
    });

    it('[P1 回归] isSameZentaoSite 能够精准识别相同站点与不同部署站点', async () => {
      const { isSameZentaoSite } = await import('../src/shared/integrations/zentaoHelper');

      // 相同站点
      expect(isSameZentaoSite('https://zentao.hbisscm.com', 'https://zentao.hbisscm.com/')).toBe(true);
      expect(isSameZentaoSite('https://zentao.hbisscm.com/api.php/v2', 'https://zentao.hbisscm.com')).toBe(true);
      expect(isSameZentaoSite('https://zentao.hbisscm.com/bug-browse-1.html', 'https://zentao.hbisscm.com')).toBe(true);

      // 不同站点（即使域名类似或属于子路径）
      expect(isSameZentaoSite('https://zentao.hbisscm.com', 'https://zentao-test.hbisscm.com')).toBe(false);
      expect(isSameZentaoSite('https://corp.com/zentao1', 'https://corp.com/zentao2')).toBe(false);
      expect(isSameZentaoSite('https://corp.com/zentao', 'https://corp.com/jira')).toBe(false);
    });

    it('[P2 回归] normalizeZentaoUrl 识别 /api.php/v1 并正确设定 apiVersion: v1', () => {
      const res1 = normalizeZentaoUrl('https://zentao.hbisscm.com/api.php/v1');
      expect(res1.isValid).toBe(true);
      expect(res1.apiVersion).toBe('v1');
      expect(res1.apiRoot).toBe('https://zentao.hbisscm.com/api.php/v1');
      expect(res1.baseUrl).toBe('https://zentao.hbisscm.com');

      const res2 = normalizeZentaoUrl('https://zentao.hbisscm.com', 'v1');
      expect(res2.isValid).toBe(true);
      expect(res2.apiVersion).toBe('v1');
      expect(res2.apiRoot).toBe('https://zentao.hbisscm.com/api.php/v1');
    });
  });
});
