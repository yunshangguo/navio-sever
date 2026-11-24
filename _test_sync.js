'use strict';
/**
 * 阶段 21 专项单测：多标签页 / 多设备数据同步。
 *  - 服务端：每个身份的 rev 在 save/flush/reset 时递增；不同身份互不影响；
 *    /api/state GET 与 /api/state/rev 返回当前身份 rev（源码断言 + Spaces 实例实测）。
 *  - 前端：app.js 轮询/广播比对 rev、门控不覆盖未保存改动、reload 保留状态。
 *  - navio-http.js 暴露 stateRev 与 BroadcastChannel 广播。
 * 用法：node _test_sync.js [rootDir]
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const app = read(path.join('renderer', 'app.js'));
const http = read(path.join('renderer', 'navio-http.js'));
const server = read(path.join('src', 'server.js'));
const spacesSrc = read(path.join('src', 'spaces.js'));

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

console.log('root = ' + ROOT);

/* ---------- 1. 服务端 rev 源码断言 ---------- */
ck('Spaces 有 revs 版本号表', /this\.revs\s*=\s*new Map\(\)/.test(spacesSrc));
ck('Spaces 有 rev(id) 读取', /rev\(identityId\)\s*\{/.test(spacesSrc));
ck('Spaces 有 bumpRev(id) 递增', /bumpRev\(identityId\)\s*\{/.test(spacesSrc));
const bumpCount = (spacesSrc.match(/this\.bumpRev\(identityId\)/g) || []).length;
ck('save/flush/reset 三处都递增 rev（>=3）', bumpCount >= 3, { bumpCount });
ck('save/flush/reset 返回 rev 字段', (spacesSrc.match(/rev:\s*this\.rev\(identityId\)/g) || []).length >= 3);
ck('/api/state GET 返回 rev', /state:\s*this\.spaces\.view\(who\.id\)[\s\S]{0,120}rev:\s*this\.spaces\.rev\(who\.id\)/.test(server));
ck('/api/state/rev 轻量端点存在', /pathname === '\/api\/state\/rev'/.test(server) && /rev:\s*this\.spaces\.rev\(who\.id\)/.test(server));
ck('/api/state/rev 在游客白名单', /PUBLIC_API[\s\S]{0,400}'\/api\/state\/rev'/.test(server));

/* ---------- 2. 前端同步源码断言 ---------- */
ck('navio-http.js 暴露 stateRev()', /stateRev:\s*\(\)\s*=>\s*call\('\/state\/rev'\)/.test(http));
ck('navio-http.js 有 BroadcastChannel 通道', /new BroadcastChannel\(/.test(http));
ck('navio-http.js 暴露 navioSync.broadcast', /window\.navioSync\s*=\s*\{/.test(http) && /broadcast:/.test(http));
ck('app.js 有 currentRev 基准', /currentRev\s*=\s*0/.test(app));
ck('app.js 有轮询定时器与间隔', /setInterval\(\(\)\s*=>\s*checkSync\(\),\s*SYNC_POLL_MS\)/.test(app));
ck('app.js 有 checkSync 比对函数', /async function checkSync\(/.test(app));
ck('checkSync 用 rev>currentRev 判定变化', /rev\s*>\s*currentRev/.test(app));
ck('门控：无未保存改动才同步', /if\s*\(pendingSave[\s\S]{0,80}return false/.test(app));
ck('门控：页面隐藏不同步', /document\.hidden[\s\S]{0,60}return false/.test(app));
ck('门控：弹窗/抽屉打开不同步', /UI\.drawer[\s\S]{0,40}return false/.test(app) && /modalRoot[\s\S]{0,120}children\.length[\s\S]{0,40}return false/.test(app));
ck('门控：输入框聚焦不同步', /ae\.tagName === 'INPUT'[\s\S]{0,120}return false/.test(app));
ck('保存/flush 后广播', /noteSaved\(r\)/.test(app) && (app.match(/noteSaved\(r\)/g) || []).length >= 2);
ck('保存响应 rev 更新本地基准', /if\s*\(r && typeof r\.rev === 'number'\)\s*currentRev\s*=\s*r\.rev/.test(app));
ck('reload 记录服务端 rev', /async function reload\(\)[\s\S]{0,240}r\.rev[\s\S]{0,40}currentRev/.test(app));
ck('boot 初始化 rev 并启动同步', /currentRev = r\.rev[\s\S]{0,400}startAutoSync\(\)/.test(app));
ck('同步刷新保留滚动位置', /keepScroll[\s\S]{0,200}scrollTop\s*=\s*keepScroll/.test(app));
ck('广播回调接线 __navioOnPeerChange', /__navioOnPeerChange\s*=\s*\(hintRev\)/.test(app));
ck('可见时立即比对 visibilitychange', /visibilitychange[\s\S]{0,80}checkSync\(\)/.test(app));

/* ---------- 3. 真实 Spaces 实例：rev 递增与隔离 ---------- */
try {
  const Store = require(path.join(ROOT, 'src', 'store')).Store;
  const { Spaces, COMMON_GID } = require(path.join(ROOT, 'src', 'spaces'));
  const DATA = path.join('C:/AI使用/navio-tmp', 'sync-test-' + Date.now());
  fs.mkdirSync(DATA, { recursive: true });
  const store = new Store(DATA);
  store.load();
  const sp = new Spaces(store, path.join(ROOT, 'renderer'));
  const AID = 'u_alice';
  const BID = 'u_bob';
  const VID = 'anon_' + 'c'.repeat(32);

  ck('初始 rev 为 0', sp.rev(AID) === 0, { rev: sp.rev(AID) });
  const snap = () => {
    const v = sp.template();
    v.bookmarks = [{ id: 'bm_x', groupId: COMMON_GID, title: 'X', url: 'https://x.com/', icon: '', desc: '', order: 0, createdAt: '', clickCount: 0 }];
    return v;
  };
  const r1 = sp.save(AID, snap());
  ck('save 后 rev=1 且响应带 rev', sp.rev(AID) === 1 && r1.rev === 1, { rev: sp.rev(AID), r1 });
  ck('save 其它身份不影响 Alice', sp.rev(BID) === 0, { bob: sp.rev(BID) });
  sp.flush(AID, snap());
  ck('flush 后 rev=2', sp.rev(AID) === 2, { rev: sp.rev(AID) });
  sp.save(VID, snap());
  ck('游客 volatile save 也递增 rev', sp.rev(VID) === 1, { rev: sp.rev(VID) });
  sp.reset(AID);
  ck('reset 后 rev=3', sp.rev(AID) === 3, { rev: sp.rev(AID) });
  const before = sp.rev(AID);
  sp.bumpRev(AID);
  ck('bumpRev 独立递增', sp.rev(AID) === before + 1);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
} catch (e) {
  ck('Spaces 实例测试可执行', false, { error: e.message });
}

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n结果: ${pass}/${results.length} 通过, ${fail} 失败`);
console.log('RESULT ' + JSON.stringify({ total: results.length, pass, fail }));
process.exit(fail ? 1 : 0);
