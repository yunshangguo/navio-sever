'use strict';
/**
 * 真实站点图标包专项测试
 * 覆盖：资源包完整性 / host 匹配 / 数据迁移纯函数 / 源码不再写死自绘图标 /
 *       服务端在「关闭在线抓取」时仍优先返回真实 favicon（离线可用）。
 * 用法：node _test_site_icons.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');

const { Store } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');
const { SiteIcons } = require('./src/site-icons');
const { Spaces } = require('./src/spaces');
const { migrateIcons } = require('./tools/migrate-icons');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'renderer', 'site-icons');
const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

/* ---------------- A. 资源包完整性 ---------------- */
const mapPath = path.join(DIR, 'map.json');
ck('site-icons/map.json 存在', fs.existsSync(mapPath));
const map = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};
const hosts = Object.keys(map);
ck('图标包覆盖 >= 94 个站点', hosts.length >= 94, hosts.length);
ck('report.json 记录零失败', (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8')).miss === 0; }
  catch (_) { return false; }
})());

function presetHosts() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'renderer', 'presets.js'), 'utf8'), sandbox, { timeout: 1000 });
  const out = [];
  for (const g of (((sandbox.window || {}).NAVIO_PRESETS || {}).groups || [])) {
    for (const it of (g.items || [])) {
      try { out.push(new URL(String(it[1])).host); } catch (_) {}
    }
  }
  return out;
}
const pHosts = [...new Set(presetHosts())];
ck('推荐目录 51 个站点全部收录', pHosts.length === 51 && pHosts.every((h) => !!map[h]), pHosts.length);

const TYPES = ['image/png', 'image/x-icon', 'image/svg+xml', 'image/jpeg', 'image/webp', 'image/gif'];
let missing = 0, badHead = 0, badType = 0, totalBytes = 0;
const shas = {};
for (const h of hosts) {
  const v = map[h];
  const p = path.join(DIR, path.basename(v.file || ''));
  if (!v.file || !fs.existsSync(p)) { missing++; continue; }
  const b = fs.readFileSync(p);
  totalBytes += b.length;
  (shas[crypto.createHash('sha1').update(b).digest('hex')] =
    shas[crypto.createHash('sha1').update(b).digest('hex')] || []).push(h);
  if (!TYPES.includes(v.type)) badType++;
  let ok = false;
  if (v.type === 'image/png') ok = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  else if (v.type === 'image/x-icon') ok = b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2);
  else if (v.type === 'image/svg+xml') ok = /<svg|<\?xml/i.test(b.slice(0, 400).toString('utf8'));
  else if (v.type === 'image/jpeg') ok = b[0] === 0xff && b[1] === 0xd8;
  else if (v.type === 'image/webp') ok = b.slice(0, 4).toString() === 'RIFF';
  else if (v.type === 'image/gif') ok = b.slice(0, 3).toString() === 'GIF';
  if (!ok) badHead++;
}
ck('所有图标文件都存在', missing === 0, missing);
ck('所有图标文件头与声明类型一致', badHead === 0, badHead);
ck('所有类型都是浏览器可显示格式', badType === 0, badType);
ck('图标包体积合理（< 2 MB）', totalBytes > 0 && totalBytes < 2 * 1024 * 1024, totalBytes);
const maxDup = Math.max(0, ...Object.values(shas).map((a) => a.length));
ck('无大规模重复图标（未被统一占位图污染）', maxDup <= 3, maxDup);
const svgPlaceholders = hosts.filter((h) => {
  if (map[h].type !== 'image/svg+xml') return false;
  const s = fs.readFileSync(path.join(DIR, path.basename(map[h].file)), 'utf8');
  return /<text\b/i.test(s) || !/<path\b|<rect\b|<circle\b/i.test(s);
});
ck('SVG 图标都是真实图形而非文字占位', svgPlaceholders.length === 0, svgPlaceholders.slice(0, 5));
const hiRes = hosts.filter((h) => ['image/png', 'image/svg+xml', 'image/webp'].includes(map[h].type)).length;
ck('过半图标为高清 PNG/SVG/WEBP', hiRes >= 47, hiRes);

/* ---------------- B. host 匹配 ---------------- */
const si = new SiteIcons(path.join(ROOT, 'renderer'));
ck('SiteIcons.count 与 map 一致', si.count() === hosts.length, si.count());
ck('精确 host 命中（github.com）', !!si.find('github.com'));
ck('服务端去 www 后仍能命中（baidu.com）', !!si.find('baidu.com'), (si.find('baidu.com') || {}).key);
ck('带 www 也能命中（www.zhihu.com）', !!si.find('www.zhihu.com'));
ck('子域独立命中（pan.baidu.com）', !!si.find('pan.baidu.com'));
ck('cleanHost 后 51 站点全部可命中', pHosts.every((h) => {
  const clean = h.toLowerCase().replace(/^www\./, '');
  return !!si.find(clean);
}));
ck('未知域名不误命中', si.find('zzq-nonexistent-9182.example') === null);
ck('keys 生成 www 双向变体', JSON.stringify(SiteIcons.keys('baidu.com')) === JSON.stringify(['baidu.com', 'www.baidu.com']));
ck('keys 能剥离协议与端口', JSON.stringify(SiteIcons.keys('https://github.com:443/x')) === JSON.stringify(['github.com', 'www.github.com']));
ck('find 返回正确 MIME', /^image\//.test((si.find('github.com') || {}).type || ''), (si.find('github.com') || {}).type);

/* ---------------- B2. 归一化统一规格（阶段 7） ---------------- */
function pngDim(b) {
  if (!b || b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}
const STD = path.join(DIR, 'std');
const stdFiles = fs.existsSync(STD) ? fs.readdirSync(STD).filter((f) => f.endsWith('.png')) : [];
ck('归一化目录 std/ 含 94 枚 PNG', stdFiles.length >= 94, stdFiles.length);
let stdMiss = 0, stdBad = 0, stdBadHead = 0;
const stdDims = {};
for (const h of hosts) {
  const stem = path.basename(String(map[h].file)).replace(/\.[^.]+$/, '');
  const p = path.join(STD, stem + '.png');
  if (!fs.existsSync(p)) { stdMiss++; continue; }
  const b = fs.readFileSync(p);
  const dim = pngDim(b);
  if (!dim) { stdBadHead++; continue; }
  stdDims[dim] = (stdDims[dim] || 0) + 1;
  if (dim !== '128x128') stdBad++;
}
ck('归一化图标覆盖图标包全部 94 个 host', stdMiss === 0, stdMiss);
ck('归一化图标文件头全部为合法 PNG', stdBadHead === 0, stdBadHead);
ck('94 枚归一化图标全部为 128x128 统一尺寸', stdBad === 0 && Object.keys(stdDims).length === 1 &&
  Object.keys(stdDims)[0] === '128x128', stdDims);
const normReport = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(STD, 'normalize-report.json'), 'utf8')); }
  catch (_) { return null; }
})();
ck('归一化报告标记 v1-128-f84 且零失败',
  !!(normReport && normReport.tag === 'v1-128-f84' && normReport.fail === 0 && normReport.ok >= 94),
  normReport && { tag: normReport.tag, ok: normReport.ok, fail: normReport.fail });
ck('站点原始尺寸确有差异（证明归一化有必要）', !!(normReport && normReport.sourceKinds >= 10),
  normReport && normReport.sourceKinds);
ck('SiteIcons.find 优先返回归一化图标', (() => {
  const f = si.find('github.com');
  return !!(f && f.normalized === true && f.type === 'image/png' && /std[\\/]/.test(f.file));
})(), si.find('github.com'));
ck('归一化文件仍是透明 PNG（保留品牌形状、无实色底）', (() => {
  const f = si.find('github.com');
  return !!(f && fs.readFileSync(f.file).length < 60000);
})());

/* ---------------- C. 数据迁移纯函数 ---------------- */
const fixture = {
  version: 2,
  settings: { theme: 'light', wallpaper: 'dawn' },
  bookmarks: [
    { id: 'a', title: 'GitHub', url: 'https://github.com', groupId: 'g_common', order: 1, clickCount: 7,
      icon: '/api/preset-icon?url=' + encodeURIComponent('https://github.com') + '&title=GitHub' },
    { id: 'b', title: '我的站点', url: 'https://example.com', icon: 'https://cdn.example.com/mine.png' },
    { id: 'c', title: '百度', url: 'https://www.baidu.com', icon: '' },
    { id: 'd', title: '已升级', url: 'https://gitee.com', icon: '/api/icon?host=gitee.com&title=Gitee' }
  ],
  spaces: {
    'u_1': {
      groups: [{ id: 'mine', name: '我的' }],
      bookmarks: [
        { id: 's1', title: '知乎', url: 'https://www.zhihu.com',
          icon: '/api/preset-icon?url=' + encodeURIComponent('https://www.zhihu.com') + '&title=' + encodeURIComponent('知乎') },
        { id: 's2', title: '自定义', url: 'https://x.example', icon: 'data:image/png;base64,AAAA' }
      ],
      widgets: [{ id: 'w1', data: { x: 1 } }]
    },
    'u_2': { bookmarks: [] }
  },
  notes: [{ id: 'n1', text: '保持' }]
};
const snapshot = JSON.stringify(fixture);
const m1 = migrateIcons(fixture);
ck('迁移不修改入参（纯函数）', JSON.stringify(fixture) === snapshot);
ck('顶层替换数量正确', m1.stats.top === 1, m1.stats.top);
ck('个人快照替换数量正确', m1.stats.spaces === 1, m1.stats.spaces);
ck('自定义图标统计保留', m1.stats.keptCustom === 2, m1.stats.keptCustom);
ck('顶层自绘图标换成真实 favicon URL', /^\/api\/icon\?host=github\.com/.test(m1.state.bookmarks[0].icon));
ck('生成的 host 与书签 url 一致', new URL(m1.state.bookmarks[0].icon, 'http://x').searchParams.get('host') === 'github.com');
ck('title 一并保留供兜底匹配', new URL(m1.state.bookmarks[0].icon, 'http://x').searchParams.get('title') === 'GitHub');
ck('自定义外链图标原样保留', m1.state.bookmarks[1].icon === 'https://cdn.example.com/mine.png');
ck('空图标保持为空（交给前端兜底）', m1.state.bookmarks[2].icon === '');
ck('已是真实图标的不重复改写', m1.state.bookmarks[3].icon === '/api/icon?host=gitee.com&title=Gitee');
ck('快照里的自绘图标也升级', /^\/api\/icon\?host=www\.zhihu\.com/.test(m1.state.spaces.u_1.bookmarks[0].icon));
ck('快照里的 data URI 原样保留', m1.state.spaces.u_1.bookmarks[1].icon === 'data:image/png;base64,AAAA');
ck('快照其它数据完整保留', JSON.stringify(m1.state.spaces.u_1.widgets) === JSON.stringify(fixture.spaces.u_1.widgets));
ck('settings / notes / version 未改动',
  JSON.stringify(m1.state.settings) === JSON.stringify(fixture.settings) &&
  JSON.stringify(m1.state.notes) === JSON.stringify(fixture.notes) &&
  m1.state.version === 2);
ck('书签其它字段逐字段未改动', ['id', 'title', 'url', 'groupId', 'order', 'clickCount']
  .every((k) => m1.state.bookmarks[0][k] === fixture.bookmarks[0][k]));
const m2 = migrateIcons(m1.state);
ck('迁移幂等（二次执行零改动）', m2.stats.top === 0 && m2.stats.spaces === 0 && JSON.stringify(m2.state) === JSON.stringify(m1.state));
ck('空对象不报错', migrateIcons({}).state.bookmarks === undefined);
ck('无 spaces 字段不报错', migrateIcons({ bookmarks: [] }).state.spaces === undefined);

/* ---------------- D. 源码不再写死自绘图标 ---------------- */
const srcSpaces = fs.readFileSync(path.join(ROOT, 'src', 'spaces.js'), 'utf8');
const srcApp = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
const srcHome = fs.readFileSync(path.join(ROOT, 'renderer', 'home.js'), 'utf8');
ck('spaces.js 不再给书签写死 preset-icon', !srcSpaces.includes("'/api/preset-icon?url='"));
ck('app.js 不再给书签写死 preset-icon', !srcApp.includes('"/api/preset-icon?url="'));
ck('home.js 快捷站点不再写死 preset-icon', !srcHome.includes("'/api/preset-icon?url='"));
ck('app.js 保留旧数据运行时兜底', srcApp.includes("cur.indexOf('/api/preset-icon') === 0"));
const pb = new Spaces({}, path.join(ROOT, 'renderer')).presetBookmarks();
ck('presetBookmarks 生成 51 条', pb.length === 51, pb.length);
ck('presetBookmarks 全部指向真实 favicon', pb.every((b) => /^\/api\/icon\?host=/.test(b.icon)),
  pb.filter((b) => !/^\/api\/icon\?host=/.test(b.icon)).slice(0, 3));

/* ---------------- E. 服务端离线优先真实图标 ---------------- */
const tmp = path.join(os.tmpdir(), 'navio-siteicons-' + Date.now());
const PORT = 19600 + (process.pid % 300);
const base = `http://127.0.0.1:${PORT}`;
let svr;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const store = new Store(tmp); store.load();
  const config = new ServerConfig(tmp); config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true,
    icons: { fetchEnabled: false, presetFallback: true } }); // 关键：彻底关闭在线抓取
  const auth = new Auth(tmp, config); auth.load();
  const icons = new IconCache(tmp, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  svr = new NavioServer({ store, auth, config, icons, rendererDir: path.join(ROOT, 'renderer'),
    dataDir: tmp, log: () => {} });
  const started = await svr.start();
  ck('测试 HTTP 服务启动', started.ok, started);

  let r = await fetch(base + '/api/icon?host=github.com&title=GitHub');
  const ct = r.headers.get('content-type') || '';
  ck('离线状态下 GitHub 仍返回 200', r.status === 200, r.status);
  ck('命中内置真实图标包（X-Navio-Icon: site）', r.headers.get('x-navio-icon') === 'site');
  ck('返回的是图片而非自绘 SVG 文字图标', /^image\//.test(ct), ct);
  ck('响应含真实字节', (await r.arrayBuffer()).byteLength > 200);

  r = await fetch(base + '/api/icon?host=baidu.com');
  ck('cleanHost 去 www 后线上也能命中', r.status === 200 && r.headers.get('x-navio-icon') === 'site', r.status);
  r = await fetch(base + '/api/icon?host=www.bilibili.com');
  ck('中文站点线上命中真实图标', r.status === 200 && (r.headers.get('content-type') || '').includes('image/png'),
    r.headers.get('content-type'));

  // 第 4 级：不在图标包里、但内置自绘库能匹配的域名，仍可用自绘 SVG 兜底
  r = await fetch(base + '/api/icon?host=x.example&title=' + encodeURIComponent('我的 Notion 笔记'));
  const svg = r.status === 200 ? await r.text() : '';
  ck('包外域名仍走自绘 SVG 兜底', r.status === 200 && svg.includes('<svg'), r.status);
  ck('自绘兜底未被误标为真实图标', r.headers.get('x-navio-icon') !== 'site');
  r = await fetch(base + '/api/icon?host=zzq-nonexistent-9182.example');
  ck('完全无匹配仍返回 404 让前端降级', r.status === 404, r.status);

  try { await Promise.race([Promise.resolve(svr.stop()), wait(2000)]); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n==== ${pass}/${results.length} ${pass === results.length ? 'PASS' : 'FAIL'} ====`);
  if (pass !== results.length) {
    console.log('FAILED:\n' + results.filter((x) => !x.ok).map((x) => '  - ' + x.name).join('\n'));
  }
  setTimeout(() => process.exit(pass === results.length ? 0 : 1), 100);
})().catch((e) => {
  console.error('FATAL', e);
  setTimeout(() => process.exit(1), 100);
});
