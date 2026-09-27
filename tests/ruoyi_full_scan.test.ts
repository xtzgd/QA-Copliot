import { describe, it, expect, beforeEach } from 'vitest';
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

  contains(other: MockDOMElement): boolean {
    let cur: MockDOMElement | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    const classList = this.className.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const cleanPart = part.replace(/:not\([^)]*\)/g, '').trim();
      if (cleanPart.startsWith('.') && classList.includes(cleanPart.slice(1))) return true;
      if (cleanPart.startsWith('#') && this.id === cleanPart.slice(1)) return true;
      if (cleanPart.toLowerCase() === this.tagName.toLowerCase()) return true;
      if (cleanPart.includes('[role=') && this.attributes['role'] && cleanPart.includes(this.attributes['role'])) return true;
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

describe('RuoYi Scan Reproduction Test', () => {
  beforeEach(() => {
    FormDOMRegistry.clearAll();
  });

  it('scans all fields in RuoYi Add User modal', () => {
    const doc = new MockDOMElement('body', 'body');
    const dialog = new MockDOMElement('div', 'user-dialog', 'el-dialog');
    const title = new MockDOMElement('span', '', 'el-dialog__title');
    title.textContent = '添加用户';
    dialog.appendChild(title);

    const form = new MockDOMElement('form', 'userForm', 'el-form');

    // 1. 用户昵称
    const row1 = new MockDOMElement('div', '', 'el-row');
    const col1 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item1 = new MockDOMElement('div', '', 'el-form-item is-required');
    const label1 = new MockDOMElement('label', '', 'el-form-item__label');
    label1.textContent = '* 用户昵称';
    const inputWrapper1 = new MockDOMElement('div', '', 'el-input');
    const input1 = new MockDOMElement('input', 'nickName', 'el-input__inner');
    input1.placeholder = '请输入用户昵称';
    inputWrapper1.appendChild(input1);
    item1.appendChild(label1);
    item1.appendChild(inputWrapper1);
    col1.appendChild(item1);
    row1.appendChild(col1);

    // 2. 归属部门 (vue-treeselect)
    const col2 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item2 = new MockDOMElement('div', '', 'el-form-item');
    const label2 = new MockDOMElement('label', '', 'el-form-item__label');
    label2.textContent = '归属部门';
    const treeSelect = new MockDOMElement('div', '', 'vue-treeselect');
    const treeControl = new MockDOMElement('div', '', 'vue-treeselect__control');
    const treePh = new MockDOMElement('div', '', 'vue-treeselect__placeholder');
    treePh.textContent = '请选择归属部门';
    const treeInputContainer = new MockDOMElement('div', '', 'vue-treeselect__input-container');
    const treeInput = new MockDOMElement('input', '', 'vue-treeselect__input');
    treeInput.placeholder = '';
    treeInputContainer.appendChild(treeInput);
    treeControl.appendChild(treePh);
    treeControl.appendChild(treeInputContainer);
    treeSelect.appendChild(treeControl);
    item2.appendChild(label2);
    item2.appendChild(treeSelect);
    col2.appendChild(item2);
    row1.appendChild(col2);
    form.appendChild(row1);

    // 3. 手机号码 & 邮箱
    const row2 = new MockDOMElement('div', '', 'el-row');
    const col3 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item3 = new MockDOMElement('div', '', 'el-form-item');
    const label3 = new MockDOMElement('label', '', 'el-form-item__label');
    label3.textContent = '手机号码';
    const input3 = new MockDOMElement('input', 'phonenumber', 'el-input__inner');
    input3.placeholder = '请输入手机号码';
    item3.appendChild(label3);
    item3.appendChild(input3);
    col3.appendChild(item3);
    row2.appendChild(col3);

    const col4 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item4 = new MockDOMElement('div', '', 'el-form-item');
    const label4 = new MockDOMElement('label', '', 'el-form-item__label');
    label4.textContent = '邮箱';
    const input4 = new MockDOMElement('input', 'email', 'el-input__inner');
    input4.placeholder = '请输入邮箱';
    item4.appendChild(label4);
    item4.appendChild(input4);
    col4.appendChild(item4);
    row2.appendChild(col4);
    form.appendChild(row2);

    // 4. 用户性别 & 状态
    const row3 = new MockDOMElement('div', '', 'el-row');
    const col5 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item5 = new MockDOMElement('div', '', 'el-form-item');
    const label5 = new MockDOMElement('label', '', 'el-form-item__label');
    label5.textContent = '用户性别';
    const select5 = new MockDOMElement('div', '', 'el-select');
    const input5 = new MockDOMElement('input', '', 'el-input__inner');
    input5.readOnly = true;
    input5.placeholder = '请选择性别';
    select5.appendChild(input5);
    item5.appendChild(label5);
    item5.appendChild(select5);
    col5.appendChild(item5);
    row3.appendChild(col5);

    const col6 = new MockDOMElement('div', '', 'el-col el-col-12');
    const item6 = new MockDOMElement('div', '', 'el-form-item');
    const label6 = new MockDOMElement('label', '', 'el-form-item__label');
    label6.textContent = '状态';
    const radioGroup = new MockDOMElement('div', '', 'el-radio-group');
    const r1Label = new MockDOMElement('label', '', 'el-radio is-checked');
    const r1 = new MockDOMElement('input', 'status_0', 'el-radio__original');
    r1.type = 'radio';
    r1.name = 'status';
    r1.value = '0';
    r1.checked = true;
    const r1Text = new MockDOMElement('span', '', 'el-radio__label');
    r1Text.textContent = '正常';
    r1Label.appendChild(r1);
    r1Label.appendChild(r1Text);

    const r2Label = new MockDOMElement('label', '', 'el-radio');
    const r2 = new MockDOMElement('input', 'status_1', 'el-radio__original');
    r2.type = 'radio';
    r2.name = 'status';
    r2.value = '1';
    const r2Text = new MockDOMElement('span', '', 'el-radio__label');
    r2Text.textContent = '停用';
    r2Label.appendChild(r2);
    r2Label.appendChild(r2Text);

    radioGroup.appendChild(r1Label);
    radioGroup.appendChild(r2Label);
    item6.appendChild(label6);
    item6.appendChild(radioGroup);
    col6.appendChild(item6);
    row3.appendChild(col6);
    form.appendChild(row3);

    // 5. 备注 (textarea)
    const row4 = new MockDOMElement('div', '', 'el-row');
    const col7 = new MockDOMElement('div', '', 'el-col el-col-24');
    const item7 = new MockDOMElement('div', '', 'el-form-item');
    const label7 = new MockDOMElement('label', '', 'el-form-item__label');
    label7.textContent = '备注';
    const textarea = new MockDOMElement('textarea', 'remark', 'el-textarea__inner');
    textarea.placeholder = '请输入内容';
    item7.appendChild(label7);
    item7.appendChild(textarea);
    col7.appendChild(item7);
    row4.appendChild(col7);
    form.appendChild(row4);

    dialog.appendChild(form);
    doc.appendChild(dialog);

    const snapshot = FormScanner.scan(doc as any);
    expect(snapshot.fields.length).toBe(7);

    const nickField = snapshot.fields[0];
    expect(nickField.label).toBe('用户昵称');
    expect(nickField.kind).toBe('text');
    expect(nickField.isEmpty).toBe(true);

    const deptField = snapshot.fields[1];
    expect(deptField.label).toBe('归属部门');
    expect(deptField.kind).toBe('select');
    expect(deptField.isEmpty).toBe(true);

    const genderField = snapshot.fields[4];
    expect(genderField.label).toBe('用户性别');
    expect(genderField.kind).toBe('select');
    // 关键回归：绝对不能因为下拉菜单隐藏的“男/女/未知”节点导致 currentValue 误读为“男女未知”
    expect(genderField.currentValue).toBe('');
    expect(genderField.isEmpty).toBe(true);

    const remarkField = snapshot.fields[5];
    // 关键回归：备注必须正确识别为“备注”，不能因为 placeholder="请输入内容" 降级退化成“内容”
    expect(remarkField.label).toBe('备注');
    expect(remarkField.kind).toBe('textarea');
    expect(remarkField.isEmpty).toBe(true);

    const statusField = snapshot.fields[6];
    // 关键回归：单选组必须识别表单项标题“状态”，绝对不能取选项“正常”
    expect(statusField.label).toBe('状态');
    expect(statusField.kind).toBe('radio');
    expect(statusField.currentValue).toBe('正常');
  });

  it('Midscene 空间几何就近原则验证：无原生 label 标签与组件库 class 的 Flex 布局下，根据物理渲染坐标精准定位', () => {
    // 模拟纯 flex 布局的无 class 表单：
    // [DIV: 经办人姓名] (left: 20, top: 100, right: 90, bottom: 132)  -->  [INPUT] (left: 100, top: 100, right: 280, bottom: 132)
    const labelDiv = new MockDOMElement('div', '', 'custom-text');
    labelDiv.textContent = '* 经办人姓名：';
    labelDiv.getBoundingClientRect = () => ({
      left: 20,
      top: 100,
      right: 90,
      bottom: 132,
      width: 70,
      height: 32,
    } as any);

    const inputEl = new MockDOMElement('input', 'custom_input_1', '');
    inputEl.placeholder = '请输入';
    inputEl.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      right: 280,
      bottom: 132,
      width: 180,
      height: 32,
    } as any);

    const container = new MockDOMElement('div', 'row_1', 'flex-row');
    container.appendChild(labelDiv);
    container.appendChild(inputEl);

    // 运行视觉空间识别
    const detected = FormScanner.getFieldLabel(inputEl as any, inputEl as any);
    expect(detected).toBe('经办人姓名');
  });

  it('多下拉框浮层隔离与防串扰：归属部门不应匹配页面其他下拉框（如性别男女未知）的选项，且执行填充互不干扰', async () => {
    const doc = new MockDOMElement('body', 'body');

    // 1. 归属部门 (vue-treeselect, 屏幕坐标 y=200)
    const deptFormItem = new MockDOMElement('div', '', 'el-form-item');
    const deptLabel = new MockDOMElement('label', '', 'el-form-item__label');
    deptLabel.textContent = '归属部门';
    deptFormItem.appendChild(deptLabel);

    const deptWrapper = new MockDOMElement('div', 'dept_select', 'vue-treeselect');
    deptWrapper.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      right: 280,
      bottom: 232,
      width: 180,
      height: 32,
    } as any);

    const deptControl = new MockDOMElement('div', '', 'vue-treeselect__control');
    const deptInput = new MockDOMElement('input', 'dept_input', 'vue-treeselect__input');
    deptInput.placeholder = '请选择归属部门';
    deptControl.appendChild(deptInput);
    deptWrapper.appendChild(deptControl);

    // 内部树形菜单，包含部门选项
    const deptMenu = new MockDOMElement('div', '', 'vue-treeselect__menu');
    const optDept1 = new MockDOMElement('div', 'opt_dept_1', 'vue-treeselect__option');
    optDept1.textContent = '科技 (2)';
    const optDept2 = new MockDOMElement('div', 'opt_dept_2', 'vue-treeselect__option');
    optDept2.textContent = '深圳总公司 (5)';
    const optDept3 = new MockDOMElement('div', 'opt_dept_3', 'vue-treeselect__option');
    optDept3.textContent = '长沙分公司 (2)';
    deptMenu.appendChild(optDept1);
    optDept2.click = () => {
      const selected = new MockDOMElement('span', '', 'vue-treeselect__single-value');
      selected.textContent = '深圳总公司 (5)';
      deptWrapper.appendChild(selected);
    };
    deptMenu.appendChild(optDept2);
    deptMenu.appendChild(optDept3);
    deptWrapper.appendChild(deptMenu);
    deptFormItem.appendChild(deptWrapper);
    doc.appendChild(deptFormItem);

    // 2. 用户性别 (el-select, 屏幕坐标 y=400)
    const genderFormItem = new MockDOMElement('div', '', 'el-form-item');
    const genderLabel = new MockDOMElement('label', '', 'el-form-item__label');
    genderLabel.textContent = '用户性别';
    genderFormItem.appendChild(genderLabel);

    const genderWrapper = new MockDOMElement('div', 'gender_select', 'el-select');
    genderWrapper.getBoundingClientRect = () => ({
      left: 100,
      top: 400,
      right: 280,
      bottom: 432,
      width: 180,
      height: 32,
    } as any);
    const genderInput = new MockDOMElement('input', 'gender_input', 'el-input__inner');
    genderInput.readOnly = true;
    genderInput.placeholder = '请选择性别';
    genderWrapper.appendChild(genderInput);
    genderFormItem.appendChild(genderWrapper);
    doc.appendChild(genderFormItem);

    // 挂载到 body 上的用户性别下拉浮层（紧贴用户性别，屏幕坐标 y=432）
    const genderDropdown = new MockDOMElement('div', 'gender_popper', 'el-select-dropdown');
    genderDropdown.getBoundingClientRect = () => ({
      left: 100,
      top: 432,
      right: 280,
      bottom: 532,
      width: 180,
      height: 100,
    } as any);

    let selectedGender = '';
    const optMale = new MockDOMElement('li', 'opt_male', 'el-select-dropdown__item');
    optMale.textContent = '男';
    optMale.click = () => { selectedGender = '男'; genderInput.value = '男'; };
    optMale.dispatchEvent = (e: any) => { if (e.type === 'click') selectedGender = '男'; return true; };
    const optFemale = new MockDOMElement('li', 'opt_female', 'el-select-dropdown__item');
    optFemale.textContent = '女';
    const optUnknown = new MockDOMElement('li', 'opt_unknown', 'el-select-dropdown__item');
    optUnknown.textContent = '未知';
    optUnknown.click = () => { selectedGender = '未知'; };
    optUnknown.dispatchEvent = (e: any) => { if (e.type === 'click') selectedGender = '未知'; return true; };
    genderDropdown.appendChild(optMale);
    genderDropdown.appendChild(optFemale);
    genderDropdown.appendChild(optUnknown);
    doc.appendChild(genderDropdown);

    // 验证 1：归属部门提取的选项绝不能串扰到性别的“男、女、未知”，而必须是部门列表
    const deptOpts = FormScanner.extractDropdownOptionsFromDom(deptInput as any, deptWrapper as any, doc as any);
    const deptLabels = deptOpts.map((o) => o.label);
    expect(deptLabels).toContain('科技');
    expect(deptLabels).toContain('深圳总公司');
    expect(deptLabels).toContain('长沙分公司');
    expect(deptLabels).not.toContain('未知');
    expect(deptLabels).not.toContain('男');

    // 验证 2：用户性别提取的选项必须精准匹配自身挂载浮层的项
    const genderOpts = FormScanner.extractDropdownOptionsFromDom(genderInput as any, genderWrapper as any, doc as any);
    const genderLabels = genderOpts.map((o) => o.label);
    expect(genderLabels).toEqual(['男', '女', '未知']);

    // 验证 3：AI / 规则生成计划中，归属部门与性别绝不能被规划为“未知”
    const plan = AIProvider.planFormFill({
      snapshotId: 'snap_ruoyi_test',
      instruction: '生成合理合规测试数据',
      mode: 'empty_only',
      fields: [
        {
          fieldId: 'f_dept',
          formId: 'form_1',
          tag: 'input',
          kind: 'select',
          label: '归属部门',
          currentValue: '',
          isEmpty: true,
          required: true,
          disabled: false,
          readOnly: false,
          isVisible: true,
          options: deptOpts,
        },
        {
          fieldId: 'f_gender',
          formId: 'form_1',
          tag: 'input',
          kind: 'select',
          label: '用户性别',
          currentValue: '',
          isEmpty: true,
          required: false,
          disabled: false,
          readOnly: false,
          isVisible: true,
          options: genderOpts,
        },
      ],
    });

    const deptAssign = plan.assignments.find((a) => a.fieldId === 'f_dept');
    const genderAssign = plan.assignments.find((a) => a.fieldId === 'f_gender');
    expect(deptAssign?.value).not.toBe('未知');
    expect(deptAssign?.value).toBe('科技'); // 首个有效部门
    expect(genderAssign?.value).toBe('男'); // 优先选择具体性别，绝不选未知！

    // 验证 4：执行填充，确保点击选中不发生串扰
    FormDOMRegistry.register('f_dept', deptWrapper as any, 'snap_ruoyi_test');
    FormDOMRegistry.register('f_gender', genderWrapper as any, 'snap_ruoyi_test');

    const execRes = await FormExecutor.executePlan(
      'snap_ruoyi_test',
      [
        { fieldId: 'f_dept', action: 'select', value: '深圳总公司' },
        { fieldId: 'f_gender', action: 'select', value: '男' },
      ],
      'empty_only'
    );

    expect(execRes.status).toBe('completed');
    expect(selectedGender).toBe('男'); // 性别成功被选为“男”，绝不会被错误篡改为“未知”！
  });

  it('模态弹窗保护机制：点击表单识别时模态框内的下拉框绝不派发 Escape 键盘事件，防止 el-dialog 弹窗意外关闭消失', async () => {
    const doc = new MockDOMElement('HTML');
    const body = new MockDOMElement('BODY');
    doc.appendChild(body);

    const dialog = new MockDOMElement('DIV', 'user_dialog', 'el-dialog is-fullscreen');
    body.appendChild(dialog);

    let escapeDispatched = false;
    let clickDispatchedCount = 0;

    const selectWrapper = new MockDOMElement('DIV', 'dept_wrapper', 'vue-treeselect');
    // 模拟挂载 Vue 实例
    (selectWrapper as any).__vue__ = {
      forest: {
        nodeList: [
          { id: 100, label: '若依科技 (10)' },
          { id: 101, label: '研发部门 (5)' },
        ],
      },
    };

    const input = new MockDOMElement('INPUT', 'dept_input', 'vue-treeselect__input');
    (input as any).dispatchEvent = (evt: any) => {
      if (evt?.key === 'Escape' || evt?.keyCode === 27) {
        escapeDispatched = true;
      }
      if (evt?.type === 'click') {
        clickDispatchedCount++;
      }
      return true;
    };
    (selectWrapper as any).dispatchEvent = (evt: any) => {
      if (evt?.key === 'Escape' || evt?.keyCode === 27) {
        escapeDispatched = true;
      }
      if (evt?.type === 'click') {
        clickDispatchedCount++;
      }
      return true;
    };

    selectWrapper.appendChild(input);
    dialog.appendChild(selectWrapper);

    // 验证 1: 从 Vue 实例直接提取，无须点击
    const extracted = FormScanner.extractDropdownOptionsFromDom(input as any, selectWrapper as any, doc as any);
    expect(extracted.map((o) => o.label)).toEqual(['若依科技', '研发部门']);

    // 验证 2: scanWithProbe 在模态框内部绝对不乱点，绝不派发 Escape
    await FormScanner.scanWithProbe(doc as any);
    expect(escapeDispatched).toBe(false);
    expect(clickDispatchedCount).toBe(0);
  });

  it('单选框聚合与标题防窜测试：当 radio 无 name 属性且选项包含“正常/停用”时，标题必须严格取“状态”，绝不误识别为“正常”', () => {
    const doc = new MockDOMElement('HTML');
    const body = new MockDOMElement('BODY');
    doc.appendChild(body);

    const dialog = new MockDOMElement('DIV', 'user_dialog', 'el-dialog is-fullscreen');
    body.appendChild(dialog);

    const formItem = new MockDOMElement('DIV', '', 'el-form-item');
    const label = new MockDOMElement('LABEL', '', 'el-form-item__label');
    label.textContent = '状态';
    formItem.appendChild(label);

    const radioGroup = new MockDOMElement('DIV', '', 'el-radio-group');
    const r1Label = new MockDOMElement('LABEL', '', 'el-radio is-checked');
    const r1Input = new MockDOMElement('INPUT', 'status_0', 'el-radio__original');
    r1Input.type = 'radio';
    r1Input.name = ''; // 无 name 属性（典型 Vue 模板场景）
    r1Input.value = '0';
    r1Input.checked = true;
    const r1Text = new MockDOMElement('SPAN', '', 'el-radio__label');
    r1Text.textContent = '正常';
    r1Label.appendChild(r1Input);
    r1Label.appendChild(r1Text);

    const r2Label = new MockDOMElement('LABEL', '', 'el-radio');
    const r2Input = new MockDOMElement('INPUT', 'status_1', 'el-radio__original');
    r2Input.type = 'radio';
    r2Input.name = '';
    r2Input.value = '1';
    r2Input.checked = false;
    const r2Text = new MockDOMElement('SPAN', '', 'el-radio__label');
    r2Text.textContent = '停用';
    r2Label.appendChild(r2Input);
    r2Label.appendChild(r2Text);

    radioGroup.appendChild(r1Label);
    radioGroup.appendChild(r2Label);
    formItem.appendChild(radioGroup);
    dialog.appendChild(formItem);

    const snapshot = FormScanner.scan(doc as any);
    const radioField = snapshot.fields.find((f) => f.kind === 'radio');
    expect(radioField).toBeDefined();
    expect(radioField?.label).toBe('状态');
    expect(radioField?.label).not.toBe('正常');
    expect(radioField?.currentValue).toBe('正常');
  });
});


