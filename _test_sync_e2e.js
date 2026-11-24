'use strict';
/**
 * 阶段 21 E2E：多视图同步的 HTTP 层验证（纯 Node，不起 Electron）。
 * 起独立 NavioServer 实例，覆盖两种真实场景：
 *  场景A（同浏览器多标签）：两标签共享同一 anon cookie 身份
 *  场景B（跨设备同账号）：两个独立 cookie jar 分别登录 admin，共享 user id
 * 每条都验证：A 保存改动 → rev 递增 → B 轮询 /api/state/rev 感知 → 拉全量看到新数据。
 * 用法：node _test_sync_e2e.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Store } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const tmp = path.join(os.tmpdir(), 'navio-sync-e2e-' + Date.now());
const PORT = 19500 + (process.pid % 300);
const base = `http://127.0.0.1:${PORT}`;

function cookieOf(jar) { return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); }
function absorbSetCookie(jar, r) {
  const raw = r.headers.get('set-cookie');
  if (!raw) return;
  String(raw).split(/,(?=\s*navio_)/).forEach((part) => {
    const m = part.match(/^\s*(navio_[a-z]+)=([^;]*)/);
    if (m) jar[m[1]] = m[2];
  });
}
async function req(p, jar, opt) {
  const o = { redirect: 'manual', ...(opt || {}) };
  o.headers = { ...(o.headers || {}) };
  const c = cookieOf(jar);
  if (c) o.headers.Cookie = c;
  const r = await fetch(base + p, o);
  absorbSetCookie(jar, r);
  return r;
}
async function j(r) { try { return await r.json(); } catch (_) { return null; } }
async function post(p, jar, data) {
  return req(p, jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
}

/** 在 jar 身份下保存一个带探针书签的 state，返回新 rev */
async function saveProbe(jar, tag) {
  const s = await j(await req('/api/state', jar));
  const st = JSON.parse(JSON.stringify(s.state));
  delete st.spaces;
  const id = 'bm_probe_' + tag;
  st.bookmarks = (st.bookmarks || []).concat([{
    id, groupId: 'g_common', title: 'PROBE_' + tag, url: 'https://probe.example/' + tag,
    icon: '', desc: '', order: 9999, createdAt: '', clickCount: 0
  }]);
  const saved = await j(await post('/api/state', jar, st));
  return { saved, id };
}

(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const rendererDir = path.join(__dirname, 'renderer');
  const store = new Store(tmp); store.load();
  const config = new ServerConfig(tmp); config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  const auth = new Auth(tmp, config);
  const adminPw = auth.load().initialPassword;
  const icons = new IconCache(tmp, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  const svr = new NavioServer({ store, auth, config, icons, rendererDir, dataDir: tmp, log: () => {} });
  const started = await svr.start();
  ck('独立服务启动', started.ok, started);

  /* ===== 场景A：同浏览器两个标签（共享 anon cookie）===== */
  const jarA = {}, jarB = {};
  await req('/', jarA);
  Object.assign(jarB, jarA); // 同一浏览器 => 复制 cookie
  ck('场景A：两标签同一匿名身份', jarA.navio_anon === jarB.navio_anon);
  const revA0 = (await j(await req('/api/state/rev', jarA))).rev;
  const sA = await j(await req('/api/state', jarA));
  ck('场景A：/api/state 的 rev 与 /state/rev 一致', sA.rev === revA0, { state: sA.rev, rev: revA0 });
  const aProbe = await saveProbe(jarA, 'samebrowser');
  ck('场景A：A 保存后 rev 递增', aProbe.saved.rev > revA0, { before: revA0, after: aProbe.saved.rev });
  const revB1 = (await j(await req('/api/state/rev', jarB))).rev;
  ck('场景A：B 轮询到新 rev', revB1 === aProbe.saved.rev, { b: revB1, expected: aProbe.saved.rev });
  const sB1 = await j(await req('/api/state', jarB));
  ck('场景A：B 拉全量看到 A 的新书签', (sB1.state.bookmarks || []).some((b) => b.id === aProbe.id), { rev: sB1.rev });

  /* ===== 场景B：跨设备登录同一 admin（共享 user id）===== */
  const dev1 = {}, dev2 = {};
  await req('/login.html', dev1);
  await req('/login.html', dev2);
  const lr1 = await j(await post('/api/auth/login', dev1, { username: 'admin', password: adminPw }));
  const lr2 = await j(await post('/api/auth/login', dev2, { username: 'admin', password: adminPw }));
  ck('场景B：两台设备均登录 admin', !!(lr1 && lr1.ok) && !!(lr2 && lr2.ok), { r1: !!(lr1 && lr1.ok), r2: !!(lr2 && lr2.ok) });
  const st1 = await j(await req('/api/state', dev1));
  const st2 = await j(await req('/api/state', dev2));
  ck('场景B：两设备同一 user 身份', st1.identity.id === st2.identity.id && st1.identity.kind === 'user', { id: st1.identity.id });
  const rev0 = st1.rev;
  const bProbe = await saveProbe(dev1, 'crossdevice');
  ck('场景B：设备1 保存后 rev 递增', bProbe.saved.rev > rev0, { before: rev0, after: bProbe.saved.rev });
  const rev2 = (await j(await req('/api/state/rev', dev2))).rev;
  ck('场景B：设备2 轮询到新 rev', rev2 === bProbe.saved.rev, { dev2: rev2, expected: bProbe.saved.rev });
  const st2b = await j(await req('/api/state', dev2));
  ck('场景B：设备2 拉全量看到设备1 的新书签', (st2b.state.bookmarks || []).some((b) => b.id === bProbe.id), { rev: st2b.rev });

  /* ===== 隔离：不同身份 rev 独立 ===== */
  const outsider = {};
  await req('/', outsider);
  ck('隔离：另一游客身份 rev 独立', (await j(await req('/api/state/rev', outsider))).rev === 0);

  await svr.stop();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n结果: ${pass}/${results.length} 通过, ${fail} 失败`);
  console.log('RESULT ' + JSON.stringify({ total: results.length, pass, fail }));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('E2E 异常:', e && e.stack || e);
  console.log('RESULT ' + JSON.stringify({ total: results.length, pass: results.filter((r) => r.ok).length, fail: 1 }));
  process.exit(1);
});
