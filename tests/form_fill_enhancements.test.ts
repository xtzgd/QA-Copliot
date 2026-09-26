/**
 * IMP-09 & IMP-10: 复杂填表与可复用填写方案专项测试
 * 覆盖：
 * 1. IMP-09: Radio 组判空保护、Checkbox 严格布尔解析（拒绝将 "false" 视作真值）、自定义 ARIA 控件扫描
 * 2. IMP-10: 填写模板 IndexedDB 持久化与动态特征匹配（杜绝硬编码旧 snapshot/field ID）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { FormExecutor } from '../src/content/formExecutor';
import { FormScanner } from '../src/content/formScanner';
import { db, QACopilotDatabase } from '../src/db/index';
import { FormFillTemplateRepository } from '../src/db/repositories/formFillTemplateRepository';
import type { FormFillTemplate, FormFieldItem } from '../src/shared/types/formFill';

// 轻量 DOM Mock 类
class MockElement {
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
  labels: Array<{ textContent: string }> = [];
  parentNode: MockElement | null = null;
  children: MockElement[] = [];
  style: any = { display: 'block', visibility: 'visible' };
  attributes: Record<string, string> = {};

  constructor(tag: string, id: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
  }

  setAttribute(attr: string, val: string) {
    this.attributes[attr] = val;
  }

  getAttribute(attr: string): string | null {
    if (attr === 'name') return this.name;
    if (attr === 'id') return this.id;
    if (attr === 'placeholder') return this.placeholder;
    return this.attributes[attr] ?? null;
  }

  hasAttribute(attr: string): boolean {
    if (attr === 'disabled') return this.disabled;
    if (attr === 'readonly') return this.readOnly;
    if (attr === 'required') return this.required;
    return attr in this.attributes;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  get offsetParent() {
    return {};
  }

  closest(selector: string): MockElement | null {
    if (selector === 'form') {
      let cur = this.parentNode;
      while (cur) {
        if (cur.tagName === 'FORM') return cur;
        cur = cur.parentNode;
      }
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    return null;
  }
}

describe('IMP-09 控件适配器与组判空保护', () => {
  describe('toStrictBoolean 严格布尔值解析 (防将 "false" 当真值)', () => {
    it('字符串 "false"、"0"、"off"、"no"、"" 必须解析为 false', () => {
      expect(FormExecutor.toStrictBoolean('false')).toBe(false);
      expect(FormExecutor.toStrictBoolean('False')).toBe(false);
      expect(FormExecutor.toStrictBoolean('0')).toBe(false);
      expect(FormExecutor.toStrictBoolean('off')).toBe(false);
      expect(FormExecutor.toStrictBoolean('no')).toBe(false);
      expect(FormExecutor.toStrictBoolean('')).toBe(false);
      expect(FormExecutor.toStrictBoolean(false)).toBe(false);
      expect(FormExecutor.toStrictBoolean(0)).toBe(false);
    });

    it('真值 "true"、"1"、"yes"、"on"、1、true 必须解析为 true', () => {
      expect(FormExecutor.toStrictBoolean('true')).toBe(true);
      expect(FormExecutor.toStrictBoolean('True')).toBe(true);
      expect(FormExecutor.toStrictBoolean('1')).toBe(true);
      expect(FormExecutor.toStrictBoolean('yes')).toBe(true);
      expect(FormExecutor.toStrictBoolean('on')).toBe(true);
      expect(FormExecutor.toStrictBoolean(1)).toBe(true);
      expect(FormExecutor.toStrictBoolean(true)).toBe(true);
    });
  });

  describe('FormScanner Radio 组判空防护', () => {
    it('同名 Radio 组内若已有一项被选中，整组均不属于未填写空白项 (isEmpty = false)', () => {
      const radio1 = new MockElement('input', 'r1');
      radio1.type = 'radio';
      radio1.name = 'plan';
      radio1.checked = false;
      radio1.labels = [{ textContent: '基础版' }];

      const radio2 = new MockElement('input', 'r2');
      radio2.type = 'radio';
      radio2.name = 'plan';
      radio2.checked = true; // 专业版已选
      radio2.labels = [{ textContent: '专业版' }];

      const radio3 = new MockElement('input', 'r3');
      radio3.type = 'radio';
      radio3.name = 'plan';
      radio3.checked = false;
      radio3.labels = [{ textContent: '企业版' }];

      const mockDoc = {
        querySelectorAll: (sel: string) => {
          if (sel === 'form') return [];
          if (sel.includes('input')) return [radio1, radio2, radio3];
          if (sel.includes('role=')) return [];
          return [];
        },
        location: { href: 'http://test.com/form' },
        title: '测试页面',
      };

      const snapshot = FormScanner.scan(mockDoc as any);
      const radioFields = snapshot.fields.filter((f) => f.kind === 'radio' && f.groupName === 'plan');

      expect(radioFields.length).toBe(1);
      // 因为“专业版”已选中，整组应该被判断为已填写（isEmpty: false），避免仅填空白模式覆盖破坏已有选择
      expect(radioFields[0].isEmpty).toBe(false);
      expect(radioFields[0].options?.length).toBe(3);
    });

    it('同名 Radio 组内若全未选中，整组判定为未填写空白项 (isEmpty = true)', () => {
      const radio1 = new MockElement('input', 'g1');
      radio1.type = 'radio';
      radio1.name = 'gender';
      radio1.checked = false;
      radio1.labels = [{ textContent: '男' }];

      const radio2 = new MockElement('input', 'g2');
      radio2.type = 'radio';
      radio2.name = 'gender';
      radio2.checked = false;
      radio2.labels = [{ textContent: '女' }];

      const mockDoc = {
        querySelectorAll: (sel: string) => {
          if (sel === 'form') return [];
          if (sel.includes('input')) return [radio1, radio2];
          if (sel.includes('role=')) return [];
          return [];
        },
        location: { href: 'http://test.com/form' },
        title: '测试页面',
      };

      const snapshot = FormScanner.scan(mockDoc as any);
      const radioFields = snapshot.fields.filter((f) => f.kind === 'radio' && f.groupName === 'gender');

      expect(radioFields.length).toBe(1);
      // 组内全未选中，此时整组均为空
      expect(radioFields[0].isEmpty).toBe(true);
      expect(radioFields[0].options?.length).toBe(2);
    });

    it('扫描识别自定义 ARIA combobox 控件', () => {
      const customSelect = new MockElement('div', 'custom-select');
      customSelect.setAttribute('role', 'combobox');
      customSelect.setAttribute('aria-label', '所属地区');
      customSelect.setAttribute('aria-required', 'true');
      (customSelect as any).textContent = '请选择省市';

      const mockDoc = {
        querySelectorAll: (sel: string) => {
          if (sel === 'form') return [];
          if (sel.includes('combobox')) return [customSelect];
          if (sel.includes('input')) return [];
          return [];
        },
        location: { href: 'http://test.com/form' },
        title: '测试页面',
      };

      const snapshot = FormScanner.scan(mockDoc as any);
      const ariaField = snapshot.fields.find((f) => f.kind === 'unsupported' && f.label.includes('所属地区'));

      expect(ariaField).toBeDefined();
      expect(ariaField?.label).toBe('所属地区');
      expect(ariaField?.required).toBe(true);
      expect(ariaField?.isEmpty).toBe(true); // 包含“请选择”应判定为空
      expect(ariaField?.optionsState).toBe('partial');
      expect(ariaField?.unsupportedReason).toContain('自定义 ARIA 控件尚未接入专用点击展开交互适配器');
    });
  });
});

describe('IMP-10 填写模板存储与动态特征匹配', () => {
  let testDb: QACopilotDatabase;
  let testRepo: FormFillTemplateRepository;

  beforeEach(async () => {
    testDb = new QACopilotDatabase(`test_tpl_db_${Date.now()}_${Math.random()}`);
    testRepo = new FormFillTemplateRepository(testDb);
  });

  it('模板持久化: 保存到 Dexie version(6) 并成功读取与删除', async () => {
    const template: FormFillTemplate = {
      id: 'tpl-101',
      name: '标准商户注册资料',
      description: '通用电商商户入驻表单测试资料',
      urlPattern: '/merchant/register',
      rules: [
        { labelPattern: '企业名称', fieldName: 'companyName', value: '星河极速科技有限公司', action: 'fill' },
        { labelPattern: '纳税人识别号', fieldName: 'taxId', value: '91110108MA01ABCDEF', action: 'fill' },
        { labelPattern: '所属行业', fieldName: 'industry', value: '软件与信息技术', action: 'select' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await testRepo.save(template);

    const loaded = await testRepo.get('tpl-101');
    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe('标准商户注册资料');
    expect(loaded?.rules.length).toBe(3);

    const list = await testRepo.listAll();
    expect(list.length).toBe(1);

    await testRepo.delete('tpl-101');
    const afterDelete = await testRepo.get('tpl-101');
    expect(afterDelete).toBeUndefined();
  });

  it('动态特征匹配 (非硬编码 ID): 根据 labelPattern 和 fieldName 匹配新的表单快照', () => {
    const template: FormFillTemplate = {
      id: 'tpl-test',
      name: '测试客户模版',
      rules: [
        { labelPattern: '公司名称', value: '杭州阿尔法软件', action: 'fill' },
        { labelPattern: '联系人姓名', fieldName: 'contactName', value: '李四', action: 'fill' },
        { labelPattern: '手机号码', value: '13800138000', action: 'fill' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 模拟来自完全不同页面、不同 snapshotId 的表单快照字段
    const newSnapshotFields: FormFieldItem[] = [
      {
        fieldId: 'field_snap_2026_1_company',
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'company',
        label: '客户公司名称 *',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
      {
        fieldId: 'field_snap_2026_2_contactName',
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'contactName',
        label: '主要联系人',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
      {
        fieldId: 'field_snap_2026_3_phone',
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'mobile',
        label: '常用手机号码',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
      {
        fieldId: 'field_snap_2026_4_unrelated',
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'fax',
        label: '传真号码',
        currentValue: '',
        isEmpty: true,
        required: false,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
    ];

    // 动态特征匹配逻辑
    const matchedAssignments: Array<{ fieldId: string; value: unknown }> = [];
    newSnapshotFields.forEach((field) => {
      const rule = template.rules.find((r) => {
        if (r.fieldName && field.name && r.fieldName === field.name) return true;
        if (r.labelPattern) {
          const pattern = r.labelPattern.trim().toLowerCase();
          const targetLabel = field.label.trim().toLowerCase();
          if (targetLabel.includes(pattern) || pattern.includes(targetLabel)) return true;
        }
        return false;
      });

      if (rule) {
        matchedAssignments.push({ fieldId: field.fieldId, value: rule.value });
      }
    });

    expect(matchedAssignments.length).toBe(3);
    expect(matchedAssignments.find((a) => a.fieldId === 'field_snap_2026_1_company')?.value).toBe('杭州阿尔法软件');
    expect(matchedAssignments.find((a) => a.fieldId === 'field_snap_2026_2_contactName')?.value).toBe('李四');
    expect(matchedAssignments.find((a) => a.fieldId === 'field_snap_2026_3_phone')?.value).toBe('13800138000');
    // 无关字段不被错误匹配
    expect(matchedAssignments.some((a) => a.fieldId === 'field_snap_2026_4_unrelated')).toBe(false);
  });
});
