'use strict';
/**
 * 阶段 12：单个书签图标背景色（系统预设色板） + 左侧分类栏弱化区分
 *
 * 第一部分：纯 Node 单元
 *   - 服务端 / 前端两份色板逐项一致
 *   - normalize 白名单、注入防护、旧数据向后兼容
 *   - spaces.template/project/annotate 逐层透传、migrate-catalog 继承、文件往返
 *   - 静态文件：分区标题移除、统一滚动容器、私有标签中性图标
 * 第二部分：真实 Chromium + 真实 HTTP 服务端到端
 *   - 默认无背景时视觉与阶段 7 完全一致
 *   - 右键 / 编辑弹窗色板点选即时生效、多书签独立、刷新持久化
 *   - 个人快照隔离、顶层公共模板不被写入、一键复位
 *   - 侧栏两类分类同处一个连续列表，不再有分区标题
 *
 * 用法：node _test_icon_bg.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.TEMP = 'C:/AI使用/navio-tmp';
process.env.TMP = 'C:/AI使用/navio-tmp';

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const { Store, normalize, defaultState, isCardBgColor, normalizeCardBgColor } = require('./src/store');
const presetColors = require('./src/preset-colors');
const { Spaces, isPublicGid } = require('./src/spaces');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');
const { migrateState } = require('./tools/migrate-catalog');

const ROOT = __dirname;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const DATA = 'C:/AI使用/navio-tmp/bg-e2e';
const UNIT_DATA = 'C:/AI使用/navio-tmp/bg-unit';
const PORT = 19900 + (process.pid % 80) + 200;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = [];
let fails = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ck = (n, ok, x) => {
  if (!ok) fails++;
  const line = (ok ? 'PASS' : 'FAIL') + '  ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '');
  OUT.push(line);
  console.log(line);
};
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    try { if (await fn()) return true; } catch (_) {}
    await wait(200);
  }
  return false;
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ================= 第一部分：单元 ================= */
function unitTests() {
  // --- 1. 色板单一真源一致性 ---
  const sandbox = { window: {} };
  vm.runInNewContext(read('renderer/presets.js'), sandbox, { timeout: 1000 });
  const front = (sandbox.window.NAVIO_PRESETS || {}).bgColors || [];
  const back = presetColors.list();
  ck('前端色板存在且不少于 10 项', front.length >= 10, front.length);
  ck('前后端色板逐项完全一致（key/name/hex）',
     front.length === back.length && front.every((c, i) =>
       c.key === back[i].key && c.name === back[i].name && c.hex === back[i].hex),
     { front: front.length, back: back.length });
  ck('色板首项为「无背景」且 hex 为空', front[0] && front[0].hex === '' && front[0].key === 'none', front[0]);
  const hexes = front.filter((c) => c.hex).map((c) => c.hex);
  ck('所有预设色都是 6 位小写 hex 且互不重复',
     hexes.length >= 9 && hexes.length === new Set(hexes).size &&
     hexes.every((h) => /^#[0-9a-f]{6}$/.test(h)), hexes);
  ck('服务端保留一个无背景项 + 至少 9 个可选色', back.length >= 10, back.length);

  // --- 2. normalize 白名单 / 注入防护 / 向后兼容 ---
  const bmk = (bgColor) => ({ id: 'b1', url: 'https://example.com', groupId: 'g1', bgColor });
  const kept = hexes.map((h) => normalize({ groups: [{ id: 'g1', name: 'G' }], bookmarks: [bmk(h)] }).bookmarks[0].bgColor);
  ck('normalize 保留全部合法预设色', kept.every((v, i) => v === hexes[i]), kept);
  const bad = [
    'red', 'url(javascript:alert(1))', '#fff;position:fixed', '#4F8CFF',
    '#4f8cff ', 'rgb(1,2,3)', 2, null, {}, true, undefined,
    'linear-gradient(90deg,red,blue)', '";background:red;--x:"'
  ];
  const leaked = bad.filter((v) => {
    const o = normalize({ groups: [{ id: 'g1', name: 'G' }], bookmarks: [bmk(v)] }).bookmarks[0];
    return Object.prototype.hasOwnProperty.call(o, 'bgColor');
  });
  ck('normalize 丢弃所有非法 / 注入型色值', leaked.length === 0, leaked);
  const legacy = normalize({ bookmarks: [{ id: 'b1', url: 'https://example.com' }] }).bookmarks[0];
  ck('旧数据 normalize 不含 bgColor 字段（逐字段向后兼容）',
     !Object.prototype.hasOwnProperty.call(legacy, 'bgColor'), Object.keys(legacy));
  ck('无背景（空串）不落字段',
     !Object.prototype.hasOwnProperty.call(normalize({ bookmarks: [bmk('')] }).bookmarks[0], 'bgColor'));
  ck('归一化函数兜底正确', normalizeCardBgColor('zzz') === '' && isCardBgColor(hexes[0]) && !isCardBgColor('#ffffff'));

  // --- 3. spaces 逐层透传 ---
  const pub = { ...defaultState(), bookmarks: [
    { id: 'bp1', url: 'https://github.com', title: 'GitHub', groupId: 'g_public', bgColor: hexes[0], order: 0 },
    { id: 'bp2', url: 'https://example.org', title: '示例', groupId: 'g_public', bgColor: hexes[1], order: 1 }
  ] };
  const sp = new Spaces({ state: pub }, path.join(ROOT, 'renderer'));
  const tpl = sp.template();
  ck('spaces.template 透传公共模板背景色',
     tpl.bookmarks[0].bgColor === hexes[0] && tpl.bookmarks[1].bgColor === hexes[1],
     tpl.bookmarks.map((b) => b.bgColor));
  const ids = sp.publicBookmarkIds();
  const proj = sp.project(tpl, ids);
  ck('spaces.project 透传背景色且分组无悬空',
     proj.bookmarks.find((b) => b.id === 'bp1').bgColor === hexes[0] &&
     proj.groups.some((g) => g.name === '常用') &&
     proj.bookmarks.every((b) => proj.groups.some((g) => g.id === b.groupId)));
  const view = sp.annotate(proj, ids);
  ck('spaces.annotate 透传背景色并标 scope',
     view.bookmarks.every((b) => b.scope === 'public' && hexes.includes(b.bgColor)),
     view.bookmarks.map((b) => b.bgColor + ':' + b.scope));

  // --- 4. 迁移工具按 URL 继承 ---
  const oldState = { ...defaultState(), bookmarks: [
    { id: 'old1', url: 'https://github.com', title: 'GitHub', groupId: 'g_public', bgColor: hexes[2], size: '2x1', order: 0 }
  ] };
  const newBooks = [
    { id: 'new1', url: 'https://github.com', title: 'GitHub', groupId: 'g_public', order: 0 }
  ];
  const catDefs = [{ id: 'g_common', name: '常用', order: 0, items: ['https://github.com'] }];
  const mig = migrateState(oldState, newBooks, catDefs, isPublicGid);
  const migBook = ((mig && mig.state && mig.state.bookmarks) || [])[0] || {};
  ck('migrate-catalog 按 URL 继承背景色与尺寸',
     migBook.bgColor === hexes[2] && migBook.size === '2x1', migBook);

  // --- 5. 文件往返 ---
  try { fs.rmSync(UNIT_DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(UNIT_DATA, { recursive: true });
  const st = new Store(UNIT_DATA); st.load();
  const state = { ...defaultState(), groups: [{ id: 'g1', name: 'G', order: 0 }], bookmarks: [
    { id: 'b1', url: 'https://a.com', groupId: 'g1', bgColor: hexes[0], order: 0 },
    { id: 'b2', url: 'https://b.com', groupId: 'g1', bgColor: hexes[1], order: 1 }
  ] };
  st.saveSync(state);
  const st2 = new Store(UNIT_DATA); st2.load();
  ck('Store 文件往返保留背景色',
     st2.state.bookmarks.map((b) => b.bgColor).join(',') === hexes.slice(0, 2).join(','),
     st2.state.bookmarks.map((b) => b.bgColor));
  const sp2 = new Spaces(st2, path.join(ROOT, 'renderer'));
  sp2.flush('anon_bg', { ...state, bookmarks: state.bookmarks.map((b) => ({ ...b, scope: 'public' })) });
  const st3 = new Store(UNIT_DATA); st3.load();
  const snap = st3.state.spaces && st3.state.spaces.anon_bg;
  ck('个人快照落盘含背景色且不带 scope',
     !!snap && snap.bookmarks[0].bgColor === hexes[0] && snap.bookmarks.every((b) => !Object.prototype.hasOwnProperty.call(b, 'scope')),
     snap && snap.bookmarks.map((b) => b.bgColor));
  ck('顶层公共模板未被 Web 写入',
     (st3.state.bookmarks || []).filter((b) => b.bgColor).length === 2 &&
     Object.prototype.hasOwnProperty.call(st3.state, 'spaces'));

  // --- 6. 侧栏弱化：静态检查 ---
  const html = read('renderer/index.html');
  const css = read('renderer/home.css');
  const home = read('renderer/home.js');
  ck('DOM 保留 #sideCatNav 与 #sideNav（事件委托 / 旧断言不破）',
     html.includes('id="sideCatNav"') && html.includes('id="sideNav"'));
  ck('移除「书签分类 / 我的标签」两个分区标题',
     !html.includes('书签分类') && !html.includes('我的标签') && !html.includes('side-cap-cat') && !html.includes('side-cap-mine'),
     html.match(/side-cap[^>]*>[^<]*/g));
  ck('移除「公共 · 人人可见 / 仅自己可见」说明文字',
     !html.includes('人人可见') && !html.includes('仅自己可见') && !html.includes('side-cap-hint'));
  ck('两个 nav 包进统一滚动容器 .side-scroll',
     html.includes('class="side-scroll"') && css.includes('.side-scroll') &&
     html.indexOf('side-scroll') < html.indexOf('id="sideCatNav"'));
  ck('css 中分区标题专用样式已清理',
     !css.includes('.side-cap-mine') && !css.includes('.side-cap-hint') && !css.includes('.side-cap-cat'));
  ck('home.js 私有标签统一中性图标、不再随机彩色',
     home.includes('ico-plain') && !home.includes('PALETTE') && home.includes('plainIcon'));
  ck('侧栏文案不再强调「我的 / 自己」',
     !home.includes('新建我的标签') && !home.includes('还没有自己的标签') && !html.includes('个我的标签'));

  // --- 7. 前端渲染链路存在 ---
  const app = read('renderer/app.js');
  const appcss = read('renderer/style.css');
  ck('前端读取 NAVIO_PRESETS.bgColors 并有白名单 normBg',
     app.includes('NAVIO_PRESETS.bgColors') && app.includes('BG_HEX_SET') && app.includes('normBg'));
  ck('卡片渲染输出 data-bg / has-bg / 背景色 CSS 变量',
     app.includes('data-bg=') && app.includes("'has-bg'") && app.includes('--ico-bg-soft') && appcss.includes('.card .ico.has-bg'));
  ck('三个入口齐全：编辑弹窗 / 右键快捷 / 设置抽屉复位',
     app.includes('bgPickerHTML(b.bgColor)') && app.includes('openBgDialog') &&
     app.includes('data-act="reset-bg"') && app.includes("act === 'reset-bg'"));
  ck('服务端提供只读色板接口', read('src/server.js').includes("'/api/preset-colors'"));
}

/* ================= 第二部分：端到端 ================= */
async function cardBg(page, id) {
  return page.evaluate((bid) => {
    const el = document.querySelector('#sections .card[data-id="' + bid + '"]');
    if (!el) return null;
    const ico = el.querySelector('.ico');
    const cs = ico ? getComputedStyle(ico) : null;
    const img = ico && ico.querySelector('img');
    return {
      bg: el.dataset.bg || '',
      cls: ico ? ico.className : '',
      icoBg: cs ? cs.backgroundColor : null,
      vars: ico ? {
        soft: ico.style.getPropertyValue('--ico-bg-soft'),
        raw: ico.style.getPropertyValue('--ico-bg')
      } : null,
      imgPad: img ? getComputedStyle(img).padding : null
    };
  }, id);
}

async function openBgModal(page, id) {
  await page.locator('#sections .card[data-id="' + id + '"]').click({ button: 'right' });
  await page.waitForSelector('#ctxMenu:not(.hidden) [data-k="bg"]', { timeout: 6000 });
  await page.click('#ctxMenu [data-k="bg"]');
  await page.waitForSelector('#modalRoot .bg-pick', { timeout: 6000 });
}
async function pickBg(page, hex) {
  await page.click('#modalRoot .bg-opt[data-bg="' + hex + '"]');
  await wait(180);
}
async function closeBgModal(page) {
  await page.click('#modalRoot [data-ok]');
  await page.waitForSelector('#modalRoot .bg-pick', { state: 'detached', timeout: 6000 }).catch(() => {});
}

async function e2e() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(DATA, { recursive: true });
  const store = new Store(DATA); store.load();
  const config = new ServerConfig(DATA); config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  const auth = new Auth(DATA, config); auth.load();
  const icons = new IconCache(DATA, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  const svr = new NavioServer({ store, auth, config, icons, rendererDir: path.join(ROOT, 'renderer'), dataDir: DATA, log: () => {} });
  ck('HTTP 服务启动', (await svr.start()).ok);

  // 只读色板接口
  const apiColors = await (await fetch(BASE + '/api/preset-colors')).json();
  ck('/api/preset-colors 返回完整色板',
     apiColors.ok === true && apiColors.total >= 10 && apiColors.items.length === apiColors.total &&
     apiColors.items[0].hex === '', { total: apiColors.total });

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    env: { ...process.env, TEMP: 'C:/AI使用/navio-tmp', TMP: 'C:/AI使用/navio-tmp', TMPDIR: 'C:/AI使用/navio-tmp' },
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu',
           '--disable-dev-shm-usage', '--disable-crash-reporter', '--no-crash-upload',
           '--disk-cache-dir=C:/AI使用/navio-tmp/pwcache-bg']
  });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const ready = await waitFor(async () => (await page.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  ck('首页书签渲染完成', ready, await page.locator('#sections .card:not(.add)').count());

  /* --- 1. 默认态：与阶段 7 视觉完全一致 --- */
  const base = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#sections .card:not(.add)')];
    const icos = cards.map((c) => c.querySelector('.ico')).filter(Boolean);
    const colored = icos.filter((n) => {
      const cs = getComputedStyle(n);
      const tr = cs.backgroundColor === 'transparent' || /rgba\([^)]*,\s*0\)/.test(cs.backgroundColor);
      return cs.backgroundImage !== 'none' || !tr || cs.boxShadow !== 'none';
    });
    const imgs = [...document.querySelectorAll('#sections .card:not(.add) .ico img')];
    const specs = [...new Set(imgs.map((i) => getComputedStyle(i).padding + '|' + getComputedStyle(i).objectFit))];
    return {
      total: cards.length,
      noBg: cards.every((c) => (c.dataset.bg || '') === ''),
      noHasBg: icos.every((n) => !n.classList.contains('has-bg')),
      colored: colored.length, specs,
      icoSizes: [...new Set(icos.map((n) => Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height)))]
    };
  });
  ck('全部书签默认无背景（零视觉变化）', base.total >= 51 && base.noBg && base.noHasBg && base.colored === 0, base);
  ck('默认图标 48x48、图片 padding/object-fit 不变',
     base.icoSizes.length === 1 && base.icoSizes[0] === '48x48' && base.specs.length === 1 && base.specs[0] === '0px|contain',
     { icoSizes: base.icoSizes, specs: base.specs });

  /* --- 2. 侧栏弱化：一个连续列表 --- */
  const side = await page.evaluate(() => {
    const scroll = document.querySelector('.side-scroll');
    const catNav = document.querySelector('#sideCatNav');
    const mineNav = document.querySelector('#sideNav');
    const caps = [...document.querySelectorAll('#sidebar .side-cap')].map((x) => x.textContent.trim());
    return {
      hasScroll: !!scroll,
      bothInside: !!scroll && !!catNav && !!mineNav && scroll.contains(catNav) && scroll.contains(mineNav),
      caps,
      hints: document.querySelectorAll('#sidebar .side-cap-hint').length,
      catItems: catNav ? catNav.querySelectorAll('.side-item').length : 0,
      catImg: catNav ? catNav.querySelectorAll('.side-ico img').length : 0,
      plainIco: mineNav ? mineNav.querySelectorAll('.side-ico.ico-plain').length : 0,
      scrollCount: document.querySelectorAll('.side-scroll').length
    };
  });
  ck('两个分类列表同处唯一滚动容器', side.hasScroll && side.bothInside && side.scrollCount === 1, side);
  ck('不再有分区标题与「公共/仅自己可见」提示',
     side.caps.filter((c) => /书签分类|我的标签|人人可见|仅自己可见/.test(c)).length === 0 && side.hints === 0, side.caps);
  ck('公共分类仍显示「常用」与系统预设图标', side.catItems === 1 && side.catImg >= 1, side);

  const ids = await page.evaluate(() => [...document.querySelectorAll('#sections .card:not(.add)')].slice(0, 5).map((c) => c.dataset.id));
  ck('取得测试卡片', ids.length >= 4, ids);

  /* --- 3. 右键色板 --- */
  await openBgModal(page, ids[0]);
  const picker = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#modalRoot .bg-opt')].map((x) => x.dataset.bg),
    active: (document.querySelector('#modalRoot .bg-opt.on') || {}).dataset?.bg,
    names: [...document.querySelectorAll('#modalRoot .bg-txt')].map((x) => x.textContent)
  }));
  ck('色板含无背景 + 至少 9 个预设色，默认选中无背景',
     picker.opts.length >= 10 && picker.opts[0] === '' && picker.active === '' &&
     picker.opts.slice(1).every((h) => /^#[0-9a-f]{6}$/.test(h)) &&
     new Set(picker.opts).size === picker.opts.length, picker.opts);
  ck('色板每项都有中文名称', picker.names.length === picker.opts.length && picker.names.every((n) => n && n.length >= 2), picker.names);
  // 弹窗动画 .16s/.2s，等 650ms 再截图，避免拍到全透明首帧
  await wait(650);
  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-icon-bg-picker.png', fullPage: false });

  const c1 = picker.opts[1], c2 = picker.opts[2];
  await pickBg(page, c1);
  const got1 = await cardBg(page, ids[0]);
  ck('点选预设色即时生效（data-bg / has-bg / 背景色变量 / computed 底色）',
     got1 && got1.bg === c1 && got1.cls.includes('has-bg') &&
     got1.vars.raw === c1 && got1.icoBg !== 'transparent' && got1.icoBg !== 'rgba(0, 0, 0, 0)', got1);
  await pickBg(page, '');
  const gotNone = await cardBg(page, ids[0]);
  ck('选「无背景」恢复纯透明',
     gotNone && gotNone.bg === '' && !gotNone.cls.includes('has-bg') &&
     /transparent|rgba\(0, 0, 0, 0\)/.test(gotNone.icoBg || ''), gotNone);
  await pickBg(page, c1);
  await closeBgModal(page);

  /* --- 4. 多书签各自独立 + 编辑弹窗回显 --- */
  await openBgModal(page, ids[1]);
  await pickBg(page, c2);
  await closeBgModal(page);
  const multi = await page.evaluate((args) => {
    const out = {};
    args.ids.forEach((id) => {
      const el = document.querySelector('#sections .card[data-id="' + id + '"]');
      out[id] = el ? (el.dataset.bg || '') : null;
    });
    return out;
  }, { ids: [ids[0], ids[1], ids[2]] });
  ck('多个书签可各自设置不同背景色',
     multi[ids[0]] === c1 && multi[ids[1]] === c2 && multi[ids[2]] === '', multi);

  await page.locator('#sections .card[data-id="' + ids[0] + '"]').click({ button: 'right' });
  await page.waitForSelector('#ctxMenu:not(.hidden) [data-k="edit"]', { timeout: 6000 });
  await page.click('#ctxMenu [data-k="edit"]');
  await page.waitForSelector('#modalRoot .bg-pick', { timeout: 6000 });
  const editActive = await page.evaluate(() => (document.querySelector('#modalRoot .bg-opt.on') || {}).dataset?.bg);
  ck('编辑弹窗色板回显当前背景色', editActive === c1, editActive);
  await page.click('#modalRoot .bg-opt[data-bg=""]');
  await page.click('#modalRoot [data-ok]');
  await wait(250);
  ck('编辑弹窗可清除背景色', (await cardBg(page, ids[0])).bg === '');
  // 恢复用于后续持久化断言
  await openBgModal(page, ids[0]); await pickBg(page, c1); await closeBgModal(page);

  /* --- 5. 持久化 / 隔离 / 顶层公共模板 --- */
  const saved = await waitFor(async () => page.evaluate(async () => {
    const j = await (await fetch('/api/state')).json();
    return (j.state.bookmarks || []).some((b) => b.bgColor);
  }), 8000).catch(() => false);
  ck('背景色已保存到服务端个人快照', saved);
  // 服务端 store.save 有 500ms 防抖：内存先更新、磁盘稍后落。条件等待磁盘而非立即读。
  const diskReady = await waitFor(() => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'));
      return Object.keys(d.spaces || {}).flatMap((k) =>
        (d.spaces[k].bookmarks || []).filter((b) => b.bgColor)).length >= 2;
    } catch (_) { return false; }
  }, 8000);
  const disk = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'));
  const snapBg = Object.keys(disk.spaces || {}).flatMap((k) =>
    (disk.spaces[k].bookmarks || []).filter((b) => b.bgColor).map((b) => b.bgColor));
  ck('data.json 个人快照落盘含背景色', diskReady && snapBg.length >= 2, snapBg);
  ck('顶层公共模板未被写入背景色', (disk.bookmarks || []).filter((b) => b.bgColor).length === 0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  const afterReload = await page.evaluate((args) => {
    const out = {};
    args.ids.forEach((id) => {
      const el = document.querySelector('#sections .card[data-id="' + id + '"]');
      out[id] = el ? (el.dataset.bg || '') : null;
    });
    return out;
  }, { ids: [ids[0], ids[1], ids[2]] });
  ck('刷新后各书签背景色保持',
     afterReload[ids[0]] === c1 && afterReload[ids[1]] === c2 && afterReload[ids[2]] === '', afterReload);

  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page2.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  const other = await page2.evaluate(async () => {
    let stateBg = [];
    try {
      const j = await (await fetch('/api/state')).json();
      stateBg = (j.state.bookmarks || []).filter((b) => b.bgColor).map((b) => b.bgColor);
    } catch (_) {}
    return {
      domBg: [...document.querySelectorAll('#sections .card:not(.add)')].filter((c) => (c.dataset.bg || '') !== '').length,
      stateBg
    };
  });
  ck('另一访客不受影响（个人快照隔离）',
     other.domBg === 0 && other.stateBg.length === 0, other);
  await ctx2.close();

  /* --- 6. 一键复位 --- */
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#drawerBody [data-act="reset-bg"]', { timeout: 6000 });
  await page.click('#drawerBody [data-act="reset-bg"]');
  await wait(300);
  const reset = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#sections .card:not(.add)')];
    return {
      custom: cards.filter((c) => (c.dataset.bg || '') !== '').length,
      hasBg: document.querySelectorAll('#sections .ico.has-bg').length
    };
  });
  ck('设置抽屉一键恢复无背景', reset.custom === 0 && reset.hasBg === 0, reset);

  /* --- 7. 侧栏截图（先关掉设置抽屉遮罩，避免遮挡） --- */
  await page.evaluate(() => {
    const m = document.querySelector('#drawerMask');
    if (m && !m.classList.contains('hidden')) m.click();
    window.scrollTo(0, 0);
  });
  await wait(400);
  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-sidebar-unified.png', fullPage: false });

  ck('无 JS 运行时错误', errs.length === 0, errs.slice(0, 3));
  try { await Promise.race([browser.close(), wait(4000)]); } catch (_) {}
}

(async () => {
  try {
    unitTests();
    await e2e();
  } catch (e) {
    ck('执行过程无异常', false, String(e && e.stack || e).slice(0, 500));
  }
  OUT.push('');
  OUT.push('ICON_BG_FAILS=' + fails);
  fs.writeFileSync('C:/AI使用/navio-tmp/icon-bg-test.txt', OUT.join('\n'), 'utf8');
  setTimeout(() => process.exit(fails ? 1 : 0), 200);
})();
