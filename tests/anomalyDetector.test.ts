import { describe, it, expect } from 'vitest';
import { AnomalyDetector } from '../src/shared/rules/anomalyDetector';
import { NetworkRequest } from '../src/shared/types/network';
import { QAEvent } from '../src/shared/types/event';

describe('异常识别规则引擎与操作因果关联 (TASK-206 & TASK-207)', () => {
  const baseTime = 1700000000000;

  const clickAction: QAEvent = {
    id: 'act-click-1',
    sessionId: 'sess-1',
    type: 'click',
    timestamp: baseTime,
    title: '点击「提交订单」',
    description: '点击提交订单按钮',
    url: 'https://test.xxx.com/order/create',
    payload: {
      timestamp: baseTime,
      url: 'https://test.xxx.com/order/create',
      tag: 'BUTTON',
      text: '提交订单',
      selector: '#submit-order',
    },
  };

  it('500 接口自动标记高风险并与 500ms 前的「提交订单」操作建立关联', () => {
    const errorReq: NetworkRequest = {
      id: 'req-1',
      sessionId: 'sess-1',
      method: 'POST',
      url: 'https://test.xxx.com/api/order/create',
      pathname: '/api/order/create',
      status: 500,
      startedAt: baseTime + 500, // 500ms 后发生
      duration: 320,
      isError: true,
      isSlow: false,
    };

    const anomaly = AnomalyDetector.classifyNetworkRequest(errorReq, [clickAction]);
    expect(anomaly).not.toBeNull();
    expect(anomaly?.severity).toBe('high');
    expect(anomaly?.type).toBe('http_error');
    expect(anomaly?.relatedAction?.actionId).toBe('act-click-1');
    expect(anomaly?.relatedAction?.actionTitle).toBe('点击「提交订单」');
    expect(anomaly?.relatedAction?.timeDeltaMs).toBe(500);
    expect(anomaly?.description).toContain('提交订单');
    expect(anomaly?.description).toContain('500ms 前');
  });

  it('耗时超过 2000ms 的请求自动标记慢接口', () => {
    const slowReq: NetworkRequest = {
      id: 'req-2',
      sessionId: 'sess-1',
      method: 'GET',
      url: 'https://test.xxx.com/api/customer/list',
      pathname: '/api/customer/list',
      status: 200,
      startedAt: baseTime + 1000,
      duration: 3200,
      isError: false,
      isSlow: true,
    };

    const anomaly = AnomalyDetector.classifyNetworkRequest(slowReq, [clickAction]);
    expect(anomaly).not.toBeNull();
    expect(anomaly?.type).toBe('slow_request');
    expect(anomaly?.title).toContain('3200ms');
  });

  it('超过 5 秒的不予强行关联操作', () => {
    const farReq: NetworkRequest = {
      id: 'req-3',
      sessionId: 'sess-1',
      method: 'POST',
      url: 'https://test.xxx.com/api/pay',
      pathname: '/api/pay',
      status: 502,
      startedAt: baseTime + 6000, // 6秒后，超过 5000ms 窗口
      duration: 200,
      isError: true,
      isSlow: false,
    };

    const anomaly = AnomalyDetector.classifyNetworkRequest(farReq, [clickAction]);
    expect(anomaly?.relatedAction).toBeUndefined();
  });
});
