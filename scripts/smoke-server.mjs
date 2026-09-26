import { createServer } from 'node:http';

const port = Number(process.env.QA_COPILOT_SMOKE_PORT || 4173);

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>QA Copilot M2 Smoke</title>
  <style>
    body{font:14px system-ui;max-width:820px;margin:40px auto;padding:0 20px;color:#172033}
    section{border:1px solid #d9e0ea;border-radius:12px;padding:16px;margin:14px 0}
    label{display:block;margin:10px 0 4px} input,select,button{padding:8px;margin-right:6px}
    button{margin-top:8px;cursor:pointer}.danger{background:#d92d20;color:white;border:0;border-radius:6px}
    pre{background:#111827;color:#d1fae5;padding:12px;border-radius:8px;min-height:40px;white-space:pre-wrap}
  </style>
</head>
<body>
  <h1>QA Copilot M2 Smoke</h1>
  <p>先在插件中开始测试，再依次操作下列控件。iframe 测试请访问：<a href="/smoke/iframe-host" target="_blank" id="iframe-test-link">打开 Iframe 隔离测试页</a></p>
  <section>
    <h2>表单采集与同名组</h2>
    <label for="username">用户名</label><input id="username" name="username" placeholder="请输入用户名" />
    <label for="phone">手机号</label><input id="phone" name="phone" type="tel" value="13812345678" />
    <label for="password">密码（不得被记录）</label><input id="password" name="password" type="password" value="raw-secret" />
    <label for="role">角色</label><select id="role" name="role"><option>QA</option><option>Developer</option></select>
    <label><input id="enabled" name="enabled" type="checkbox" value="yes" /> 启用</label>
    <div>
      <p style="margin:8px 0 4px;font-weight:bold">性别（无独立 id 的同名单选组）：</p>
      <label style="display:inline-block;margin-right:12px"><input type="radio" name="gender" value="male" /> 男</label>
      <label style="display:inline-block;margin-right:12px"><input type="radio" name="gender" value="female" /> 女</label>
      <label style="display:inline-block"><input type="radio" name="gender" value="secret" /> 保密</label>
    </div>
  </section>
  <section>
    <h2>导航</h2>
    <button id="push">pushState</button><button id="replace">replaceState</button><button id="hash">hash</button>
  </section>
  <section>
    <h2>Network 与 Console (含跨 Session 慢请求)</h2>
    <button id="fetch-ok">Fetch 200</button>
    <button id="fetch-500" class="danger"><span>Fetch 500（点击内部文字）</span></button>
    <button id="xhr-400">XHR 400</button>
    <button id="slow-3s">发起慢请求 (3.5s)</button>
    <button id="abort-req">取消慢请求</button>
    <button id="console">console.error</button><button id="runtime">运行时异常</button>
    <pre id="output"></pre>
  </section>
  <script>
    const out = document.querySelector('#output');
    const show = value => { out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
    let abortController = null;
    document.querySelector('#push').onclick = () => history.pushState({}, '', '/smoke/pushed?token=raw-token-example');
    document.querySelector('#replace').onclick = () => history.replaceState({}, '', '/smoke/replaced');
    document.querySelector('#hash').onclick = () => location.hash = 'smoke-hash';
    document.querySelector('#fetch-ok').onclick = async () => show(await (await fetch('/api/success')).json());
    document.querySelector('#fetch-500').onclick = async () => show(await (await fetch('/api/error', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer raw-token'},
      body:JSON.stringify({password:'raw-password',phone:'13812345678',quantity:99})
    })).text());
    document.querySelector('#xhr-400').onclick = () => { const x=new XMLHttpRequest(); x.open('POST','/api/bad-request'); x.setRequestHeader('X-Smoke','xhr'); x.onloadend=()=>show(x.responseText); x.send('token=raw-xhr-token&name=qa'); };
    document.querySelector('#slow-3s').onclick = async () => {
      abortController = new AbortController();
      show('慢请求已发起 (预计 3.5 秒后响应)，请在插件中尝试结束当前会话并开启新会话...');
      try {
        const res = await fetch('/api/slow?delay=3500', { signal: abortController.signal });
        show(await res.json());
      } catch (err) {
        show('请求异常/已取消: ' + err.message);
      }
    };
    document.querySelector('#abort-req').onclick = () => {
      if (abortController) {
        abortController.abort();
        show('慢请求已调用 abort() 取消');
      }
    };
    document.querySelector('#console').onclick = () => console.error('Smoke console error', {password:'never-store'});
    document.querySelector('#runtime').onclick = () => setTimeout(() => { throw new TypeError('Smoke runtime error'); }, 0);
  </script>
</body>
</html>`;

const iframeChildPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>QA Copilot Smoke - Iframe Child</title>
  <style>
    body{font:13px system-ui;background:#f8fafc;padding:12px;margin:0;color:#334155;border:2px dashed #94a3b8}
    button{padding:6px 12px;cursor:pointer;background:#0284c7;color:#fff;border:0;border-radius:4px}
    input{padding:6px;margin:6px 0;width:180px}
  </style>
</head>
<body>
  <h3>内嵌 Iframe 子页面</h3>
  <p>同名控件隔离测试：</p>
  <label>用户名：<input name="username" placeholder="iframe 内部用户名" /></label><br />
  <button id="common-submit-btn">公共提交按钮 (Iframe 内部)</button>
  <p id="child-status">未点击</p>
  <script>
    document.querySelector('#common-submit-btn').onclick = () => {
      document.querySelector('#child-status').textContent = '已由 iframe 内部点击，时间: ' + Date.now();
    };
  </script>
</body>
</html>`;

const iframeHostPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>QA Copilot Smoke - Iframe Host</title>
  <style>
    body{font:14px system-ui;max-width:820px;margin:30px auto;padding:0 20px;color:#172033}
    section{border:1px solid #d9e0ea;border-radius:12px;padding:16px;margin:14px 0}
    button{padding:8px 14px;cursor:pointer;background:#2563eb;color:#fff;border:0;border-radius:6px}
    iframe{width:100%;height:220px;border:0;margin-top:12px}
  </style>
</head>
<body>
  <h1>Iframe 嵌套与同名目标测试 (IMP-04 夹具)</h1>
  <section>
    <h2>顶层父页面 (Top Frame)</h2>
    <label>用户名：<input name="username" placeholder="顶层父页面用户名" /></label><br /><br />
    <button id="common-submit-btn">公共提交按钮 (顶层父页面)</button>
    <p id="top-status">未点击</p>
  </section>
  <section>
    <h2>内嵌子页面 (Child Frame)</h2>
    <iframe src="/smoke/iframe-child" id="smoke-iframe"></iframe>
  </section>
  <script>
    document.querySelector('#common-submit-btn').onclick = () => {
      document.querySelector('#top-status').textContent = '已由顶层父页面点击，时间: ' + Date.now();
    };
  </script>
</body>
</html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  response.setHeader('Cache-Control', 'no-store');

  if (url.pathname === '/api/success') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/error') {
    response.writeHead(500, { 'Content-Type': 'application/json', 'X-Smoke': 'server-error' });
    response.end(JSON.stringify({ code: 50001, message: 'stock calculation error', token: 'response-secret' }));
    return;
  }
  if (url.pathname === '/api/bad-request') {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 40001, message: 'invalid request' }));
    return;
  }
  if (url.pathname === '/api/malformed-json') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok": true, "corrupted": ');
    return;
  }
  if (url.pathname === '/api/slow') {
    const delay = Math.max(100, Math.min(10000, Number(url.searchParams.get('delay')) || 2500));
    setTimeout(() => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, delay, message: 'slow response complete' }));
    }, delay);
    return;
  }
  if (url.pathname === '/smoke/iframe-host') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(iframeHostPage);
    return;
  }
  if (url.pathname === '/smoke/iframe-child') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(iframeChildPage);
    return;
  }

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(page);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`QA Copilot Smoke: http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

