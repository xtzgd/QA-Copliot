export interface ParsedAiStep {
  name: string;
  instruction: string;
  type: 'ai' | 'assert';
}

/**
 * 智能自然语言多任务/跨系统步骤拆分器
 * 支持：
 * 1. 显式任务标记（如：任务1: ... 任务2: ... 或 Task 1: ... Step 2: ...）
 * 2. 编号列表（如：1. ... 2. ... 或 1、... 2、...）
 * 3. 换行多步骤
 * 4. 自动识别断言/核对意图，并保证流程终态有明确核对
 */
export function splitNaturalLanguageInstruction(rawText: string): ParsedAiStep[] {
  const text = (rawText || '').trim();
  if (!text) return [];

  const isAssertText = (s: string) => {
    const trimmed = (s || '').trim();
    return /^(?:核对|断言|检查|验证|确认|校验)/.test(trimmed) ||
      /^(?:assert|verify|check)\b/i.test(trimmed) ||
      /^(?:查看|观察).*(?:是否|为已|变为|显示为)/.test(trimmed) ||
      /(?:是否|为已|变为|显示为).*(?:正常|成功|通过|正确|完成|已结算|已发货)/.test(trimmed);
  };

  // 1. 尝试匹配“任务1/任务2”或“步骤1/步骤2”或“Task 1/Step 1”
  const taskRegex = /(?:^|[;\n\r；])\s*(?:任务|task|步骤|step)\s*([0-9一二三四五六七八九十]+)\s*[:：\s]/i;
  if (taskRegex.test(text)) {
    const rawParts = text
      .split(/(?:^|[;\n\r；])\s*(?=(?:任务|task|步骤|step)\s*[0-9一二三四五六七八九十]+\s*[:：\s])/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (rawParts.length >= 2) {
      const steps: ParsedAiStep[] = [];
      let hasAssert = false;
      for (const part of rawParts) {
        const cleanContent = part.replace(/^(?:任务|task|步骤|step)\s*[0-9一二三四五六七八九十]+\s*[:：\s]\s*/i, '').trim();
        const assertStep = isAssertText(cleanContent);
        if (assertStep) hasAssert = true;
        steps.push({
          name: part.slice(0, 60),
          instruction: part,
          type: assertStep ? 'assert' : 'ai',
        });
      }
      if (!hasAssert) {
        steps.push({
          name: '整体核对与断言',
          instruction: `核对并断言以上流程执行后，目标是否已成功达成：“${text.slice(0, 120)}”。请结合当前页面状态进行最终核对`,
          type: 'assert',
        });
      }
      return steps;
    }
  }

  // 2. 尝试匹配数字编号列表（如 1. ... 2. ... 或 1、... 2、...）
  const numListRegex = /(?:^|[\n\r])\s*([0-9]{1,2})[\.、\s]\s*/;
  if (numListRegex.test(text)) {
    const rawParts = text
      .split(/(?:^|[\n\r])\s*(?=[0-9]{1,2}[\.、\s]\s*)/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (rawParts.length >= 2) {
      const steps: ParsedAiStep[] = [];
      let hasAssert = false;
      for (const part of rawParts) {
        const cleanContent = part.replace(/^[0-9]{1,2}[\.、\s]\s*/, '').trim();
        const assertStep = isAssertText(cleanContent);
        if (assertStep) hasAssert = true;
        steps.push({
          name: part.slice(0, 60),
          instruction: part,
          type: assertStep ? 'assert' : 'ai',
        });
      }
      if (!hasAssert) {
        steps.push({
          name: '整体核对与断言',
          instruction: `核对并断言以上流程执行后，目标是否已成功达成：“${text.slice(0, 120)}”。请结合当前页面状态进行最终核对`,
          type: 'assert',
        });
      }
      return steps;
    }
  }

  // 3. 尝试按换行多行拆分（如果包含 2 行以上非空文本，且每行像独立指令）
  const lines = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length >= 2) {
    const steps: ParsedAiStep[] = [];
    let hasAssert = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const assertStep = isAssertText(line);
      if (assertStep) hasAssert = true;
      steps.push({
        name: `步骤 ${i + 1}：${line.slice(0, 50)}`,
        instruction: line,
        type: assertStep ? 'assert' : 'ai',
      });
    }
    if (!hasAssert) {
      steps.push({
        name: '整体核对与断言',
        instruction: `核对并断言以上流程执行后，目标是否已成功达成：“${text.slice(0, 120)}”。请结合当前页面状态进行最终核对`,
        type: 'assert',
      });
    }
    return steps;
  }

  // 4. 单条指令回退：一个操作步 + 一个断言步
  return [
    {
      name: `执行操作：${text.slice(0, 60)}`,
      instruction: text,
      type: 'ai',
    },
    {
      name: `断言核对：${text.slice(0, 60)}`,
      instruction: `核对并断言测试目标是否已成功达成：“${text}”。请结合界面文本、提示信息、数据列表或弹窗状态进行核对`,
      type: 'assert',
    },
  ];
}
