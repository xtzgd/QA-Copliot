/**
 * Playwright / Selenium 定位器生成器 (TASK-501 & TASK-502)
 * 智能推荐最佳定位策略：getByRole -> getByLabel -> getByTestId -> getByText -> CSS
 */

export interface ElementInspectResult {
  tag: string;
  text: string;
  id?: string;
  name?: string;
  role?: string;
  testId?: string;
  css: string;
  xpath: string;
  frame?: ElementFrameInfo;
  playwright: {
    recommended: string;
    strategy: 'role' | 'label' | 'testid' | 'text' | 'css';
    alternatives: string[];
  };
}

export interface ElementFrameInfo {
  frameId?: number;
  url: string;
  frameXPath: string[];
  frameCssPath: string[];
  offset: { left: number; top: number };
  zoom: number;
  complete: boolean;
}

export class LocatorGenerator {
  private static quote(value: string): string {
    return JSON.stringify(value);
  }

  private static cssEscape(value: string): string {
    const cssEscape = (globalThis as typeof globalThis & { CSS?: typeof CSS }).CSS?.escape;
    if (cssEscape) return cssEscape(value);
    return Array.from(value).map((char, index) => {
      const code = char.codePointAt(0) || 0;
      if (code === 0) return '\\fffd ';
      if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) ||
        (index === 1 && value[0] === '-' && code >= 48 && code <= 57)) {
        return `\\${code.toString(16)} `;
      }
      if (code >= 128 || char === '-' || char === '_' || /[a-zA-Z0-9]/.test(char)) return char;
      return `\\${char}`;
    }).join('');
  }

  static generate(el: {
    tag: string;
    text?: string;
    id?: string;
    name?: string;
    role?: string;
    testId?: string;
    placeholder?: string;
    ariaLabel?: string;
    label?: string;
    frameCssPath?: string[];
    frameUrl?: string;
    isChildFrame?: boolean;
  }): ElementInspectResult['playwright'] {
    const tag = el.tag.toLowerCase();
    const text = (el.text || el.ariaLabel || '').trim();
    const safeText = this.quote(text);
    const alternatives: string[] = [];
    const page = (el.frameCssPath || []).length > 0
      ? `page${(el.frameCssPath || []).map((selector) => `.frameLocator(${this.quote(selector)})`).join('')}`
      : el.isChildFrame && el.frameUrl
        ? `page.frame({ url: new URL(${this.quote(el.frameUrl)}) })!`
        : 'page';
    const cssId = el.id ? `#${this.cssEscape(el.id)}` : undefined;

    // 1. 可交互语义优先 getByRole
    const effectiveRole = el.role || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : undefined);
    if (effectiveRole && text) {
      const loc = `${page}.getByRole(${this.quote(effectiveRole)}, { name: ${safeText} })`;
      if (cssId) alternatives.push(`${page}.locator(${this.quote(cssId)})`);
      alternatives.push(`${page}.getByText(${safeText})`);
      return { recommended: loc, strategy: 'role', alternatives };
    }

    // 2. 表单项优先使用真实 label
    if (el.label) {
      const loc = `${page}.getByLabel(${this.quote(el.label)})`;
      if (el.testId) alternatives.push(`${page}.getByTestId(${this.quote(el.testId)})`);
      return { recommended: loc, strategy: 'label', alternatives };
    }

    // 3. 普通可见文本
    if (text && text.length < 80 && !['input', 'select', 'textarea'].includes(tag)) {
      const loc = `${page}.getByText(${safeText})`;
      if (el.testId) alternatives.push(`${page}.getByTestId(${this.quote(el.testId)})`);
      if (cssId) alternatives.push(`${page}.locator(${this.quote(cssId)})`);
      return { recommended: loc, strategy: 'text', alternatives };
    }

    // 4. data-testid
    if (el.testId) {
      return { recommended: `${page}.getByTestId(${this.quote(el.testId)})`, strategy: 'testid', alternatives };
    }

    // 5. 无 label 时退化到 placeholder
    if (el.placeholder) {
      const loc = `${page}.getByPlaceholder(${this.quote(el.placeholder)})`;
      return { recommended: loc, strategy: 'label', alternatives };
    }

    // 6. CSS Fallback
    const css = cssId || (el.name ? `${tag}[name=${this.quote(el.name)}]` : tag);
    return {
      recommended: `${page}.locator(${this.quote(css)})`,
      strategy: 'css',
      alternatives,
    };
  }
}
