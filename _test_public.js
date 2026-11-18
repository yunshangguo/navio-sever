'use strict';
/**
 * 公共起始页 / 个人快照隔离专项测试（纯 Node，无需 Electron / 浏览器）
 *
 * 语义：
 *  - 顶层 groups/bookmarks = 通用只读模板，所有身份（含未登录游客）都能看到
 *  - 每个身份（登录账号 id / 匿名 cookie id）持有独立可编辑快照
 *  - 一个人删改通用书签或新建标签，别的身份完全看不到，公共模板本身不变
 *  - 游客不能碰备份/恢复/导入/宿主机探测，导出也只能拿到自己的视图
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Store, defaultState } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
const ROOT = __dirname;
const DATA = 'C:/AI使用/navio-tmp/public-test';
const PORT = 19800 + (process.pid % 150);
const BASE = { host: '127.0.0.1', port: PORT };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ck(name, ok, extra) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
}

function req(pathname, opt) {
  const o = opt || {};
  return new Promise((resolve) => {
    const headers = {};
    if (o.cookie) headers.Cookie = o.cookie;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const r = http.request({ ...BASE, path: pathname, method: o.method || 'GET', headers, timeout: 6000 }, (x) => {
      let b = '';
      x.on('data', (c) => { b += c; });
      x.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (_) {}
        resolve({ status: x.statusCode, headers: x.headers, body: b, json: j, loc: x.headers.location || '' });
      });
    });
    r.on('error', (e) => resolve({ err: e.code, status: 0 }));
    r.on('timeout', () => { r.destroy(); resolve({ err: 'timeout', status: 0 }); });
    if (o.body !== undefined) r.write(JSON.stringify(o.body));
    r.end();
  });
}
function cookieOf(r, name) {
  const list = r.headers && r.headers['set-cookie'] || [];
  for (const c of list) {
    const m = String(c).match(new RegExp('(?:^|;\\s*)?' + name + '=([^;]+)'));
    if (m) return name + '=' + m[1];
  }
  return '';
}
function firstAnon(r) {
  const list = r.headers && r.headers['set-cookie'] || [];
  for (const c of list) if (/navio_anon=/.test(c)) return c.split(';')[0];
  return '';
}
async function state(cookie) {
  const r = await req('/api/state', { cookie });
  return { r, st: r.json && r.json.state, meta: r.json };
}
function ids(st) { return (st.bookmarks || []).map((b) => b.id); }
function mineIds(st) { return (st.bookmarks || []).filter((b) => b.scope === 'mine').map((b) => b.id); }

(async () => {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(DATA, { recursive: true });

  const store = new Store(DATA); store.load();
  const config = new ServerConfig(DATA); config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  const auth = new Auth(DATA, config);
  const ai = auth.load();
  const icons = new IconCache(DATA, () => ({ fetch: (...a) => globalThis.fetch(...a) }));

  // 构造「通用」公共模板：2 个分组 / 3 个书签
  const top = defaultState();
  top.seeded = true;
  top.groups = [
    { id: 'g_a', name: '常用', color: '', icon: '', order: 0, collapsed: false },
    { id: 'g_b', name: '开发', color: '', icon: '', order: 1, collapsed: false }
  ];
  top.bookmarks = [
    { id: 'b1', groupId: 'g_a', title: '站点一', url: 'https://one.example.com', icon: '', desc: '', order: 0, clickCount: 0 },
    { id: 'b2', groupId: 'g_a', title: '站点二', url: 'https://two.example.com', icon: '', desc: '', order: 1, clickCount: 0 },
    { id: 'b3', groupId: 'g_b', title: '站点三', url: 'https://three.example.com', icon: '', desc: '', order: 2, clickCount: 0 }
  ];
  store.saveSync(top);

  const svr = new NavioServer({ store, auth, config, icons, rendererDir: path.join(ROOT, 'renderer'), dataDir: DATA, log: () => {} });
  ck('HTTP 服务启动', (await svr.start()).ok);

  /* ---------- 1. 游客放行 ---------- */
  const home = await req('/');
  ck('未登录可直接进入首页（不再 302）', home.status === 200 && /Navio/.test(home.body), home.status);
  const anonA = firstAnon(home);
  ck('首次访问下发匿名 HttpOnly cookie', /^navio_anon=anon_[a-f0-9]{32}$/.test(anonA) && /HttpOnly/.test(String((home.headers['set-cookie'] || []).join(';'))), anonA);
  ck('登录页仍可访问', (await req('/login.html')).status === 200);
  ck('控制台资源仍不暴露', (await req('/console.html', { cookie: anonA })).status === 404);

  const a0 = await state(anonA);
  ck('游客可读通用模板', a0.r.status === 200 && ids(a0.st).length === 3, a0.r.status);
  ck('阶段11：所有公共书签归入唯一「常用」分组', a0.st.groups.length === 1 &&
    a0.st.groups[0].scope === 'public' && a0.st.groups[0].name === '常用' &&
    a0.st.groups[0].id === 'g_common', a0.st.groups);
  ck('公共项 scope=public', (a0.st.bookmarks || []).every((b) => b.scope === 'public'));
  ck('身份为匿名且可编辑', a0.meta.identity.kind === 'anon' && a0.meta.publicMode.canEdit === true, a0.meta.identity);
  ck('未登录接口白名单外一律 401', (await req('/api/backups', { cookie: anonA })).status === 401);
  ck('未登录不能导出全库', (await req('/api/export', { method: 'POST', cookie: anonA, body: {} })).status === 401);
  ck('未登录不能恢复备份', (await req('/api/restore', { method: 'POST', cookie: anonA, body: { name: 'x' } })).status === 401);
  ck('未登录不能探测宿主机书签', (await req('/api/bookmarks/detect', { cookie: anonA })).status === 401);

  /* ---------- 2. 游客 A 修改只影响自己 ---------- */
  const viewA = JSON.parse(JSON.stringify(a0.st));
  viewA.bookmarks = viewA.bookmarks.filter((b) => b.id !== 'b1');
  viewA.bookmarks.find((b) => b.id === 'b2').title = '我改过的站点二';
  viewA.groups.push({ id: 'mine_g', name: '我的标签', color: '', icon: '', order: 10, collapsed: false });
  viewA.bookmarks.push({ id: 'mine_b', groupId: 'mine_g', title: '我的书签', url: 'https://mine.example.com', icon: '', desc: '', order: 99, clickCount: 0 });
  ck('游客可保存自己的视图', (await req('/api/state', { method: 'POST', cookie: anonA, body: viewA })).status === 200);

  const a1 = await state(anonA);
  ck('游客 A 看到自己的改动', ids(a1.st).length === 3 && ids(a1.st).includes('mine_b') && !ids(a1.st).includes('b1'), ids(a1.st));
  ck('游客 A 的私有项标记 scope=mine', mineIds(a1.st).join(',') === 'mine_b', mineIds(a1.st));
  ck('游客 A 的私有分组标记 scope=mine', (a1.st.groups.find((g) => g.id === 'mine_g') || {}).scope === 'mine');
  ck('公共模板未被改动（顶层仍 3 条）', store.state.bookmarks.length === 3, store.state.bookmarks.length);
  ck('公共模板标题仍是原值', store.state.bookmarks.find((b) => b.id === 'b2').title === '站点二');
  ck('顶层公共模板分组未被 Web 端改写', store.state.groups.length === 2);

  /* ---------- 3. 游客 B 完全看不到 A 的改动 ---------- */
  const bHome = await req('/');
  const anonB = firstAnon(bHome);
  ck('游客 B 拿到不同匿名 id', anonB && anonB !== anonA, { a: anonA, b: anonB });
  const b0 = await state(anonB);
  ck('游客 B 仍看到原始 3 个通用书签', ids(b0.st).join(',') === 'b1,b2,b3', ids(b0.st));
  ck('游客 B 看不到 A 的私有书签', !ids(b0.st).includes('mine_b'));
  ck('游客 B 看不到 A 的私有分组', !(b0.st.groups || []).some((g) => g.id === 'mine_g'));
  ck('游客 B 看到的标题是原始值', (b0.st.bookmarks.find((x) => x.id === 'b2') || {}).title === '站点二');

  // B 也做一次删除，A 不应受影响
  const viewB = JSON.parse(JSON.stringify(b0.st));
  viewB.bookmarks = viewB.bookmarks.filter((x) => x.id !== 'b3');
  await req('/api/state', { method: 'POST', cookie: anonB, body: viewB });
  const b1 = await state(anonB);
  const a2 = await state(anonA);
  ck('游客 B 的删除生效', ids(b1.st).join(',') === 'b1,b2', ids(b1.st));
  ck('游客 B 的删除不影响游客 A', ids(a2.st).includes('mine_b') && !ids(a2.st).includes('b1'), ids(a2.st));

  /* ---------- 4. 登录账号之间隔离 ---------- */
  ck('创建第二个账号', auth.createUser({ username: 'bob', password: 'bobpass123', role: 'user' }).ok);
  const liA = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ai.initialPassword } });
  const sidA = cookieOf(liA, 'navio_sid');
  ck('管理员登录成功', liA.status === 200 && !!sidA, liA.status);
  ck('登录响应同时下发会话与匿名 cookie', (liA.headers['set-cookie'] || []).length >= 2,
     (liA.headers['set-cookie'] || []).map((c) => c.split('=')[0]));
  const adm0 = await state(sidA);
  ck('登录后身份为账号', adm0.meta.identity.kind === 'user' && adm0.meta.identity.admin === true, adm0.meta.identity);
  ck('登录账号初始看到通用模板', ids(adm0.st).join(',') === 'b1,b2,b3', ids(adm0.st));

  const viewAdm = JSON.parse(JSON.stringify(adm0.st));
  viewAdm.groups.push({ id: 'adm_g', name: '管理员私有', color: '', icon: '', order: 20, collapsed: false });
  viewAdm.bookmarks.push({ id: 'adm_b', groupId: 'adm_g', title: '管理员书签', url: 'https://adm.example.com', icon: '', desc: '', order: 100, clickCount: 0 });
  await req('/api/state', { method: 'POST', cookie: sidA, body: viewAdm });

  // 游客 B 编辑过，用 B 的匿名 cookie 登录新账号 → 快照应被带到该账号，不丢失
  ck('创建第三个账号用于继承验证', auth.createUser({ username: 'carol', password: 'carolpass123', role: 'user' }).ok);
  const liC = await req('/api/auth/login', { method: 'POST', cookie: anonB, body: { username: 'carol', password: 'carolpass123' } });
  const sidC = cookieOf(liC, 'navio_sid');
  const carol0 = await state(sidC);
  ck('游客编辑后登录会把自己的视图带到账号', carol0.r.status === 200 && ids(carol0.st).join(',') === 'b1,b2', ids(carol0.st));

  const liB = await req('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'bobpass123' } });
  const sidB = cookieOf(liB, 'navio_sid');
  ck('第二个账号登录成功', liB.status === 200 && !!sidB, liB.status);
  const bob0 = await state(sidB);
  ck('其他账号看不到管理员私有书签', !ids(bob0.st).includes('adm_b'), ids(bob0.st));
  ck('其他账号看不到管理员私有标签', !(bob0.st.groups || []).some((g) => g.id === 'adm_g'));
  ck('其他账号看到的仍是通用模板', ids(bob0.st).join(',') === 'b1,b2,b3', ids(bob0.st));
  const adm1 = await state(sidA);
  ck('管理员仍能看到自己的私有标签', ids(adm1.st).includes('adm_b'));

  const exp = await req('/api/export', { method: 'POST', cookie: sidB, body: {} });
  ck('导出只含自己的视图、不含 spaces', exp.status === 200 && exp.json && exp.json.data && !exp.json.data.spaces,
     exp.json && Object.keys(exp.json.data || {}).slice(0, 8));
  ck('非管理员不能恢复全库备份', (await req('/api/restore', { method: 'POST', cookie: sidB, body: { name: 'x' } })).status === 403);

  /* ---------- 5. 重置 / 模式开关 ---------- */
  ck('游客可重置回通用模板', (await req('/api/state/reset', { method: 'POST', cookie: anonA, body: {} })).status === 200);
  const a3 = await state(anonA);
  ck('重置后回到 3 个通用书签', ids(a3.st).join(',') === 'b1,b2,b3' && !(a3.st.groups || []).some((g) => g.id === 'mine_g'), ids(a3.st));

  config.save({ publicMode: { enabled: false } });
  const offHome = await req('/');
  const offState = await req('/api/state', { cookie: anonA });
  ck('关闭公共模式后首页恢复 302', offHome.status === 302 && /login\.html/.test(offHome.loc), offHome.status);
  ck('关闭公共模式后 API 恢复 401', offState.status === 401, offState.status);
  config.save({ publicMode: { enabled: true } });
  ck('重新开启公共模式后恢复 200', (await req('/')).status === 200);

  const spaceKeys = Object.keys(store.state.spaces || {});
  // 阶段15：游客快照只存内存、永不落盘；磁盘只保留真正保存过的登录账号。
  // bob 登录后只读未保存，不生成空间——这是「没改过不产生垃圾空间」的正确行为。
  ck('磁盘快照彼此独立（key 唯一）', new Set(spaceKeys).size === spaceKeys.length, spaceKeys);
  ck('磁盘不含任何游客 anon 快照（游客不落盘）', !spaceKeys.some((k) => /^anon_/.test(k)), spaceKeys);
  ck('登录管理员快照已落盘', spaceKeys.includes('u_admin'), spaceKeys);
  ck('游客编辑后登录迁移的账号快照已落盘', spaceKeys.some((k) => k !== 'u_admin' && /^u_/.test(k)), spaceKeys);

  await svr.stop();
  console.log('\n结果: ' + pass + '/' + (pass + fail) + ' PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FATAL ' + (e && e.stack || e));
  process.exit(1);
});
