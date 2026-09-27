import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FormScanner, FormDOMRegistry } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { AIProvider } from '../src/ai';
import { FormFillPlanContext } from '../src/shared/types/formFill';

describe('智能填表下拉选项三步闭环机制 (form_dropdown_three_steps.test.ts)', () => {
  beforeEach(() => {
    FormDOMRegistry.clearAll();
  });

  it('第一步：FormScanner 精准提取树形下拉选项，并严格与左侧侧边栏同名组织机构树隔离', () => {
    // 构造模拟 DOM：
    // 左侧侧边栏包含组织机构树（含“研发部门”）
    const sidebarTree = {
      tagName: 'ASIDE',
      className: 'sidebar org-tree',
      querySelectorAll: (sel: string) => [],
      closest: (sel: string) => sel.includes('sidebar') ? {} : null,
    };

    // 弹窗内的树形下拉框（例如归属部门）
    const deptTrigger: any = {
      tagName: 'DIV',
      className: 'el-tree-select vue-treeselect',
      id: 'dept_select_wrapper',
      getAttribute: (k: string) => (k === 'aria-controls' ? 'dept_popper' : null),
      hasAttribute: () => false,
      textContent: '请选择归属部门',
      getBoundingClientRect: () => ({ width: 180, height: 32, left: 100, top: 100 }),
      closest: (sel: string) => null,
      querySelector: () => null,
    };

    // 下拉选项浮层中的具体部门叶子节点
    const popperOption: any = {
      tagName: 'DIV',
      className: 'el-tree-node__content vue-treeselect__label',
      innerText: '研发部门',
      textContent: '研发部门',
      getAttribute: (k: string) => (k === 'role' ? 'treeitem' : null),
      closest: () => null,
      querySelector: () => null,
    };

    // 浮层容器
    const popperContainer: any = {
      tagName: 'DIV',
      id: 'dept_popper',
      className: 'el-tree-select__popper vue-treeselect__menu',
      style: { display: 'block' },
      getAttribute: (k: string) => (k === 'aria-hidden' ? 'false' : null),
      querySelectorAll: (sel: string) => [popperOption],
      closest: () => null,
    };

    popperOption.closest = (sel: string) => (sel.includes('popper') || sel.includes('menu') ? popperContainer : null);

    const mockDoc: any = {
      location: { href: 'https://test.example.com/system/user' },
      title: '用户管理',
      forms: [],
      body: { contains: () => true },
      getElementById: (id: string) => (id === 'dept_popper' ? popperContainer : null),
      querySelector: (sel: string) => null,
      querySelectorAll: (sel: string) => {
        if (sel.includes('form') || sel.includes('dialog')) return [];
        if (sel.includes('sidebar')) return [sidebarTree];
        // 全量候选包含下拉触发框
        return [deptTrigger];
      },
    };

    // 探测选项
    const options = FormScanner.extractDropdownOptionsFromDom(deptTrigger, deptTrigger, mockDoc);
    expect(options.length).toBe(1);
    expect(options[0].label).toBe('研发部门');
    expect(options[0].value).toBe('研发部门');
  });

  it('第二步：AI 规划决策在提供 options 候选列表时，严格在 options 范围内做有界选择，拒绝凭空臆造', () => {
    const context: FormFillPlanContext = {
      snapshotId: 'snap_test_001',
      instruction: '归属部门选择研发部门，用户性别选择男',
      mode: 'allow_overwrite',
      fields: [
        {
          fieldId: 'field_dept',
          formId: 'form_1',
          tag: 'div',
          kind: 'select',
          label: '归属部门',
          name: 'deptId',
          currentValue: '',
          isEmpty: true,
          optionsState: 'complete',
          options: [
            { optionId: 'opt_tech', label: '科技 (2)', value: '1' },
            { optionId: 'opt_rd', label: '研发部门', value: '101' },
            { optionId: 'opt_market', label: '市场部门', value: '102' },
          ],
        },
        {
          fieldId: 'field_gender',
          formId: 'form_1',
          tag: 'select',
          kind: 'select',
          label: '用户性别',
          name: 'gender',
          currentValue: '',
          isEmpty: true,
          optionsState: 'complete',
          options: [
            { optionId: 'opt_male', label: '男', value: '0' },
            { optionId: 'opt_female', label: '女', value: '1' },
          ],
        },
      ],
    };

    const plan = AIProvider.planFormFill(context);
    expect(plan.assignments.length).toBe(2);

    const deptAssignment = plan.assignments.find((a) => a.fieldId === 'field_dept');
    expect(deptAssignment).toBeDefined();
    expect(deptAssignment?.action).toBe('select');
    // 优先选择业务叶子项（研发部门），而不是科技 (2)
    expect(deptAssignment?.value).toBe('研发部门');
    expect(deptAssignment?.optionIds).toContain('opt_rd');

    const genderAssignment = plan.assignments.find((a) => a.fieldId === 'field_gender');
    expect(genderAssignment).toBeDefined();
    expect(genderAssignment?.value).toBe('男');
  });

  it('第三步：FormExecutor 执行自定义下拉选项选择，驱动展开并在活动浮层内精准点击命中目标选项', async () => {
    let clickedOption = false;
    let clickedTrigger = false;

    const popperOption: any = {
      tagName: 'DIV',
      className: 'el-tree-node__content vue-treeselect__label',
      innerText: '研发部门',
      textContent: '研发部门',
      offsetParent: {},
      getClientRects: () => [{ width: 100, height: 26 }],
      getBoundingClientRect: () => ({ width: 100, height: 26, left: 100, top: 150 }),
      getAttribute: () => null,
      closest: () => null,
      querySelector: () => null,
      dispatchEvent: (e: any) => {
        if (e.type === 'click') { clickedOption = true; innerInput.value = '研发部门'; }
        return true;
      },
      click: () => { clickedOption = true; innerInput.value = '研发部门'; },
      scrollIntoView: () => {},
    };

    const innerInput: any = {
      tagName: 'INPUT',
      value: '',
      readOnly: true,
      getAttribute: () => null,
      hasAttribute: () => false,
      dispatchEvent: (e: any) => {
        if (e.type === 'click') clickedTrigger = true;
        return true;
      },
      click: () => { clickedTrigger = true; },
    };

    const selectWrapper: any = {
      tagName: 'DIV',
      className: 'el-tree-select',
      offsetParent: {},
      getBoundingClientRect: () => ({ width: 180, height: 32, left: 100, top: 100 }),
      querySelector: (sel: string) => {
        if (sel.includes('.vue-treeselect__menu,')) return { querySelectorAll: (q: string) => q.includes('.el-tree-node__content') ? [popperOption] : [] };
        if (sel.includes('input')) return innerInput;
        return null;
      },
      querySelectorAll: (sel: string) => [],
      getAttribute: () => null,
      hasAttribute: () => false,
      dispatchEvent: (e: any) => {
        if (e.type === 'click') clickedTrigger = true;
        return true;
      },
      click: () => { clickedTrigger = true; },
      closest: (sel: string) => (sel.includes('el-tree-select') ? selectWrapper : null),
    };

    const mockDoc: any = {
      querySelectorAll: (sel: string) => {
        if (sel.includes('el-tree-node__content') || sel.includes('vue-treeselect__label')) {
          return [popperOption];
        }
        return [];
      },
      contains: () => true,
    };

    const originalDoc = (globalThis as any).document;
    try {
      (globalThis as any).document = mockDoc;
      FormDOMRegistry.register('field_dept_001', selectWrapper, 'snap_test_001');

      const result = await (FormExecutor as any).executeAssignment(
        {
          fieldId: 'field_dept_001',
          action: 'select',
          value: '研发部门',
          optionIds: ['opt_rd'],
        },
        'snap_test_001',
        'allow_overwrite'
      );

      expect(clickedTrigger).toBe(true);
      expect(clickedOption, JSON.stringify(result)).toBe(true);
      expect(result.status).toBe('success');
      expect(result.appliedValue).toBe('研发部门');
      expect(innerInput.value).toBe('研发部门');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });
});
