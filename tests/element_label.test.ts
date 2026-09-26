import { describe, expect, it } from 'vitest';
import { cleanLabelText, describeClickElement, findAssociatedInput, getElementLabel } from '../src/shared/tools/elementLabel';
import { PlaywrightSessionExporter } from '../src/shared/formatters/playwrightExport';

// 轻量 DOM 节点模拟器
class MockNode {
  tagName: string;
  id: string = '';
  className: string = '';
  type: string = 'text';
  value: string = '';
  placeholder: string = '';
  private _textContent?: string;
  private _innerText?: string;
  labels?: Array<{ textContent: string }>;
  parentElement: MockNode | null = null;
  children: MockNode[] = [];
  attributes: Record<string, string> = {};

  constructor(tagName: string, props: Partial<MockNode> = {}) {
    this.tagName = tagName.toUpperCase();
    Object.assign(this, props);
  }

  get textContent(): string {
    if (this._textContent !== undefined) return this._textContent;
    if (this.children.length > 0) {
      return this.children.map((c) => c.textContent).join('');
    }
    return '';
  }

  set textContent(v: string) {
    this._textContent = v;
  }

  get innerText(): string {
    if (this._innerText !== undefined) return this._innerText;
    return this.textContent;
  }

  set innerText(v: string) {
    this._innerText = v;
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    if (k in this.attributes) return this.attributes[k];
    if (k === 'id') return this.id || null;
    if (k === 'placeholder') return this.placeholder || null;
    return null;
  }

  appendChild(child: MockNode): MockNode {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get previousElementSibling(): MockNode | null {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  closest(selector: string): MockNode | null {
    let cur: MockNode | null = this;
    const targets = selector.split(',').map((s) => s.trim());
    while (cur) {
      for (const target of targets) {
        if (target.startsWith('.') && cur.className.split(/\s+/).includes(target.slice(1))) return cur;
        if (target === cur.tagName.toLowerCase()) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(selector: string): MockNode | null {
    const targets = selector.split(',').map((s) => s.trim());
    const queue: MockNode[] = [...this.children];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const target of targets) {
        if (target.startsWith('.') && node.className.split(/\s+/).includes(target.slice(1))) return node;
        if (target.startsWith('input') && node.tagName === 'INPUT') return node;
        if (target.startsWith('textarea') && node.tagName === 'TEXTAREA') return node;
        if (target.startsWith('select') && node.tagName === 'SELECT') return node;
        if (target === 'label' && node.tagName === 'LABEL') return node;
        if (target === node.tagName.toLowerCase()) return node;
      }
      queue.push(...node.children);
    }
    return null;
  }

  contains(other: MockNode): boolean {
    let cur: MockNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
}

describe('表单控件标签智能提取与点击描述 (elementLabel)', () => {
  it('cleanLabelText 清洗前后冒号、必填红星、标点与多余空格', () => {
    expect(cleanLabelText('* 手机号码： ')).toBe('手机号码');
    expect(cleanLabelText('  密码:  ')).toBe('密码');
    expect(cleanLabelText('· 验证码 - ')).toBe('验证码');
    expect(cleanLabelText('收货地址')).toBe('收货地址');
  });

  it('支持从原生 HTML labels 属性与包裹 label 中提取字段标签', () => {
    const inputWithLabels = new MockNode('input', {
      id: 'user-input',
      labels: [{ textContent: '用户账号' }],
    });
    expect(getElementLabel(inputWithLabels)).toBe('用户账号');

    const wrapLabel = new MockNode('label', { textContent: '记住登录状态' });
    const checkInput = new MockNode('input', { type: 'checkbox' });
    wrapLabel.appendChild(checkInput);
    expect(getElementLabel(checkInput)).toBe('记住登录状态');
  });

  it('点击 Element Plus 风格表单项包装层 div 时，自动识别关联输入框及字段 Label', () => {
    // 模拟 Element Plus 树结构
    const formItem = new MockNode('div', { className: 'el-form-item' });
    const labelEl = new MockNode('label', { className: 'el-form-item__label', textContent: '* 手机号码：' });
    const contentDiv = new MockNode('div', { className: 'el-form-item__content' });
    const elInputDiv = new MockNode('div', { className: 'el-input' });
    const wrapperDiv = new MockNode('div', { className: 'el-input__wrapper', id: 'wrapper-div' });
    const innerInput = new MockNode('input', { className: 'el-input__inner', placeholder: '请输入手机号' });

    formItem.appendChild(labelEl);
    formItem.appendChild(contentDiv);
    contentDiv.appendChild(elInputDiv);
    elInputDiv.appendChild(wrapperDiv);
    wrapperDiv.appendChild(innerInput);

    // 点击在 wrapperDiv 上
    const associated = findAssociatedInput(wrapperDiv);
    expect(associated).toBe(innerInput);

    const desc = describeClickElement(wrapperDiv);
    expect(desc.isInput).toBe(true);
    expect(desc.fieldLabel).toBe('手机号码');
    expect(desc.title).toBe('点击「手机号码」');
    expect(desc.description).toBe('点击「手机号码」输入框');
  });

  it('点击 Ant Design 风格表单项包装层时，识别外层 label', () => {
    const formItem = new MockNode('div', { className: 'ant-form-item' });
    const labelDiv = new MockNode('div', { className: 'ant-form-item-label' });
    const labelEl = new MockNode('label', { textContent: '收件人姓名' });
    const controlDiv = new MockNode('div', { className: 'ant-form-item-control' });
    const antWrapper = new MockNode('div', { className: 'ant-input-affix-wrapper' });
    const antInput = new MockNode('input', { className: 'ant-input', placeholder: '请输入姓名' });

    formItem.appendChild(labelDiv);
    labelDiv.appendChild(labelEl);
    formItem.appendChild(controlDiv);
    controlDiv.appendChild(antWrapper);
    antWrapper.appendChild(antInput);

    const desc = describeClickElement(antWrapper);
    expect(desc.fieldLabel).toBe('收件人姓名');
    expect(desc.description).toBe('点击「收件人姓名」输入框');
  });

  it('当无外部 label 时，自动使用 placeholder 提示作为字段标签', () => {
    const searchInput = new MockNode('input', { placeholder: '搜索你喜欢的商品...' });
    const desc = describeClickElement(searchInput);
    expect(desc.fieldLabel).toBe('搜索你喜欢的商品...');
    expect(desc.description).toBe('点击「搜索你喜欢的商品...」输入框');
  });

  it('支持紧邻前置 span / 表格同行前置 td 提取字段名', () => {
    const container = new MockNode('div');
    const spanLabel = new MockNode('span', { textContent: '支付密码：' });
    const pwdInput = new MockNode('input', { type: 'password' });
    container.appendChild(spanLabel);
    container.appendChild(pwdInput);

    const desc = describeClickElement(pwdInput);
    expect(desc.description).toBe('点击「支付密码」输入框');
  });

  it('普通按钮与超链接点击不受影响，保持原有行为', () => {
    const btn = new MockNode('button', { textContent: '立即结算' });
    const descBtn = describeClickElement(btn);
    expect(descBtn.isInput).toBe(false);
    expect(descBtn.title).toBe('点击 立即结算');
    expect(descBtn.description).toBe('点击「立即结算」');

    const link = new MockNode('a', { textContent: '帮助中心' });
    const descLink = describeClickElement(link);
    expect(descLink.isInput).toBe(false);
    expect(descLink.title).toBe('点击 帮助中心');
    expect(descLink.description).toBe('点击「帮助中心」');
  });

  it('Playwright 导出时包含 fieldLabel 的输入控件导出为 getByLabel 点击', () => {
    const source = PlaywrightSessionExporter.generate([
      {
        id: 'click-phone',
        sessionId: 'sess-1',
        type: 'click',
        timestamp: 100,
        title: '点击「手机号码」',
        description: '点击「手机号码」输入框',
        url: 'https://test.example.com',
        payload: {
          timestamp: 100,
          url: 'https://test.example.com',
          tag: 'INPUT',
          text: '手机号码',
          fieldLabel: '手机号码',
          isInput: true,
          selector: 'div.el-input__wrapper > input',
        },
      },
    ]);

    expect(source).toContain('page.getByLabel("手机号码").click()');
  });
});
