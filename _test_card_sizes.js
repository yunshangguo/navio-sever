'use strict';
/**
 * 阶段 8：单个书签独立占格（1x1 / 2x1 / 1x2 / 2x2）
 *
 * 第一部分：纯 Node 单元（normalize 白名单、旧数据兼容、spaces 透传、文件往返）
 * 第二部分：真实 Chromium + 真实 HTTP 服务端到端
 *   - 默认 1x1 视觉与阶段 7 完全一致（图标 48x48、透明、padding/object-fit 不变）
 *   - 右键「图标尺寸…」四种占格的 computed / rect 生效
 *   - 编辑弹窗内选择器、刷新持久化、个人快照隔离、设置抽屉一键复位
 *
 * 用法：node _test_card_sizes.js
 */
const fs = require('fs');
const path = require('path');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.TEMP = 'C:/AI使用/navio-tmp';
process.env.TMP = 'C:/AI使用/navio-tmp';

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const { Store, normalize, defaultState, CARD_SIZES, isCardSize, normalizeCardSize } = require('./src/store');
const { Spaces } = require('./src/spaces');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');

const ROOT = __dirname;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const DATA = 'C:/AI使用/navio-tmp/size-e2e';
const UNIT_DATA = 'C:/AI使用/navio-tmp/size-unit';
const PORT = 19900 + (process.pid % 80);
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

/* ================= 第一部分：单元 ================= */
function unitTests() {
  ck('尺寸清单恰好 4 种', CARD_SIZES.length === 4 && CARD_SIZES.join(',') === '1x1,2x1,1x2,2x2', CARD_SIZES);
  const bmk = (size) => ({ id: 'b1', url: 'https://example.com', groupId: 'g1', size });
  const kept = CARD_SIZES.map((s) => normalize({ groups: [{ id: 'g1', name: 'G' }], bookmarks: [bmk(s)] }).bookmarks[0].size);
  ck('normalize 保留全部合法占格', kept.join(',') === CARD_SIZES.join(','), kept);
  const bad = ['9x9', '2X2', 2, null, {}, '1x1 ', undefined, true];
  const leaked = bad.filter((v) => {
    const o = normalize({ bookmarks: [bmk(v)] }).bookmarks[0];
    return Object.prototype.hasOwnProperty.call(o, 'size');
  });
  ck('normalize 丢弃所有非法占格', leaked.length === 0, leaked);
  const legacy = normalize({ bookmarks: [{ id: 'b1', url: 'https://example.com' }] }).bookmarks[0];
  ck('旧数据 normalize 结果不含 size 字段（向后兼容）', !Object.prototype.hasOwnProperty.call(legacy, 'size'), Object.keys(legacy));
  ck('非法值兜底为 1x1', normalizeCardSize('zzz') === '1x1' && isCardSize('2x2') && !isCardSize('9x9'));

  // spaces：公共模板 → 投影 → scope 标注，逐层都不能丢字段
  // 阶段 10 后目录以用户保留的 58 站点为准，夹具必须选目录里真实存在的 host，
  // 否则会被 project() 归到「更多」。GitHub 属于「常用」，example.org 统一归入「常用」。
  const pub = { ...defaultState(), bookmarks: [
    { id: 'bp1', url: 'https://github.com', title: 'GitHub', groupId: 'g_public', size: '2x2', order: 0 },
    { id: 'bp2', url: 'https://example.org', title: '示例', groupId: 'g_public', size: '1x2', order: 1 }
  ] };
  const fakeStore = { state: pub };
  const sp = new Spaces(fakeStore, path.join(ROOT, 'renderer'));
  const tpl = sp.template();
  ck('spaces.template 透传公共模板尺寸', tpl.bookmarks[0].size === '2x2' && tpl.bookmarks[1].size === '1x2', tpl.bookmarks.map((b) => b.size));
  const ids = sp.publicBookmarkIds();
  const proj = sp.project(tpl, ids);
  // 不写死分组数量（分类数会随目录增减）：只校验尺寸没丢、分类命中「常用」、
  // 且每个书签的 groupId 都指向一个真实存在的分组（无悬空引用）。
  ck('spaces.project 透传尺寸并重分组',
     proj.bookmarks.find((b) => b.id === 'bp1').size === '2x2' &&
     proj.groups.some((g) => g.name === '常用') &&
     proj.bookmarks.every((b) => proj.groups.some((g) => g.id === b.groupId)),
     proj.groups.map((g) => g.name));
  const view = sp.annotate(proj, ids);
  ck('spaces.annotate 透传尺寸并标 scope', view.bookmarks.every((b) => b.scope === 'public' && ['2x2', '1x2'].includes(b.size)), view.bookmarks.map((b) => b.size + ':' + b.scope));

  // 文件往返：Store / Spaces.flush 都能把 size 写进磁盘再读回
  try { fs.rmSync(UNIT_DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(UNIT_DATA, { recursive: true });
  const st = new Store(UNIT_DATA); st.load();
  const state = { ...defaultState(), groups: [{ id: 'g1', name: 'G', order: 0 }], bookmarks: [
    { id: 'b1', url: 'https://a.com', groupId: 'g1', size: '2x2', order: 0 },
    { id: 'b2', url: 'https://b.com', groupId: 'g1', size: '1x2', order: 1 }
  ] };
  st.saveSync(state);
  const st2 = new Store(UNIT_DATA); st2.load();
  ck('Store 文件往返保留尺寸', st2.state.bookmarks.map((b) => b.size).join(',') === '2x2,1x2', st2.state.bookmarks.map((b) => b.size));
  const sp2 = new Spaces(st2, path.join(ROOT, 'renderer'));
  sp2.flush('anon_test', { ...state, bookmarks: state.bookmarks.map((b) => ({ ...b, scope: 'public' })) });
  const st3 = new Store(UNIT_DATA); st3.load();
  const snap = st3.state.spaces && st3.state.spaces.anon_test;
  ck('个人快照保存后尺寸仍在且不带 scope', !!snap && snap.bookmarks.map((b) => b.size).join(',') === '2x2,1x2' &&
     snap.bookmarks.every((b) => !Object.prototype.hasOwnProperty.call(b, 'scope')), snap && snap.bookmarks.map((b) => b.size));
  const v3 = new Spaces(st3, path.join(ROOT, 'renderer')).view('anon_test');
  ck('重新读取视图仍能看到尺寸', v3.bookmarks.filter((b) => b.size && b.size !== '1x1').length === 2, v3.bookmarks.map((b) => b.size));
}

/* ================= 第二部分：端到端 ================= */
async function cardInfo(page, id) {
  return page.evaluate((bid) => {
    const el = document.querySelector('#sections .card[data-id="' + bid + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const ico = el.querySelector('.ico');
    const ir = ico ? ico.getBoundingClientRect() : null;
    const img = ico && ico.querySelector('img');
    const cs = getComputedStyle(el);
    return {
      size: el.dataset.size,
      cls: el.className,
      w: Math.round(r.width), h: Math.round(r.height),
      col: cs.gridColumnStart, row: cs.gridRowStart,
      ico: ir ? Math.round(ir.width) + 'x' + Math.round(ir.height) : null,
      imgFit: img ? getComputedStyle(img).objectFit : null,
      imgPad: img ? getComputedStyle(img).padding : null,
      icoBg: ico ? getComputedStyle(ico).backgroundColor : null
    };
  }, id);
}

async function openSizeModal(page, id) {
  await page.locator('#sections .card[data-id="' + id + '"]').click({ button: 'right' });
  await page.waitForSelector('#ctxMenu:not(.hidden) [data-k="size"]', { timeout: 6000 });
  await page.click('#ctxMenu [data-k="size"]');
  await page.waitForSelector('#modalRoot .size-pick', { timeout: 6000 });
}
async function pickSize(page, v) {
  await page.click('#modalRoot [data-size="' + v + '"]');
  await wait(180);
}
async function closeSizeModal(page) {
  await page.click('#modalRoot [data-ok]');
  await page.waitForSelector('#modalRoot .size-pick', { state: 'detached', timeout: 6000 }).catch(() => {});
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

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    env: { ...process.env, TEMP: 'C:/AI使用/navio-tmp', TMP: 'C:/AI使用/navio-tmp', TMPDIR: 'C:/AI使用/navio-tmp' },
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu',
           '--disable-dev-shm-usage', '--disable-crash-reporter', '--no-crash-upload',
           '--disk-cache-dir=C:/AI使用/navio-tmp/pwcache-size']
  });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const ready = await waitFor(async () => (await page.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  ck('首页书签渲染完成', ready, await page.locator('#sections .card:not(.add)').count());

  /* --- 1. 默认态必须与阶段 7 完全一致 --- */
  const base = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('#sections .grid')];
    const cards = [...document.querySelectorAll('#sections .card:not(.add)')];
    const icos = cards.map((c) => c.querySelector('.ico')).filter(Boolean);
    const sizes = [...new Set(icos.map((n) => Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height)))];
    const imgs = [...document.querySelectorAll('#sections .card:not(.add) .ico img')];
    const specs = [...new Set(imgs.map((i) => {
      const cs = getComputedStyle(i);
      return cs.padding + '|' + cs.objectFit;
    }))];
    const colored = icos.filter((n) => {
      const cs = getComputedStyle(n);
      const tr = cs.backgroundColor === 'transparent' || /rgba\([^)]*,\s*0\)/.test(cs.backgroundColor);
      return cs.backgroundImage !== 'none' || !tr || cs.boxShadow !== 'none';
    });
    return {
      grids: grids.length,
      gridMode: grids[0] ? getComputedStyle(grids[0]).display : '',
      flow: grids[0] ? getComputedStyle(grids[0]).gridAutoFlow : '',
      all1x1: cards.every((c) => c.dataset.size === '1x1'),
      cardW: Math.round(cards[0].getBoundingClientRect().width),
      cardH: Math.round(cards[0].getBoundingClientRect().height),
      icoSizes: sizes, specs, colored: colored.length
    };
  });
  ck('书签区为 CSS Grid + dense 排布', base.grids >= 1 && base.gridMode === 'grid' && (base.flow === 'dense' || base.flow === 'row dense'), base);
  ck('全部书签默认 1x1', base.all1x1 && base.cardW === 104 && base.cardH === 100, { w: base.cardW, h: base.cardH });
  ck('默认图标仍是 48x48 且无彩色色块', base.icoSizes.length === 1 && base.icoSizes[0] === '48x48' && base.colored === 0, base.icoSizes);
  ck('默认图片 padding / object-fit 不变', base.specs.length === 1 && base.specs[0] === '0px|contain', base.specs);

  const ids = await page.evaluate(() => [...document.querySelectorAll('#sections .card:not(.add)')].slice(0, 6).map((c) => c.dataset.id));
  ck('取得测试卡片', ids.length >= 4, ids);

  /* --- 2. 右键菜单四种占格 --- */
  await openSizeModal(page, ids[0]);
  const picker = await page.evaluate(() => ({
    opts: [...document.querySelectorAll('#modalRoot .size-opt')].map((x) => x.dataset.size),
    active: (document.querySelector('#modalRoot .size-opt.on') || {}).dataset?.size
  }));
  ck('尺寸选择器含 4 种占格且默认选中 1x1', picker.opts.join(',') === '1x1,2x1,1x2,2x2' && picker.active === '1x1', picker);

  const expect = {
    '2x2': { w: 216, h: 208, ico: '104x104', col: 'span 2', row: 'span 2' },
    '1x2': { w: 104, h: 208, ico: '76x76', col: 'span 1', row: 'span 2' },
    '2x1': { w: 216, h: 100, ico: '68x68', col: 'span 2', row: 'span 1' },
    '1x1': { w: 104, h: 100, ico: '48x48', col: 'span 1', row: 'span 1' }
  };
  for (const v of ['2x2', '1x2', '2x1', '1x1']) {
    await pickSize(page, v);
    const got = await cardInfo(page, ids[0]);
    const e = expect[v];
    ck('占格 ' + v + ' 生效（跨行列 / 尺寸 / 图标放大）',
       got && got.size === v && Math.abs(got.w - e.w) <= 2 && Math.abs(got.h - e.h) <= 2 &&
       got.ico === e.ico && got.col === e.col && got.row === e.row &&
       got.imgFit === 'contain' && got.imgPad === '0px' && /transparent|rgba\(0, 0, 0, 0\)/.test(got.icoBg || ''), got);
  }
  await closeSizeModal(page);

  /* --- 3. 多个书签各自独立尺寸 + 演示截图 --- */
  const layout = [
    [ids[0], '2x2'], [ids[1], '1x2'], [ids[2], '2x1'], [ids[3], '1x1']
  ];
  for (const [id, v] of layout) {
    await openSizeModal(page, id);
    await pickSize(page, v);
    await closeSizeModal(page);
  }
  const layoutInfo = {};
  for (const [id] of layout) layoutInfo[id] = (await cardInfo(page, id)).size;
  ck('4 个书签可各自设置不同占格', Object.values(layoutInfo).join(',') === '2x2,1x2,2x1,1x1', layoutInfo);
  const noOverlap = await page.evaluate(() => {
    const grid = document.querySelector('#sections .grid.cards-grid');
    const rs = [...grid.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
    let bad = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad++;
    }
    return { bad, total: rs.length };
  });
  ck('dense 网格无卡片重叠', noOverlap.bad === 0, noOverlap);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(400);
  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-card-sizes.png', fullPage: false });

  /* --- 4. 保存持久化 / 刷新 / 身份隔离 --- */
  const saved = await waitFor(async () => page.evaluate(async () => {
    const r = await fetch('/api/state');
    const j = await r.json();
    return (j.state.bookmarks || []).some((b) => b.size && b.size !== '1x1');
  }), 8000).catch(() => false);
  ck('尺寸已保存到服务端个人快照', saved);
  const disk = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'));
  const snapSizes = Object.keys(disk.spaces || {}).flatMap((k) => (disk.spaces[k].bookmarks || []).filter((b) => b.size && b.size !== '1x1').map((b) => b.size));
  ck('data.json 个人快照落盘含尺寸', snapSizes.length >= 3, snapSizes);
  ck('顶层公共模板未被写入尺寸', (disk.bookmarks || []).filter((b) => b.size && b.size !== '1x1').length === 0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  const afterReload = {};
  for (const [id] of layout) afterReload[id] = (await cardInfo(page, id)).size;
  ck('刷新后各书签尺寸保持', Object.values(afterReload).join(',') === '2x2,1x2,2x1,1x1', afterReload);

  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await page2.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  /* 阶段 10 分页后首页只渲染「常用」51 张，DOM 上数不到整站 51 个。
     隔离语义改为「DOM 当前分类无自定义尺寸 + 该身份全量 state 的 51 个书签也全无自定义尺寸」，
     既适配单页切换，又比原来只看 DOM 总数更严谨。 */
  const other = await page2.evaluate(async () => {
    let stateTotal = 0, stateSizes = [];
    try {
      const j = await (await fetch('/api/state')).json();
      const books = (j.state && j.state.bookmarks) || [];
      stateTotal = books.length;
      stateSizes = books.filter((b) => b.size && b.size !== '1x1').map((b) => b.size);
    } catch (_) {}
    return {
      custom: [...document.querySelectorAll('#sections .card:not(.add)')].filter((c) => c.dataset.size !== '1x1').length,
      total: document.querySelectorAll('#sections .card:not(.add)').length,
      stateTotal, stateSizes
    };
  });
  ck('另一访客不受影响（个人快照隔离）',
     other.custom === 0 && other.total >= 51 && other.stateTotal === 51 && other.stateSizes.length === 0, other);
  await ctx2.close();

  /* --- 5. 编辑弹窗内也能改尺寸 --- */
  await page.locator('#sections .card[data-id="' + ids[0] + '"]').click({ button: 'right' });
  await page.waitForSelector('#ctxMenu:not(.hidden) [data-k="edit"]', { timeout: 6000 });
  await page.click('#ctxMenu [data-k="edit"]');
  await page.waitForSelector('#modalRoot .size-pick', { timeout: 6000 });
  const editActive = await page.evaluate(() => (document.querySelector('#modalRoot .size-opt.on') || {}).dataset?.size);
  ck('编辑弹窗选择器回显当前尺寸', editActive === '2x2', editActive);
  await pickSize(page, '1x1');
  await page.click('#modalRoot [data-ok]');
  await wait(250);
  ck('编辑弹窗保存后尺寸生效', (await cardInfo(page, ids[0])).size === '1x1');

  /* --- 6. 设置抽屉一键复位 --- */
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#drawerBody [data-act="reset-sizes"]', { timeout: 6000 });
  await page.click('#drawerBody [data-act="reset-sizes"]');
  await wait(300);
  const reset = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#sections .card:not(.add)')];
    const icos = cards.map((c) => c.querySelector('.ico')).filter(Boolean);
    return {
      custom: cards.filter((c) => c.dataset.size !== '1x1').length,
      icoSizes: [...new Set(icos.map((n) => Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height)))]
    };
  });
  ck('一键复位后回到全 1x1 且图标恢复 48x48', reset.custom === 0 && reset.icoSizes.length === 1 && reset.icoSizes[0] === '48x48', reset);
  ck('无 JS 运行时错误', errs.length === 0, errs.slice(0, 3));

  try { await Promise.race([browser.close(), wait(4000)]); } catch (_) {}
}

(async () => {
  try {
    unitTests();
    await e2e();
  } catch (e) {
    ck('执行过程无异常', false, String(e && e.stack || e).slice(0, 400));
  }
  OUT.push('');
  OUT.push('CARD_SIZE_FAILS=' + fails);
  fs.writeFileSync('C:/AI使用/navio-tmp/card-size-test.txt', OUT.join('\n'), 'utf8');
  setTimeout(() => process.exit(fails ? 1 : 0), 200);
})();
