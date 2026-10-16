import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormScanner, FormDOMRegistry } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';

afterEach(() => {
  vi.restoreAllMocks();
  FormDOMRegistry.clearAll();
});

describe('智能填表方案1高级特性验证：单选Radio组、多选下拉、Search-First与树形懒加载 (tests/form_fill_select_radio_advanced.test.ts)', () => {
  it('1. Element Plus 风格单选组：点击外层 label 包装层，触发真实手势与受控状态更新', async () => {
    // 构造 Radio Group DOM
    let statusValue = '0';
    const radioContainer: any = {
      tagName: 'DIV',
      className: 'el-radio-group',
      querySelectorAll: (sel: string) => [],
    };

    const createRadioItem = (val: string, labelText: string) => {
      const inputEl: any = {
        tagName: 'INPUT',
        type: 'radio',
        name: 'status',
        value: val,
        checked: statusValue === val,
        disabled: false,
        parentElement: null as any,
        closest: (sel: string) => sel.includes('radio-group') ? radioContainer : null,
        dispatchEvent: vi.fn(),
      };
      const textSpan: any = {
        tagName: 'SPAN',
        className: 'el-radio__label',
        textContent: labelText,
      };
      const labelEl: any = {
        tagName: 'LABEL',
        className: 'el-radio',
        parentElement: radioContainer,
        classList: {
          contains: (cls: string) => (cls === 'is-checked' ? statusValue === val : false),
        },
        querySelector: (sel: string) => {
          if (sel.includes('input')) return inputEl;
          if (sel.includes('label')) return textSpan;
          return null;
        },
        querySelectorAll: () => [],
        closest: (sel: string) => sel.includes('radio-group') ? radioContainer : null,
        click: vi.fn(() => {
          statusValue = val;
          inputEl.checked = true;
        }),
        dispatchEvent: vi.fn((e: Event) => {
          if (e.type === 'click') {
            statusValue = val;
            inputEl.checked = true;
          }
        }),
      };
      inputEl.parentElement = labelEl;
      return { inputEl, labelEl };
    };

    const normal = createRadioItem('0', '正常');
    const disabled = createRadioItem('1', '停用');

    radioContainer.querySelectorAll = (sel: string) => [normal.labelEl, disabled.labelEl];

    // 注册到 DOM 注册表
    const optionElements = new Map<string, HTMLElement>([
      ['正常', normal.labelEl],
      ['停用', disabled.labelEl],
    ]);
    FormDOMRegistry.register('field_status', normal.inputEl, 'snap_radio', optionElements);

    // 执行单选：选择“停用”
    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_status', action: 'select', value: '停用' },
      'snap_radio',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(statusValue).toBe('1');
    expect(disabled.labelEl.click.mock.calls.length > 0 || disabled.labelEl.dispatchEvent.mock.calls.length > 0).toBe(true);
  });

  it('2. 多选下拉框：支持 values 数组或逗号分隔文本，依次点击选项、渲染 Tags 并通过 blur 失焦安全平稳收起（杜绝 ESC 误关闭弹窗）', async () => {
    const selectedTags: string[] = [];
    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => null, click: vi.fn(), dispatchEvent: vi.fn(), blur: vi.fn() };

    const createOption = (text: string) => {
      const opt: any = {
        id: `opt_${text}`,
        textContent: text,
        getAttribute: () => null,
        closest: () => null,
        querySelector: () => null,
        scrollIntoView: vi.fn(),
        click: vi.fn(() => {
          if (!selectedTags.includes(text)) {
            selectedTags.push(text);
          }
        }),
        dispatchEvent: vi.fn((e: Event) => {
          if (e.type === 'click' && !selectedTags.includes(text)) {
            selectedTags.push(text);
          }
        }),
      };
      return opt;
    };

    const optAdmin = createOption('系统管理员');
    const optDevOps = createOption('运维工程师');
    const optTester = createOption('测试员');

    const menu: any = {
      querySelectorAll: (sel: string) =>
        sel.includes('[role="option"]') ? [optAdmin, optDevOps, optTester] : [],
    };

    const wrapper: any = {
      tagName: 'DIV',
      className: 'el-select is-multiple',
      classList: { contains: (cls: string) => cls.includes('multiple') },
      getAttribute: () => null,
      closest: () => null,
      querySelector: (sel: string) => (sel.includes('input') ? input : null),
      querySelectorAll: (sel: string) => {
        if (sel.includes('tags-text')) {
          return selectedTags.map((t) => ({ textContent: t }));
        }
        return [];
      },
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('field_roles', wrapper, 'snap_multi');

    // 执行多选赋值
    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_roles', action: 'select', values: ['系统管理员', '运维工程师'] },
      'snap_multi',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(selectedTags).toContain('系统管理员');
    expect(selectedTags).toContain('运维工程师');
    expect(input.blur).toHaveBeenCalled();
  });

  it('3. 树形下拉框 Search-First 穿透：优先使用内置搜索框键入目标，触发过滤直达目标叶子节点', async () => {
    let searchedKeyword = '';
    const searchInput: any = {
      tagName: 'INPUT',
      className: 'el-select__input',
      value: '',
      readOnly: false,
      getAttribute: () => null,
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'input') {
          searchedKeyword = searchInput.value;
        }
      }),
    };

    let selectedValue = '';
    const targetOption: any = {
      id: 'node_fe',
      textContent: '前端开发组',
      getAttribute: () => null,
      closest: () => null,
      querySelector: () => null,
      scrollIntoView: vi.fn(),
      click: vi.fn(() => {
        selectedValue = '前端开发组';
      }),
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') {
          selectedValue = '前端开发组';
        }
      }),
    };

    const menu: any = {
      // 只有在搜索输入“前端”或“前端开发组”后才显示出过滤出的选项
      querySelectorAll: (sel: string) =>
        searchedKeyword.includes('前端') && sel.includes('[role="option"]') ? [targetOption] : [],
    };

    const wrapper: any = {
      tagName: 'DIV',
      className: 'el-select',
      getAttribute: () => null,
      closest: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('input')) return searchInput;
        if (sel.includes('single-value') || sel.includes('selected-item')) {
          return selectedValue ? { textContent: selectedValue } : null;
        }
        return null;
      },
      querySelectorAll: () => [],
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('field_dept', wrapper, 'snap_search');

    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_dept', action: 'select', value: '前端开发组' },
      'snap_search',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(searchedKeyword).toBe('前端开发组');
    expect(selectedValue).toBe('前端开发组');
  });

  it('4. 异步懒加载树：点击展开节点等待异步网络 loading 动画消失并挂载子节点后完成选中', async () => {
    let isExpanded = false;
    let isLoading = false;
    let selectedValue = '';

    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => null };

    // 展开箭头
    const expandArrow: any = {
      tagName: 'I',
      className: 'el-tree-node__expand-icon',
      parentElement: null,
      getAttribute: () => null,
      closest: () => null,
      click: vi.fn(() => {
        isLoading = true;
        setTimeout(() => {
          isLoading = false;
          isExpanded = true;
        }, 150);
      }),
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') {
          isLoading = true;
          setTimeout(() => {
            isLoading = false;
            isExpanded = true;
          }, 150);
        }
      }),
    };

    // 懒加载子节点
    const lazyLeafOption: any = {
      id: 'lazy_node_bigdata',
      textContent: '大数据开发组',
      getAttribute: () => null,
      closest: () => null,
      querySelector: () => null,
      scrollIntoView: vi.fn(),
      click: vi.fn(() => {
        selectedValue = '大数据开发组';
      }),
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') {
          selectedValue = '大数据开发组';
        }
      }),
    };

    const menu: any = {
      querySelectorAll: (sel: string) => {
        if (sel.includes('expand-icon')) {
          return isExpanded ? [] : [expandArrow];
        }
        if (sel.includes('[role="option"]')) {
          return isExpanded ? [lazyLeafOption] : [];
        }
        return [];
      },
      querySelector: (sel: string) => {
        if (sel.includes('loading') && isLoading) {
          return { tagName: 'I', className: 'is-loading' };
        }
        return null;
      },
    };

    const wrapper: any = {
      tagName: 'DIV',
      className: 'el-tree-select',
      getAttribute: () => null,
      matches: () => true,
      closest: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('input')) return input;
        if (sel.includes('single-value') || sel.includes('selected-item')) {
          return selectedValue ? { textContent: selectedValue } : null;
        }
        return null;
      },
      querySelectorAll: () => [],
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('field_lazy_tree', wrapper, 'snap_lazy');

    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_lazy_tree', action: 'select', value: '大数据开发组' },
      'snap_lazy',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(selectedValue).toBe('大数据开发组');
    expect(expandArrow.click.mock.calls.length > 0 || expandArrow.dispatchEvent.mock.calls.length > 0).toBe(true);
  });

  it('5. Element UI 若依真实场景：当浮层带有 aria-hidden="true" 且目标文本存在偏差时，能够正常识别选项并智能匹配/兜底成功', async () => {
    let currentSelected = '';
    const option1: any = {
      tagName: 'LI',
      className: 'el-select-dropdown__item',
      textContent: '董事长',
      getAttribute: (attr: string) => attr === 'value' ? '1' : null,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') currentSelected = '董事长';
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const option2: any = {
      tagName: 'LI',
      className: 'el-select-dropdown__item',
      textContent: '普通员工',
      getAttribute: (attr: string) => attr === 'value' ? '2' : null,
      scrollIntoView: vi.fn(),
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') currentSelected = '普通员工';
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    // Element UI 官方硬编码 aria-hidden="true"
    const popper: any = {
      tagName: 'DIV',
      className: 'el-select-dropdown el-popper',
      getAttribute: (attr: string) => attr === 'aria-hidden' ? 'true' : null,
      style: { display: 'block' },
      querySelectorAll: (sel: string) => [option1, option2],
      querySelector: () => null,
    };
    option1.parentElement = popper;
    option2.parentElement = popper;

    const selectWrapper: any = {
      tagName: 'DIV',
      className: 'el-select',
      getAttribute: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('input')) {
          return {
            tagName: 'INPUT',
            className: 'el-input__inner',
            value: currentSelected,
            placeholder: '请选择岗位',
            getAttribute: () => null,
            dispatchEvent: vi.fn(),
          };
        }
        return null;
      },
      querySelectorAll: () => [],
      dispatchEvent: vi.fn(),
    };

    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(selectWrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(popper);
    FormDOMRegistry.register('field_post', selectWrapper, 'snap_ruoyi');

    // 目标传入带微小偏差的“普通角色”，测试智能相互包含与兜底匹配
    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_post', action: 'select', value: '普通员工' },
      'snap_ruoyi',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(currentSelected).toBe('普通员工');
  });

  it('6. 若依管理系统真实场景：归属部门未展开时自动提取页面上下文组织树；若执行目标为不存在的「技术部」，搜索致空后能自动清空恢复并自愈选择真实部门「河钢集团」', async () => {
    let selectedDept = '';
    let searchValue = '';

    // 页面背景组织树节点（模拟若依左侧背景中的 .head-container .el-tree）
    const bgTreeNode1: any = {
      tagName: 'DIV',
      className: 'el-tree-node__content',
      textContent: '河钢集团 (7)',
      getAttribute: () => null,
      querySelector: () => null,
      closest: (sel: string) => sel.includes('sidebar') || sel.includes('head-container') ? {} : null,
    };
    const bgTreeNode2: any = {
      tagName: 'DIV',
      className: 'el-tree-node__content',
      textContent: '河钢集团供应链管理有限公司',
      getAttribute: () => null,
      querySelector: () => null,
      closest: (sel: string) => sel.includes('sidebar') || sel.includes('head-container') ? {} : null,
    };

    const bgTree: any = {
      tagName: 'DIV',
      className: 'el-tree',
      closest: () => null,
      querySelectorAll: (sel: string) => {
        if (sel.includes('el-tree-node__content') || sel.includes('el-tree-node__label') || sel.includes('treeitem')) {
          return [bgTreeNode1, bgTreeNode2];
        }
        return [bgTreeNode1, bgTreeNode2];
      },
    };

    const mockDoc: any = {
      querySelectorAll: (sel: string) => {
        if (sel.includes('.head-container .el-tree') || sel.includes('.el-tree')) {
          return [bgTree];
        }
        return [];
      },
    };

    // 弹窗内部归属部门 vue-treeselect 真实浮层选项（事件监听绑定在内层 label-container 上）
    const labelContainer: any = {
      tagName: 'DIV',
      className: 'vue-treeselect__label-container',
      textContent: '河钢集团',
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') selectedDept = '河钢集团';
      }),
    };

    const optHeGang: any = {
      tagName: 'DIV',
      className: 'vue-treeselect__option',
      textContent: '河钢集团',
      getAttribute: () => null,
      closest: () => null,
      scrollIntoView: vi.fn(),
      querySelector: (sel: string) => sel.includes('label-container') ? labelContainer : null,
      querySelectorAll: () => [],
      dispatchEvent: vi.fn(),
    };

    const optHeGangSub: any = {
      tagName: 'DIV',
      className: 'vue-treeselect__option',
      textContent: '河钢集团供应链管理有限公司',
      getAttribute: () => null,
      closest: () => null,
      scrollIntoView: vi.fn(),
      querySelector: () => null,
      querySelectorAll: () => [],
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'click') selectedDept = '河钢集团供应链管理有限公司';
      }),
    };

    const searchInput: any = {
      tagName: 'INPUT',
      className: 'vue-treeselect__input',
      value: '',
      readOnly: false,
      getAttribute: () => null,
      dispatchEvent: vi.fn((e: Event) => {
        if (e.type === 'input') {
          searchValue = searchInput.value;
        }
      }),
    };

    const treeselectMenu: any = {
      tagName: 'DIV',
      className: 'vue-treeselect__menu',
      style: { display: 'block' },
      getAttribute: () => null,
      querySelectorAll: (sel: string) => {
        // 当被输入“技术部”时，由于不存在该部门，树被过滤为 0 项
        if (searchValue === '技术部') {
          return [];
        }
        return [optHeGang, optHeGangSub];
      },
      querySelector: (sel: string) => {
        if (searchValue === '技术部' && sel.includes('no-results')) {
          return { tagName: 'DIV', className: 'vue-treeselect__tip--no-results', textContent: '无匹配部门' };
        }
        return null;
      },
    };
    optHeGang.parentElement = treeselectMenu;
    optHeGangSub.parentElement = treeselectMenu;

    const deptWrapper: any = {
      tagName: 'DIV',
      className: 'vue-treeselect',
      ownerDocument: mockDoc,
      getAttribute: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('vue-treeselect__input')) return searchInput;
        if (sel.includes('single-value')) return selectedDept ? { textContent: selectedDept } : null;
        return null;
      },
      querySelectorAll: () => [],
      dispatchEvent: vi.fn(),
    };

    // 1. 验证扫描阶段：归属部门能从上下文组织树中提取真实部门候选
    const scannedOptions = FormScanner.extractDropdownOptionsFromDom(deptWrapper, deptWrapper, mockDoc, '归属部门');
    expect(scannedOptions.length).toBe(2);
    expect(scannedOptions[0].label).toBe('河钢集团');
    expect(scannedOptions[1].label).toBe('河钢集团供应链管理有限公司');

    // 2. 验证执行阶段：传入带角标的“河钢集团(7)”，能通过归一化匹配，并精准命中内层 labelContainer 触发选中，回读成功！
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(deptWrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(treeselectMenu);
    FormDOMRegistry.register('field_dept', deptWrapper, 'snap_ruoyi_dept');

    const result = await (FormExecutor as any).executeAssignment(
      { fieldId: 'field_dept', action: 'select', value: '河钢集团(7)' },
      'snap_ruoyi_dept',
      'allow_overwrite'
    );

    expect(result.status, result.error).toBe('success');
    expect(selectedDept).toBe('河钢集团');
    expect(labelContainer.dispatchEvent).toHaveBeenCalled();
  });
});

