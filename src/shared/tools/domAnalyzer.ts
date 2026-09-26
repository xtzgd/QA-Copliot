import { FormFieldInfo, PageActionInfo, PageContext } from '../types/page';

export class DomAnalyzer {
  private static isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  static parsePageFields(root: Document = document): FormFieldInfo[] {
    const fields: FormFieldInfo[] = [];
    root.querySelectorAll('input, select, textarea').forEach((element) => {
      const input = element as HTMLInputElement;
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
      if (!this.isVisible(input)) return;

      let label = input.labels?.[0]?.textContent?.trim() || '';
      if (!label && input.id) label = root.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent?.trim() || '';
      if (!label) label = input.closest('label')?.textContent?.replace(input.value || '', '').trim() || '';
      if (!label) label = input.name || input.placeholder || '未命名字段';

      const min = input.min === '' ? undefined : Number(input.min);
      const max = input.max === '' ? undefined : Number(input.max);
      fields.push({
        tag: input.tagName.toLowerCase(),
        name: input.name || input.id || '',
        label,
        type: input.type || input.tagName.toLowerCase(),
        required: input.required || input.hasAttribute('required'),
        maxLength: input.maxLength > 0 ? input.maxLength : undefined,
        min: min !== undefined && Number.isFinite(min) ? min : undefined,
        max: max !== undefined && Number.isFinite(max) ? max : undefined,
        pattern: input.pattern || undefined,
        placeholder: input.placeholder || undefined,
      });
    });
    return fields;
  }

  static parsePageActions(root: Document = document): PageActionInfo[] {
    const actions: PageActionInfo[] = [];
    root.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((element) => {
      const control = element as HTMLButtonElement | HTMLInputElement;
      if (!this.isVisible(control)) return;
      const label = (control.getAttribute('aria-label') || control.textContent || control.value || control.title || '').trim();
      if (!label) return;
      actions.push({
        tag: control.tagName.toLowerCase(),
        type: control.getAttribute('type') || control.getAttribute('role') || 'button',
        label: label.slice(0, 120),
        name: control.getAttribute('name') || control.id || undefined,
      });
    });
    return actions.slice(0, 50);
  }

  static parsePageContext(root: Document = document): PageContext {
    return {
      fields: this.parsePageFields(root),
      actions: this.parsePageActions(root),
      formCount: root.querySelectorAll('form').length,
    };
  }
}
