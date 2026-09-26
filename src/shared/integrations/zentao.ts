import { Bug, BugSnapshot } from '../types/snapshot';
import { normalizeZentaoUrl } from './zentaoHelper';

export interface ZentaoConfig {
  baseUrl: string;
  token?: string;
  authMode?: 'cookie' | 'token';
  productId: number;
  openedBuild: string[];
  apiVersion?: 'v1' | 'v2';
  projectId?: number;
  executionId?: number;
  assignedTo?: string;
}

export interface ZentaoUserItem {
  id?: number | string;
  account: string;
  realname?: string;
  avatar?: string;
}

export interface ZentaoProductItem {
  id: number;
  name: string;
  code?: string;
  type?: string;
}

export interface ZentaoProjectItem {
  id: number;
  name: string;
  code?: string;
  status?: string;
}

export interface ZentaoBuildItem {
  id: number | string;
  name: string;
  product?: number;
  branch?: number;
}

export interface ZentaoCreateResult {
  id: number;
  url: string;
  attachmentUploaded?: boolean;
  attachmentError?: string;
  recordingUploaded?: boolean;
  recordingError?: string;
}

export interface ZentaoApiAdapter {
  readonly version: 'v1' | 'v2';
  getCreateBugUrl(apiRoot: string, productId: number): string;
  buildCreateBugBody(params: {
    productId: number;
    title: string;
    openedBuild: string[];
    project?: number;
    execution?: number;
    severity: number;
    pri: number;
    type: string;
    steps: string;
    assignedTo?: string;
  }): Record<string, any>;
  parseCreateBugResponse(responseOk: boolean, responseStatus: number, result: any): { id: number };
}

export class ZentaoV2Adapter implements ZentaoApiAdapter {
  readonly version = 'v2' as const;

  getCreateBugUrl(apiRoot: string): string {
    return `${apiRoot}/bugs`;
  }

  buildCreateBugBody(params: {
    productId: number;
    title: string;
    openedBuild: string[];
    project?: number;
    execution?: number;
    severity: number;
    pri: number;
    type: string;
    steps: string;
    assignedTo?: string;
  }): Record<string, any> {
    const payload: Record<string, any> = {
      product: params.productId,
      productID: params.productId,
      title: params.title,
      openedBuild: params.openedBuild.length ? params.openedBuild : ['trunk'],
      severity: params.severity,
      pri: params.pri,
      type: params.type,
      steps: params.steps,
    };
    if (params.project && params.project > 0) payload.project = params.project;
    if (params.execution && params.execution > 0) payload.execution = params.execution;
    if (params.assignedTo) payload.assignedTo = params.assignedTo;
    return payload;
  }

  parseCreateBugResponse(responseOk: boolean, responseStatus: number, result: any): { id: number } {
    if (!responseOk) {
      throw new Error(result?.message || result?.error || `禅道返回 HTTP ${responseStatus}`);
    }
    const isBizFail = result?.status === 'failed' || result?.status === 'fail' || Boolean(result?.error);
    if (isBizFail) {
      throw new Error(result?.message || result?.error || '禅道业务校验失败');
    }
    const bugId = Number(result?.id || result?.data?.id);
    if (!bugId || isNaN(bugId)) {
      throw new Error(result?.message || '创建 Bug 响应未包含有效的 Bug ID');
    }
    return { id: bugId };
  }
}

export class ZentaoV1Adapter implements ZentaoApiAdapter {
  readonly version = 'v1' as const;

  getCreateBugUrl(apiRoot: string, productId: number): string {
    if (!productId) {
      throw new Error('禅道 API v1 创建 Bug 必须指定有效的产品 ID');
    }
    return `${apiRoot}/products/${productId}/bugs`;
  }

  buildCreateBugBody(params: {
    productId: number;
    title: string;
    openedBuild: string[];
    project?: number;
    execution?: number;
    severity: number;
    pri: number;
    type: string;
    steps: string;
    assignedTo?: string;
  }): Record<string, any> {
    const payload: Record<string, any> = {
      product: params.productId,
      productID: params.productId,
      title: params.title,
      openedBuild: params.openedBuild.length ? params.openedBuild : ['trunk'],
      severity: params.severity,
      pri: params.pri,
      type: params.type,
      steps: params.steps,
    };
    if (params.project && params.project > 0) payload.project = params.project;
    if (params.execution && params.execution > 0) payload.execution = params.execution;
    if (params.assignedTo) payload.assignedTo = params.assignedTo;
    return payload;
  }

  parseCreateBugResponse(responseOk: boolean, responseStatus: number, result: any): { id: number } {
    if (!responseOk) {
      throw new Error(result?.message || result?.error || `禅道 v1 返回 HTTP ${responseStatus}`);
    }
    const isBizFail = result?.status === 'failed' || result?.status === 'fail' || Boolean(result?.error);
    if (isBizFail) {
      throw new Error(result?.message || result?.error || '禅道 v1 创建 Bug 失败');
    }
    // 官方 v1 响应为 Bug 实体对象，status 通常为 'active'
    const bugId = Number(result?.id || result?.bug?.id || result?.data?.id);
    if (!bugId || isNaN(bugId)) {
      throw new Error(result?.message || result?.error || '禅道 v1 响应未包含有效的 Bug ID');
    }
    return { id: bugId };
  }
}

type FetchLike = typeof fetch;

export class ZentaoClient {
  private fetcher: FetchLike;

  constructor(private config: ZentaoConfig, fetcher?: FetchLike) {
    this.fetcher = fetcher ? (input, init) => fetcher(input, init) : (input, init) => globalThis.fetch(input, init);
  }

  private isTokenMode(): boolean {
    return this.config.authMode === 'token';
  }

  private buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.config.token && this.config.token.trim()) {
      headers['Token'] = this.config.token.trim();
    }
    return headers;
  }

  private getAdapter(): ZentaoApiAdapter {
    return this.config.apiVersion === 'v1' ? new ZentaoV1Adapter() : new ZentaoV2Adapter();
  }

  static async fromChromeStorage(): Promise<ZentaoClient> {
    const [local, session] = await Promise.all([
      chrome.storage.local.get({
        zentaoBaseUrl: '',
        zentaoAuthMode: 'cookie',
        zentaoApiVersion: 'v2',
        zentaoProductId: 0,
        zentaoOpenedBuild: 'trunk',
        zentaoProjectId: 0,
        zentaoExecutionId: 0,
        zentaoAssignedTo: '',
      }),
      chrome.storage.session.get({ zentaoToken: '' }),
    ]);
    return new ZentaoClient({
      baseUrl: String(local.zentaoBaseUrl || ''),
      authMode: (local.zentaoAuthMode === 'token' ? 'token' : 'cookie') as 'cookie' | 'token',
      token: String(session.zentaoToken || ''),
      apiVersion: (local.zentaoApiVersion === 'v1' ? 'v1' : 'v2') as 'v1' | 'v2',
      productId: Number(local.zentaoProductId) || 0,
      openedBuild: String(local.zentaoOpenedBuild || 'trunk')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      projectId: Number(local.zentaoProjectId) || undefined,
      executionId: Number(local.zentaoExecutionId) || undefined,
      assignedTo: String(local.zentaoAssignedTo || '').trim() || undefined,
    });
  }

  private getNormalized() {
    const norm = normalizeZentaoUrl(this.config.baseUrl, this.config.apiVersion || 'v2');
    if (!norm.isValid) {
      throw new Error(norm.error || '禅道地址格式无效');
    }
    return norm;
  }

  private validateConfig(): void {
    const tokenRequired = this.isTokenMode();
    if (!this.config.baseUrl || !this.config.productId || (tokenRequired && !this.config.token)) {
      throw new Error(
        tokenRequired
          ? '请先在设置中完成禅道地址、Token 和产品 ID 配置'
          : '请先在设置中完成禅道地址和产品 ID 配置'
      );
    }
  }

  private screenshotBlob(dataUrl: string): Blob {
    const [metadata, encoded] = dataUrl.split(',', 2);
    if (!encoded) throw new Error('截图数据格式不正确');
    const mimeType = metadata.match(/^data:([^;]+)/)?.[1] || 'image/png';
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
  }

  async uploadFile(bugId: number, blob: Blob, fileName: string): Promise<void> {
    const norm = this.getNormalized();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000); // 30秒全程超时

    const isUploadSuccess = (status: number, result: any): boolean => {
      if (status >= 200 && status < 300) {
        if (result?.status === 'success' || result?.status === 'created') return true;
        if (result?.error === 0 || result?.status === 'ok') return true;
        if (result?.id || result?.data?.id || result?.file?.id) return true;
        if (result?.url || result?.data?.url) return true;
        if (!result?.status && !result?.error && !result?.message) return true;
      }
      return false;
    };

    let lastErrorMsg = '';

    try {
      // 1. 首选：官方 v2 标准文件接口 /api.php/v2/files (同时支持 file 与 files 字段)
      try {
        const form1 = new FormData();
        form1.append('file', blob, fileName);
        form1.append('files', blob, fileName);
        form1.append('objectType', 'bug');
        form1.append('objectID', String(bugId));

        const response1 = await this.fetcher(`${norm.apiRoot}/files`, {
          method: 'POST',
          credentials: 'include',
          headers: this.buildHeaders(),
          body: form1,
          signal: controller.signal,
        });

        const contentType1 = response1.headers?.get ? (response1.headers.get('content-type') || '') : '';
        if (contentType1.includes('text/html')) {
          lastErrorMsg = '附件接口返回了 HTML 页面，表明登录态已失效或未授权';
        } else {
          const resJson1 = (await response1.json().catch(() => ({}))) as any;
          if (isUploadSuccess(response1.status, resJson1)) {
            return;
          }
          lastErrorMsg = resJson1?.message || resJson1?.error || `附件上传返回 HTTP ${response1.status}`;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        lastErrorMsg = (err as Error).message;
      }

      // 2. 备用端点 A：/api.php/v2/bugs/{bugId}/files (对象级子资源上传)
      try {
        const form2 = new FormData();
        form2.append('file', blob, fileName);
        form2.append('files', blob, fileName);

        const response2 = await this.fetcher(`${norm.apiRoot}/bugs/${bugId}/files`, {
          method: 'POST',
          credentials: 'include',
          headers: this.buildHeaders(),
          body: form2,
          signal: controller.signal,
        });

        const contentType2 = response2.headers?.get ? (response2.headers.get('content-type') || '') : '';
        if (!contentType2.includes('text/html')) {
          const resJson2 = (await response2.json().catch(() => ({}))) as any;
          if (isUploadSuccess(response2.status, resJson2)) {
            return;
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
      }

      // 3. 备用端点 B：若为基于浏览器会话的 cookie 模式，尝试调用网页富文本通用异步上传接口
      if (this.config.authMode === 'cookie') {
        try {
          const form3 = new FormData();
          form3.append('imgFile', blob, fileName);
          form3.append('localUrl', fileName);

          const response3 = await this.fetcher(`${norm.baseUrl}/file-ajaxUpload.html?dir=image`, {
            method: 'POST',
            credentials: 'include',
            headers: this.buildHeaders(),
            body: form3,
            signal: controller.signal,
          });

          const contentType3 = response3.headers?.get ? (response3.headers.get('content-type') || '') : '';
          if (!contentType3.includes('text/html')) {
            const resJson3 = (await response3.json().catch(() => ({}))) as any;
            if (response3.ok && (resJson3?.error === 0 || resJson3?.status === 'success' || resJson3?.url)) {
              return;
            }
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
        }
      }

      // 4. 全部候选端点均未成功，对常见权限拒绝做人性化精准转译
      if (lastErrorMsg.toLowerCase().includes('not allowed') || lastErrorMsg.includes('403') || lastErrorMsg.includes('405')) {
        throw new Error('禅道服务端限制了 API 附件上传权限 (not allowed)，当前账号在禅道权限组中未分配文件上传接口权限。Bug 已成功建单，可通过网页手动粘贴附件');
      }

      throw new Error(lastErrorMsg || '附件上传失败');
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new Error('附件上传超时（30秒）');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadScreenshot(bugId: number, dataUrl: string): Promise<void> {
    const blob = this.screenshotBlob(dataUrl);
    return this.uploadFile(bugId, blob, `qa-copilot-bug-${bugId}.png`);
  }

  async uploadRecording(bugId: number, recordingBlob: Blob, fileName?: string): Promise<void> {
    const name = fileName || `qa-recording-bug-${bugId}.webm`;
    return this.uploadFile(bugId, recordingBlob, name);
  }

  /**
   * 只读连接测试 (IMP-08 / CFG-01)：验证禅道地址、Token 与 ProductId 有效性，不创建任何业务 Bug
   */
  async testConnection(): Promise<{
    success: boolean;
    productName?: string;
    error?: string;
    errorType?: 'CONFIG' | 'AUTH' | 'NOT_FOUND' | 'NETWORK' | 'PROTOCOL' | 'FORBIDDEN';
  }> {
    const isTokenMode = this.isTokenMode();
    if (!this.config.baseUrl || (isTokenMode && !this.config.token)) {
      return {
        success: false,
        error: isTokenMode ? '请先填写完整的禅道地址与 Token' : '请先填写禅道地址',
        errorType: 'CONFIG',
      };
    }

    let norm;
    try {
      norm = this.getNormalized();
    } catch (err) {
      return { success: false, error: (err as Error).message, errorType: 'CONFIG' };
    }

    const targetUrl = this.config.productId
      ? `${norm.apiRoot}/products/${this.config.productId}`
      : `${norm.apiRoot}/products?limit=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10秒全程超时
    try {
      const response = await this.fetcher(targetUrl, {
        method: 'GET',
        credentials: 'include',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: isTokenMode
            ? `禅道 Token 无效或无权限 (HTTP ${response.status})`
            : `禅道登录态已失效或无权限 (HTTP ${response.status})，请在浏览器中登录禅道后重试`,
          errorType: 'AUTH',
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: `未找到产品 ID ${this.config.productId}，请核对产品 ID`,
          errorType: 'NOT_FOUND',
        };
      }
      if (!response.ok) {
        return { success: false, error: `禅道服务器响应异常 (HTTP ${response.status})`, errorType: 'NETWORK' };
      }

      const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
      if (contentType.includes('text/html')) {
        return {
          success: false,
          error: isTokenMode
            ? '返回了 HTML 登录页面而不是 API 数据，表明 Token 错误或该地址未启用 API'
            : '返回了 HTML 登录页面，表明当前浏览器未登录禅道或会话已过期，请在网页中登录后重试',
          errorType: 'PROTOCOL',
        };
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        return {
          success: false,
          error: '禅道接口返回非合法 JSON 数据',
          errorType: 'PROTOCOL',
        };
      }

      // 严格校验真实性：空对象不代表成功
      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        return {
          success: false,
          error: '禅道接口返回空数据，无法确认产品有效性',
          errorType: 'PROTOCOL',
        };
      }

      // 严格检查各种业务失败标识 (status, result, error, message)
      const isBizFail =
        data.status === 'failed' ||
        data.status === 'fail' ||
        data.result === 'failed' ||
        data.result === 'fail' ||
        Boolean(data.error) ||
        Boolean(data.errmsg);

      if (isBizFail) {
        return {
          success: false,
          error: data.message || data.error || data.errmsg || '禅道业务返回失败',
          errorType: 'AUTH',
        };
      }

      // 提取真实产品信息 (全面适配官方 v2 的 { product: {...} }、平铺对象、列表与字典结构)
      let productName: string | undefined;
      let hasValidProduct = false;

      if (data.product && typeof data.product === 'object' && (data.product.id || data.product.name || data.product.title)) {
        productName = String(data.product.name || data.product.title || `产品 #${data.product.id || this.config.productId}`);
        hasValidProduct = true;
      } else if (data.data?.product && typeof data.data.product === 'object' && (data.data.product.id || data.data.product.name || data.data.product.title)) {
        productName = String(data.data.product.name || data.data.product.title || `产品 #${data.data.product.id || this.config.productId}`);
        hasValidProduct = true;
      } else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data) && (data.data.name || data.data.title || data.data.id)) {
        productName = String(data.data.name || data.data.title || `产品 #${data.data.id || this.config.productId}`);
        hasValidProduct = true;
      } else if (data.id && (data.name || data.title)) {
        productName = String(data.name || data.title);
        hasValidProduct = true;
      } else if (Array.isArray(data) && data.length > 0 && data[0]?.id) {
        const matched = this.config.productId ? data.find((p: any) => Number(p.id) === this.config.productId) : data[0];
        const target = matched || data[0];
        productName = String(target.name || target.title || `产品 #${target.id}`);
        hasValidProduct = true;
      } else if (data.products && Array.isArray(data.products) && data.products.length > 0) {
        const matched = this.config.productId ? data.products.find((p: any) => Number(p.id) === this.config.productId) : data.products[0];
        const target = matched || data.products[0];
        if (target && (target.id || target.name || target.title)) {
          productName = String(target.name || target.title || `产品 #${target.id}`);
          hasValidProduct = true;
        }
      } else if (data.data?.products && Array.isArray(data.data.products) && data.data.products.length > 0) {
        const matched = this.config.productId ? data.data.products.find((p: any) => Number(p.id) === this.config.productId) : data.data.products[0];
        const target = matched || data.data.products[0];
        if (target && (target.id || target.name || target.title)) {
          productName = String(target.name || target.title || `产品 #${target.id}`);
          hasValidProduct = true;
        }
      } else if (typeof data === 'object') {
        const values = Object.values(data).filter((v: any) => v && typeof v === 'object' && (v.id || v.name || v.title));
        if (values.length > 0) {
          const matched: any = this.config.productId ? values.find((v: any) => Number(v.id) === this.config.productId) : values[0];
          const target = matched || values[0];
          productName = String(target.name || target.title || `产品 #${target.id}`);
          hasValidProduct = true;
        }
      }

      if (!hasValidProduct) {
        return {
          success: false,
          error: data.message || (this.config.productId ? `响应中未包含产品 #${this.config.productId} 的有效信息` : '未读取到任何有效产品，请核对权限'),
          errorType: 'FORBIDDEN',
        };
      }

      return {
        success: true,
        productName: productName!,
      };
    } catch (err) {
      const error = err as Error;
      const isTimeout = error.name === 'AbortError';
      return {
        success: false,
        error: isTimeout ? '连接禅道服务器超时（10秒）' : `网络连接失败: ${error.message}`,
        errorType: 'NETWORK',
      };
    } finally {
      clearTimeout(timer); // 全程超时：统一在 finally 清除
    }
  }

  /**
   * 安全提取单页产品及分页元信息 (CFG-05)
   */
  private extractProductsFromRaw(raw: any): {
    products: ZentaoProductItem[];
    total?: number;
    totalPage?: number;
    page?: number;
  } {
    if (!raw || typeof raw !== 'object') return { products: [] };

    const total =
      typeof raw.total === 'number' ? raw.total :
      typeof raw.pager?.total === 'number' ? raw.pager.total :
      typeof raw.pager?.recTotal === 'number' ? raw.pager.recTotal :
      typeof raw.data?.total === 'number' ? raw.data.total :
      typeof raw.data?.pager?.total === 'number' ? raw.data.pager.total :
      typeof raw.data?.pager?.recTotal === 'number' ? raw.data.pager.recTotal :
      undefined;

    const totalPage =
      typeof raw.totalPage === 'number' ? raw.totalPage :
      typeof raw.pager?.totalPage === 'number' ? raw.pager.totalPage :
      typeof raw.pager?.pageTotal === 'number' ? raw.pager.pageTotal :
      typeof raw.data?.totalPage === 'number' ? raw.data.totalPage :
      typeof raw.data?.pager?.totalPage === 'number' ? raw.data.pager.totalPage :
      undefined;

    const page =
      typeof raw.page === 'number' ? raw.page :
      typeof raw.pager?.page === 'number' ? raw.pager.page :
      typeof raw.pager?.pageID === 'number' ? raw.pager.pageID :
      typeof raw.data?.page === 'number' ? raw.data.page :
      typeof raw.data?.pager?.page === 'number' ? raw.data.pager.page :
      typeof raw.data?.pager?.pageID === 'number' ? raw.data.pager.pageID :
      undefined;

    let rawList: any[] = [];
    if (Array.isArray(raw)) {
      rawList = raw;
    } else if (Array.isArray(raw.products)) {
      rawList = raw.products;
    } else if (raw.products && typeof raw.products === 'object') {
      rawList = Object.values(raw.products);
    } else if (Array.isArray(raw.data?.products)) {
      rawList = raw.data.products;
    } else if (raw.data?.products && typeof raw.data.products === 'object') {
      rawList = Object.values(raw.data.products);
    } else if (Array.isArray(raw.data)) {
      rawList = raw.data;
    } else if (raw.data && typeof raw.data === 'object') {
      const dCopy = { ...raw.data };
      delete dCopy.pager;
      delete dCopy.total;
      delete dCopy.page;
      delete dCopy.limit;
      delete dCopy.totalPage;
      rawList = Object.values(dCopy);
    } else if (typeof raw === 'object' && !raw.status && !raw.error) {
      const copy = { ...raw };
      delete copy.pager;
      delete copy.total;
      delete copy.page;
      delete copy.limit;
      delete copy.totalPage;
      rawList = Object.values(copy);
    }

    const products: ZentaoProductItem[] = rawList
      .filter((item: any) => item && typeof item === 'object' && (item.id || item.name || item.title))
      .map((item: any, idx: number) => ({
        id: Number(item.id) || idx + 1,
        name: String(item.name || item.title || `产品 #${item.id || idx + 1}`),
        code: item.code ? String(item.code) : undefined,
        type: item.type ? String(item.type) : undefined,
      }));

    return { products, total, totalPage, page };
  }

  /**
   * 安全提取项目列表及分页元信息
   */
  private extractProjectsFromRaw(raw: any): {
    projects: ZentaoProjectItem[];
    total?: number;
    totalPage?: number;
    page?: number;
  } {
    if (!raw || typeof raw !== 'object') return { projects: [] };

    const total =
      typeof raw.total === 'number' ? raw.total :
      typeof raw.pager?.total === 'number' ? raw.pager.total :
      typeof raw.pager?.recTotal === 'number' ? raw.pager.recTotal :
      typeof raw.data?.total === 'number' ? raw.data.total :
      typeof raw.data?.pager?.total === 'number' ? raw.data.pager.total :
      typeof raw.data?.pager?.recTotal === 'number' ? raw.data.pager.recTotal :
      undefined;

    const totalPage =
      typeof raw.totalPage === 'number' ? raw.totalPage :
      typeof raw.pager?.totalPage === 'number' ? raw.pager.totalPage :
      typeof raw.pager?.pageTotal === 'number' ? raw.pager.pageTotal :
      typeof raw.data?.totalPage === 'number' ? raw.data.totalPage :
      typeof raw.data?.pager?.totalPage === 'number' ? raw.data.pager.totalPage :
      undefined;

    const page =
      typeof raw.page === 'number' ? raw.page :
      typeof raw.pager?.page === 'number' ? raw.pager.page :
      typeof raw.pager?.pageID === 'number' ? raw.pager.pageID :
      typeof raw.data?.page === 'number' ? raw.data.page :
      typeof raw.data?.pager?.page === 'number' ? raw.data.pager.page :
      typeof raw.data?.pager?.pageID === 'number' ? raw.data.pager.pageID :
      undefined;

    let rawList: any[] = [];
    if (Array.isArray(raw)) {
      rawList = raw;
    } else if (Array.isArray(raw.projects)) {
      rawList = raw.projects;
    } else if (raw.projects && typeof raw.projects === 'object') {
      rawList = Object.values(raw.projects);
    } else if (Array.isArray(raw.data?.projects)) {
      rawList = raw.data.projects;
    } else if (raw.data?.projects && typeof raw.data.projects === 'object') {
      rawList = Object.values(raw.data.projects);
    } else if (Array.isArray(raw.data)) {
      rawList = raw.data;
    } else if (raw.data && typeof raw.data === 'object') {
      const dCopy = { ...raw.data };
      delete dCopy.pager;
      delete dCopy.total;
      delete dCopy.page;
      delete dCopy.limit;
      delete dCopy.totalPage;
      rawList = Object.values(dCopy);
    } else if (typeof raw === 'object' && !raw.status && !raw.error) {
      const copy = { ...raw };
      delete copy.pager;
      delete copy.total;
      delete copy.page;
      delete copy.limit;
      delete copy.totalPage;
      rawList = Object.values(copy);
    }

    const projects: ZentaoProjectItem[] = rawList
      .filter((item: any) => item && typeof item === 'object' && (item.id || item.name || item.title))
      .map((item: any, idx: number) => ({
        id: Number(item.id) || idx + 1,
        name: String(item.name || item.title || `项目 #${item.id || idx + 1}`),
        code: item.code ? String(item.code) : undefined,
        status: item.status ? String(item.status) : undefined,
      }));

    return { projects, total, totalPage, page };
  }

  /**
   * 安全提取产品发布版本列表 (Releases)
   */
  private extractReleasesFromRaw(raw: any): ZentaoBuildItem[] {
    if (!raw || typeof raw !== 'object') return [];
    let rawList: any[] = [];
    if (Array.isArray(raw)) {
      rawList = raw;
    } else if (Array.isArray(raw.releases)) {
      rawList = raw.releases;
    } else if (raw.releases && typeof raw.releases === 'object') {
      rawList = Object.values(raw.releases);
    } else if (Array.isArray(raw.data?.releases)) {
      rawList = raw.data.releases;
    } else if (raw.data?.releases && typeof raw.data.releases === 'object') {
      rawList = Object.values(raw.data.releases);
    } else if (Array.isArray(raw.data)) {
      rawList = raw.data;
    } else if (raw.data && typeof raw.data === 'object') {
      const dCopy = { ...raw.data };
      delete dCopy.pager;
      delete dCopy.total;
      rawList = Object.values(dCopy);
    }
    return rawList
      .filter((r: any) => r && typeof r === 'object' && (r.id || r.name || r.tag || r.build))
      .map((r: any) => ({
        id: r.tag || r.id || r.name,
        name: String(r.name || r.tag || r.id),
        product: r.product ? Number(r.product) : undefined,
      }));
  }

  /**
   * 安全提取单页版本及分页元信息 (CFG-05)
   */
  private extractBuildsFromRaw(raw: any): {
    builds: ZentaoBuildItem[];
    total?: number;
    totalPage?: number;
  } {
    if (!raw || typeof raw !== 'object') return { builds: [] };

    const total =
      typeof raw.total === 'number' ? raw.total :
      typeof raw.pager?.total === 'number' ? raw.pager.total :
      typeof raw.pager?.recTotal === 'number' ? raw.pager.recTotal :
      typeof raw.data?.total === 'number' ? raw.data.total :
      typeof raw.data?.pager?.total === 'number' ? raw.data.pager.total :
      typeof raw.data?.pager?.recTotal === 'number' ? raw.data.pager.recTotal :
      undefined;

    const totalPage =
      typeof raw.totalPage === 'number' ? raw.totalPage :
      typeof raw.pager?.totalPage === 'number' ? raw.pager.totalPage :
      typeof raw.pager?.pageTotal === 'number' ? raw.pager.pageTotal :
      typeof raw.data?.totalPage === 'number' ? raw.data.totalPage :
      typeof raw.data?.pager?.totalPage === 'number' ? raw.data.pager.totalPage :
      undefined;

    let rawList: any[] = [];
    if (Array.isArray(raw)) {
      rawList = raw;
    } else if (Array.isArray(raw.builds)) {
      rawList = raw.builds;
    } else if (raw.builds && typeof raw.builds === 'object') {
      rawList = Object.values(raw.builds);
    } else if (Array.isArray(raw.data?.builds)) {
      rawList = raw.data.builds;
    } else if (raw.data?.builds && typeof raw.data.builds === 'object') {
      rawList = Object.values(raw.data.builds);
    } else if (Array.isArray(raw.data)) {
      rawList = raw.data;
    } else if (raw.data && typeof raw.data === 'object') {
      const dCopy = { ...raw.data };
      delete dCopy.pager;
      delete dCopy.total;
      delete dCopy.page;
      delete dCopy.limit;
      delete dCopy.totalPage;
      rawList = Object.values(dCopy);
    } else if (typeof raw === 'object' && !raw.status && !raw.error) {
      const copy = { ...raw };
      delete copy.pager;
      delete copy.total;
      delete copy.page;
      delete copy.limit;
      delete copy.totalPage;
      rawList = Object.values(copy);
    }

    const builds: ZentaoBuildItem[] = rawList
      .filter((b: any) => b && typeof b === 'object' && (b.id || b.name))
      .map((b: any) => ({
        id: b.id || b.name,
        name: String(b.name || b.id),
        product: b.product ? Number(b.product) : undefined,
        branch: b.branch ? Number(b.branch) : undefined,
      }));

    return { builds, total, totalPage };
  }

  /**
   * 动态拉取当前权限可访问的全部产品列表 (支持多页全量自动聚合) (CFG-05)
   */
  async fetchProducts(): Promise<{
    success: boolean;
    products?: ZentaoProductItem[];
    error?: string;
  }> {
    const isTokenMode = this.isTokenMode();
    if (!this.config.baseUrl || (isTokenMode && !this.config.token)) {
      return { success: false, error: isTokenMode ? '缺少禅道地址或 Token' : '缺少禅道地址' };
    }

    const norm = this.getNormalized();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000); // 20秒多页全程超时保护

    try {
      const productMap = new Map<number, ZentaoProductItem>();
      const MAX_PAGES = 30; // 最多自动翻 30 页（以每页 100 条计，最高支持 3000 个产品）
      let currentPage = 1;
      let knownTotal: number | undefined = undefined;
      let knownTotalPage: number | undefined = undefined;

      while (currentPage <= MAX_PAGES) {
        const pageUrl = `${norm.apiRoot}/products?page=${currentPage}&pageID=${currentPage}&limit=100&recPerPage=100`;
        const response = await this.fetcher(pageUrl, {
          method: 'GET',
          credentials: 'include',
          headers: this.buildHeaders(),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (currentPage === 1) {
            return { success: false, error: `获取产品列表失败 (HTTP ${response.status})` };
          }
          break; // 后续页出错则保留已有成功页
        }

        const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
        if (contentType.includes('text/html')) {
          if (currentPage === 1) {
            return {
              success: false,
              error: isTokenMode ? '接口返回 HTML，Token 可能已失效' : '接口返回 HTML，浏览器登录态可能已失效，请重新登录禅道',
            };
          }
          break;
        }

        const raw = (await response.json().catch(() => null)) as any;
        if (!raw || typeof raw !== 'object') {
          if (currentPage === 1) return { success: false, error: '解析产品列表失败：空响应' };
          break;
        }

        if (raw.status === 'fail' || raw.status === 'failed' || raw.error) {
          if (currentPage === 1) {
            return { success: false, error: raw.message || raw.error || '获取产品列表被拒绝' };
          }
          break;
        }

        const { products, total, totalPage } = this.extractProductsFromRaw(raw);
        if (total !== undefined && knownTotal === undefined) knownTotal = total;
        if (totalPage !== undefined && knownTotalPage === undefined) knownTotalPage = totalPage;

        if (products.length === 0) {
          break;
        }

        let newAdded = 0;
        for (const p of products) {
          if (!productMap.has(p.id)) {
            productMap.set(p.id, p);
            newAdded++;
          }
        }

        // 判定停止条件：
        // 1. 如果当前页没有带来任何新的产品 ID，说明服务端不支持翻页参数（重复返回相同数据）或已见底
        if (newAdded === 0) {
          break;
        }

        // 2. 如果已知总记录数 total 且累积数量已达到或超过 total
        if (knownTotal !== undefined && productMap.size >= knownTotal) {
          break;
        }

        // 3. 如果已知总页数 totalPage 且当前已处理至末页
        if (knownTotalPage !== undefined && currentPage >= knownTotalPage) {
          break;
        }

        // 4. 若无 total 与 totalPage 元数据，且当前页返回记录少于 20 条，判定已到末页
        if (knownTotal === undefined && knownTotalPage === undefined && products.length < 20) {
          break;
        }

        currentPage++;
      }

      const allProducts = Array.from(productMap.values());
      return { success: true, products: allProducts };
    } catch (err) {
      const error = err as Error;
      return {
        success: false,
        error: error.name === 'AbortError' ? '获取产品列表超时' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 动态拉取所属项目列表 (优先拉取产品关联项目，平滑降级至全局项目列表)
   */
  async fetchProjects(productId?: number): Promise<{
    success: boolean;
    projects?: ZentaoProjectItem[];
    error?: string;
  }> {
    const isTokenMode = this.isTokenMode();
    if (!this.config.baseUrl || (isTokenMode && !this.config.token)) {
      return { success: false, error: isTokenMode ? '缺少禅道地址或 Token' : '缺少禅道地址' };
    }

    const norm = this.getNormalized();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    try {
      const projectMap = new Map<number, ZentaoProjectItem>();

      const fetchFromUrl = async (urlPrefix: string): Promise<boolean> => {
        let currentPage = 1;
        const MAX_PAGES = 10;
        let knownTotal: number | undefined;
        let knownTotalPage: number | undefined;

        while (currentPage <= MAX_PAGES) {
          const sep = urlPrefix.includes('?') ? '&' : '?';
          const pageUrl = `${urlPrefix}${sep}page=${currentPage}&pageID=${currentPage}&limit=100&recPerPage=100`;
          const response = await this.fetcher(pageUrl, {
            method: 'GET',
            credentials: 'include',
            headers: this.buildHeaders(),
            signal: controller.signal,
          });

          if (!response.ok) return false;
          const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
          if (contentType.includes('text/html')) return false;

          const raw = (await response.json().catch(() => null)) as any;
          if (!raw || typeof raw !== 'object' || raw.status === 'fail' || raw.error) return false;

          const { projects, total, totalPage } = this.extractProjectsFromRaw(raw);
          if (total !== undefined && knownTotal === undefined) knownTotal = total;
          if (totalPage !== undefined && knownTotalPage === undefined) knownTotalPage = totalPage;

          if (projects.length === 0) break;
          let newAdded = 0;
          for (const p of projects) {
            if (!projectMap.has(p.id)) {
              projectMap.set(p.id, p);
              newAdded++;
            }
          }
          if (newAdded === 0) break;
          if (knownTotal !== undefined && projectMap.size >= knownTotal) break;
          if (knownTotalPage !== undefined && currentPage >= knownTotalPage) break;
          if (knownTotal === undefined && knownTotalPage === undefined && projects.length < 20) break;
          currentPage++;
        }
        return projectMap.size > 0;
      };

      // 1. 若提供了 productId，优先从 /products/{productId}/projects 获取
      if (productId) {
        await fetchFromUrl(`${norm.apiRoot}/products/${productId}/projects`).catch(() => false);
      }

      // 2. 若未获取到项目，回退至全局 /projects 获取
      if (projectMap.size === 0) {
        await fetchFromUrl(`${norm.apiRoot}/projects`).catch(() => false);
      }

      // 3. 若仍为空，尝试 /executions 获取执行列表
      if (projectMap.size === 0) {
        await fetchFromUrl(`${norm.apiRoot}/executions`).catch(() => false);
      }

      return { success: true, projects: Array.from(projectMap.values()) };
    } catch (err) {
      const error = err as Error;
      return {
        success: false,
        error: error.name === 'AbortError' ? '获取项目列表超时' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 动态拉取构建/影响版本列表 (多源并发聚合：项目构建 + 产品发布 + 产品构建 + trunk 兜底) (CFG-05)
   */
  async fetchProductBuilds(productId: number, projectId?: number): Promise<{
    success: boolean;
    builds?: ZentaoBuildItem[];
    error?: string;
  }> {
    const isTokenMode = this.isTokenMode();
    if (!this.config.baseUrl || !productId || (isTokenMode && !this.config.token)) {
      return { success: false, error: '缺少必要参数' };
    }

    const norm = this.getNormalized();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000); // 20秒超时

    try {
      const buildMap = new Map<string, ZentaoBuildItem>();
      // 始终置顶 trunk 主干
      buildMap.set('trunk', { id: 'trunk', name: 'trunk (主干)' });

      const safeFetchJson = async (url: string): Promise<any> => {
        try {
          const resp = await this.fetcher(url, {
            method: 'GET',
            credentials: 'include',
            headers: this.buildHeaders(),
            signal: controller.signal,
          });
          if (!resp.ok) return null;
          const contentType = resp.headers?.get ? (resp.headers.get('content-type') || '') : '';
          if (contentType.includes('text/html')) return null;
          const json = await resp.json().catch(() => null);
          if (!json || json.status === 'fail' || json.status === 'failed' || json.error) return null;
          return json;
        } catch {
          return null;
        }
      };

      const tasks: Promise<void>[] = [];

      // 源 1: 若提供了 projectId，拉取该项目下的构建列表（提 Bug 核心构建）
      if (projectId) {
        tasks.push(
          (async () => {
            const raw = await safeFetchJson(`${norm.apiRoot}/projects/${projectId}/builds?limit=100&recPerPage=100`);
            if (raw) {
              const { builds } = this.extractBuildsFromRaw(raw);
              for (const b of builds) {
                const key = String(b.id);
                if (!buildMap.has(key)) {
                  buildMap.set(key, b);
                }
              }
            }
          })()
        );
      }

      // 源 2: 拉取产品发布版本 (Releases，提单重要影响版本)
      tasks.push(
        (async () => {
          const raw = await safeFetchJson(`${norm.apiRoot}/products/${productId}/releases?limit=100&recPerPage=100`);
          if (raw) {
            const releases = this.extractReleasesFromRaw(raw);
            for (const r of releases) {
              const key = String(r.id);
              if (!buildMap.has(key)) {
                buildMap.set(key, r);
              }
            }
          }
        })()
      );

      // 源 3: 备用尝试 /products/{productId}/builds
      tasks.push(
        (async () => {
          const raw = await safeFetchJson(`${norm.apiRoot}/products/${productId}/builds?limit=100&recPerPage=100`);
          if (raw) {
            const { builds } = this.extractBuildsFromRaw(raw);
            for (const b of builds) {
              const key = String(b.id);
              if (!buildMap.has(key)) {
                buildMap.set(key, b);
              }
            }
          }
        })()
      );

      // 源 4: 备用尝试 /builds?product={productId}
      tasks.push(
        (async () => {
          const raw = await safeFetchJson(`${norm.apiRoot}/builds?product=${productId}&limit=100&recPerPage=100`);
          if (raw) {
            const { builds } = this.extractBuildsFromRaw(raw);
            for (const b of builds) {
              const key = String(b.id);
              if (!buildMap.has(key)) {
                buildMap.set(key, b);
              }
            }
          }
        })()
      );

      await Promise.allSettled(tasks);

      return { success: true, builds: Array.from(buildMap.values()) };
    } catch (err) {
      const error = err as Error;
      return {
        success: false,
        error: error.name === 'AbortError' ? '获取版本列表超时' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  extractUsersFromRaw(raw: any): ZentaoUserItem[] {
    const list: ZentaoUserItem[] = [];
    if (!raw || typeof raw !== 'object') return list;

    // 1. 如果 raw 自身是数组
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const account = String(item.account || item.user || item.username || item.id || '').trim();
        if (account && account !== 'null' && account !== 'undefined' && account !== 'closed') {
          list.push({
            id: item.id || account,
            account,
            realname: String(item.realname || item.name || item.realName || account).trim(),
            avatar: item.avatar,
          });
        }
      }
      return list;
    }

    // 2. 检查常见包含数组的字段 (users, team, members, data.users, data.team)
    const arrayCandidates = [
      raw.users,
      raw.data?.users,
      raw.team,
      raw.data?.team,
      raw.members,
      raw.data?.members,
      raw.data,
    ];
    for (const cand of arrayCandidates) {
      if (Array.isArray(cand) && cand.length > 0) {
        for (const item of cand) {
          if (!item || typeof item !== 'object') continue;
          const account = String(item.account || item.user || item.username || item.id || '').trim();
          if (account && account !== 'null' && account !== 'undefined' && account !== 'closed') {
            list.push({
              id: item.id || account,
              account,
              realname: String(item.realname || item.name || item.realName || account).trim(),
              avatar: item.avatar,
            });
          }
        }
        if (list.length > 0) return list;
      }
    }

    // 3. 检查字典对象形式 (如 { "admin": "管理员", "zhangsan": "张三" } 或 { "1": { account: "admin", realname: "管理员" } })
    const targetDict = raw.users || raw.data?.users || raw.team || (typeof raw === 'object' && !raw.status && !raw.error ? raw : null);
    if (targetDict && typeof targetDict === 'object' && !Array.isArray(targetDict)) {
      for (const [key, val] of Object.entries(targetDict)) {
        if (!val) continue;
        if (typeof val === 'string') {
          const account = key.trim();
          if (account && account !== 'closed' && !account.startsWith('page') && account !== 'total') {
            list.push({ account, realname: val.trim() });
          }
        } else if (typeof val === 'object') {
          const v = val as any;
          const account = String(v.account || v.user || v.username || key).trim();
          if (account && account !== 'closed') {
            list.push({
              id: v.id || account,
              account,
              realname: String(v.realname || v.name || account).trim(),
              avatar: v.avatar,
            });
          }
        }
      }
    }

    return list;
  }

  /**
   * 拉取指派人/用户列表 (优先项目团队，平滑降级至全局用户列表)
   */
  async fetchUsers(options?: {
    projectId?: number;
    productId?: number;
  }): Promise<{
    success: boolean;
    users?: ZentaoUserItem[];
    error?: string;
  }> {
    const isTokenMode = this.isTokenMode();
    if (!this.config.baseUrl || (isTokenMode && !this.config.token)) {
      return { success: false, error: isTokenMode ? '缺少禅道地址或 Token' : '缺少禅道地址' };
    }

    const norm = this.getNormalized();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const userMap = new Map<string, ZentaoUserItem>();

    const tryFetch = async (url: string): Promise<boolean> => {
      try {
        const response = await this.fetcher(url, {
          method: 'GET',
          credentials: 'include',
          headers: this.buildHeaders(),
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
        if (contentType.includes('text/html')) return false;

        const raw = (await response.json().catch(() => null)) as any;
        if (!raw || typeof raw !== 'object' || raw.status === 'fail' || raw.error) return false;

        const users = this.extractUsersFromRaw(raw);
        for (const u of users) {
          if (!userMap.has(u.account)) {
            userMap.set(u.account, u);
          }
        }
        return users.length > 0;
      } catch {
        return false;
      }
    };

    try {
      const projId = options?.projectId || this.config.projectId;
      const prodId = options?.productId || this.config.productId;

      // 1. 若有项目 ID，优先请求该项目团队成员
      if (projId) {
        await tryFetch(`${norm.apiRoot}/projects/${projId}/team`);
        await tryFetch(`${norm.apiRoot}/projects/${projId}/users`);
      }

      // 2. 尝试全局用户列表 (带分页 limit 与不带参数)
      await tryFetch(`${norm.apiRoot}/users?limit=200&recPerPage=200`);
      if (userMap.size === 0) {
        await tryFetch(`${norm.apiRoot}/users`);
      }

      // 3. 若仍为空且有产品 ID，尝试产品团队
      if (userMap.size === 0 && prodId) {
        await tryFetch(`${norm.apiRoot}/products/${prodId}/team`);
      }

      const users = Array.from(userMap.values());
      return {
        success: users.length > 0,
        users,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async createBug(
    bug: Pick<Bug, 'title' | 'severity' | 'reproductionSteps' | 'expectedResult' | 'actualResult'> & {
      assignedTo?: string;
      pri?: number;
      severityLevel?: number;
      aiAnalysis?: string;
      recordingBlob?: Blob;
      recordingFileName?: string;
    },
    snapshot: BugSnapshot
  ): Promise<ZentaoCreateResult> {
    const severityMap: Record<Bug['severity'], number> = {
      Blocker: 1,
      Critical: 2,
      Major: 3,
      Minor: 4,
      Suggestion: 4,
    };
    const resolvedSeverity = bug.severityLevel && [1, 2, 3, 4].includes(bug.severityLevel)
      ? bug.severityLevel
      : (severityMap[bug.severity] || 3);
    const resolvedPri = bug.pri && [1, 2, 3, 4].includes(bug.pri)
      ? bug.pri
      : (severityMap[bug.severity] || 3);

    const stepsParts = [
      '[步骤]',
      ...bug.reproductionSteps.map((step, index) => `${index + 1}. ${step.replace(/^\d+\.\s*/, '')}`),
      '',
      '[结果]',
      bug.actualResult,
      '',
      '[期望]',
      bug.expectedResult,
    ];

    if (bug.aiAnalysis && bug.aiAnalysis.trim()) {
      stepsParts.push('', '[疑似根因分析与排查建议]', bug.aiAnalysis.trim());
    }

    stepsParts.push(
      '',
      '[环境]',
      `${snapshot.environment || '未知'} | ${snapshot.browserInfo.browserName} ${snapshot.browserInfo.browserVersion} | ${snapshot.browserInfo.os}`,
      snapshot.url,
    );

    const steps = stepsParts.join('\n');
    this.validateConfig();
    const norm = this.getNormalized();
    const primaryAdapter = this.getAdapter();
    const fallbackAdapter = this.config.apiVersion === 'v1' ? new ZentaoV2Adapter() : new ZentaoV1Adapter();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000); // 20秒全程超时

    try {
      // 构造多级容错候选方案
      const attempts: Array<{
        adapter: ZentaoApiAdapter;
        url: string;
        body: Record<string, any>;
        name: string;
      }> = [
        // 方案 1: 当前配置 API 版本 + 完整参数
        {
          adapter: primaryAdapter,
          url: primaryAdapter.getCreateBugUrl(norm.apiRoot, this.config.productId),
          body: primaryAdapter.buildCreateBugBody({
            productId: this.config.productId,
            title: bug.title,
            openedBuild: this.config.openedBuild,
            project: this.config.projectId,
            execution: this.config.executionId,
            severity: resolvedSeverity,
            pri: resolvedPri,
            type: 'codeerror',
            steps,
            assignedTo: bug.assignedTo || this.config.assignedTo,
          }),
          name: `首选 (${primaryAdapter.version})`,
        },
      ];

      // 方案 2: 若当前参数包含了项目或执行，加入剔除项目的降级尝试（解决账号未被拉入项目团队或项目已归档导致的 not allowed）
      if (this.config.projectId || this.config.executionId) {
        attempts.push({
          adapter: primaryAdapter,
          url: primaryAdapter.getCreateBugUrl(norm.apiRoot, this.config.productId),
          body: primaryAdapter.buildCreateBugBody({
            productId: this.config.productId,
            title: bug.title,
            openedBuild: this.config.openedBuild,
            project: undefined,
            execution: undefined,
            severity: resolvedSeverity,
            pri: resolvedPri,
            type: 'codeerror',
            steps,
            assignedTo: bug.assignedTo || this.config.assignedTo,
          }),
          name: `剔除关联项目 (${primaryAdapter.version})`,
        });
      }

      // 方案 3: 备用 API 版本重试（解决服务端未开启 v2 路由或 v1 权限差异导致的 not allowed）
      const fallbackApiRoot = `${norm.baseUrl}/api.php/${fallbackAdapter.version}`;
      attempts.push({
        adapter: fallbackAdapter,
        url: fallbackAdapter.getCreateBugUrl(fallbackApiRoot, this.config.productId),
        body: fallbackAdapter.buildCreateBugBody({
          productId: this.config.productId,
          title: bug.title,
          openedBuild: this.config.openedBuild,
          project: undefined,
          execution: undefined,
          severity: resolvedSeverity,
          pri: resolvedPri,
          type: 'codeerror',
          steps,
          assignedTo: bug.assignedTo || this.config.assignedTo,
        }),
        name: `备用版本 (${fallbackAdapter.version})`,
      });

      let parsed: { id: number } | null = null;
      let lastErrMsg = '';

      for (let i = 0; i < attempts.length; i += 1) {
        const att = attempts[i];
        try {
          const response = await this.fetcher(att.url, {
            method: 'POST',
            credentials: 'include',
            headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(att.body),
            signal: controller.signal,
          });

          const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
          if (contentType.includes('text/html')) {
            throw new Error('创建 Bug 接口返回 HTML 页面，表明登录态已失效或未授权');
          }

          const result = await response.json().catch(() => ({}));
          parsed = att.adapter.parseCreateBugResponse(response.ok, response.status, result);
          if (parsed && parsed.id) {
            break;
          }
        } catch (err) {
          lastErrMsg = (err as Error).message || '';
          const isPermissionOrRoutingError =
            lastErrMsg.toLowerCase().includes('not allowed') ||
            lastErrMsg.includes('403') ||
            lastErrMsg.includes('404') ||
            lastErrMsg.includes('405') ||
            lastErrMsg.includes('未授权');

          // 若不是权限拒绝或路由未找到（如网络错误、AbortError 等），或者已经是最后一个重试方案，则不再重试
          if (!isPermissionOrRoutingError || i === attempts.length - 1) {
            if (lastErrMsg.toLowerCase().includes('not allowed')) {
              throw new Error(
                this.isTokenMode()
                  ? '禅道权限拒绝 (not allowed)：Token 无提单权限或已失效，请检查系统设置中的 Token 与权限配置'
                  : '禅道权限拒绝 (not allowed)：当前账号对所选产品无提单权限，或网页登录态已失效。请在浏览器中打开并登录禅道'
              );
            }
            throw err;
          }
        }
      }

      if (!parsed || !parsed.id) {
        throw new Error(lastErrMsg || '创建 Bug 失败');
      }

      const created: ZentaoCreateResult = {
        id: parsed.id,
        url: `${norm.baseUrl}/bug-view-${parsed.id}.html`,
      };

      if (snapshot.screenshotUrl) {
        try {
          await this.uploadScreenshot(parsed.id, snapshot.screenshotUrl);
          created.attachmentUploaded = true;
        } catch (error) {
          created.attachmentUploaded = false;
          created.attachmentError =
            this.config.apiVersion === 'v1'
              ? `禅道 API v1 暂未开放官方 Token 附件上传接口，Bug 已建单成功 (#${parsed.id})`
              : (error as Error).message;
        }
      }

      if (bug.recordingBlob) {
        try {
          await this.uploadRecording(parsed.id, bug.recordingBlob, bug.recordingFileName);
          created.recordingUploaded = true;
        } catch (error) {
          created.recordingUploaded = false;
          created.recordingError =
            this.config.apiVersion === 'v1'
              ? `禅道 API v1 暂未开放官方 Token 附件上传接口，录屏未上传`
              : (error as Error).message;
        }
      }
      return created;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new Error('创建 Bug 请求超时（15秒）');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
