'use strict';
/**
 * Navio Server HTTP 集成测试（纯 Node，不起 Electron）
 * 覆盖：游客公共模式、登录/登出、会话、数据读写、多用户空间隔离、
 *       内置图标降级、图标库、书签 HTML 往返、管理接口不暴露、限流、白名单。
 * 用法：node _test_server.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Store } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');
const preset = require('./src/preset-icons');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const tmp = path.join(os.tmpdir(), 'navio-server-test-' + Date.now());
const PORT = 19000 + (process.pid % 1000);
const base = `http://127.0.0.1:${PORT}`;

let svr, auth, store, config, adminPw;
let cookie = '';

async function req(p, opt) {
  const o = { redirect: 'manual', ...(opt || {}) };
  o.headers = { ...(o.headers || {}) };
  if (cookie) o.headers.Cookie = cookie;
  return fetch(base + p, o);
}
async function post(p, data, opt) {
  return req(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data === undefined ? {} : data),
    ...(opt || {})
  });
}
async function j(r) {
  try {
    return await r.json();
  } catch (_) {
    return null;
  }
}

(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const rendererDir = path.join(__dirname, 'renderer');

  store = new Store(tmp);
  store.load();
  config = new ServerConfig(tmp);
  config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  auth = new Auth(tmp, config);
  const ai = auth.load();
  adminPw = ai.initialPassword;
  ck('首次启动生成随机管理员密码', !!adminPw && adminPw.length >= 10, adminPw ? adminPw.slice(0, 4) + '…' : null);
  ck('密码以 scrypt 加盐哈希存储', /^scrypt\$/.test(auth.users[0].password) && !auth.users[0].password.includes(adminPw));
  ck('公开用户视图不含密码', !('password' in auth.publicUser(auth.users[0])));

  const icons = new IconCache(tmp, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  svr = new NavioServer({ store, auth, config, icons, rendererDir, dataDir: tmp, log: () => {} });
  const started = await svr.start();
  ck('HTTP 服务启动', started.ok, started);

  /* --- 未登录：公共起始页允许游客浏览 --- */
  let r = await req('/');
  ck('未登录可直接进入通用起始页', r.status === 200 && !/login\.html/.test(r.headers.get('location') || ''), r.status);
  ck('首次访问下发匿名身份 Cookie', /navio_anon=anon_/.test(r.headers.get('set-cookie') || ''));
  r = await req('/api/state');
  const guestState = await j(r);
  ck('游客可读取通用模板', r.status === 200 && guestState.state && guestState.state.bookmarks.length > 0, r.status);
  ck('阶段11：公共书签归入唯一「常用」分组', guestState.state.groups.length === 1 &&
    guestState.state.groups[0].scope === 'public' &&
    guestState.state.groups[0].name === '常用' &&
    guestState.state.groups[0].id === 'g_common' &&
    !!guestState.state.groups[0].icon,
    guestState.state.groups);
  ck('游客身份标记为匿名', !!(guestState.identity && guestState.identity.kind === 'anon'), guestState.identity);
  r = await req('/login.html');
  ck('登录页无需鉴权', r.status === 200 && (await r.text()).includes('Navio Server'));
  r = await req('/login.js');
  ck('登录页 JS 无需鉴权', r.status === 200 && (r.headers.get('content-type') || '').includes('javascript'));
  r = await req('/app.js');
  ck('游客可下载首页脚本（页面需要运行）', r.status === 200 && (r.headers.get('content-type') || '').includes('javascript'));
  r = await req('/api/backups');
  ck('游客不能访问敏感接口', r.status === 401, r.status);

  /* --- 登录 --- */
  r = await post('/api/auth/login', { username: 'admin', password: 'wrong-password' });
  let d = await j(r);
  ck('错误密码被拒绝', r.status === 401 && d.code === 'bad_credentials');
  ck('错误密码不泄露账号是否存在', !/不存在/.test(d.error || ''));

  r = await post('/api/auth/login', { username: 'admin', password: adminPw });
  d = await j(r);
  ck('正确密码登录成功', r.status === 200 && d.ok && d.user.username === 'admin');
  const allCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const sc = allCookies.join(' ; ');
  ck('下发 HttpOnly + SameSite 会话 Cookie', /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc));
  // 登录响应同时带匿名 cookie 与会话 cookie，必须精确取 navio_sid
  const sidCookie = allCookies.find((x) => /^navio_sid=/.test(x)) || '';
  cookie = sidCookie.split(';')[0];
  ck('登录响应同时含会话与匿名 Cookie', /^navio_sid=/.test(cookie) && allCookies.some((x) => /navio_anon=/.test(x)), cookie);
  ck('提示初始密码需修改', d.user.mustChangePassword === true);

  r = await req('/api/auth/session');
  d = await j(r);
  ck('会话查询返回当前用户', d.authenticated && d.user.username === 'admin');
  r = await req('/app.js');
  ck('登录后可下载主界面 JS', r.status === 200 && (r.headers.get('content-type') || '').includes('javascript'));

  /* --- 数据读写 --- */
  r = await req('/api/state');
  d = await j(r);
  ck('读取 state 结构与旧 IPC 一致', d.state && d.state.version === 1 && Array.isArray(d.state.groups) && Array.isArray(d.state.bookmarks) && d.meta);
  ck('Web 端不暴露宿主机绝对路径', d.dataDir === null || d.dataDir === undefined);

  const state = JSON.parse(JSON.stringify(d.state));
  state.groups = [{ id: 'g_test', name: '测试分组', color: '', icon: '', order: 0, collapsed: false }];
  state.bookmarks = [
    { id: 'b_1', groupId: 'g_test', title: 'GitHub', url: 'https://github.com', icon: '', desc: '', order: 0, clickCount: 0 },
    { id: 'b_2', groupId: 'g_test', title: '哔哩哔哩', url: 'https://bilibili.com', icon: '', desc: '', order: 1, clickCount: 0 }
  ];
  r = await post('/api/state', state);
  ck('保存 state 成功', (await j(r)).ok === true);
  r = await req('/api/state');
  d = await j(r);
  ck('保存后读回书签一致', d.state.bookmarks.length === 2 && d.state.bookmarks[0].title === 'GitHub');

  /* --- 内置图标库 --- */
  r = await req('/api/preset-icons');
  d = await j(r);
  ck('内置图标库数量充足（>=120）', d.total >= 120, d.total);
  ck('图标库含 GitHub 与哔哩哔哩', d.items.some((x) => x.id === 'github') && d.items.some((x) => x.id === 'bilibili'));
  ck('图标库每项带可直接用的 data URI', d.items[0].svg.startsWith('data:image/svg+xml'));

  r = await req('/api/icon?host=github.com&title=GitHub');
  ck('GitHub 返回官网真实 favicon（离线图标包）',
    r.status === 200 && r.headers.get('x-navio-icon') === 'site' &&
    /^image\//.test(r.headers.get('content-type') || ''), r.status);
  const ghBytes = (await r.arrayBuffer()).byteLength;
  ck('真实图标含有效字节', ghBytes > 200, ghBytes);
  r = await req('/api/icon?host=bilibili.com');
  ck('中文站点也能命中真实图标（哔哩哔哩）', r.status === 200 && r.headers.get('x-navio-icon') === 'site', r.status);
  r = await req('/api/icon?host=x.example&title=' + encodeURIComponent('我的 Notion 笔记'));
  const svg = r.status === 200 ? await r.text() : '';
  ck('包外域名仍保留自绘 SVG 兜底', svg.includes('<svg') && r.headers.get('x-navio-icon') !== 'site');
  r = await req('/api/icon?host=zzq-nonexistent-9182.example');
  ck('完全无匹配时返回 404 让前端降级首字母', r.status === 404, r.status);
  ck('域名匹配函数可用', preset.match('https://www.youtube.com/watch', '')?.id === 'youtube');
  ck('关键词兜底可用', preset.match('https://x.example', '我的 Notion 笔记')?.id === 'notion');

  /* --- 书签 HTML 往返 --- */
  r = await post('/api/bookmarks/export-html', { groups: state.groups, bookmarks: state.bookmarks });
  d = await j(r);
  ck('导出浏览器书签 HTML', d.ok && d.count === 2 && d.html.includes('NETSCAPE-Bookmark-file-1'));
  r = await post('/api/bookmarks/import-html', { content: d.html });
  const imp = await j(r);
  ck('导出的 HTML 可再解析回来', imp.ok && imp.bookmarks.length === 2, imp.bookmarks && imp.bookmarks.length);

  /* --- 管理接口不暴露 --- */
  r = await req('/api/admin/config');
  ck('管理接口不在 HTTP 上暴露', r.status === 404 || r.status === 401, r.status);
  r = await req('/api/admin/users');
  ck('账号接口不在 HTTP 上暴露', r.status === 404 || r.status === 401, r.status);

  /* --- 多用户空间隔离 --- */
  const created = auth.createUser({ username: 'family', password: 'family-pass-123', name: '家人', role: 'user' });
  ck('可创建第二个账号', created.ok, created.ok ? created.user.username : created.error);
  const adminCookie = cookie;
  cookie = '';
  r = await post('/api/auth/login', { username: 'family', password: 'family-pass-123' });
  d = await j(r);
  ck('第二个账号可登录', r.status === 200 && d.ok);
  const famCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = (famCookies.find((x) => /^navio_sid=/.test(x)) || '').split(';')[0];
  r = await req('/api/state');
  d = await j(r);
  ck('新账号看到通用模板、但没有任何自己的私有内容',
     d.state.bookmarks.length > 0 &&
     !(d.state.bookmarks || []).some((b) => b.scope === 'mine') &&
     !(d.state.groups || []).some((g) => g.scope === 'mine'),
     { total: d.state.bookmarks.length, mine: (d.state.bookmarks || []).filter((b) => b.scope === 'mine').length });
  const famState = JSON.parse(JSON.stringify(d.state));
  famState.bookmarks = [{ id: 'f1', groupId: '', title: '家人专用', url: 'https://example.com', icon: '', desc: '', order: 0 }];
  famState.groups = [{ id: 'gf', name: '家人', color: '', icon: '', order: 0, collapsed: false }];
  famState.bookmarks[0].groupId = 'gf';
  await post('/api/state', famState);
  cookie = adminCookie;
  r = await req('/api/state');
  d = await j(r);
  ck('管理员空间未被其他账号污染', d.state.bookmarks.length === 2 && d.state.bookmarks.every((b) => b.title !== '家人专用'));
  await new Promise((done) => setTimeout(done, 800)); // 等 debounce 落盘
  ck('全部数据仍写在单个 data.json', fs.existsSync(path.join(tmp, 'data.json')) && !fs.existsSync(path.join(tmp, 'data-family.json')));
  const rawAll = JSON.parse(fs.readFileSync(path.join(tmp, 'data.json'), 'utf8'));
  ck('单文件内用 spaces 区分各身份', rawAll.spaces && Object.keys(rawAll.spaces).length >= 2, Object.keys(rawAll.spaces || {}));
  ck('Web 端写入只落 spaces、不碰顶层公共模板',
     (!rawAll.bookmarks || rawAll.bookmarks.length === 0), rawAll.bookmarks && rawAll.bookmarks.length);

  /* --- 登出 --- */
  r = await post('/api/auth/logout', {});
  ck('登出成功', r.status === 200);
  r = await req('/api/state');
  ck('登出后仍可浏览通用起始页', r.status === 200, r.status);
  r = await req('/api/backups');
  ck('登出后会话确实失效（敏感接口 401）', r.status === 401, r.status);
  cookie = '';

  /* --- 白名单 --- */
  config.save({ ipWhitelist: ['10.0.0.'] });
  r = await req('/api/auth/session');
  ck('IP 白名单生效（本机被拒）', r.status === 403, r.status);
  config.save({ ipWhitelist: [] });

  /* --- 登录失败锁定 --- */
  let locked = false;
  for (let i = 0; i < 6; i++) {
    const rr = await post('/api/auth/login', { username: 'admin', password: 'bad-' + i });
    if (rr.status === 401) {
      const dd = await j(rr);
      if (dd.code === 'locked') locked = true;
    }
  }
  ck('连续失败后触发登录锁定', locked);

  await svr.stop();
  ck('服务可正常停止', !svr.startedAt);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {}

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n结果: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(async (e) => {
  console.log('ERR', e && e.stack);
  try {
    if (svr) await svr.stop();
  } catch (_) {}
  process.exit(1);
});
