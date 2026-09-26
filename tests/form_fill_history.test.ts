import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { FormFillHistoryRepository } from '../src/db/repositories/formFillHistoryRepository';
import { QACopilotDatabase } from '../src/db';
import { FormFillHistoryRecord, FormFieldItem, FormSnapshot } from '../src/shared/types/formFill';
import { FormDOMRegistry, FormScanner } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';

describe('智能填表历史记录留存与一键填表 (tests/form_fill_history.test.ts)', () => {
  let testDb: QACopilotDatabase;
  let historyRepo: FormFillHistoryRepository;

  beforeAll(() => {
    (globalThis as any).getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    if (typeof (globalThis as any).Event === 'undefined') {
      (globalThis as any).Event = class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };
    }
  });

  beforeEach(async () => {
    (globalThis as any).document = {
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    testDb = new QACopilotDatabase(`test_hist_db_${Date.now()}_${Math.random()}`);
    historyRepo = new FormFillHistoryRepository(testDb);
    FormDOMRegistry.clearAll();
  });

  it('1. 历史记录持久化：保存、倒序排列与收藏置顶', async () => {
    const r1: FormFillHistoryRecord = {
      id: 'h1',
      title: '客户资料 A',
      url: 'https://crm.example.com/add',
      timestamp: 1000,
      isFavorite: false,
      fields: [{ label: '客户名称', value: '星河科技', kind: 'text' }],
    };

    const r2: FormFillHistoryRecord = {
      id: 'h2',
      title: '客户资料 B',
      url: 'https://crm.example.com/add',
      timestamp: 2000,
      isFavorite: false,
      fields: [{ label: '客户名称', value: '极光网络', kind: 'text' }],
    };

    await historyRepo.save(r1);
    await historyRepo.save(r2);

    let list = await historyRepo.listAll();
    expect(list.length).toBe(2);
    // 默认按时间倒序：r2 在前，r1 在后
    expect(list[0].id).toBe('h2');
    expect(list[1].id).toBe('h1');

    // 将 r1 设为常用收藏
    const newStatus = await historyRepo.toggleFavorite('h1');
    expect(newStatus).toBe(true);

    list = await historyRepo.listAll();
    // 收藏后 r1 必须置顶排在最前
    expect(list[0].id).toBe('h1');
    expect(list[0].isFavorite).toBe(true);
    expect(list[1].id).toBe('h2');

    // 删除记录
    await historyRepo.delete('h2');
    list = await historyRepo.listAll();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('h1');
  });

  it('2. 跨快照/刷新一键回填：新页面生成全新 DOM ID，历史记录依据 Label/Name 动态匹配并执行填充', async () => {
    // 模拟快照 1 留存的历史记录
    const historyRecord: FormFillHistoryRecord = {
      id: 'h_crm_standard',
      title: '标准客户登记',
      url: 'https://crm.example.com/customer/new',
      timestamp: Date.now(),
      fields: [
        { label: '客户全称', name: 'companyName', kind: 'text', value: '星河互动科技有限公司' },
        { label: '联系人', name: 'contactPerson', kind: 'text', value: '张经理' },
        { label: '所属行业', name: 'industry', kind: 'select', value: '软件服务' },
      ],
    };

    // 模拟用户刷新页面后，页面控件具有全新动态生成的快照 ID (如 field_snap2_xxx)
    const newSnapshotId = 'snap_after_refresh_999';

    const inputCompany: any = {
      tagName: 'INPUT',
      type: 'text',
      name: 'companyName',
      value: '',
      disabled: false,
      readOnly: false,
      offsetParent: {},
      dispatchEvent: () => true,
    };

    const inputContact: any = {
      tagName: 'INPUT',
      type: 'text',
      name: 'contactPerson',
      value: '',
      disabled: false,
      readOnly: false,
      offsetParent: {},
      dispatchEvent: () => true,
    };

    const selectIndustry: any = {
      tagName: 'SELECT',
      name: 'industry',
      value: '',
      disabled: false,
      readOnly: false,
      offsetParent: {},
      options: [
        { id: 'opt_1', value: '1', text: '制造加工' },
        { id: 'opt_2', value: '2', text: '软件服务' },
      ],
      dispatchEvent: () => true,
    };

    const fieldCompanyId = `field_${newSnapshotId}_1_companyName`;
    const fieldContactId = `field_${newSnapshotId}_2_contactPerson`;
    const fieldIndustryId = `field_${newSnapshotId}_3_industry`;

    FormDOMRegistry.register(fieldCompanyId, inputCompany, newSnapshotId);
    FormDOMRegistry.register(fieldContactId, inputContact, newSnapshotId);
    FormDOMRegistry.register(fieldIndustryId, selectIndustry, newSnapshotId);

    const currentFields: FormFieldItem[] = [
      {
        fieldId: fieldCompanyId,
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'companyName',
        label: '客户全称',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
      {
        fieldId: fieldContactId,
        formId: 'form_1',
        tag: 'input',
        kind: 'text',
        name: 'contactPerson',
        label: '联系人',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
      },
      {
        fieldId: fieldIndustryId,
        formId: 'form_1',
        tag: 'select',
        kind: 'select',
        name: 'industry',
        label: '所属行业',
        currentValue: '',
        isEmpty: true,
        required: true,
        disabled: false,
        readOnly: false,
        isVisible: true,
        options: [
          { optionId: 'opt_1', value: '1', label: '制造加工' },
          { optionId: 'opt_2', value: '2', label: '软件服务' },
        ],
      },
    ];

    // 动态模拟一键填表的匹配逻辑
    const matchedAssignments: any[] = [];
    for (const hField of historyRecord.fields) {
      const matched = currentFields.find(
        (f) => f.name === hField.name || f.label === hField.label || f.label.includes(hField.label)
      );
      expect(matched).toBeDefined();

      let optionIds: string[] | undefined;
      if (matched?.options) {
        const opt = matched.options.find(
          (o) => o.label === hField.value || o.value === hField.value
        );
        if (opt) optionIds = [opt.optionId];
      }

      matchedAssignments.push({
        fieldId: matched!.fieldId,
        action: hField.kind === 'select' ? 'select' : 'fill',
        value: hField.value,
        optionIds,
        source: 'instruction',
      });
    }

    expect(matchedAssignments.length).toBe(3);

    // 执行一键填充
    const fillResult = await FormExecutor.executePlan(
      newSnapshotId,
      matchedAssignments,
      'allow_overwrite'
    );

    // 验证：3 个字段全部成功写入且回读通过
    expect(fillResult.status).toBe('completed');
    expect(fillResult.steps.length).toBe(3);
    expect(fillResult.steps.every((s) => s.status === 'success')).toBe(true);

    expect(inputCompany.value).toBe('星河互动科技有限公司');
    expect(inputContact.value).toBe('张经理');
    expect(selectIndustry.value).toBe('2'); // 软件服务对应的 option value
  });

  it('3. Radio 组历史数据一键回填与选中校验', async () => {
    const radioHistory: FormFillHistoryRecord = {
      id: 'h_radio',
      title: '开票选择',
      url: 'https://billing.example.com',
      timestamp: Date.now(),
      fields: [{ label: '发票类型', name: 'invType', kind: 'radio', value: '增值税专用发票' }],
    };

    const snapshotId = 'snap_radio_test';
    const radio1: any = {
      tagName: 'INPUT',
      type: 'radio',
      name: 'invType',
      value: 'normal',
      checked: false,
      disabled: false,
      readOnly: false,
      click() { this.checked = true; },
      dispatchEvent: () => true,
    };
    const radio2: any = {
      tagName: 'INPUT',
      type: 'radio',
      name: 'invType',
      value: 'special',
      checked: false,
      disabled: false,
      readOnly: false,
      click() { this.checked = true; },
      dispatchEvent: () => true,
    };

    const fieldId = `field_${snapshotId}_radiogroup_invType`;
    const optionElements = new Map<string, any>();
    optionElements.set('增值税普通发票', radio1);
    optionElements.set('增值税专用发票', radio2);

    FormDOMRegistry.register(fieldId, radio1, snapshotId, optionElements);

    const assignment = {
      fieldId,
      action: 'select' as const,
      value: '增值税专用发票',
      source: 'instruction' as const,
    };

    const fillResult = await FormExecutor.executePlan(snapshotId, [assignment], 'allow_overwrite');
    expect(fillResult.status).toBe('completed');
    expect(fillResult.steps[0].status).toBe('success');
    expect(radio2.checked).toBe(true);
    expect(radio1.checked).toBe(false);
  });
});
