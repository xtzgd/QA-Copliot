/**
 * AI 智能填表第一期全链路自动化测试套件
 * 覆盖 QA-011, QA-012, QA-013, QA-014, QA-016, QA-023
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { FormDOMRegistry, FormScanner } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { AIProvider, AIProviderError, RemoteGatewayProviderAdapter } from '../src/ai';
import { FormSnapshot } from '../src/shared/types/formFill';

// ==========================================
// 轻量级 DOM 环境 Mock (适配 Node.js 运行环境)
// ==========================================
class MockDOMElement {
  id: string = '';
  name: string = '';
  tagName: string;
  type: string = 'text';
  value: string = '';
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  required: boolean = false;
  placeholder: string = '';
  min: string = '';
  max: string = '';
  step: string = '';
  pattern: string = '';
  options: any[] = [];
  selectedOptions: any[] = [];
  labels: Array<{ textContent: string }> = [];
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  listeners: Record<string, Array<(e: any) => void>> = {};
  style: any = { display: 'block', visibility: 'visible' };

  constructor(tag: string, id: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
  }

  getAttribute(attr: string): string | null {
    if (attr === 'name') return this.name;
    if (attr === 'id') return this.id;
    if (attr === 'placeholder') return this.placeholder;
    return null;
  }

  hasAttribute(attr: string): boolean {
    if (attr === 'disabled') return this.disabled;
    if (attr === 'readonly') return this.readOnly;
    if (attr === 'required') return this.required;
    return false;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  get offsetParent() {
    return {};
  }

  closest(selector: string): MockDOMElement | null {
    if (selector === 'form') {
      let cur = this.parentNode;
      while (cur) {
        if (cur.tagName === 'FORM') return cur;
        cur = cur.parentNode;
      }
    }
    return null;
  }

  addEventListener(event: string, fn: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event: any) {
    const list = this.listeners[event?.type] || [];
    list.forEach((fn) => fn(event));
    return true;
  }

  click() {
    if (this.type === 'checkbox') {
      this.checked = !this.checked;
    } else if (this.type === 'radio') {
      this.checked = true;
    }
    this.dispatchEvent({ type: 'click' });
  }
}

class MockDocument {
  forms: MockDOMElement[] = [];
  allElements: MockDOMElement[] = [];
  location = { href: 'https://test.example.com/form' };
  title = '客户登记表';

  querySelectorAll(selector: string): MockDOMElement[] {
    if (selector === 'form') return this.forms;
    if (selector.includes('input') || selector.includes('select') || selector.includes('textarea')) {
      return this.allElements;
    }
    return [];
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.allElements.find((e) => selector.includes(e.id)) || null;
  }

  contains(element: any): boolean {
    return this.allElements.includes(element) || this.forms.includes(element);
  }
}

describe('AI 智能填表第一期测试套件 (QA-011 ~ QA-016, QA-023)', () => {
  let mockDoc: MockDocument;

  beforeAll(() => {
    (globalThis as any).getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    (globalThis as any).window = {
      location: { href: 'https://test.example.com/form' },
      getComputedStyle: (globalThis as any).getComputedStyle,
    };
    (globalThis as any).Event = class {
      type: string;
      bubbles: boolean;
      constructor(type: string, opts?: any) {
        this.type = type;
        this.bubbles = Boolean(opts?.bubbles);
      }
    };
  });

  beforeEach(() => {
    mockDoc = new MockDocument();
    (globalThis as any).document = mockDoc;
    FormDOMRegistry.clearAll();
    FormExecutor.resetCancel();
  });

  // ==========================================
  // QA-011 & QA-023: 表单快照扫描与空值精确语义
  // ==========================================
  describe('QA-011 & QA-023: 表单扫描与空值语义', () => {
    it('精确识别控件类型，并严格区分 0/false 与未填空白', () => {
      const form = new MockDOMElement('form', 'customerForm');
      mockDoc.forms.push(form);

      // 1. 联系人文本框（未填）
      const nameInput = new MockDOMElement('input', 'nameInput');
      nameInput.name = 'contactName';
      nameInput.value = '';
      nameInput.required = true;
      nameInput.labels = [{ textContent: '联系人姓名' }];
      nameInput.parentNode = form;

      // 2. 公司文本框（已填）
      const companyInput = new MockDOMElement('input', 'companyInput');
      companyInput.name = 'company';
      companyInput.value = '已填公司';
      companyInput.labels = [{ textContent: '公司名称' }];
      companyInput.parentNode = form;

      // 3. QA-023: 数字 input 值为 "0" 时，视为有效数字，isEmpty = false
      const amountInput = new MockDOMElement('input', 'amountInput');
      amountInput.type = 'number';
      amountInput.name = 'amount';
      amountInput.value = '0';
      amountInput.labels = [{ textContent: '投资金额' }];
      amountInput.parentNode = form;

      // 4. 未填写的数字 input，isEmpty = true
      const scoreInput = new MockDOMElement('input', 'scoreInput');
      scoreInput.type = 'number';
      scoreInput.name = 'score';
      scoreInput.value = '';
      scoreInput.labels = [{ textContent: '信用评分' }];
      scoreInput.parentNode = form;

      // 5. QA-023: 复选框 checked = false 为有效未勾选状态，isEmpty = false（不可被盲目覆盖）
      const agreeCheckbox = new MockDOMElement('input', 'agreeCheckbox');
      agreeCheckbox.type = 'checkbox';
      agreeCheckbox.name = 'agree';
      agreeCheckbox.checked = false;
      agreeCheckbox.labels = [{ textContent: '同意用户协议' }];
      agreeCheckbox.parentNode = form;

      // 6. 下拉选择框（当前选中占位符）
      const industrySelect = new MockDOMElement('select', 'industrySelect');
      industrySelect.name = 'industry';
      industrySelect.labels = [{ textContent: '所属行业' }];
      industrySelect.options = [
        { id: 'opt_0', value: '', text: '--请选择--', disabled: false },
        { id: 'opt_it', value: 'IT', text: '软件服务', disabled: false },
        { id: 'opt_fin', value: 'FIN', text: '金融科技', disabled: false },
      ];
      industrySelect.value = '';
      industrySelect.selectedOptions = [industrySelect.options[0]];
      industrySelect.parentNode = form;

      // 7. 不支持控件：文件上传
      const fileUpload = new MockDOMElement('input', 'fileUpload');
      fileUpload.type = 'file';
      fileUpload.labels = [{ textContent: '附件简历' }];
      fileUpload.parentNode = form;

      // 8. 不支持控件：验证码
      const captchaInput = new MockDOMElement('input', 'captchaInput');
      captchaInput.name = 'captcha';
      captchaInput.labels = [{ textContent: '短信验证码' }];
      captchaInput.parentNode = form;

      mockDoc.allElements.push(
        nameInput,
        companyInput,
        amountInput,
        scoreInput,
        agreeCheckbox,
        industrySelect,
        fileUpload,
        captchaInput
      );

      const snapshot = FormScanner.scan(mockDoc as any);

      expect(snapshot.snapshotId).toBeTruthy();
      expect(snapshot.forms.length).toBe(1);

      // 联系人检查
      const nameField = snapshot.fields.find((f) => f.name === 'contactName')!;
      expect(nameField.kind).toBe('text');
      expect(nameField.isEmpty).toBe(true);
      expect(nameField.required).toBe(true);

      // 已填公司检查
      const companyField = snapshot.fields.find((f) => f.name === 'company')!;
      expect(companyField.isEmpty).toBe(false);
      expect(companyField.currentValue).toBe('已填公司');

      // QA-023 断言: 0 是有效数字，非空
      const amountField = snapshot.fields.find((f) => f.name === 'amount')!;
      expect(amountField.kind).toBe('number');
      expect(amountField.currentValue).toBe(0);
      expect(amountField.isEmpty).toBe(false);

      // 空数字检查
      const scoreField = snapshot.fields.find((f) => f.name === 'score')!;
      expect(scoreField.isEmpty).toBe(true);

      // QA-023 断言: 未勾选的复选框 isEmpty 必须为 false（未勾选是明确状态）
      const agreeField = snapshot.fields.find((f) => f.name === 'agree')!;
      expect(agreeField.kind).toBe('checkbox');
      expect(agreeField.currentValue).toBe(false);
      expect(agreeField.isEmpty).toBe(false);

      // 下拉框占位符断言
      const industryField = snapshot.fields.find((f) => f.name === 'industry')!;
      expect(industryField.kind).toBe('select');
      expect(industryField.isEmpty).toBe(true);
      expect(industryField.options?.length).toBe(3);

      // 不支持的控件断言
      const fileField = snapshot.fields.find((f) => f.name === 'fileUpload' || f.fieldId.includes('fileUpload'))!;
      expect(fileField.kind).toBe('unsupported');

      const captchaField = snapshot.fields.find((f) => f.name === 'captcha')!;
      expect(captchaField.kind).toBe('unsupported');
    });
  });

  // ==========================================
  // QA-012: 大模型填表规划与运行时 Schema 校验
  // ==========================================
  describe('QA-012: 填表方案规划与 Schema 校验', () => {
    let mockSnapshot: FormSnapshot;

    beforeEach(() => {
      const user = new MockDOMElement('input', 'user');
      user.name = 'user';
      user.labels = [{ textContent: '用户名称' }];
      user.value = '';

      const corp = new MockDOMElement('input', 'corp');
      corp.name = 'corp';
      corp.labels = [{ textContent: '所属公司' }];
      corp.value = '已有企业';

      const role = new MockDOMElement('select', 'role');
      role.name = 'role';
      role.labels = [{ textContent: '角色选择' }];
      role.options = [
        { id: 'opt_default', value: '', text: '请选择', disabled: false },
        { id: 'opt_admin', value: 'admin', text: '管理员', disabled: false },
        { id: 'opt_dev', value: 'dev', text: '开发人员', disabled: false },
      ];
      role.selectedOptions = [role.options[0]];

      mockDoc.allElements.push(user, corp, role);
      mockSnapshot = FormScanner.scan(mockDoc as any);
    });

    it('启发式规则在 empty_only 模式下保留已有值，并根据指令分配目标字段', () => {
      const plan = AIProvider.planFormFill({
        snapshotId: mockSnapshot.snapshotId,
        instruction: '用户是张三，角色选择开发人员，其他空白字段合理生成',
        mode: 'empty_only',
        fields: mockSnapshot.fields,
      });

      expect(plan.snapshotId).toBe(mockSnapshot.snapshotId);

      // corp 字段已有值，在 empty_only 模式下被跳过 (QA-023)
      const corpAssign = plan.assignments.find((a) => a.fieldId.includes('corp'))!;
      expect(corpAssign.action).toBe('skip');

      // user 字段分配为 张三
      const userAssign = plan.assignments.find((a) => a.fieldId.includes('user'))!;
      expect(userAssign.action).toBe('fill');
      expect(userAssign.value).toBe('张三');

      // role 字段选中 开发人员
      const roleAssign = plan.assignments.find((a) => a.fieldId.includes('role'))!;
      expect(roleAssign.action).toBe('select');
      expect(roleAssign.optionIds).toContain('opt_dev');
    });

    it('远程网关 Schema 校验：非法字段 ID 或非法 action 时抛出明确异常', async () => {
      const fakeFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          snapshotId: mockSnapshot.snapshotId,
          assignments: [
            { fieldId: 'malicious_field_999', action: 'fill', value: 'bad' },
          ],
          unresolved: [],
        }),
      });

      const adapter = new RemoteGatewayProviderAdapter('https://api.gateway.local', fakeFetcher as any);

      await expect(
        adapter.planFormFill({
          snapshotId: mockSnapshot.snapshotId,
          instruction: '测试',
          mode: 'empty_only',
          fields: mockSnapshot.fields,
        })
      ).rejects.toThrow('不存在的字段 ID');
    });

    it('远程网关 Schema 校验：快照 ID 不匹配时严密拒绝', async () => {
      const fakeFetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          snapshotId: 'wrong_snapshot_id',
          assignments: [],
          unresolved: [],
        }),
      });

      const adapter = new RemoteGatewayProviderAdapter('https://api.gateway.local', fakeFetcher as any);

      await expect(
        adapter.planFormFill({
          snapshotId: mockSnapshot.snapshotId,
          instruction: '测试',
          mode: 'empty_only',
          fields: mockSnapshot.fields,
        })
      ).rejects.toThrow('快照 ID 与当前页面不匹配');
    });
  });

  // ==========================================
  // QA-014: 受控写入、回读校验、取消与冲突感知撤销
  // ==========================================
  describe('QA-014: 控件执行、回读校验与冲突感知撤销', () => {
    it('成功写入文本与下拉框，并触发 input/change 事件与回读校验', async () => {
      const input = new MockDOMElement('input', 'userName');
      input.labels = [{ textContent: '用户名称' }];
      input.value = '';

      const select = new MockDOMElement('select', 'userRole');
      select.labels = [{ textContent: '用户角色' }];
      select.options = [
        { id: 'opt_default', value: '', text: '请选择', disabled: false },
        { id: 'opt_lead', value: 'lead', text: '架构师', disabled: false },
      ];
      select.selectedOptions = [select.options[0]];

      let inputDispatched = false;
      input.addEventListener('input', () => {
        inputDispatched = true;
      });

      mockDoc.allElements.push(input, select);
      const snapshot = FormScanner.scan(mockDoc as any);

      const userField = snapshot.fields.find((f) => f.fieldId.includes('userName'))!;
      const roleField = snapshot.fields.find((f) => f.fieldId.includes('userRole'))!;

      const runRecord = await FormExecutor.executePlan(snapshot.snapshotId, [
        {
          fieldId: userField.fieldId,
          action: 'fill',
          value: '李四架构师',
          source: 'instruction',
        },
        {
          fieldId: roleField.fieldId,
          action: 'select',
          optionIds: ['opt_lead'],
          source: 'instruction',
        },
      ]);

      expect(runRecord.status).toBe('completed');
      expect(input.value).toBe('李四架构师');
      expect(select.value).toBe('lead');
      expect(inputDispatched).toBe(true);

      const userStep = runRecord.steps.find((s) => s.fieldId === userField.fieldId)!;
      expect(userStep.status).toBe('success');
      expect(userStep.beforeValue).toBe('');
      expect(userStep.appliedValue).toBe('李四架构师');

      // 验证撤销 (Undo)
      const undoResult = await FormExecutor.undo(runRecord.runId);
      expect(undoResult.success).toBe(true);
      expect(undoResult.restoredCount).toBe(2);
      expect(input.value).toBe(''); // 成功恢复为 beforeValue
      expect(select.value).toBe('');
    });

    it('冲突感知撤销：若用户在填表后手动修改了输入框，则保留用户新输入，跳过撤销', async () => {
      const input = new MockDOMElement('input', 'phoneInput');
      input.labels = [{ textContent: '手机号码' }];
      input.value = '13000000000';

      mockDoc.allElements.push(input);
      const snapshot = FormScanner.scan(mockDoc as any);
      const field = snapshot.fields[0];

      const runRecord = await FormExecutor.executePlan(
        snapshot.snapshotId,
        [
          {
            fieldId: field.fieldId,
            action: 'fill',
            value: '13999999999',
            source: 'instruction',
          },
        ],
        'allow_overwrite'
      );

      expect(input.value).toBe('13999999999');

      // 模拟用户在填表后，自己手动改成了另外的值
      input.value = '13888888888';

      // 触发撤销
      const undoResult = await FormExecutor.undo(runRecord.runId);
      expect(undoResult.success).toBe(true);
      expect(undoResult.conflictCount).toBe(1); // 感知到冲突
      expect(undoResult.restoredCount).toBe(0);
      expect(input.value).toBe('13888888888'); // 坚决保留用户修改，不被回滚
    });

    it('取消机制：执行过程中调用 cancel()，后续任务立即停止不再写入', async () => {
      const input1 = new MockDOMElement('input', 'f1');
      const input2 = new MockDOMElement('input', 'f2');
      mockDoc.allElements.push(input1, input2);

      const snapshot = FormScanner.scan(mockDoc as any);

      // 先触发 cancel
      FormExecutor.cancel();

      const runRecord = await FormExecutor.executePlan(snapshot.snapshotId, [
        {
          fieldId: snapshot.fields[0].fieldId,
          action: 'fill',
          value: 'val1',
          source: 'instruction',
        },
        {
          fieldId: snapshot.fields[1].fieldId,
          action: 'fill',
          value: 'val2',
          source: 'instruction',
        },
      ]);

      expect(runRecord.status).toBe('cancelled');
      expect(input1.value).toBe('');
      expect(input2.value).toBe('');
    });
  });
});
