import { describe, expect, it } from 'vitest';
import { PlaywrightSessionExporter } from '../src/shared/formatters/playwrightExport';
import { QAEvent } from '../src/shared/types/event';

describe('Playwright Session 导出', () => {
  it('按时间生成导航、输入和语义点击脚本', () => {
    const base = { sessionId: 'sess', url: 'https://example.test', title: '', description: '' };
    const events: QAEvent[] = [
      { ...base, id: 'click', type: 'click', timestamp: 3, payload: { timestamp: 3, url: base.url, tag: 'BUTTON', text: '提交订单', role: 'button', selector: '#submit' } },
      { ...base, id: 'nav', type: 'navigation', timestamp: 1, payload: { timestamp: 1, url: base.url, fromUrl: '', toUrl: `${base.url}/order`, pageTitle: '订单', navigationType: 'initial' } },
      { ...base, id: 'input', type: 'input', timestamp: 2, payload: { timestamp: 2, url: base.url, tag: 'INPUT', fieldLabel: '数量', inputType: 'number', value: '99' } },
    ];
    const source = PlaywrightSessionExporter.generate(events, '创建订单');
    expect(source).toContain(`test("创建订单"`);
    expect(source).toContain(`await page.goto("https://example.test/order")`);
    expect(source).toContain(`page.getByLabel("数量").fill("99")`);
    expect(source).toContain(`page.getByRole("button", { name: "提交订单" }).click()`);
    expect(source.indexOf('goto')).toBeLessThan(source.indexOf('fill'));
  });

  it('把密码等原始输入值直接写入可执行步骤', () => {
    const source = PlaywrightSessionExporter.generate([{
      id: 'secret', sessionId: 'sess', type: 'input', timestamp: 1, title: '', description: '', url: 'https://example.test',
      payload: { timestamp: 1, url: 'https://example.test', tag: 'INPUT', fieldName: 'password', inputType: 'password', value: 'raw-secret' },
    }]);
    expect(source).toContain('page.locator("[name=\\"password\\"]").fill("raw-secret")');
  });

  it('导出下拉列表滚动步骤', () => {
    const source = PlaywrightSessionExporter.generate([{
      id: 'evt-scroll', sessionId: 'sess', type: 'scroll', timestamp: 1,
      title: '滚动列表', description: '列表滚动到 420', url: 'https://example.test',
      payload: {
        timestamp: 1, url: 'https://example.test', target: 'element',
        selector: '[role="listbox"]', scrollTop: 420, scrollLeft: 0,
      },
    }]);
    expect(source).toContain('page.locator("[role=\\"listbox\\"]").evaluate((element) => element.scrollTo(0, 420))');
  });
});
