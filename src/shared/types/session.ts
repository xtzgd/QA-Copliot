/**
 * 会话相关实体定义
 */

export type SessionStatus = 'in_progress' | 'completed' | 'paused';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface Environment {
  id: string;
  projectId: string;
  name: 'DEV' | 'TEST' | 'UAT' | 'PROD' | string;
  baseUrl: string;
}

export interface BrowserContextInfo {
  userAgent: string;
  browserName: string;
  browserVersion: string;
  os: string;
  viewport: {
    width: number;
    height: number;
  };
}

export interface TestSession {
  id: string;
  projectId: string;
  projectName: string;
  environment: string;
  title: string;
  status: SessionStatus;
  startedAt: number;
  endedAt?: number;
  initialUrl: string;
  currentUrl: string;
  tabId?: number;
  browserInfo: BrowserContextInfo;
  stats: {
    actionCount: number;
    apiCount: number;
    errorCount: number;
  };
}
