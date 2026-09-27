import { describe, it, expect } from 'vitest';
import { LocatorGenerator } from '../src/shared/tools/locatorGenerator';

describe('Locator 生成器', () => {
  it('优先生成基于角色与文本的 Playwright Locator', () => {
    const btn = LocatorGenerator.generate({
      tag: 'button',
      text: '提交订单',
      id: 'submit-order',
    });

    expect(btn.strategy).toBe('role');
    expect(btn.recommended).toBe('page.getByRole("button", { name: "提交订单" })');
  });

  it('含有 testId 时优先推荐 getByTestId', () => {
    const field = LocatorGenerator.generate({
      tag: 'input',
      testId: 'user-phone-input',
      text: '手机号',
    });

    expect(field.strategy).toBe('testid');
    expect(field.recommended).toBe('page.getByTestId("user-phone-input")');
  });

  it('优先使用表单 Label 并转义单引号', () => {
    const field = LocatorGenerator.generate({ tag: 'input', label: "客户's Name", id: 'customer' });
    expect(field.strategy).toBe('label');
    expect(field.recommended).toBe('page.getByLabel("客户\'s Name")');
  });

});
