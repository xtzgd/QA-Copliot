import { describe, it, expect } from 'vitest';
import { splitNaturalLanguageInstruction } from '../src/shared/utils/taskParser';

describe('跨系统与多任务自然语言测试指令解析 (splitNaturalLanguageInstruction)', () => {
  it('能够准确识别“任务1/任务2/任务3”显式标记的跨系统测试流程', () => {
    const raw = `
      任务1: 在系统A前台下单并提交商品；
      任务2: 打开 http://erp.oa.com/audit 审核该订单；
      任务3: 回到商城前台 http://mall.com 查看订单已发货
    `;

    const steps = splitNaturalLanguageInstruction(raw);
    expect(steps.length).toBe(4); // 3 个操作任务 + 1 个末尾综合断言

    expect(steps[0].type).toBe('ai');
    expect(steps[0].instruction).toContain('任务1: 在系统A前台下单并提交商品');

    expect(steps[1].type).toBe('ai');
    expect(steps[1].instruction).toContain('任务2: 打开 http://erp.oa.com/audit 审核该订单');

    expect(steps[2].type).toBe('ai');
    expect(steps[2].instruction).toContain('任务3: 回到商城前台 http://mall.com 查看订单已发货');

    expect(steps[3].type).toBe('assert');
    expect(steps[3].name).toBe('整体核对与断言');
  });

  it('当最后一个任务已经是断言/核对时，不再重复追加全局断言', () => {
    const raw = `
      任务1: 在当前系统新增用户 张三；
      任务2: 打开 http://admin.sso.com/auth 激活用户；
      任务3: 核对页面上用户状态是否显示为“正常”
    `;

    const steps = splitNaturalLanguageInstruction(raw);
    expect(steps.length).toBe(3); // 任务3 本身是 assert，不再额外追加

    expect(steps[0].type).toBe('ai');
    expect(steps[1].type).toBe('ai');
    expect(steps[2].type).toBe('assert');
    expect(steps[2].instruction).toContain('任务3: 核对页面上用户状态是否显示为“正常”');
  });

  it('支持序号编号模式（1. 2. 3.）的跨系统多步骤拆解', () => {
    const raw = `
      1. 打开 http://portal.oa.com/login 登录管理员账号
      2. 跳转到 http://finance.internal/pay 批量支付待付单
      3. 检查支付记录列表中是否显示已结算
    `;

    const steps = splitNaturalLanguageInstruction(raw);
    expect(steps.length).toBe(3);
    expect(steps[0].type).toBe('ai');
    expect(steps[0].instruction).toContain('1. 打开 http://portal.oa.com/login');
    expect(steps[1].type).toBe('ai');
    expect(steps[1].instruction).toContain('2. 跳转到 http://finance.internal/pay');
    expect(steps[2].type).toBe('assert');
    expect(steps[2].instruction).toContain('3. 检查支付记录列表中是否显示已结算');
  });

  it('单行/单目标自然语言输入保持默认单操作+单断言结构', () => {
    const raw = '在用户列表新增一个测试用户，名称叫 tester_888';

    const steps = splitNaturalLanguageInstruction(raw);
    expect(steps.length).toBe(2);
    expect(steps[0].type).toBe('ai');
    expect(steps[0].name).toBe('执行操作：在用户列表新增一个测试用户，名称叫 tester_888');
    expect(steps[1].type).toBe('assert');
    expect(steps[1].name).toBe('断言核对：在用户列表新增一个测试用户，名称叫 tester_888');
  });

  it('空文本安全防御', () => {
    expect(splitNaturalLanguageInstruction('')).toEqual([]);
    expect(splitNaturalLanguageInstruction('   ')).toEqual([]);
  });
});
