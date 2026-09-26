/**
 * 异常识别规则引擎与操作因果链关联 (TASK-206 & TASK-207)
 */

import { QAEvent } from '../types/event';
import { NetworkRequest } from '../types/network';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export interface AnomalyItem {
  id: string;
  type: 'http_error' | 'slow_request' | 'js_error' | 'unhandled_rejection';
  severity: AnomalySeverity;
  title: string;
  description: string;
  timestamp: number;
  relatedAction?: {
    actionId: string;
    actionTitle: string;
    timeDeltaMs: number;
  };
  rawEvidence: NetworkRequest | QAEvent;
}

export class AnomalyDetector {
  /**
   * 判定网络请求是否为异常
   */
  static classifyNetworkRequest(
    req: NetworkRequest,
    recentActions: QAEvent[] = [],
    slowThresholdMs = 2000,
    associationWindowMs = 5000
  ): AnomalyItem | null {
    if (!req.isError && req.duration <= slowThresholdMs) {
      return null;
    }

    let type: AnomalyItem['type'] = 'http_error';
    let severity: AnomalySeverity = 'medium';
    let title = '';

    if (req.status >= 500 || req.status === 0) {
      type = 'http_error';
      severity = 'high';
      title = `${req.method} ${req.pathname} → HTTP ${req.status || 'Network Error'}`;
    } else if (req.status >= 400) {
      type = 'http_error';
      severity = 'medium';
      title = `${req.method} ${req.pathname} → HTTP ${req.status}`;
    } else if (req.duration > slowThresholdMs) {
      type = 'slow_request';
      severity = 'medium';
      title = `${req.method} ${req.pathname} 耗时 ${req.duration}ms`;
    }

    // 关联最近的操作 (0 ~ 5s 内发生的 click 或 input)
    let relatedAction: AnomalyItem['relatedAction'] | undefined;
    const candidates = recentActions.filter(
      (a) => (a.type === 'click' || a.type === 'input') &&
             req.startedAt >= a.timestamp &&
             req.startedAt - a.timestamp <= associationWindowMs
    );

    if (candidates.length > 0) {
      // 取距离请求发生最近的一次操作
      const nearest = candidates.sort((a, b) => b.timestamp - a.timestamp)[0];
      const delta = req.startedAt - nearest.timestamp;
      relatedAction = {
        actionId: nearest.id,
        actionTitle: nearest.title,
        timeDeltaMs: delta,
      };
    }

    const description = relatedAction
      ? `操作关联：${relatedAction.actionTitle} (${relatedAction.timeDeltaMs}ms 前) → 接口返回 ${req.status || '异常'}`
      : `请求耗时 ${req.duration}ms，响应状态码 ${req.status}`;

    return {
      id: `anom-net-${req.id}`,
      type,
      severity,
      title,
      description,
      timestamp: req.startedAt,
      relatedAction,
      rawEvidence: req,
    };
  }

  /**
   * 判定 Console / JS 异常与操作关联
   */
  static classifyJsError(
    event: QAEvent,
    recentActions: QAEvent[] = [],
    associationWindowMs = 5000
  ): AnomalyItem {
    let relatedAction: AnomalyItem['relatedAction'] | undefined;
    const candidates = recentActions.filter(
      (a) => (a.type === 'click' || a.type === 'input') &&
             event.timestamp >= a.timestamp &&
             event.timestamp - a.timestamp <= associationWindowMs
    );

    if (candidates.length > 0) {
      const nearest = candidates.sort((a, b) => b.timestamp - a.timestamp)[0];
      const delta = event.timestamp - nearest.timestamp;
      relatedAction = {
        actionId: nearest.id,
        actionTitle: nearest.title,
        timeDeltaMs: delta,
      };
    }

    const description = relatedAction
      ? `操作关联：${relatedAction.actionTitle} (${relatedAction.timeDeltaMs}ms 前) → 触发异常`
      : event.description;

    return {
      id: `anom-js-${event.id}`,
      type: 'js_error',
      severity: 'high',
      title: event.title,
      description,
      timestamp: event.timestamp,
      relatedAction,
      rawEvidence: event,
    };
  }
}
