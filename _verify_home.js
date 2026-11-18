'use strict';
/**
 * 公共起始页端到端：真实 Chromium + 真实 HTTP 服务
 *
 * 覆盖：游客免登录、通用书签平铺、侧栏只放「我的标签」、Hero、图标不叠字、
 *       游客/账号之间私有内容互不可见、搜索、主题、组件、深浅截图、零 JS 错误。
 * 用法：node _verify_home.js
 */
const fs = require('fs');
const path = require('path');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.TEMP = 'C:/AI使用/navio-tmp';
process.env.TMP = 'C:/AI使用/navio-tmp';

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const { Store } = require('./src/store');
const { ServerConfig } = require('./src/config');
const { Auth } = require('./src/auth');
const { IconCache } = require('./src/favicon');
const { NavioServer } = require('./src/server');

const ROOT = __dirname;
const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
const DATA = 'C:/AI使用/navio-tmp/home-e2e';
const PORT = 19700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    try { if (await fn()) return true; } catch (_) {}
    await wait(250);
  }
  return false;
}
function launchOpts() {
  return {
    executablePath: CHROME, headless: true,
    env: { ...process.env, TEMP: 'C:/AI使用/navio-tmp', TMP: 'C:/AI使用/navio-tmp', TMPDIR: 'C:/AI使用/navio-tmp' },
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu',
           '--disable-dev-shm-usage', '--disable-crash-reporter', '--no-crash-upload',
           '--disk-cache-dir=C:/AI使用/navio-tmp/pwcache']
  };
}

(async () => {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(DATA, { recursive: true });

  const store = new Store(DATA); store.load();
  const config = new ServerConfig(DATA); config.load();
  config.save({ host: '127.0.0.1', port: PORT, autoStart: true, icons: { fetchEnabled: false, presetFallback: true } });
  const auth = new Auth(DATA, config);
  const ai = auth.load();
  const icons = new IconCache(DATA, () => ({ fetch: (...a) => globalThis.fetch(...a) }));
  const svr = new NavioServer({ store, auth, config, icons, rendererDir: path.join(ROOT, 'renderer'), dataDir: DATA, log: () => {} });
  ck('HTTP 服务启动', (await svr.start()).ok);

  const browser = await chromium.launch(launchOpts());
  const errs = [];
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxA.newPage();
  page.on('pageerror', (e) => errs.push(e.message));

  /* ---- 1. 游客免登录 ---- */
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(1300); // 等异步账号条与身份提示初始化
  ck('游客直接进入起始页（不再跳登录页）', !/login\.html/.test(page.url()) && page.url().endsWith('/'), page.url());
  const guestBar = await page.evaluate(() => ({
    login: !!document.querySelector('#btnLogin') && !document.querySelector('#btnLogin').hidden,
    user: (document.querySelector('#webUser') || {}).textContent || '',
    identity: (document.querySelector('#sideIdentity') || {}).textContent || ''
  }));
  ck('未登录显示「登录」入口与访客提示', guestBar.login && /访客/.test(guestBar.identity), guestBar);

  /* ---- 2. 默认只显示「常用」 + 分类导航 ---- */
  const ready = await waitFor(async () => (await page.locator('#sections .card:not(.add)').count()) >= 51, 15000);
  const info = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('#sections .group')];
    const cards = document.querySelectorAll('#sections .card:not(.add)');
    return {
      cards: cards.length,
      groups: groups.length,
      firstGroup: (groups[0] && groups[0].querySelector('.gname') || {}).textContent || '',
      pubBadge: !!groups[0] && !!groups[0].querySelector('.g-badge.pub'),
      groupNames: groups.map((g) => (g.querySelector('.gname') || {}).textContent || ''),
      publicCards: [...cards].filter((c) => c.dataset.id && c.dataset.id.startsWith('bp_')).length,
      mineBadges: document.querySelectorAll('#sections .mine-badge').length,
      sideItems: document.querySelectorAll('#sideNav .side-item').length,
      sideAdd: document.querySelectorAll('#sideNav .side-add').length,
      sideEmpty: !!document.querySelector('#sideNav .side-empty'),
      catItems: document.querySelectorAll('#sideCatNav .side-item').length,
      catNames: [...document.querySelectorAll('#sideCatNav .side-item .side-name')].map((n) => n.textContent || ''),
      catIcons: document.querySelectorAll('#sideCatNav .side-item .side-ico img').length,
      sideAll: document.querySelectorAll('#sideNav [data-key="all"]').length,
      sidePublic: document.querySelectorAll('#sideNav [data-key="g_public"], #sideNav [data-key="g_common"], #sideNav [data-key="g_more"], #sideNav [data-key^="g_cat_"]').length,
      sideTotal: Number((document.querySelector('#sideTotal') || {}).textContent || 0),
      sideGroups: Number((document.querySelector('#sideGroups') || {}).textContent || 0),
      crumb: (document.querySelector('#crumbText') || {}).textContent || '',
      catTabs: document.querySelectorAll('#groupTabs .tab[data-scope="public"]').length,
      catNames: [...document.querySelectorAll('#groupTabs .tab[data-scope="public"]')]
        .map((t) => (t.childNodes[0] || {}).textContent || '')
    };
  });
  ck('首页只显示唯一「常用」分类（1 个区块 / 51 张卡片）', info.groups === 1 && info.pubBadge &&
    info.groupNames[0] === '常用' && info.cards === 51, info);
  ck('系统预设分类只剩「常用」1 个', info.catTabs === 1 && info.catNames[0] === '常用', info.catNames);
  ck('当前分类卡片都来自推荐目录且无「我的」徽标', info.publicCards === 51 && info.mineBadges === 0, { pub: info.publicCards, mine: info.mineBadges });
   ck('左侧分类栏含「常用」且带系统预设图标', info.catItems === 1 && info.catNames[0] === '常用' && info.catIcons >= 1, info);
   ck('自建标签栏不再混入公共分类', info.sideAll === 0 && info.sidePublic === 0);
   ck('自建标签栏只留「新建标签」与空态提示', info.sideItems === 1 && info.sideAdd === 1 && info.sideEmpty, info);
   ck('侧栏统计：总数 51（全目录）、自建标签为 0', info.sideTotal === 51 && info.sideGroups === 0, info);
  ck('面包屑跟随当前分类显示「常用」', info.crumb === '常用', info.crumb);

  /* ---- 2b. 阶段 11：只有「常用」一个分类，无需切换 ---- */

  /* ---- 3. Hero / 图标浮字 ---- */
  const hero = await page.evaluate(() => {
    const wrap = document.querySelector('#searchWrap');
    const r = wrap ? wrap.getBoundingClientRect() : null;
    return {
      clock: (document.querySelector('#heroClock') || {}).textContent || '',
      hello: (document.querySelector('#heroHello') || {}).textContent || '',
      date: (document.querySelector('#heroDate') || {}).textContent || '',
      inHero: !!(wrap && wrap.closest('#hero')),
      searchW: r ? Math.round(r.width) : 0,
      quick: document.querySelectorAll('#heroQuick .quick-chip').length
    };
  });
  ck('大时钟渲染 HH:MM', /^\d{2}:\d{2}/.test(hero.clock), hero.clock);
  ck('问候语与日期', hero.hello.length >= 4 && /月/.test(hero.date) && /星期/.test(hero.date));
  ck('搜索框位于 Hero 且为大尺寸', hero.inHero && hero.searchW >= 500, hero.searchW);
  ck('常用站点快捷胶囊', hero.quick >= 6, hero.quick);

  // 图标全部加载完成再断言（条件等待，避免固定 sleep 造成 flaky）
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#sections .card:not(.add) .ico img')];
    return imgs.length >= 51 && imgs.every((i) => i.complete);
  }, { timeout: 20000 }).catch(() => {});

  const iconInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#sections .card:not(.add)')];
    const withImg = cards.filter((c) => c.querySelector('.ico img:not([data-failed="1"])'));
    const fbShown = withImg.filter((c) => {
      const fb = c.querySelector('.fallback');
      return fb && getComputedStyle(fb).display !== 'none';
    });
    const scoped = ['#sideNav', '#heroQuick', '#sections', '#topbar', '#sidebar', '#titlebar'];
    let titles = 0;
    scoped.forEach((sel) => {
      const r = document.querySelector(sel);
      if (r) titles += r.querySelectorAll('[title]').length + (r.hasAttribute('title') ? 1 : 0);
    });
    let degraded = false;
    const first = withImg[0];
    if (first) {
      const img = first.querySelector('.ico img');
      const fb = first.querySelector('.fallback');
      if (img) img.dataset.failed = '1';
      void first.offsetHeight;
      degraded = !!(fb && getComputedStyle(fb).display !== 'none');
      if (img) delete img.dataset.failed;
      void first.offsetHeight;
    }
    const imgs = [...document.querySelectorAll('#sections .card:not(.add) .ico img')];
    const srcs = imgs.map((i) => i.getAttribute('src') || '');
    // 色块检测：真实图标容器本身必须纯透明、无底色、无投影
    const icos = [...document.querySelectorAll('#sections .card:not(.add) .ico')];
    const colored = icos.filter((n) => {
      const cs = getComputedStyle(n);
      const bg = cs.backgroundColor;
      const transparent = bg === 'transparent' || /rgba\([^)]*,\s*0\)/.test(bg);
      return cs.backgroundImage !== 'none' || !transparent || cs.boxShadow !== 'none';
    });
    const icoSizes = [...new Set(icos.map((n) => {
      const r = n.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    }))];
    // 尺寸规格检测：归一化后所有图片原生尺寸 / padding / object-fit / 容器尺寸必须完全一致
    const specs = imgs.map((i) => {
      const cs = getComputedStyle(i);
      return {
        nat: i.naturalWidth + 'x' + i.naturalHeight,
        pad: cs.padding, fit: cs.objectFit, size: cs.width + 'x' + cs.height
      };
    });
    const uniq = (k) => [...new Set(specs.map((s) => s[k]))];
    return {
      withImg: withImg.length, fbShown: fbShown.length, titles, degraded,
      imgs: imgs.length,
      real: srcs.filter((s) => s.indexOf('/api/icon?host=') === 0).length,
      preset: srcs.filter((s) => s.indexOf('/api/preset-icon') === 0).length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      colored: colored.length, icoSizes,
      natKinds: uniq('nat'), padKinds: uniq('pad'), fitKinds: uniq('fit'), sizeKinds: uniq('size')
    };
  });
  ck('图标正常时不叠加首字母浮字', iconInfo.withImg > 0 && iconInfo.fbShown === 0, iconInfo);
  ck('首页无原生 title 悬浮提示文字', iconInfo.titles === 0, iconInfo.titles);
  ck('图片加载失败仍保留首字母降级', iconInfo.degraded, iconInfo.degraded);
  ck('卡片图标全部指向网站真实 favicon（不再用自绘 SVG）',
    iconInfo.real >= 51 && iconInfo.preset === 0 && iconInfo.real === iconInfo.imgs, iconInfo);
  ck('真实图标在关闭在线抓取时仍全部加载成功（离线图标包生效）',
    iconInfo.loaded >= 51 && iconInfo.loaded === iconInfo.imgs, iconInfo);
  ck('图标容器纯透明：真实 logo 下无彩色渐变/底色/投影色块',
    iconInfo.colored === 0 && iconInfo.icoSizes.length === 1, iconInfo);
  ck('当前分类 51 枚图标全部归一化为同一 128x128 透明规格',
    iconInfo.natKinds.length === 1 && iconInfo.natKinds[0] === '128x128', iconInfo.natKinds);
  ck('所有图标显示参数完全一致（padding / object-fit / 尺寸）',
    iconInfo.padKinds.length === 1 && iconInfo.fitKinds.length === 1 &&
    iconInfo.sizeKinds.length === 1 && iconInfo.fitKinds[0] === 'contain', iconInfo);
  const iconProbe = await page.evaluate(async () => {
    const r = await fetch('/api/icon?host=github.com&title=GitHub');
    return { status: r.status, site: r.headers.get('x-navio-icon'), ct: r.headers.get('content-type') };
  });
  ck('服务端命中内置真实图标包（X-Navio-Icon: site）',
    iconProbe.status === 200 && iconProbe.site === 'site' && /^image\//.test(iconProbe.ct || ''), iconProbe);

  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-home-dark.png' });

  /* ---- 4. 游客 A 编辑 → 只有自己可见 ---- */
  const edited = await page.evaluate(async () => {
    const r = await window.navio.readState();
    const st = JSON.parse(JSON.stringify(r.state));
    st.bookmarks = st.bookmarks.filter((b) => b.id !== 'bp_p_common_0'); // 删掉首张常用卡片
    st.groups.push({ id: 'mine_g', name: '我的收藏', color: '', icon: '', order: 50, collapsed: false, scope: 'mine' });
    st.bookmarks.push({
      id: 'mine_b', groupId: 'mine_g', title: '只给我看的站点',
      url: 'https://private.example.com', icon: '', desc: '', order: 999, clickCount: 0, scope: 'mine'
    });
    await window.navio.saveState(st);
    return { count: st.bookmarks.length, identity: r.identity.kind };
  });
  ck('游客可保存自己的视图', edited.identity === 'anon' && edited.count === 51, edited);
  // 不能直接 reload 原页面：pagehide 的 flush 会用页面内存里那份旧 state 覆盖刚写的快照。
  // 用同一上下文的新标签页读取，等价于「关掉再打开」，且不会触发旧页 unload。
  const pageA2 = await ctxA.newPage();
  pageA2.on('pageerror', (e) => errs.push('A2: ' + e.message));
  await pageA2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await pageA2.locator('#sections .card:not(.add)').count()) >= 51, 12000);
  // 阶段 10：单页视图默认只显示「常用」，私有标签要主动切换过去才可见
  await pageA2.click('#sideNav .side-item[data-key="mine_g"]');
  await waitFor(async () => (await pageA2.locator('#sections .card[data-id="mine_b"]').count()) === 1, 8000);
  const mineView = await pageA2.evaluate(() => ({
    hasPrivate: !!document.querySelector('#sections .card[data-id="mine_b"]'),
    privateBadge: !!document.querySelector('#sections .card[data-id="mine_b"] .mine-badge'),
    sideMine: document.querySelectorAll('#sideNav .side-item[data-key="mine_g"]').length,
    groupBadge: document.querySelectorAll('#sections .g-badge.mine').length
  }));
  const removedOnDisk = await pageA2.evaluate(async () => {
    const r = await window.navio.readState();
    return !r.state.bookmarks.some((b) => b.id === 'bp_p_common_0');
  });
  ck('刷新后自己的改动保留', mineView.hasPrivate && removedOnDisk, { mineView, removedOnDisk });
  ck('私有书签带「我的」角标', mineView.privateBadge);
  ck('私有标签出现在侧栏且带徽标', mineView.sideMine === 1 && mineView.groupBadge === 1, mineView);

  // 全新浏览器上下文 = 另一个游客（不同匿名 cookie）
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => errs.push('B: ' + e.message));
  await pageB.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await pageB.locator('#sections .card:not(.add)').count()) >= 51, 12000);
  const otherView = await pageB.evaluate(() => ({
    cards: document.querySelectorAll('#sections .card:not(.add)').length,
    hasBaidu: !!document.querySelector('#sections .card[data-id="bp_p_common_0"]'),
    hasPrivate: !!document.querySelector('#sections .card[data-id="mine_b"]'),
    sideMine: document.querySelectorAll('#sideNav .side-item[data-key="mine_g"]').length,
    mineBadges: document.querySelectorAll('#sections .mine-badge').length
  }));
  ck('其他游客仍看到完整的通用书签', otherView.hasBaidu && otherView.cards === info.cards, otherView);
  ck('其他游客看不到你的私有书签与标签', !otherView.hasPrivate && otherView.sideMine === 0 && otherView.mineBadges === 0, otherView);

  /* ---- 5. 登录账号也看不到游客的私有内容 ---- */
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageC = await ctxC.newPage();
  pageC.on('pageerror', (e) => errs.push('C: ' + e.message));
  await pageC.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await pageC.fill('#user', 'admin');
  await pageC.fill('#pw', ai.initialPassword);
  await pageC.click('#submit');
  await waitFor(async () => !/login\.html/.test(pageC.url()), 12000);
  await waitFor(async () => (await pageC.locator('#sections .card:not(.add)').count()) >= 51, 12000);
  const loginView = await pageC.evaluate(() => ({
    url: location.pathname,
    hasPrivate: !!document.querySelector('#sections .card[data-id="mine_b"]'),
    hasBaidu: !!document.querySelector('#sections .card[data-id="bp_p_common_0"]'),
    user: (document.querySelector('#webUser') || {}).textContent || '',
    loginHidden: !!(document.querySelector('#btnLogin') || {}).hidden
  }));
  ck('登录后进入起始页', loginView.url === '/' && loginView.loginHidden, loginView.url);
  ck('登录账号看不到游客的私有内容', !loginView.hasPrivate && loginView.hasBaidu, loginView);
  ck('登录账号显示用户名', loginView.user.length > 0 && loginView.user !== '访客', loginView.user);

  /* ---- 6. 通用搜索 / 主题 / 组件 ---- */
  // 用独立干净页面测搜索与引擎下拉：主页面此前经历过保存/删除/抽屉等多次交互，
  // 输入框在本机高负载下偶发短暂不可编辑（fill 超时），独立页面确定性更高。
  const ctxQ = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pQ = await ctxQ.newPage();
  pQ.on('pageerror', (e) => errs.push('Q: ' + e.message));
  await pQ.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pQ.waitForSelector('#sections .card:not(.add)', { timeout: 15000 });
  await pQ.waitForFunction(() => {
    const el = document.querySelector('#searchInput');
    return !!el && !el.disabled;
  }, { timeout: 10000 }).catch(() => {});
  await pQ.fill('#searchInput', 'github', { timeout: 20000 });
  await wait(400);
  const searchHit = await pQ.evaluate(() => ({
    visible: !document.querySelector('#searchResults').classList.contains('hidden'),
    text: (document.querySelector('#searchResults') || {}).textContent || ''
  }));
  ck('首页搜索仍可用', searchHit.visible && /GitHub/i.test(searchHit.text), searchHit.text.slice(0, 60));
  await pQ.fill('#searchInput', '');
  await wait(250);

  /* ---- 6b. 搜索引擎下拉 + 联网搜索 ---- */
  const engInit = await pQ.evaluate(() => ({
    pick: !!document.querySelector('#enginePick'),
    menu: !!document.querySelector('#engineMenu'),
    name: (document.querySelector('#engineName') || {}).textContent || '',
    items: document.querySelectorAll('#engineMenu [data-engine]').length
  }));
  ck('搜索栏内嵌搜索引擎下拉', engInit.pick && engInit.menu && engInit.items >= 6, engInit);

  await pQ.click('#enginePick');
  await wait(220);
  const engMenu = await pQ.evaluate(() => ({
    open: document.querySelector('#engineMenu').classList.contains('open'),
    text: (document.querySelector('#engineMenu') || {}).textContent || ''
  }));
  ck('下拉可展开且含百度/谷歌/必应/360',
    engMenu.open && /百度/.test(engMenu.text) && /谷歌/.test(engMenu.text) &&
    /必应/.test(engMenu.text) && /360/.test(engMenu.text), engMenu.text.slice(0, 80));

  // 层叠回归：菜单必须真正盖住下方快捷胶囊/卡片，7 项都要能命中。
  // 用独立干净页面测——主页面此前经历过搜索面板、设置抽屉、滚动、hover 等交互，
  // 菜单可能处于 hidden 态；elementFromPoint 会穿透隐藏元素造成假失败。
  const ctxS = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pS = await ctxS.newPage();
  await pS.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pS.waitForSelector('#sections .card:not(.add)', { timeout: 15000 });
  await wait(700);
  await pS.click('#enginePick');
  // visibility 参与 .16s 过渡，独立页面首帧可能未稳定，条件等待而非固定 sleep
  await waitFor(async () => await pS.evaluate(() => {
    const m = document.querySelector('#engineMenu');
    return m && m.classList.contains('open') && getComputedStyle(m).visibility === 'visible';
  }), 4000);
  await wait(220);
  const stack = await pS.evaluate(() => {
    const menu = document.querySelector('#engineMenu');
    const items = [...menu.querySelectorAll('.eng-item')];
    const vis = getComputedStyle(menu).visibility;
    const hits = items.map((n) => {
      const r = n.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!(el && n.contains(el));
    });
    return {
      vis, open: menu.classList.contains('open'),
      zHero: getComputedStyle(document.querySelector('.hero-search')).zIndex,
      n: hits.length, ok: hits.filter(Boolean).length
    };
  });
  ck('下拉 7 项层叠正确：每项中心都能命中菜单',
    stack.vis === 'visible' && stack.open && stack.n === 7 && stack.ok === 7 && stack.zHero === '60', stack);
  await ctxS.close();

  await pQ.click('#engineMenu [data-engine="baidu"]');
  await wait(1000);
  const engPicked = await pQ.evaluate(() => ({
    name: (document.querySelector('#engineName') || {}).textContent || '',
    closed: !document.querySelector('#engineMenu').classList.contains('open'),
    active: document.querySelectorAll('#engineMenu [data-engine].active').length
  }));
  ck('切换到百度后标签与选中态同步',
    engPicked.name === '百度' && engPicked.closed && engPicked.active === 1, engPicked);
  const persisted = Object.values(store.state.spaces || {})
    .some((sp) => sp && sp.settings && sp.settings.searchEngine === 'baidu');
  ck('引擎选择已持久化到个人快照', persisted, Object.keys(store.state.spaces || {}));

  await pQ.evaluate(() => {
    window.__opened = [];
    window.__origOpen = window.open;
    window.open = function (u) { window.__opened.push(String(u)); return null; };
  });
  await pQ.fill('#searchInput', '天气预报');
  await wait(350);
  const webBtn = await pQ.evaluate(() => {
    const b = document.querySelector('#searchResults [data-web]');
    return { has: !!b, text: b ? b.textContent : '', q: b ? b.getAttribute('data-q') : '' };
  });
  ck('结果页出现「用 百度 联网搜索」入口',
    webBtn.has && /百度/.test(webBtn.text) && webBtn.q === '天气预报', webBtn);
  await pQ.click('#searchResults [data-web]');
  await wait(250);
  const opened = await pQ.evaluate(() => window.__opened || []);
  ck('点击联网按钮打开百度搜索页',
    opened.some((u) => u.startsWith('https://www.baidu.com/s?wd=') &&
      u.includes(encodeURIComponent('天气预报'))), opened);

  await pQ.fill('#searchInput', 'github');
  await wait(320);
  const localHit = await pQ.evaluate(() => ({
    cards: document.querySelectorAll('#searchResults .card[data-id]').length,
    web: !!document.querySelector('#searchResults [data-web]')
  }));
  ck('联网入口不影响本地书签搜索', localHit.cards >= 1 && localHit.web, localHit);
  await pQ.evaluate(() => { if (window.__origOpen) window.open = window.__origOpen; });

  await pQ.click('#btnSettings');
  await waitFor(async () => { try { return await pQ.locator('#setEngine').count() > 0; } catch (_) { return false; } }, 10000);
  const drawerEng = await pQ.evaluate(() => {
    const s = document.querySelector('#setEngine');
    return { value: s ? s.value : '', options: s ? s.querySelectorAll('option').length : 0 };
  });
  ck('设置抽屉默认引擎与搜索栏同步', drawerEng.value === 'baidu' && drawerEng.options >= 6, drawerEng);
  await pQ.click('#btnCloseDrawer');
  await pQ.fill('#searchInput', '');
  await wait(250);

  await pQ.click('#sideTheme');
  await wait(1200);
  const theme = await pQ.evaluate(() => document.documentElement.dataset.theme);
  ck('侧栏可一键切换深/浅主题', theme === 'light', theme);
  await pQ.screenshot({ path: 'C:/AI使用/navio-tmp/shot-home-light.png' });

  await pQ.click('#sideWidgets');
  await wait(300);
  ck('组件面板仍可打开', !(await pQ.locator('#widgetsPanel').getAttribute('class') || '').includes('hidden'));

  /* ---- 7. 公共模板本身没有被 Web 端改写 ---- */
  const top = store.state;
  ck('顶层公共模板未被 Web 端写入', (!top.bookmarks || top.bookmarks.length === 0), top.bookmarks && top.bookmarks.length);
  ck('每个身份各有独立快照', Object.keys(top.spaces || {}).length >= 2, Object.keys(top.spaces || {}));
  ck('无 JS 运行时错误', errs.length === 0, errs.slice(0, 3));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT ${pass}/${results.length} PASS`);
  fs.writeFileSync('C:/AI使用/navio-tmp/home-e2e-result.json', JSON.stringify({ pass, total: results.length, results, errors: errs }, null, 2), 'utf8');

  try { await Promise.race([browser.close(), wait(4000)]); } catch (_) {}
  // svr.stop() 偶发挂起，必须超时兜底，否则打印完 RESULT 也不退出
  try { await Promise.race([Promise.resolve(svr.stop()), wait(2000)]); } catch (_) {}
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.log('ERR ' + (e && e.stack ? e.stack : e));
  fs.writeFileSync('C:/AI使用/navio-tmp/home-e2e-result.json', JSON.stringify({ fatal: String(e && e.stack || e) }, null, 2), 'utf8');
  setTimeout(() => process.exit(1), 200);
});
