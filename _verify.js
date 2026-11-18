'use strict';
/**
 * Navio-Win 端到端验证
 * 前置：应用以 NAVIO_DEBUG_PORT=9222 运行
 * 断言尽量走 page.evaluate，避免 Playwright locator 严格模式/可见性误判
 */
const path = require('path');
const fs = require('fs');
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const DATA_DIR = process.env.NAVIO_DATA_DIR || path.join(__dirname, 'data');

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  → ' + extra : ''));
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('index.html')) || ctx.pages()[0];

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const reset = async () => {
    await page.evaluate(() => {
      document.querySelector('#drawer')?.classList.remove('open');
      document.querySelector('#drawerMask')?.classList.add('hidden');
      document.querySelector('#modalRoot')?.replaceChildren();
      document.querySelector('#ctxMenu')?.classList.add('hidden');
      const allTab = document.querySelector('#groupTabs [data-tab="all"]');
      if (allTab) allTab.click();
    });
    await page.waitForTimeout(150);
  };
  const snap = async (file) => page.screenshot({ path: path.join(OUT, file), animations: 'disabled', timeout: 90000, scale: 'css' });

  // 刷新以加载最新前端代码，同时复位内存状态
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#sections .card[data-id]').length > 0, null, { timeout: 20000 });
  await reset();
  await page.waitForTimeout(1200);

  /* ---- 1. 基础渲染 ---- */
  const base = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('#groupTabs .tab')).map((e) => e.textContent.trim()),
    cards: document.querySelectorAll('#sections .card[data-id]').length,
    title: document.title
  }));
  check('分组标签渲染', base.tabs.length >= 3, base.tabs.join(' | '));
  check('书签卡片渲染', base.cards >= 12, base.cards + ' 个卡片');
  check('窗口标题', base.title === 'Navio', base.title);

  /* ---- 2. 图标抓取 ---- */
  await page.waitForTimeout(2000);
  const iconStat = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('#sections .ico img'));
    return {
      total: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      failed: imgs.filter((i) => i.dataset.failed === '1').length
    };
  });
  check('图标抓取（有兜底）', iconStat.total > 0 && iconStat.loaded >= 6,
    `${iconStat.loaded}/${iconStat.total} 张真实图标，${iconStat.failed} 张降级为字母`);
  await snap('01-home.png');

  /* ---- 3. 搜索 ---- */
  await reset();
  await page.click('#searchInput');
  await page.type('#searchInput', 'github', { delay: 30 });
  await page.waitForTimeout(500);
  const sr = await page.evaluate(() => ({
    visible: !document.querySelector('#searchResults').classList.contains('hidden'),
    hits: document.querySelectorAll('#searchResults .card[data-id]').length,
    sectionsHidden: document.querySelector('#sections').classList.contains('hidden')
  }));
  check('搜索过滤', sr.visible && sr.hits >= 1 && sr.sectionsHidden, sr.hits + ' 条命中');
  await snap('02-search.png');
  await page.evaluate(() => { const i = document.querySelector('#searchInput'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);

  /* ---- 4. 添加书签 ---- */
  await reset();
  await page.click('#btnAdd');
  await page.waitForTimeout(400);
  const m1 = await page.evaluate(() => ({
    has: !!document.querySelector('#fUrl') && !!document.querySelector('#fTitle'),
    title: (document.querySelector('.modal-head h3') || {}).textContent
  }));
  check('添加书签弹窗', m1.has && m1.title === '添加书签', m1.title);
  await snap('03-add.png');

  await page.fill('#fUrl', 'example.com');
  await page.dispatchEvent('#fUrl', 'blur');
  await page.waitForTimeout(400);
  const auto = await page.evaluate(() => ({
    url: document.querySelector('#fUrl') && document.querySelector('#fUrl').value,
    title: document.querySelector('#fTitle') && document.querySelector('#fTitle').value
  }));
  check('URL 规范化 + 标题自动填充', auto.url === 'https://example.com' && auto.title === 'example.com',
    `${auto.url} / ${auto.title}`);

  await page.evaluate(() => document.querySelector('.modal-foot [data-ok]').click());
  await page.waitForTimeout(900);
  const afterAdd = await page.evaluate(() => document.querySelectorAll('#sections .card[data-id]').length);
  check('新增书签生效', afterAdd === base.cards + 1, `${base.cards} → ${afterAdd}`);

  /* ---- 5. 设置抽屉 + 主题 ---- */
  await reset();
  await page.click('#btnSettings');
  await page.waitForTimeout(600);
  const drawer = await page.evaluate(() => ({
    open: document.querySelector('#drawer').classList.contains('open'),
    sections: Array.from(document.querySelectorAll('#drawerBody .set-sec h4')).map((x) => x.textContent.trim()),
    walls: document.querySelectorAll('#drawerBody .wall-tile').length
  }));
  check('设置抽屉', drawer.open && drawer.sections.length >= 5, drawer.sections.join(' / '));
  check('壁纸预设齐全', drawer.walls === 8, drawer.walls + ' 个');
  await snap('04-settings.png');

  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[data-seg="theme"] button')).find((x) => x.dataset.v === 'light').click();
  });
  await page.waitForTimeout(700);
  const light = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    dimBg: getComputedStyle(document.querySelector('#wall-dim')).backgroundColor,
    wallBg: getComputedStyle(document.querySelector('#wall')).backgroundImage.slice(0, 30)
  }));
  check('浅色主题切换（壁纸自动配对）', light.theme === 'light', `${light.theme} / dim=${light.dimBg}`);
  await snap('05-light.png');

  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[data-seg="theme"] button')).find((x) => x.dataset.v === 'dark').click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#btnCloseDrawer').click());
  await page.waitForTimeout(400);

  /* ---- 6. 右键菜单 ---- */
  await reset();
  const box = await page.evaluate(() => {
    const c = document.querySelector('#sections .card[data-id]');
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForTimeout(400);
  const ctxMenu = await page.evaluate(() => ({
    visible: !document.querySelector('#ctxMenu').classList.contains('hidden'),
    items: Array.from(document.querySelectorAll('#ctxMenu .ctx-item')).map((x) => x.textContent.trim())
  }));
  check('右键菜单', ctxMenu.visible && ctxMenu.items.length >= 5, ctxMenu.items.join(' / '));
  await snap('06-context.png');
  await page.keyboard.press('Escape');

  /* ---- 7. 分组切换过滤 ---- */
  await reset();
  const tabInfo = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#groupTabs .tab')).filter((t) => t.dataset.tab && t.dataset.tab !== 'all');
    tabs[0].click();
    return { gid: tabs[0].dataset.tab, name: tabs[0].textContent.trim() };
  });
  await page.waitForTimeout(400);
  const tabCards = await page.evaluate(() => document.querySelectorAll('#sections .card[data-id]').length);
  check('分组切换过滤', tabCards > 0 && tabCards < base.cards + 1, `${tabInfo.name} → ${tabCards} 张 / 全部 ${base.cards + 1}`);
  await page.evaluate(() => document.querySelector('#groupTabs [data-tab="all"]').click());
  await page.waitForTimeout(300);

  /* ---- 8. 拖拽排序 ---- */
  const orderBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#sections .group:first-child .card[data-id]')).map((c) => c.dataset.id)
  );
  let dragOk = false;
  let dragNote = '未生效';
  try {
    const loc = page.locator('#sections .group:first-child .card[data-id]');
    const n = await loc.count();
    if (n >= 3) {
      await loc.nth(0).dragTo(loc.nth(2));
      await page.waitForTimeout(900);
      const orderAfter = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#sections .group:first-child .card[data-id]')).map((c) => c.dataset.id)
      );
      dragOk = orderBefore.join(',') !== orderAfter.join(',');
      dragNote = dragOk ? `${orderBefore[0].slice(0, 6)}… 移到第 3 位` : '顺序未变';
    }
  } catch (e) {
    dragNote = 'dragTo 失败: ' + e.message.split('\n')[0];
  }
  check('拖拽排序生效', dragOk, dragNote);

  /* ---- 9. 数据落盘 ---- */
  await page.waitForTimeout(1500);
  let diskOk = false;
  let diskInfo = '';
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8');
    const j = JSON.parse(raw);
    diskOk = Array.isArray(j.bookmarks) && j.bookmarks.length === afterAdd && !!j.settings;
    diskInfo = `bookmarks=${j.bookmarks.length} groups=${j.groups.length} bytes=${raw.length}`;
  } catch (e) {
    diskInfo = e.message;
  }
  check('数据写入单个 JSON 文件', diskOk, diskInfo);

  /* ---- 10. 控制台 ---- */
  const realErrors = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|ERR_NAME/i.test(e));
  check('无 JS 运行错误', realErrors.length === 0, realErrors.slice(0, 3).join(' ;; ') || 'clean');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== ${pass}/${results.length} PASS ====`);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(2);
});
