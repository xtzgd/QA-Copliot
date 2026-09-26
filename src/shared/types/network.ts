/**
 * 网络请求实体定义
 */

export interface NetworkHeader {
  name: string;
  value: string;
}

export interface NetworkRequest {
  id: string;
  sessionId: string;
  method: string;
  url: string;
  pathname: string;
  status: number;
  statusText?: string;
  startedAt: number;
  duration: number; // 耗时 ms
  requestHeaders?: NetworkHeader[];
  requestBody?: string;
  responseHeaders?: NetworkHeader[];
  responseBody?: string;
  mimeType?: string;
  initiatorType?: 'fetch' | 'xhr';
  error?: string;
  isError: boolean;
  isSlow: boolean;
  relatedActionId?: string;
  isMocked?: boolean;
  mockRuleId?: string;
  requestId?: string;
  tabId?: number;
  frameId?: number;
  documentId?: string;
}
