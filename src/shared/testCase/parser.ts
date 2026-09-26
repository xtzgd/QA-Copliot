import {
  ImportedTestCase,
  ImportedTestSuite,
  MidsceneStep,
  TestCaseParseResult,
} from '../types/testCase';

const MAX_SOURCE_CHARS = 256_000;
const MAX_CASES = 20;
const MAX_STEPS = 100;

interface YamlLine {
  raw: string;
  number: number;
  indent: number;
}

class SafeYamlSubsetParser {
  private index = 0;
  private readonly lines: YamlLine[];
  readonly nodeLines = new Map<object, number>();

  constructor(source: string) {
    this.lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).map((raw, i) => ({
      raw,
      number: i + 1,
      indent: raw.match(/^ */)?.[0].length || 0,
    }));
  }

  parse(): unknown {
    this.skipIgnorable();
    if (this.index >= this.lines.length) throw new Error('YAML 文件为空');
    if (this.lines[this.index].indent !== 0) {
      throw this.error(this.lines[this.index], '根节点必须从第 1 列开始');
    }
    const value = this.parseBlock(0);
    this.skipIgnorable();
    if (this.index < this.lines.length) throw this.error(this.lines[this.index], '无法解析此 YAML 节点');
    return value;
  }

  lineOf(value: unknown): number | undefined {
    return value && typeof value === 'object' ? this.nodeLines.get(value as object) : undefined;
  }

  private parseBlock(indent: number): unknown {
    this.skipIgnorable();
    const line = this.lines[this.index];
    if (!line || line.indent !== indent) throw this.error(line, '缩进层级不正确');
    return this.isSequenceLine(this.clean(line))
      ? this.parseSequence(indent)
      : this.parseMapping(indent);
  }

  private parseSequence(indent: number): unknown[] {
    const result: unknown[] = [];
    const first = this.lines[this.index];
    this.nodeLines.set(result, first.number);
    while (true) {
      this.skipIgnorable();
      const line = this.lines[this.index];
      if (!line || line.indent !== indent || !this.isSequenceLine(this.clean(line))) break;
      const content = this.clean(line).slice(1).trimStart();
      this.index += 1;
      if (!content) {
        const next = this.nextMeaningful();
        result.push(next && next.indent > indent ? this.parseBlock(next.indent) : null);
        continue;
      }

      const pair = this.splitPair(content);
      if (pair) {
      const item = Object.create(null) as Record<string, unknown>;
        this.nodeLines.set(item, line.number);
        this.parsePairInto(item, pair.key, pair.value, indent + 2, line);
        this.parseMapping(indent + 2, item);
        result.push(item);
      } else {
        result.push(this.parseScalar(content, line));
      }
    }
    return result;
  }

  private parseMapping(
    indent: number,
    result: Record<string, unknown> = Object.create(null) as Record<string, unknown>,
  ): Record<string, unknown> {
    const first = this.lines[this.index];
    if (first && !this.nodeLines.has(result)) this.nodeLines.set(result, first.number);
    while (true) {
      this.skipIgnorable();
      const line = this.lines[this.index];
      if (!line || line.indent < indent) break;
      if (line.indent > indent) throw this.error(line, '缩进层级不正确');
      const content = this.clean(line);
      if (this.isSequenceLine(content)) break;
      const pair = this.splitPair(content);
      if (!pair) throw this.error(line, '映射项需要 key: value 格式');
      this.index += 1;
      this.parsePairInto(result, pair.key, pair.value, indent, line);
    }
    return result;
  }

  private parsePairInto(
    result: Record<string, unknown>,
    rawKey: string,
    rawValue: string,
    parentIndent: number,
    line: YamlLine,
  ): void {
    const key = this.parseKey(rawKey, line);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw this.error(line, `重复字段「${key}」`);
    const value = rawValue.trim();
    if (/^[|>][+-]?$/.test(value)) {
      result[key] = this.parseBlockScalar(parentIndent, value[0] === '>', value.endsWith('-'));
      return;
    }
    if (value) {
      result[key] = this.parseScalar(value, line);
      return;
    }
    const next = this.nextMeaningful();
    result[key] = next && next.indent > parentIndent ? this.parseBlock(next.indent) : {};
  }

  private parseBlockScalar(parentIndent: number, folded: boolean, stripTrailing: boolean): string {
    const collected: string[] = [];
    let blockIndent: number | undefined;
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.raw.trim() && line.indent <= parentIndent) break;
      this.index += 1;
      if (!line.raw.trim()) {
        collected.push('');
        continue;
      }
      blockIndent ??= line.indent;
      collected.push(line.raw.slice(Math.min(blockIndent, line.raw.length)));
    }
    let value = folded ? collected.join(' ').replace(/\s+/g, ' ') : collected.join('\n');
    if (!stripTrailing && collected.length) value += '\n';
    return value;
  }

  private parseScalar(value: string, line: YamlLine): unknown {
    const text = value.trim();
    if (text.startsWith('!') || text.startsWith('&') || text.startsWith('*')) {
      throw this.error(line, '不支持 YAML 标签、锚点或别名');
    }
    if (text.startsWith('[') && text.endsWith(']')) {
      const inside = text.slice(1, -1).trim();
      return inside ? this.splitFlow(inside).map((part) => this.parseScalar(part, line)) : [];
    }
    if (text.startsWith('{') && text.endsWith('}')) {
      const object = Object.create(null) as Record<string, unknown>;
      const inside = text.slice(1, -1).trim();
      if (!inside) return object;
      for (const part of this.splitFlow(inside)) {
        const pair = this.splitPair(part);
        if (!pair) throw this.error(line, '行内对象需要 key: value 格式');
        const key = this.parseKey(pair.key, line);
        if (Object.prototype.hasOwnProperty.call(object, key)) throw this.error(line, `重复字段「${key}」`);
        object[key] = this.parseScalar(pair.value, line);
      }
      return object;
    }
    if (text.startsWith('"')) {
      try { return JSON.parse(text); } catch { throw this.error(line, '双引号字符串格式不正确'); }
    }
    if (text.startsWith("'")) {
      if (!text.endsWith("'") || text.length < 2) throw this.error(line, '单引号字符串格式不正确');
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (/^(?:null|~)$/i.test(text)) return null;
    if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  }

  private parseKey(raw: string, line: YamlLine): string {
    const key = raw.trim();
    if (!key) throw this.error(line, '字段名不能为空');
    const parsed = (key.startsWith('"') || key.startsWith("'")) ? this.parseScalar(key, line) : key;
    if (typeof parsed !== 'string') throw this.error(line, '字段名必须是字符串');
    return parsed;
  }

  private splitPair(value: string): { key: string; value: string } | null {
    let quote = '';
    let depth = 0;
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (quote) {
        if (char === quote && value[i - 1] !== '\\') {
          if (quote === "'" && value[i + 1] === "'") i += 1;
          else quote = '';
        }
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '[' || char === '{') depth += 1;
      else if (char === ']' || char === '}') depth -= 1;
      else if (char === ':' && depth === 0 && (i === value.length - 1 || /\s/.test(value[i + 1]))) {
        return { key: value.slice(0, i).trim(), value: value.slice(i + 1).trim() };
      }
    }
    return null;
  }

  private splitFlow(value: string): string[] {
    const parts: string[] = [];
    let quote = '';
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (quote) {
        if (char === quote && value[i - 1] !== '\\') {
          if (quote === "'" && value[i + 1] === "'") i += 1;
          else quote = '';
        }
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '[' || char === '{') depth += 1;
      else if (char === ']' || char === '}') depth -= 1;
      else if (char === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  }

  private clean(line: YamlLine): string {
    const source = line.raw.slice(line.indent);
    let quote = '';
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === quote && source[i - 1] !== '\\') quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '#' && (i === 0 || /\s/.test(source[i - 1]))) return source.slice(0, i).trimEnd();
    }
    return source.trimEnd();
  }

  private isSequenceLine(value: string): boolean {
    return /^-(?:\s|$)/.test(value);
  }

  private skipIgnorable(): void {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (!this.clean(line).trim()) this.index += 1;
      else break;
    }
  }

  private nextMeaningful(): YamlLine | undefined {
    let cursor = this.index;
    while (cursor < this.lines.length && !this.clean(this.lines[cursor]).trim()) cursor += 1;
    return this.lines[cursor];
  }

  private error(line: YamlLine | undefined, message: string): Error {
    return new Error(`${line ? `第 ${line.number} 行：` : ''}${message}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function promptText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const record = asRecord(value);
  if (!record || Object.keys(record).some((key) => key !== 'prompt')) return null;
  const prompt = record.prompt;
  return typeof prompt === 'string' ? prompt.trim() || null : null;
}

function extractPageUrl(root: Record<string, unknown>): string | undefined {
  for (const key of ['page', 'web', 'browser', 'target']) {
    const target = asRecord(root[key]);
    if (!target) continue;
    if (typeof target.url === 'string') return target.url;
    const values = asRecord(target.values);
    if (typeof values?.url === 'string') return values.url;
  }
  return undefined;
}

export function parseImportedTestSuite(source: string): TestCaseParseResult {
  if (!source.trim()) return { errors: ['用例内容为空'] };
  if (source.length > MAX_SOURCE_CHARS) return { errors: [`文件超过 ${MAX_SOURCE_CHARS.toLocaleString()} 字符限制`] };

  const yamlParser = source.trimStart().startsWith('{') || source.trimStart().startsWith('[')
    ? null
    : new SafeYamlSubsetParser(source);
  let value: unknown;
  try {
    value = yamlParser ? yamlParser.parse() : JSON.parse(source);
  } catch (error) {
    return { errors: [`解析失败：${(error as Error).message}`] };
  }

  const root = asRecord(value);
  if (!root) return { errors: ['用例根节点必须是对象'] };
  if (!Array.isArray(root.tasks)) return { errors: ['缺少 Midscene 格式的 tasks 数组'] };
  if (root.tasks.length === 0 || root.tasks.length > MAX_CASES) {
    return { errors: [`tasks 数量必须在 1 到 ${MAX_CASES} 之间`] };
  }

  const errors: string[] = [];
  const tasks: ImportedTestCase[] = [];
  let totalSteps = 0;
  root.tasks.forEach((rawTask, taskIndex) => {
    const task = asRecord(rawTask);
    const taskLine = yamlParser?.lineOf(rawTask);
    const taskName = typeof task?.name === 'string' && task.name.trim() ? task.name.trim().slice(0, 200) : `任务 ${taskIndex + 1}`;
    if (!task || !Array.isArray(task.flow)) {
      errors.push(`${taskLine ? `第 ${taskLine} 行：` : ''}${taskName} 缺少 flow 数组`);
      return;
    }
    if (task.continueOnError === true) {
      errors.push(`${taskLine ? `第 ${taskLine} 行：` : ''}${taskName} 设置了 continueOnError；当前版本按失败即停止执行`);
    }
    const steps: MidsceneStep[] = [];
    task.flow.forEach((rawStep, stepIndex) => {
      totalSteps += 1;
      const item = asRecord(rawStep);
      const line = yamlParser?.lineOf(rawStep);
      const location = line ? `第 ${line} 行，` : '';
      if (!item) {
        errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 必须是对象`);
        return;
      }
      const nodeKeys = Object.keys(item).filter((key) => !['name', 'errorMessage', 'cacheable', 'aiActionProgressTips'].includes(key));
      const name = typeof item.name === 'string' ? item.name.slice(0, 200) : undefined;
      const aiKey = ['ai', 'aiAct', 'aiAction'].find((key) => key in item);
      const instruction = aiKey ? promptText(item.instruction) || promptText(item[aiKey]) : null;
      if (aiKey && instruction && nodeKeys.every((key) => ['ai', 'aiAct', 'aiAction', 'instruction'].includes(key))) {
        if (instruction.length > 4_000) errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 的指令超过 4000 字符`);
        else steps.push({ type: 'ai', instruction, name });
      } else if ('aiAssert' in item && nodeKeys.every((key) => key === 'aiAssert')) {
        const assertion = promptText(item.aiAssert);
        if (assertion && assertion.length <= 4_000) steps.push({ type: 'assert', instruction: assertion, name });
        else if (assertion) errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 的 aiAssert 超过 4000 字符`);
        else errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 的 aiAssert 需要非空文本`);
      } else if ('sleep' in item && nodeKeys.every((key) => key === 'sleep')) {
        const milliseconds = Number(item.sleep);
        if (Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 30_000) {
          steps.push({ type: 'sleep', milliseconds, name });
        } else {
          errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 的 sleep 必须是 0 到 30000 毫秒`);
        }
      } else if ('Finalize' in item && nodeKeys.every((key) => key === 'Finalize')) {
        steps.push({ type: 'sleep', milliseconds: 0, name: name || '结束任务' });
      } else {
        const key = nodeKeys[0] || Object.keys(item)[0] || '未知节点';
        steps.push({ type: 'unsupported', key, line, name });
        errors.push(`${location}${taskName} 步骤 ${stepIndex + 1} 使用了当前不支持的节点「${key}」`);
      }
    });
    if (steps.length === 0) errors.push(`${taskName} 没有可执行步骤`);
    tasks.push({ name: taskName, steps, line: taskLine });
  });
  if (totalSteps > MAX_STEPS) errors.push(`全部 tasks 最多允许 ${MAX_STEPS} 个步骤`);

  const pageUrl = extractPageUrl(root);
  if (pageUrl) {
    if (pageUrl.length > 2_048) errors.push('page.url 不能超过 2048 字符');
    try {
      const parsed = new URL(pageUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') errors.push('page.url 只允许 http 或 https');
    } catch { errors.push('page.url 不是有效网址'); }
  }

  const suite: ImportedTestSuite = { pageUrl, tasks };
  return { suite: errors.length === 0 ? suite : undefined, errors };
}
