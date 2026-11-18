'use strict';
/**
 * 阶段 15 专项单测：未登录游客快照只存内存、永不写 data.json；登录用户照常落盘。
 * 纯 Node（Store + Spaces），不起 HTTP、不起 Electron。
 * 用法：node _test_volatile.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { Store } = require('./src/store');
const { Spaces, COMMON_GID } = require('./src/spaces');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const DATA = path.join('C:/AI使用/navio-tmp', 'volatile-test-' + Date.now());
fs.mkdirSync(DATA, { recursive: true });
const store = new Store(DATA);
store.load();
const spaces = new Spaces(store, path.join(ROOT, 'renderer'));
const dataFile = path.join(DATA, 'data.json');

const AID = 'anon_' + 'a'.repeat(32);   // 标准游客 id
const BID = 'anon_' + 'b'.repeat(32);   // 另一个游客
const UID = 'u_admin';                  // 登录身份

function rawSpaces() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')).spaces || {}; }
  catch (_) { return {}; }
}
function snapshotWithOneBookmark(title) {
  const v = spaces.template();
  v.bookmarks = [{
    id: 'bm_' + title, groupId: COMMON_GID, title, url: 'https://example.com/' + title,
    icon: '', desc: '', order: 0, createdAt: '', clickCount: 0
  }];
  v.groups = [{ id: COMMON_GID, name: '常用', order: -1000, collapsed: false }];
  return v;
}

(async () => {
  /* ---------- 身份判定 ---------- */
  ck('标准 anon id 判为游客', spaces.isVolatileId(AID));
  ck('登录uid不判为游客', !spaces.isVolatileId(UID));
  ck('测试短 id 不判为游客（保持旧测试行为）', !spaces.isVolatileId('anon_a'));
  ck('随机串不判为游客', !spaces.isVolatileId('garbage'));

  /* ---------- 游客 save 不落盘 ---------- */
  const before = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : '';
  const r1 = spaces.save(AID, snapshotWithOneBookmark('游客书A'));
  ck('游客 save 返回 volatile 标记', r1.volatile === true, r1);
  ck('游客 save 后 data.json 未被写入', !fs.existsSync(dataFile) || fs.readFileSync(dataFile, 'utf8') === before);
  ck('游客 save 后磁盘 spaces 无该身份', !rawSpaces()[AID]);
  ck('游客 save 后内存有快照', !!spaces.volatileSnapshot(AID));

  /* ---------- 游客 view 读回内存 ---------- */
  const va = spaces.view(AID);
  ck('游客 view 读到自己的书签', va.bookmarks.length === 1 && va.bookmarks[0].title === '游客书A', va.bookmarks.map((b) => b.title));
  ck('游客有快照标记（供恢复按钮）', spaces.hasSnapshotView(AID) === true);

  /* ---------- 游客之间隔离 ---------- */
  const vb = spaces.view(BID);
  ck('另一游客看不到前者书签（隔离）', vb.bookmarks.length === 51 && !vb.bookmarks.some((b) => b.title === '游客书A'));
  ck('另一游客无快照标记', spaces.hasSnapshotView(BID) === false);

  /* ---------- 游客 flush 不落盘 ---------- */
  const r2 = spaces.flush(AID, snapshotWithOneBookmark('游客书B'));
  ck('游客 flush 返回 volatile 标记', r2.volatile === true, r2);
  ck('游客 flush 后 data.json 仍未写入', !fs.existsSync(dataFile) || fs.readFileSync(dataFile, 'utf8') === before);
  ck('游客 flush 后内存更新', spaces.view(AID).bookmarks[0].title === '游客书B');

  /* ---------- 游客 reset 只清内存 ---------- */
  const r3 = spaces.reset(AID);
  ck('游客 reset 成功', r3.ok === true);
  ck('游客 reset 后内存无快照', spaces.volatileSnapshot(AID) === null);
  ck('游客 reset 后 view 回到 51 预设书签', spaces.view(AID).bookmarks.length === 51);
  ck('游客 reset 全过程未写盘', !fs.existsSync(dataFile) || fs.readFileSync(dataFile, 'utf8') === before);

  /* ---------- 登录用户照常落盘 ---------- */
  const sr = spaces.save(UID, snapshotWithOneBookmark('管理员书'));
  ck('登录用户 save 不返回 volatile', !sr.volatile, sr);
  await new Promise((r) => setTimeout(r, 700)); // store.save 延迟 500ms 落盘
  ck('登录用户 save 落盘到 spaces[uid]', !!rawSpaces()[UID], Object.keys(rawSpaces()));
  ck('登录用户 flush 落盘', (spaces.flush(UID, snapshotWithOneBookmark('管理员书3')), !!rawSpaces()[UID]));
  ck('登录用户 view 读到落盘数据', spaces.view(UID).bookmarks[0].title === '管理员书3');

  /* ---------- 顶层公共模板不被游客改动 ---------- */
  const top = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  ck('顶层 groups 为空（未被游客写入）', (top.groups || []).length === 0);
  ck('顶层 bookmarks 为空（未被游客写入）', (top.bookmarks || []).length === 0);

  /* ---------- 汇总 ---------- */
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nRESULT  total=${results.length}  pass=${results.length - fail}  fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
