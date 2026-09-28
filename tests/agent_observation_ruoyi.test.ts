import { describe, it, expect, vi } from 'vitest';

// 初始化 Node 测试环境下的最小全局对象
(globalThis as any).window = {
  location: { href: 'http://localhost/#/system/user' },
  postMessage: () => {},
  addEventListener: () => {},
  scrollTo: vi.fn(),
  scrollX: 0,
  scrollY: 0,
};
(globalThis as any).chrome = {
  storage: {
    local: { get: (_: any, cb: any) => cb?.({}) },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    onMessage: { addListener: () => {} },
  },
};
(globalThis as any).history = {
  pushState: () => {},
  replaceState: () => {},
};
(globalThis as any).document = {
  title: '用户管理 - 若依管理系统',
  documentElement: { appendChild: () => {} },
  createElement: () => ({ style: {}, dataset: {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const { collectAiObservation } = await import('../src/content/index');

class MockDOMElement {
  id: string = '';
  name: string = '';
  tagName: string;
  className: string = '';
  type: string = 'text';
  value: string = '';
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  required: boolean = false;
  placeholder: string = '';
  options: any[] = [];
  selectedOptions: any[] = [];
  parentElement: MockDOMElement | null = null;
  parentNode: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  textContent: string = '';
  innerText: string = '';
  attributes: Record<string, string> = {};
  style: any = { display: 'block', visibility: 'visible' };
  offsetParent: any = {};

  constructor(tag: string, id: string = '', className: string = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }

  getAttribute(attr: string): string | null {
    if (attr in this.attributes) return this.attributes[attr];
    if (attr === 'name') return this.name || null;
    if (attr === 'id') return this.id || null;
    if (attr === 'placeholder') return this.placeholder || null;
    if (attr === 'class') return this.className || null;
    return null;
  }

  hasAttribute(attr: string): boolean {
    if (attr in this.attributes) return true;
    if (attr === 'disabled') return this.disabled;
    if (attr === 'readonly') return this.readOnly;
    if (attr === 'required') return this.required;
    return false;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  getClientRects() {
    return [{ width: 100, height: 30 }];
  }

  appendChild(child: MockDOMElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  closest(selector: string): MockDOMElement | null {
    const parts = selector.split(',').map((s) => s.trim());
    let cur: MockDOMElement | null = this;
    while (cur) {
      for (const part of parts) {
        if (cur.matches(part)) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  contains(other: MockDOMElement): boolean {
    let cur: MockDOMElement | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    const classList = this.className.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const cleanPart = part.replace(/:not\([^)]*\)/g, '').trim();
      if (cleanPart.startsWith('.') && classList.includes(cleanPart.slice(1))) return true;
      if (cleanPart.startsWith('#') && this.id === cleanPart.slice(1)) return true;
      if (cleanPart.toLowerCase() === this.tagName.toLowerCase()) return true;
      if (cleanPart.includes('[role=') && this.attributes['role'] && cleanPart.includes(this.attributes['role'])) return true;
      if (cleanPart.includes('[class*=') && typeof this.className === 'string') {
        const match = cleanPart.match(/\[class\*=["']?([^"']+)["']?\]/);
        if (match && this.className.includes(match[1])) return true;
      }
    }
    return false;
  }

  querySelector(selector: string): MockDOMElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];
    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

describe('RuoYi 页面自然语言自动化测试观察提炼验证', () => {
  it('优先将主操作区「+ 新增」等业务按钮排在前面，且识别为按钮自身文字，避免误判右上角辅助设置', () => {
    // 构造模拟文档
    const doc = new MockDOMElement('html', 'html');
    const body = new MockDOMElement('body', 'body');
    doc.appendChild(body);

    // 1. 顶部 Navbar (包含右上角工具)
    const header = new MockDOMElement('header', 'top-navbar', 'navbar');
    const rightMenu = new MockDOMElement('div', 'right-menu', 'right-menu');
    const sizeSelectBtn = new MockDOMElement('button', 'size-select', 'size-select-btn');
    sizeSelectBtn.setAttribute('title', '布局大小');
    // 纯图标，无文字
    sizeSelectBtn.innerText = '';
    sizeSelectBtn.textContent = '';
    rightMenu.appendChild(sizeSelectBtn);
    header.appendChild(rightMenu);
    body.appendChild(header);

    // 2. 侧边栏 (20个菜单)
    const sidebar = new MockDOMElement('aside', 'sidebar', 'sidebar-container');
    for (let i = 0; i < 20; i++) {
      const menu = new MockDOMElement('a', `menu-${i}`, 'menu-item');
      menu.setAttribute('href', `#/menu-${i}`);
      menu.innerText = `菜单项 ${i}`;
      menu.textContent = `菜单项 ${i}`;
      sidebar.appendChild(menu);
    }
    body.appendChild(sidebar);

    // 3. 主内容区 (app-main)
    const main = new MockDOMElement('main', 'app-main', 'app-main');

    // 3.1 左侧部门树 (20个部门)
    const deptTree = new MockDOMElement('div', 'dept-tree', 'org-tree');
    for (let i = 0; i < 20; i++) {
      const node = new MockDOMElement('div', `dept-${i}`, 'el-tree-node');
      node.setAttribute('role', 'treeitem');
      node.innerText = `部门 ${i}`;
      node.textContent = `部门 ${i}`;
      deptTree.appendChild(node);
    }
    main.appendChild(deptTree);

    // 3.2 表格上方工具栏 (包含 + 新增 按钮)
    const toolbar = new MockDOMElement('div', 'toolbar', 'table-toolbar');
    const addBtn = new MockDOMElement('button', 'btn-add', 'el-button el-button--primary');
    addBtn.innerText = '+ 新增';
    addBtn.textContent = '+ 新增';
    toolbar.appendChild(addBtn);

    const editBtn = new MockDOMElement('button', 'btn-edit', 'el-button el-button--success');
    editBtn.innerText = '修改';
    editBtn.textContent = '修改';
    toolbar.appendChild(editBtn);
    main.appendChild(toolbar);

    body.appendChild(main);

    // 绑定到全局 document
    (doc as any).body = body;
    (doc as any).title = '用户管理 - 系统管理';
    (globalThis as any).document = doc;

    const observation = collectAiObservation();

    // 验证：
    // 1.「+ 新增」按钮必须出现在前 10 个元素中（主内容区最优先）
    const addElIndex = observation.elements.findIndex((el) => el.text?.includes('新增') || el.name?.includes('新增'));
    expect(addElIndex).toBeGreaterThanOrEqual(0);
    expect(addElIndex).toBeLessThan(10);

    // 2.「+ 新增」按钮的 name 必须是按钮自身的文字，而不是周围乱七八糟的 label
    const addEl = observation.elements[addElIndex];
    expect(addEl.name).toContain('新增');
    expect(addEl.tag).toBe('button');

    // 3. 右上角「布局大小」按钮必须打上 [顶部工具栏] 标记，且排在业务按钮之后
    const sizeEl = observation.elements.find((el) => el.id.includes('size-select') || el.name?.includes('布局大小'));
    expect(sizeEl).toBeDefined();
    if (sizeEl) {
      expect(sizeEl.name).toContain('[顶部工具栏]');
      const sizeIndex = observation.elements.indexOf(sizeEl);
      expect(sizeIndex).toBeGreaterThan(addElIndex);
    }
  });
});
