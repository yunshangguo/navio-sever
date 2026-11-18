'use strict';
/**
 * 阶段 2 组件测试（纯 Node，不起 Electron）
 * 覆盖：widgets/todos/notes 数据层往返、Web 保存→JSON 落盘、多用户空间隔离、
 *       /api/weather 服务端代理（含离线降级）、组件静态资源随包发布。
 * 用法：node _test_widgets.js
 */
const fs = require('fs');
const path = require('path');

const { Store, normalize } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');
const weather = require('./src/weather');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const tmp = 'C:/AI使用/navio-tmp/widgets-test-' + Date.now();
const PORT = 19400 + (process.pid % 300);
const base = `http://127.0.0.1:${PORT}`;
let svr, store, config, auth, cookie = '';

async function req(p, opt) {
  const o = { redirect: 'manual', ...(opt || {}) };
  o.headers = { ...(o.headers || {}) };
  if (cookie) o.headers.Cookie = cookie;
  return fetch(base + p, o);
}
async function post(p, data) {
  return req(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data === undefined ? {} : data) });
}
async function j(r) { try { return await r.json(); } catch (_) { return null; } }

(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const rendererDir = path.join(__dirname, 'renderer');

  /* ---------- A. 数据层 ---------- */
  const widgets = [
    { id: 'w_todo', type: 'todo', enabled: true, order: 0, data: {} },
    { id: 'w_weather', type: 'weather', enabled: true, order: 2, data: { city: '北京', temp: 26, desc: '晴', updatedAt: '2026-11-16T06:00:00.000Z' } }
  ];
  const todos = [
    { id: 't_1', text: '买内存条', done: false, due: '2026-11-20', createdAt: '2026-11-16T06:00:00.000Z' },
    { id: 't_2', text: '装 Docker', done: true, due: '', createdAt: '2026-11-16T06:01:00.000Z' }
  ];
  const notes = [{ id: 'n_1', title: '配置清单', body: '第一行\n第二行\n第三行', updatedAt: '2026-11-16T06:02:00.000Z' }];
  const state = {
    version: 1,
    groups: [{ id: 'g1', name: '常用', order: 0 }],
    bookmarks: [{ id: 'b1', groupId: 'g1', title: 'GitHub', url: 'https://github.com', order: 0 }],
    widgets, todos, notes
  };
  const n = normalize(state);
  ck('normalize 保留 widgets 组件配置', Array.isArray(n.widgets) && n.widgets.length === 2 && n.widgets[1].data.city === '北京');
  ck('normalize 保留 todos（含 done/due）', Array.isArray(n.todos) && n.todos.length === 2 && n.todos[0].due === '2026-11-20' && n.todos[1].done === true);
  ck('normalize 保留 notes 多行正文', Array.isArray(n.notes) && n.notes.length === 1 && n.notes[0].body.includes('第二行'));
  ck('组件数据不破坏书签/分组', n.bookmarks.length === 1 && n.groups.length === 1 && n.bookmarks[0].title === 'GitHub');
  const dirty = normalize({ widgets: ['bad', { id: 'ok' }, null], todos: [1, { text: 'ok' }] });
  ck('组件数组过滤非对象元素', dirty.widgets.length === 1 && dirty.todos.length === 1);
  ck('天气 WMO 编码映射', weather.weatherDesc(0) === '晴' && weather.weatherDesc(61) === '小雨' && weather.weatherDesc(999) === '未知');
  ck('空城市名不联网且如实失败', (await weather.fetchWeather('')).ok === false);

  /* ---------- B. 静态资源 ---------- */
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  ck('index.html 引入 widgets.css', html.includes('widgets.css'));
  ck('index.html 含组件面板与入口按钮', html.includes('id="widgetsPanel"') && html.includes('id="btnWidgets"'));
  const css = fs.readFileSync(path.join(rendererDir, 'widgets.css'), 'utf8');
  ck('widgets.css 含 4 类组件样式', ['.wg-todo-list', '.wg-cal-grid', '.wg-weather-main', '.wg-note-list'].every((s) => css.includes(s)));
  const appjs = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  ck('app.js 含 4 个组件实现', ['待办事项', '日历', '天气', '记事本'].every((s) => appjs.includes(s)) && appjs.includes('renderWidgets()'));

  /* ---------- C. HTTP ---------- */
  store = new Store(tmp);
  store.load();
  config = new ServerConfig(tmp);
  config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  auth = new Auth(tmp, config);
  const ai = auth.load();
  const icons = new IconCache(tmp, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  svr = new NavioServer({ store, auth, config, icons, rendererDir, dataDir: tmp, log: () => {} });
  ck('HTTP 服务启动', (await svr.start()).ok);

  ck('公共起始页：游客可加载组件 CSS', (await req('/widgets.css')).status === 200);
  const login = await post('/api/auth/login', { username: 'admin', password: ai.initialPassword });
  ck('管理员登录成功', (await j(login)).ok === true);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  ck('登录后组件 CSS 可访问', (await req('/widgets.css')).status === 200);

  // 保存含组件数据的完整 state
  const full = normalize(state);
  ck('保存含组件数据的 state', (await j(await post('/api/state', full))).ok === true);
  const back = (await j(await req('/api/state'))).state;
  ck('读回 widgets 一致', back.widgets.length === 2 && back.widgets[1].data.city === '北京');
  ck('读回 todos 一致', back.todos.length === 2 && back.todos[0].text === '买内存条');
  ck('读回 notes 一致', back.notes[0].body.includes('第三行'));

  // 落盘：flush 同步写，避免 debounce 竞态
  await post('/api/state/flush', full);
  const raw = fs.readFileSync(path.join(tmp, 'data.json'), 'utf8');
  ck('组件数据仍写在单个 data.json', raw.includes('买内存条') && raw.includes('配置清单') && raw.includes('北京'));
  ck('data.json 是合法 JSON', !!JSON.parse(raw).bookmarks);

  // 多用户空间隔离
  auth.createUser({ username: 'family2', password: 'pw12345678', role: 'user' });
  const saved = cookie;
  cookie = ''; // 模拟「退出后换账号登录」，不带旧 session，否则拿到的仍是上一个账号的视图
  const u2 = await post('/api/auth/login', { username: 'family2', password: 'pw12345678' });
  // 公共模式下登录响应同时带 navio_sid 与 navio_anon，必须精确取会话 cookie
  const u2Cookies = u2.headers.getSetCookie ? u2.headers.getSetCookie() : [u2.headers.get('set-cookie') || ''];
  const cookie2 = (u2Cookies.find((x) => /^navio_sid=/.test(x)) || '').split(';')[0];
  cookie = cookie2;
  const sp2 = (await j(await req('/api/state'))).state;
  ck('新用户组件数据独立为空', !(sp2.todos || []).length && !(sp2.notes || []).length,
     { todos: (sp2.todos || []).length, notes: (sp2.notes || []).length, bookmarks: (sp2.bookmarks || []).length, cookie2: cookie2.slice(0, 24) });
  ck('新用户仍有默认组件配置或空数组', !sp2.widgets || Array.isArray(sp2.widgets));
  cookie = saved;

  /* ---------- D. 天气代理 ---------- */
  ck('公共起始页下游客可访问天气代理（白名单）', (await (async () => { const c = cookie; cookie = ''; const r = await req('/api/weather?city=Beijing'); cookie = c; return r; })()).status === 200);
  const noCity = await req('/api/weather');
  ck('天气端点缺 city 返回 400', noCity.status === 400 && (await j(noCity)).ok === false);
  const wr = await req('/api/weather?city=Beijing');
  const wj = await j(wr);
  ck('天气端点返回结构化 JSON（在线/离线均可）', wr.status === 200 && wj && typeof wj.ok === 'boolean' && (wj.ok === true ? typeof wj.temp !== 'undefined' : typeof wj.error === 'string'), wj && (wj.error || wj.city));
  ck('天气端点异常不打断服务', (await req('/api/version')).status === 200);

  if (svr && svr.stop) await svr.stop();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果: ${pass}/${results.length} PASS`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.log('ERR', e && e.stack);
  process.exit(1);
});
