/**
 * 用 CDP 打开页面，收集控制台错误与异常，并可选截图。
 * 用法: node tools/inspect.mjs <url> [screenshotPath]
 */
const url = process.argv[2] || 'http://127.0.0.1:8787/';
const shot = process.argv[3];

const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || [])
      .map((a) => a.value ?? a.description ?? a.type)
      .join(' ');
    logs.push(`[console.${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`);
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error') logs.push(`[log.error] ${e.text} ${e.url || ''}`);
  }
});

await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCache');
await send('Page.enable');

// 先设定视口，再导航，避免媒体查询按默认 800px 视口布局
const W = Number(process.env.VIEWPORT_W || 1440);
await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

// 可选：模拟系统深色模式
if (process.env.DARK === '1') {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
}

// 先跳到空白页断开同一文档导航，确保之后是真正的整页加载（而不是仅换 hash）
await send('Page.navigate', { url: 'about:blank' });
await new Promise((r) => setTimeout(r, 300));
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 7000));

// 可选：先执行一段交互脚本（如点击某本书），再截图
if (process.env.CLICK) {
  await send('Runtime.evaluate', { expression: process.env.CLICK, returnByValue: true });
  await new Promise((r) => setTimeout(r, 5000));
}

// 检查渲染结果
const res = await send('Runtime.evaluate', {
  expression:
    "JSON.stringify({rootLen: document.getElementById('root').innerHTML.length, title: document.title, h1: document.querySelector('h1')?.innerText || null, cards: document.querySelectorAll('.card').length, books: document.querySelectorAll('.book-card').length})",
  returnByValue: true,
});
console.log('STATE:', res.result?.value);

if (process.env.EVAL) {
  const r2 = await send('Runtime.evaluate', {
    expression: process.env.EVAL,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log('EVAL:', JSON.stringify(r2.result?.value));
}
console.log('LOGS:', logs.length ? logs.join('\n') : '(none)');

if (shot) {
  const metrics = await send('Page.getLayoutMetrics');
  const h = Math.min(Math.ceil(metrics.cssContentSize?.height || 1000), Number(process.env.CAP_H || 1500));
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 800));
  const cap = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs/promises');
  await fs.writeFile(shot, Buffer.from(cap.data, 'base64'));
  console.log('SCREENSHOT:', shot, 'height', h);
}
ws.close();
process.exit(0);