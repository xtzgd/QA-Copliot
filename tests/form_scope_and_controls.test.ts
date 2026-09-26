import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormDOMRegistry, FormScanner } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { AIProvider } from '../src/ai';

class MockDOMElement {
  id: string = '';
  name: string = '';
  tagName: string;
  className: string = '';
  type: string = 'text';
  value: string = '';
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  required: boolean = false;
  placeholder: string = '';
  options: any[] = [];
  selectedOptions: any[] = [];
  parentElement: MockDOMElement | null = null;
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  textContent: string = '';
  attributes: Record<string, string> = {};
  style: any = { display: 'block', visibility: 'visible' };
  offsetParent: any = {};

  constructor(tag: string, id: string = '', className: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  getAttribute(attr: string): string | null {
    if (attr in this.attributes) return this.attributes[attr];
    if (attr === 'name') return this.name || null;
    if (attr === 'id') return this.id || null;
    if (attr === 'placeholder') return this.placeholder || null;
    if (attr === 'class') return this.className || null;
    return null;
  }

  hasAttribute(attr: string): boolean {
    if (attr in this.attributes) return true;
    if (attr === 'disabled') return this.disabled;
    if (attr === 'readonly') return this.readOnly;
    if (attr === 'required') return this.required;
    return false;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  getClientRects() {
    return [{ width: 100, height: 30 }];
  }

  appendChild(child: MockDOMElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  closest(selector: string): MockDOMElement | null {
    let cur: MockDOMElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    const classList = this.className.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (part.startsWith('.') && classList.includes(part.slice(1))) return true;
      if (part.startsWith('#') && this.id === part.slice(1)) return true;
      if (part.toLowerCase() === this.tagName.toLowerCase()) return true;
      if (part.includes('[role=') && this.attributes['role'] && part.includes(this.attributes['role'])) return true;
    }
    return false;
  }

  querySelector(selector: string): MockDOMElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  click() {
    if (this.type === 'radio') {
      this.checked = true;
    }
  }

  dispatchEvent() {
    return true;
  }
}

describe('智能填表范围锁定与复杂控件支持 (tests/form_scope_and_controls.test.ts)', () => {
  beforeEach(() => {
    FormDOMRegistry.clearAll();
  });

  it('1. 顶层弹窗锁定：页面存在可见弹窗时，只识别弹窗内的表单与字段，过滤背景无关表单', () => {
    const doc = new MockDOMElement('body', 'body');

    // 背景表单（应被过滤）
    const bgForm = new MockDOMElement('form', 'bg-search-form');
    const bgInput = new MockDOMElement('input', 'bg-search-key');
    bgInput.name = 'searchKey';
    bgInput.placeholder = '请输入搜索关键字';
    bgForm.appendChild(bgInput);
    doc.appendChild(bgForm);

    // 顶层弹窗（应被独占锁定）
    const overlay = new MockDOMElement('div', '', 'el-overlay');
    const dialog = new MockDOMElement('div', 'user-add-dialog', 'el-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const titleEl = new MockDOMElement('span', '', 'el-dialog__title');
    titleEl.textContent = '新增客户资料';
    dialog.appendChild(titleEl);

    // 弹窗内的字段
    const nameItem = new MockDOMElement('div', '', 'el-form-item');
    const nameLabel = new MockDOMElement('label', '', 'el-form-item__label');
    nameLabel.textContent = '客户名称';
    const nameInput = new MockDOMElement('input', 'custName');
    nameInput.placeholder = '请输入公司名称';
    nameItem.appendChild(nameLabel);
    nameItem.appendChild(nameInput);
    dialog.appendChild(nameItem);

    overlay.appendChild(dialog);
    doc.appendChild(overlay);

    const snapshot = FormScanner.scan(doc as any);

    // 验证：识别到的表单仅为顶层弹窗“新增客户资料”，背景的 bg-search-form 被彻底屏蔽
    expect(snapshot.forms.length).toBe(1);
    expect(snapshot.forms[0].title).toBe('新增客户资料');
    expect(snapshot.fields.length).toBe(1);
    expect(snapshot.fields[0].label).toBe('客户名称');
    expect(snapshot.fields.some((f) => f.name === 'searchKey')).toBe(false);
  });

  it('2. 组件库下拉框识别：Element Plus 下拉框正确识别为 select，豁免只读，且判空准确', () => {
    const doc = new MockDOMElement('body', 'body');
    const formItem = new MockDOMElement('div', '', 'el-form-item');
    const label = new MockDOMElement('label', '', 'el-form-item__label');
    label.textContent = '所属行业';
    formItem.appendChild(label);

    const selectDiv = new MockDOMElement('div', '', 'el-select');
    const selectWrapper = new MockDOMElement('div', '', 'el-select__wrapper');
    const innerInput = new MockDOMElement('input', 'industryInput', 'el-input__inner');
    innerInput.readOnly = true; // Element Plus 内部原生 input 带有 readonly
    innerInput.placeholder = '请选择行业';
    innerInput.value = '';

    selectWrapper.appendChild(innerInput);
    selectDiv.appendChild(selectWrapper);
    formItem.appendChild(selectDiv);
    doc.appendChild(formItem);

    const snapshot = FormScanner.scan(doc as any);

    expect(snapshot.fields.length).toBe(1);
    const field = snapshot.fields[0];
    expect(field.label).toBe('所属行业');
    expect(field.kind).toBe('select');
    // 关键验证：只读被豁免，可正常填选
    expect(field.readOnly).toBe(false);
    expect(field.isEmpty).toBe(true);
  });

  it('3. 单选框聚合：同一表单项下的多个 Radio 聚合成单个单选字段，options 包含所有选项', () => {
    const doc = new MockDOMElement('body', 'body');
    const formItem = new MockDOMElement('div', '', 'el-form-item');
    const label = new MockDOMElement('label', '', 'el-form-item__label');
    label.textContent = '开票类型';
    formItem.appendChild(label);

    const radioGroup = new MockDOMElement('div', '', 'el-radio-group');

    // 选项 1: 普票
    const radio1Label = new MockDOMElement('label', '', 'el-radio');
    const radio1 = new MockDOMElement('input', 'r1', 'el-radio__original');
    radio1.type = 'radio';
    radio1.name = 'invoiceType';
    radio1.value = 'normal';
    const text1 = new MockDOMElement('span', '', 'el-radio__label');
    text1.textContent = '增值税普通发票';
    radio1Label.appendChild(radio1);
    radio1Label.appendChild(text1);

    // 选项 2: 专票 (默认选中)
    const radio2Label = new MockDOMElement('label', '', 'el-radio');
    const radio2 = new MockDOMElement('input', 'r2', 'el-radio__original');
    radio2.type = 'radio';
    radio2.name = 'invoiceType';
    radio2.value = 'special';
    radio2.checked = true;
    const text2 = new MockDOMElement('span', '', 'el-radio__label');
    text2.textContent = '增值税专用发票';
    radio2Label.appendChild(radio2);
    radio2Label.appendChild(text2);

    radioGroup.appendChild(radio1Label);
    radioGroup.appendChild(radio2Label);
    formItem.appendChild(radioGroup);
    doc.appendChild(formItem);

    const snapshot = FormScanner.scan(doc as any);

    // 验证：两个 radio 聚合成了一个主字段
    expect(snapshot.fields.length).toBe(1);
    const field = snapshot.fields[0];
    expect(field.label).toBe('开票类型');
    expect(field.kind).toBe('radio');
    expect(field.options?.length).toBe(2);
    expect(field.options?.[0].label).toBe('增值税普通发票');
    expect(field.options?.[1].label).toBe('增值税专用发票');
    expect(field.currentValue).toBe('增值税专用发票');
    expect(field.isEmpty).toBe(false);
  });

  it('4. 全链路填表方案生成：AI 正确识别用户自然语言对下拉框与 Radio 组的指示并生成 Assignment', async () => {
    const radioField = {
      fieldId: 'f_radio',
      formId: 'form_1',
      tag: 'input',
      kind: 'radio' as const,
      name: 'gender',
      label: '性别',
      currentValue: '男',
      isEmpty: false,
      required: true,
      disabled: false,
      readOnly: false,
      isVisible: true,
      options: [
        { optionId: 'opt_male', label: '男', value: '1' },
        { optionId: 'opt_female', label: '女', value: '2' },
      ],
    };

    const selectField = {
      fieldId: 'f_select',
      formId: 'form_1',
      tag: 'input',
      kind: 'select' as const,
      name: 'industry',
      label: '所属行业',
      currentValue: '',
      isEmpty: true,
      required: true,
      disabled: false,
      readOnly: false,
      isVisible: true,
      optionsState: 'unloaded' as const,
      options: [],
    };

    const plan = AIProvider.planFormFill({
      snapshotId: 'snap_1',
      instruction: '性别选择女，行业选择软件服务',
      mode: 'allow_overwrite',
      fields: [radioField, selectField],
    });

    expect(plan.assignments.length).toBe(2);
    const radioAssignment = plan.assignments.find((a) => a.fieldId === 'f_radio');
    expect(radioAssignment).toBeDefined();
    expect(radioAssignment?.action).toBe('select');
    expect(radioAssignment?.value).toBe('女');

    const selectAssignment = plan.assignments.find((a) => a.fieldId === 'f_select');
    expect(selectAssignment).toBeDefined();
    expect(selectAssignment?.action).toBe('select');
    expect(selectAssignment?.value).toBe('软件服务');
  });
});
