/**
 * 禅道地址智能规范化与浏览器会话探测工具 (IMP-08 / CFG-05)
 */

export interface ZentaoNormalizedUrl {
  baseUrl: string;
  apiRoot: string;
  apiVersion: 'v1' | 'v2';
  isValid: boolean;
  error?: string;
  warning?: string;
}

/**
 * 智能规范化禅道地址，防止重复拼接 /api.php/v2，保留合法子目录，安全过滤无用参数
 */
export function normalizeZentaoUrl(rawUrl: string, apiVersion: 'v1' | 'v2' = 'v2'): ZentaoNormalizedUrl {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { baseUrl: '', apiRoot: '', apiVersion, isValid: false, error: '禅道地址不能为空' };
  }

  let trimmed = rawUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // 默认补全 https://
    trimmed = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { baseUrl: '', apiRoot: '', apiVersion, isValid: false, error: '禅道地址格式无效，请输入正确的 URL' };
  }

  // 安全检查：禁止包含嵌入的凭据 (username:password@)
  if (parsed.username || parsed.password) {
    return { baseUrl: '', apiRoot: '', apiVersion, isValid: false, error: '禅道地址禁止包含账号密码信息' };
  }

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    return {
      baseUrl: '',
      apiRoot: '',
      apiVersion,
      isValid: false,
      error: '禅道地址必须使用 HTTPS（本地开发允许 HTTP localhost）',
    };
  }

  // 提取 pathname 并剥离意外带入的 api.php 部分
  let pathname = parsed.pathname;
  let detectedVersion: 'v1' | 'v2' = apiVersion;
  let warning: string | undefined;

  if (pathname.includes('/api.php/v2')) {
    detectedVersion = 'v2';
    pathname = pathname.replace(/\/api\.php\/v2.*$/, '');
    warning = '已自动剥离地址中多余的 /api.php/v2';
  } else if (pathname.includes('/api.php/v1')) {
    detectedVersion = 'v1';
    pathname = pathname.replace(/\/api\.php\/v1.*$/, '');
    warning = '已自动剥离地址中多余的 /api.php/v1';
  } else if (pathname.endsWith('/api.php')) {
    pathname = pathname.replace(/\/api\.php$/, '');
    warning = '已自动剥离地址中多余的 /api.php';
  }

  // 若 pathname 包含具体的页面文件（如 /index.php, /my-profile.html, /bug-browse-5.html），剥离以获得干净站点根路径
  if (/\/[^/]+\.(?:html|php)$/i.test(pathname)) {
    pathname = pathname.replace(/\/[^/]+\.(?:html|php)$/i, '');
  }

  // 去除尾部多余斜杠
  pathname = pathname.replace(/\/+$/, '');

  const baseUrl = `${parsed.protocol}//${parsed.host}${pathname}`;
  const apiRoot = `${baseUrl}/api.php/${detectedVersion}`;

  return {
    baseUrl,
    apiRoot,
    apiVersion: detectedVersion,
    isValid: true,
    warning,
  };
}

/**
 * 判断两个地址是否指向同一个禅道站点部署
 */
export function isSameZentaoSite(urlA?: string, urlB?: string): boolean {
  if (!urlA || !urlB) return false;
  try {
    const a = normalizeZentaoUrl(urlA);
    const b = normalizeZentaoUrl(urlB);
    return a.isValid && b.isValid && a.baseUrl === b.baseUrl;
  } catch {
    return false;
  }
}

export interface DetectedZentaoInfo {
  found: boolean;
  siteUrl?: string;
  account?: string;
  realname?: string;
  token?: string;
  cookieSessionId?: string;
  currentProductId?: number;
  currentProductName?: string;
  currentProjectId?: number;
  currentProjectName?: string;
  currentBuild?: string;
  currentAssignedTo?: string;
  domProducts?: Array<{ id: number; name: string }>;
  domProjects?: Array<{ id: number; name: string }>;
  domUsers?: Array<{ account: string; realname: string }>;
  tabId?: number;
  tabTitle?: string;
  message?: string;
}

/**
 * 探测当前浏览器中已打开的禅道标签页或会话状态
 */
export async function detectBrowserZentao(presetUrl?: string): Promise<DetectedZentaoInfo> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return { found: false, message: '当前非 Chrome 扩展运行环境' };
  }

  try {
    const tabs = await chrome.tabs.query({});
    let targetTab: chrome.tabs.Tab | undefined;

    // 1. 严格按 origin 与部署子目录前缀匹配 presetUrl 相同的活动 tab
    if (presetUrl) {
      try {
        const parsedPreset = new URL(presetUrl);
        targetTab = tabs.find((t) => {
          if (!t.url) return false;
          try {
            const u = new URL(t.url);
            if (u.origin !== parsedPreset.origin) return false;
            // 若预设地址包含部署子目录（如 /zentao），严格检查 pathname 是否以前缀开头
            const presetPath = parsedPreset.pathname.replace(/\/+$/, '');
            if (presetPath && presetPath !== '/' && !u.pathname.startsWith(presetPath)) {
              return false;
            }
            return true;
          } catch {
            return false;
          }
        });
      } catch {}
    }

    // 2. 若未指定或未匹配到，严格在域名或路径结构中寻找真实禅道特征（排除含有 next/redirect 查询参数的无关网站和搜索引擎）
    if (!targetTab) {
      targetTab = tabs.find((t) => {
        if (!t.url) return false;
        try {
          const u = new URL(t.url);
          // 严禁在 query/hash 中匹配域名，仅限 hostname 或 pathname
          const isZentaoHostOrPath = u.hostname.includes('zentao') || u.pathname.includes('/zentao');
          if (isZentaoHostOrPath) return true;

          // 若仅有网页 title 包含禅道，严格排除常见搜索引擎与非业务页面
          if (t.title && (t.title.includes('禅道') || t.title.toLowerCase().includes('zentao'))) {
            const searchHosts = ['baidu.com', 'google.com', 'bing.com', 'sogou.com', 'so.com', 'github.com'];
            if (!searchHosts.some((h) => u.hostname.endsWith(h))) {
              if (u.pathname.endsWith('.html') || u.pathname.endsWith('.php') || u.pathname === '/') {
                return true;
              }
            }
          }
          return false;
        } catch {
          return false;
        }
      });
    }

    if (!targetTab || !targetTab.id || !targetTab.url) {
      // 3. 如果没开 tab，但有 presetUrl，检查是否有存储的 Cookie
      if (presetUrl && chrome.cookies) {
        try {
          const parsed = new URL(presetUrl);
          const cookies = await chrome.cookies.getAll({ domain: parsed.hostname });
          const sidCookie = cookies.find((c) => c.name === 'zentaosid' || c.name === 'sid');
          if (sidCookie) {
            return {
              found: true,
              siteUrl: `${parsed.protocol}//${parsed.host}`,
              cookieSessionId: sidCookie.value,
              message: `在后台发现已保存的会话 Cookie (${sidCookie.name})`,
            };
          }
        } catch {}
      }

      return {
        found: false,
        message: '未在当前打开的标签页中发现禅道系统。请先在浏览器中打开并登录您的禅道，然后再试。',
      };
    }

    const tabUrl = targetTab.url;
    const norm = normalizeZentaoUrl(tabUrl);
    const siteUrl = norm.baseUrl;

    // 4. 在禅道标签页中执行轻量只读探针脚本
    let probeResult: {
      account?: string;
      realname?: string;
      currentProductId?: number;
      currentProductName?: string;
      currentProjectId?: number;
      currentProjectName?: string;
      currentBuild?: string;
      currentAssignedTo?: string;
      domProducts?: Array<{ id: number; name: string }>;
      domProjects?: Array<{ id: number; name: string }>;
      domUsers?: Array<{ account: string; realname: string }>;
      token?: string;
    } = {};

    if (chrome.scripting && targetTab.id) {
      try {
        const injection = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: async () => {
            const res: {
              account?: string;
              realname?: string;
              currentProductId?: number;
              currentProductName?: string;
              currentProjectId?: number;
              currentProjectName?: string;
              currentBuild?: string;
              currentAssignedTo?: string;
              domProducts?: Array<{ id: number; name: string }>;
              domProjects?: Array<{ id: number; name: string }>;
              domUsers?: Array<{ account: string; realname: string }>;
              token?: string;
            } = {};

            try {
              const win = window as any;
              // 1. 探查全局 config
              if (win.config) {
                if (win.config.user) {
                  res.account = win.config.user.account;
                  res.realname = win.config.user.realname;
                }
                if (win.config.currentProduct) {
                  res.currentProductId = Number(win.config.currentProduct) || undefined;
                }
                if (win.config.token || win.config.apiToken) {
                  res.token = String(win.config.token || win.config.apiToken);
                }
              }

              // 2. 探查本地存储中的 token
              try {
                const keys = ['zentaoToken', 'token', 'apiToken', 'access_token', 'zentao_token', 'api_token'];
                for (const k of keys) {
                  const val = localStorage.getItem(k) || sessionStorage.getItem(k);
                  if (val && typeof val === 'string' && val.length > 10) {
                    res.token = val;
                    break;
                  }
                }
              } catch {}

              // 3. 尝试在同源上下文静默获取 token (部分版本在登录态下支持)
              if (!res.token) {
                try {
                  const tokenResp = await fetch('/api.php/v2/tokens', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                  });
                  if (tokenResp.ok) {
                    const data = (await tokenResp.json().catch(() => null)) as any;
                    if (data?.token) {
                      res.token = data.token;
                    } else if (data?.data?.token) {
                      res.token = data.data.token;
                    }
                  }
                } catch {}
              }

              // 4. 探查 URL 中的产品 ID 与项目 ID
              const url = window.location.href;
              const matchProd1 = url.match(/(?:product|bug)-(?:browse|view|create|all)-(\d+)/i);
              if (matchProd1 && matchProd1[1] && !res.currentProductId) {
                res.currentProductId = Number(matchProd1[1]);
              }
              const matchProd2 = url.match(/[?&]product(?:ID)?=(\d+)/i);
              if (matchProd2 && matchProd2[1] && !res.currentProductId) {
                res.currentProductId = Number(matchProd2[1]);
              }

              const matchProj1 = url.match(/(?:project|execution)-(?:browse|view|create|all|bug)-(\d+)/i);
              if (matchProj1 && matchProj1[1] && !res.currentProjectId) {
                res.currentProjectId = Number(matchProj1[1]);
              }
              const matchProj2 = url.match(/[?&]project(?:ID)?=(\d+)/i);
              if (matchProj2 && matchProj2[1] && !res.currentProjectId) {
                res.currentProjectId = Number(matchProj2[1]);
              }

              // 5. 探查页面 DOM 中的产品、项目与版本下拉框
              try {
                const productSelect = document.querySelector<HTMLSelectElement>('select#product, select[name="product"]');
                if (productSelect) {
                  if (productSelect.value && !res.currentProductId) {
                    res.currentProductId = Number(productSelect.value) || undefined;
                  }
                  const selectedOpt = productSelect.selectedOptions?.[0];
                  if (selectedOpt) {
                    res.currentProductName = selectedOpt.textContent?.trim() || undefined;
                  }
                  const opts = Array.from(productSelect.options)
                    .filter((o) => o.value && Number(o.value) > 0)
                    .map((o) => ({ id: Number(o.value), name: o.textContent?.trim() || `产品 #${o.value}` }));
                  if (opts.length > 0) {
                    res.domProducts = opts;
                  }
                }

                const projectSelect = document.querySelector<HTMLSelectElement>(
                  'select#project, select[name="project"], select[name="projectID"]'
                );
                if (projectSelect) {
                  if (projectSelect.value && !res.currentProjectId) {
                    res.currentProjectId = Number(projectSelect.value) || undefined;
                  }
                  const selectedOpt = projectSelect.selectedOptions?.[0];
                  if (selectedOpt) {
                    res.currentProjectName = selectedOpt.textContent?.trim() || undefined;
                  }
                  const opts = Array.from(projectSelect.options)
                    .filter((o) => o.value && Number(o.value) > 0)
                    .map((o) => ({ id: Number(o.value), name: o.textContent?.trim() || `项目 #${o.value}` }));
                  if (opts.length > 0) {
                    res.domProjects = opts;
                  }
                }

                const buildSelect = document.querySelector<HTMLSelectElement>(
                  'select#openedBuild, select[name="openedBuild[]"], select[name="openedBuild"]'
                );
                if (buildSelect && buildSelect.value) {
                  res.currentBuild = buildSelect.value;
                }

                const assignedSelect = document.querySelector<HTMLSelectElement>(
                  'select#assignedTo, select[name="assignedTo"]'
                );
                if (assignedSelect) {
                  if (assignedSelect.value && assignedSelect.value !== 'closed') {
                    res.currentAssignedTo = assignedSelect.value;
                  }
                  const userOpts = Array.from(assignedSelect.options)
                    .filter((o) => o.value && o.value !== 'closed')
                    .map((o) => ({
                      account: o.value,
                      realname: o.textContent?.trim() || o.value,
                    }));
                  if (userOpts.length > 0) {
                    res.domUsers = userOpts;
                  }
                }
              } catch {}

              // 6. 探查页面 DOM 中的用户名
              if (!res.account) {
                const userDom = document.querySelector('#userNav, .user-name, [data-id="user"], .dropdown-user');
                if (userDom && userDom.textContent) {
                  res.account = userDom.textContent.trim();
                }
              }
            } catch {}

            return res;
          },
        });

        if (injection && injection[0]?.result) {
          probeResult = injection[0].result;
        }
      } catch (err) {
        console.warn('[QA Copilot] 探针脚本执行受限:', err);
      }
    }

    // 5. 探查 Cookie 会话
    let cookieSessionId: string | undefined;
    if (chrome.cookies) {
      try {
        const parsed = new URL(siteUrl);
        const cookies = await chrome.cookies.getAll({ domain: parsed.hostname });
        const sidCookie = cookies.find((c) => c.name === 'zentaosid' || c.name === 'sid');
        if (sidCookie) {
          cookieSessionId = sidCookie.value;
        }
      } catch {}
    }

    return {
      found: true,
      siteUrl,
      account: probeResult.account,
      realname: probeResult.realname,
      token: probeResult.token,
      currentProductId: probeResult.currentProductId,
      currentProductName: probeResult.currentProductName,
      currentProjectId: probeResult.currentProjectId,
      currentProjectName: probeResult.currentProjectName,
      currentBuild: probeResult.currentBuild,
      currentAssignedTo: probeResult.currentAssignedTo,
      domProducts: probeResult.domProducts,
      domProjects: probeResult.domProjects,
      domUsers: probeResult.domUsers,
      cookieSessionId,
      tabId: targetTab.id,
      tabTitle: targetTab.title,
      message: `已识别标签页「${targetTab.title || siteUrl}」${probeResult.account ? ` (用户: ${probeResult.account})` : ''}`,
    };
  } catch (error) {
    return {
      found: false,
      message: `探测失败: ${(error as Error).message}`,
    };
  }
}
