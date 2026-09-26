import { ClickEventPayload, InputEventPayload, NavigationEventPayload, QAEvent, ScrollEventPayload } from '../types/event';

function tsString(value: string): string {
  return JSON.stringify(value);
}

function clickLocator(payload: ClickEventPayload): string {
  if (payload.fieldLabel && (payload.isInput || ['INPUT', 'TEXTAREA', 'SELECT'].includes(payload.tag))) {
    return `page.getByLabel(${tsString(payload.fieldLabel)})`;
  }
  const text = payload.text?.trim();
  if (payload.role && text) return `page.getByRole(${tsString(payload.role)}, { name: ${tsString(text)} })`;
  if (text && ['BUTTON', 'A'].includes(payload.tag)) return `page.getByText(${tsString(text)}, { exact: true })`;
  if (payload.id) return `page.locator(${tsString(`#${payload.id}`)})`;
  if (payload.name) return `page.locator(${tsString(`[name="${payload.name}"]`)})`;
  return `page.locator(${tsString(payload.selector || payload.tag.toLowerCase())})`;
}

function inputLocator(payload: InputEventPayload): string {
  if (payload.fieldLabel) return `page.getByLabel(${tsString(payload.fieldLabel)})`;
  if (payload.placeholder) return `page.getByPlaceholder(${tsString(payload.placeholder)})`;
  if (payload.fieldName) return `page.locator(${tsString(`[name="${payload.fieldName}"]`)})`;
  return `page.locator(${tsString(payload.tag.toLowerCase())})`;
}

export class PlaywrightSessionExporter {
  static generate(events: QAEvent[], title = 'QA Copilot recorded flow'): string {
    const lines = [
      `import { test, expect } from '@playwright/test';`,
      '',
      `test(${tsString(title)}, async ({ page }) => {`,
    ];

    events.slice().sort((a, b) => a.timestamp - b.timestamp).forEach((event) => {
      if (event.type === 'navigation') {
        const payload = event.payload as NavigationEventPayload;
        const destination = payload.toUrl || event.url;
        if (destination) lines.push(`  await page.goto(${tsString(destination)});`);
      } else if (event.type === 'click') {
        lines.push(`  await ${clickLocator(event.payload as ClickEventPayload)}.click();`);
      } else if (event.type === 'input') {
        const payload = event.payload as InputEventPayload;
        const locator = inputLocator(payload);
        if (payload.inputType === 'checkbox' || payload.inputType === 'radio') {
          lines.push(`  await ${locator}.${payload.value === '未选中' ? 'uncheck' : 'check'}();`);
        } else if (payload.tag === 'SELECT' || payload.inputType === 'select') {
          lines.push(`  await ${locator}.selectOption(${tsString(payload.value)});`);
        } else {
          lines.push(`  await ${locator}.fill(${tsString(payload.value)});`);
        }
      } else if (event.type === 'scroll') {
        const payload = event.payload as ScrollEventPayload;
        if (payload.target === 'window') {
          lines.push(`  await page.evaluate(() => window.scrollTo(${payload.scrollLeft}, ${payload.scrollTop}));`);
        } else if (payload.selector) {
          lines.push(`  await page.locator(${tsString(payload.selector)}).evaluate((element) => element.scrollTo(${payload.scrollLeft}, ${payload.scrollTop}));`);
        }
      }
    });

    lines.push('', '  // TODO: 根据业务结果补充断言。', `  await expect(page).toHaveURL(/.+/);`, '});', '');
    return lines.join('\n');
  }
}
