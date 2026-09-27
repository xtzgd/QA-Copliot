import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormScanner, FormDOMRegistry } from '../src/content/formScanner';
import { FormExecutor } from '../src/content/formExecutor';
import { matchTemplateField } from '../src/shared/utils/formTemplateMatching';
import { FormFieldItem } from '../src/shared/types/formFill';

afterEach(() => { vi.restoreAllMocks(); FormDOMRegistry.clearAll(); });
const field = (id: string, label: string, name = '') => ({ fieldId: id, label, name, kind: 'text', disabled: false, readOnly: false } as FormFieldItem);

describe('form fill review regressions', () => {
  it('matches name before an earlier fuzzy label', () => {
    const exact = field('exact', '办公电话', 'officePhone');
    expect(matchTemplateField({ labelPattern: '电话', fieldName: 'officePhone', value: '123' }, [field('wrong', '联系电话'), exact])).toBe(exact);
  });
  it('normalizes whitespace and refuses ambiguous fuzzy labels', () => {
    const exact = field('exact', '联 系 电话');
    expect(matchTemplateField({ labelPattern: '联系电话', value: '123' }, [exact])).toBe(exact);
    expect(matchTemplateField({ labelPattern: '电话', value: '123' }, [exact, field('office', '办公电话')])).toBeUndefined();
  });
  it('does not match an empty field label or incompatible kind', () => {
    expect(matchTemplateField({ labelPattern: '电话', value: '123' }, [field('blank', '')])).toBeUndefined();
    expect(matchTemplateField({ labelPattern: '电话', kind: 'select', value: '123' }, [field('text', '电话')])).toBeUndefined();
  });
  it('scanWithProbe remains read only outside dialogs too', async () => {
    const click = vi.spyOn(FormScanner, 'dispatchFullClick');
    const element: any = { closest: () => null, querySelector: () => null, blur: vi.fn() };
    const snapshot: any = { snapshotId: 's', fields: [{ fieldId: 'f', kind: 'select', optionsState: 'unloaded' }] };
    FormDOMRegistry.register('f', element, 's');
    vi.spyOn(FormScanner, 'scan').mockReturnValue(snapshot);
    expect(await FormScanner.scanWithProbe({} as Document)).toBe(snapshot);
    expect(click).not.toHaveBeenCalled();
    expect(element.blur).not.toHaveBeenCalled();
  });
  it('selects the highest dialog ancestor z-index rather than selector enumeration order', () => {
    const dialog = (zIndex: string): any => ({ tagName: 'DIV', style: {}, parentElement: { style: { zIndex }, parentElement: null }, getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null, getBoundingClientRect: () => ({ width: 100, height: 100 }) });
    const top = dialog('3000'), background = dialog('1000');
    const doc: any = { querySelectorAll: (selector: string) => selector === '.el-dialog' ? [top] : selector === '[role="dialog"]' ? [background] : [] };
    expect((FormScanner as any).findTopmostActiveScope(doc).scopeElement).toBe(top);
  });
  it('rejects a dialog hidden by an ancestor', () => {
    const el: any = { style: {}, parentElement: { style: { display: 'none' } }, getBoundingClientRect: () => ({ width: 100, height: 100 }) };
    expect((FormScanner as any).isVisible(el)).toBe(false);
  });
  it.each([false, true])('requires a real component display update after option click: %s', async (updates) => {
    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => null, click: vi.fn(), dispatchEvent: vi.fn() };
    const option: any = { id: 'male', textContent: '男', getAttribute: () => null, closest: () => null, querySelector: () => null, click: vi.fn(() => { if (updates) input.value = '男'; }) };
    const menu: any = { querySelectorAll: (selector: string) => selector.includes('[role="option"]') ? [option] : [] };
    const wrapper: any = { tagName: 'DIV', getAttribute: () => null, closest: () => wrapper, querySelector: (selector: string) => selector.includes('input') ? input : null, querySelectorAll: () => [] };
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('f', wrapper, 's');
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'select', value: '男' }, 's', 'allow_overwrite');
    expect(option.click).toHaveBeenCalledOnce();
    expect(input.dispatchEvent).not.toHaveBeenCalled();
    expect(result.status).toBe(updates ? 'success' : 'failed');
  });
  it('does not click a background tree or option when no associated menu exists', async () => {
    const backgroundClick = vi.fn();
    const doc: any = { querySelectorAll: () => [{ textContent: '男', click: backgroundClick }] };
    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => null, click: vi.fn() };
    const wrapper: any = { tagName: 'DIV', ownerDocument: doc, getAttribute: () => null, closest: () => null, querySelector: () => input, querySelectorAll: () => [] };
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(null);
    FormDOMRegistry.register('f', wrapper, 's');
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'select', value: '男' }, 's', 'allow_overwrite');
    expect(result.status).toBe('failed');
    expect(backgroundClick).not.toHaveBeenCalled();
  });
  it('rejects an unknown radio choice without clicking the first radio', async () => {
    const radio: any = { tagName: 'INPUT', type: 'radio', checked: false, closest: () => null, click: vi.fn() };
    FormDOMRegistry.register('f', radio, 's', new Map());
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'check', value: 'unknown' }, 's', 'allow_overwrite');
    expect(result.status).toBe('failed'); expect(radio.click).not.toHaveBeenCalled();
  });
  it('protects a selected non-first radio and restores the group through its option', async () => {
    const first: any = { tagName: 'INPUT', type: 'radio', checked: false, closest: () => null, value: '0' };
    const second: any = { tagName: 'INPUT', type: 'radio', checked: true, closest: () => null, value: '1' };
    first.click = vi.fn(() => { first.checked = true; second.checked = false; });
    second.click = vi.fn(() => { second.checked = true; first.checked = false; });
    FormDOMRegistry.register('f', first, 's', new Map([['男', first], ['女', second]]));
    const assignment: any = { fieldId: 'f', action: 'check', value: '男', source: 'instruction' };
    const skipped = await FormExecutor.executePlan('s', [assignment], 'empty_only');
    expect(skipped.steps[0].status).toBe('skipped');
    expect(first.click).not.toHaveBeenCalled();
    const filled = await FormExecutor.executePlan('s', [assignment], 'allow_overwrite');
    expect(filled.steps[0]).toMatchObject({ status: 'success', beforeValue: '女', appliedValue: '男' });
    expect((await FormExecutor.undo(filled.runId)).restoredCount).toBe(1);
    expect(second.checked).toBe(true);
  });

  it.each(['浙江 / 杭州 / 西湖', '西湖'])('selects asynchronously mounted cascader levels: %s', async (value) => {
    let stage = 0;
    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => null, click: vi.fn() };
    const option = (text: string, index: number): any => ({
      id: text, textContent: text, getAttribute: () => null, closest: () => null,
      querySelector: (selector: string) => index < 2 && selector.startsWith('.el-cascader-node__postfix') ? {} : null,
      click: vi.fn(() => { setTimeout(() => { if (index < 2) stage++; else input.value = value; }, 150); }),
    });
    const options = [option('浙江', 0), option('杭州', 1), option('西湖', 2)];
    const menu: any = { querySelectorAll: (selector: string) => selector.includes('[role="option"]') ? [options[stage]] : [] };
    const wrapper: any = { tagName: 'DIV', getAttribute: () => null, closest: () => null, querySelector: (selector: string) => selector.includes('input') ? input : null, querySelectorAll: () => [] };
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('f', wrapper, 's');
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'select', value }, 's', 'allow_overwrite');
    expect(result.status, result.error).toBe('success');
    for (const opt of options) expect(opt.click).toHaveBeenCalledOnce();
  });
  it('waits for delayed single-level options and does not close an already open select', async () => {
    let ready = false;
    const input: any = { tagName: 'INPUT', value: '', readOnly: true, getAttribute: () => 'true', click: vi.fn() };
    const option: any = { id: 'male', textContent: '男', getAttribute: () => null, closest: () => null, querySelector: () => null, click: () => { input.value = '男'; } };
    const menu: any = { querySelectorAll: (selector: string) => ready && selector.includes('[role="option"]') ? [option] : [] };
    const wrapper: any = { tagName: 'DIV', getAttribute: () => null, closest: () => null, querySelector: (selector: string) => selector.includes('input') ? input : null, querySelectorAll: () => [] };
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('f', wrapper, 's');
    setTimeout(() => { ready = true; }, 1000);
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'select', value: '男' }, 's', 'allow_overwrite');
    expect(result.status, result.error).toBe('success');
    expect(input.click).not.toHaveBeenCalled();
  });

  it('resolves a nested ARIA trigger to the visible dropdown around its accessibility list', () => {
    const menu: any = { style: {}, parentElement: null };
    const accessibilityList: any = { closest: () => menu };
    const doc: any = { getElementById: (id: string) => id === 'items' ? accessibilityList : null };
    const trigger: any = { getAttribute: (name: string) => name === 'aria-controls' ? 'missing items' : null };
    const wrapper: any = { tagName: 'DIV', ownerDocument: doc, getAttribute: () => null, querySelector: (selector: string) => selector === '[aria-controls], [aria-owns]' ? trigger : null };
    expect(FormScanner.findAssociatedDropdownContainer(wrapper, wrapper, doc)).toBe(menu);
  });
  it('does not use a hidden ARIA-linked dropdown from a previous render', () => {
    const hidden: any = { style: { display: 'none' }, parentElement: null };
    const doc: any = { getElementById: () => ({ closest: () => hidden }), querySelectorAll: () => [] };
    const wrapper: any = { tagName: 'DIV', ownerDocument: doc, getAttribute: (name: string) => name === 'aria-controls' ? 'old' : null, querySelector: () => null };
    expect(FormScanner.findAssociatedDropdownContainer(wrapper, wrapper, doc)).toBeNull();
  });

  it.each(['', '101'])('does not filter a lazy tree by its target ID and clears an old failed search: %s', async (oldSearch) => {
    let ready = false;
    const queries: string[] = [];
    const input: any = { tagName: 'INPUT', value: oldSearch, readOnly: false, getAttribute: () => null, click: vi.fn(), dispatchEvent: (event: Event) => { if (event.type === 'input') queries.push(input.value); } };
    let selected = '';
    const option: any = { id: 'dept-101', textContent: '研发部', getAttribute: (name: string) => name === 'data-value' ? '101' : null, closest: () => null, querySelector: () => null, click: () => { selected = '研发部'; } };
    const menu: any = { querySelectorAll: (selector: string) => ready && !input.value && selector.includes('[role="option"]') ? [option] : [], querySelector: () => null };
    const wrapper: any = { tagName: 'DIV', getAttribute: () => null, matches: () => true, closest: () => null,
      querySelector: (selector: string) => selector.includes('single-value') ? (selected ? { textContent: selected } : null) : selector.includes('input') ? input : null,
      querySelectorAll: () => [] };
    vi.spyOn(FormScanner, 'findDropdownRoot').mockReturnValue(wrapper);
    vi.spyOn(FormScanner, 'findAssociatedDropdownContainer').mockReturnValue(menu);
    FormDOMRegistry.register('f', wrapper, 's');
    setTimeout(() => { ready = true; }, 350);
    const result = await (FormExecutor as any).executeAssignment({ fieldId: 'f', action: 'select', value: '101' }, 's', 'allow_overwrite');
    expect(result.status, result.error).toBe('success');
    expect(selected).toBe('研发部');
    expect(queries).toEqual(oldSearch ? [''] : []);
  });

});
