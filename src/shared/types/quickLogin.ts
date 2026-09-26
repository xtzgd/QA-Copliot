/**
 * 快捷登录与多环境配置类型声明 (QUICK-LOGIN)
 */

export interface QuickLoginAccount {
  id: string;
  name: string;        // 账号描述，如 "超级管理员" / "测试普通用户"
  username: string;    // 用户名 / 手机号 / 邮箱
  password: string;    // 密码
}

export interface QuickLoginEnvironment {
  id: string;
  name: string;        // 环境名，如 "测试环境 (TEST)" / "预发环境 (UAT)"
  url: string;         // 登录页或系统入口 URL
  loginTriggerSelector?: string; // 可选：弹窗登录按钮自定义选择器（如 "#headerLogin"），留空则智能探测
  autoSubmit?: boolean;// 是否在填充后自动点击登录提交（默认 false）
  accounts: QuickLoginAccount[];
}

export interface QuickLoginProject {
  id: string;
  name: string;        // 项目名，如 "SCM 供应链系统" / "WMS 仓储系统"
  environments: QuickLoginEnvironment[];
}

export interface QuickLoginConfig {
  projects: QuickLoginProject[];
  lastSelected?: {
    projectId?: string;
    envId?: string;
    accountId?: string;
  };
}
