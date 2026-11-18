'use strict';
/**
 * 阶段 2 组件端到端：真实 Chromium + 真实 HTTP 服务
 * 覆盖：4 组件渲染、待办增删改勾选、日历选日、天气手动/联网、笔记编辑、
 *       组件开关、刷新后数据保持（JSON 落盘）、零 JS 错误。
 * 用法：node _verify_widgets.js
 */
const fs = require('fs');
const path = require('path');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
// 本机 C 盘长期 0 空闲，Chromium 的临时目录必须落在 D 盘，否则启动即 ENOSPC
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
const DATA = 'C:/AI使用/navio-tmp/widgets-e2e';
const PORT = 19500 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
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

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(500);
  ck('游客可直接浏览通用起始页', !/login\.html/.test(page.url()), page.url());
  await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await wait(300);
  await page.fill('#user', 'admin');
  await page.fill('#pw', ai.initialPassword);
  await page.click('#submit');
  await wait(1600);
  ck('登录进入书签页', !/login\.html/.test(page.url()), page.url());

  /* ---- 4 个组件渲染 ---- */
  const types = await page.evaluate(() => Array.from(document.querySelectorAll('#widgetsPanel .wg-card')).map((c) => c.dataset.wtype));
  ck('默认渲染 4 个卡片组件', types.length === 4, types);
  ck('组件类型齐全（待办/日历/天气/记事本）', ['todo', 'calendar', 'weather', 'notes'].every((t) => types.includes(t)), types);
  ck('组件面板可见', !(await page.locator('#widgetsPanel').getAttribute('class')).includes('hidden'));

  /* ---- 待办 ---- */
  await page.fill('#widgetsPanel input[name="todo"]', '买 DDR4 内存条');
  await page.press('#widgetsPanel input[name="todo"]', 'Enter');
  await wait(350);
  ck('添加待办后出现在列表', (await page.textContent('.wg-todo-list')).includes('买 DDR4 内存条'));
  await page.fill('#widgetsPanel input[name="todo"]', '装 Arcane');
  await page.click('[data-wact="todo-add"]');
  await wait(350);
  ck('点击「添加」也能新增待办', (await page.textContent('.wg-todo-list')).includes('装 Arcane'));
  await page.locator('[data-wact="todo-toggle"]').first().click();
  await wait(300);
  ck('待办可勾选完成', (await page.locator('.wg-todo-item.done').count()) >= 1);
  const subText = await page.textContent('.wg-card[data-wtype="todo"] .wg-sub');
  ck('待办计数随状态更新', /未完成/.test(subText), subText);

  /* ---- 日历 ---- */
  const m0 = await page.textContent('.wg-cal-nav span');
  await page.click('[data-wact="cal-next"]');
  await wait(250);
  const m1 = await page.textContent('.wg-cal-nav span');
  ck('日历可切换月份', m0 !== m1, { before: m0, after: m1 });
  await page.click('[data-wact="cal-today"]');
  await wait(250);
  ck('日历可回到本月', (await page.textContent('.wg-cal-nav span')) === m0);
  ck('日历渲染当月日期格', (await page.locator('[data-wact="cal-day"]').count()) >= 28);
  await page.locator('[data-wact="cal-day"]').nth(9).click();
  await wait(250);
  ck('点击日期产生选中态', (await page.locator('.wg-cal-cell.picked').count()) === 1);
  await page.fill('#widgetsPanel input[name="todo"]', '带日期的待办');
  await page.press('#widgetsPanel input[name="todo"]', 'Enter');
  await wait(350);
  ck('新待办自动关联所选日期', (await page.locator('.wg-todo-due').count()) >= 1);

  /* ---- 天气（手动填 → 联网获取） ---- */
  await page.click('[data-wact="weather-edit"]');
  await wait(300);
  await page.fill('#wgWCity', '北京');
  await page.fill('#wgWTemp', '26');
  await page.fill('#wgWDesc', '晴');
  await page.click('.mask [data-ok]');
  await wait(350);
  const wText = await page.textContent('.wg-card[data-wtype="weather"]');
  ck('手动填写天气立即显示', wText.includes('26') && wText.includes('晴') && wText.includes('北京'), wText.slice(0, 80));
  await page.fill('#widgetsPanel input[name="city"]', '上海');
  await page.click('[data-wact="weather-fetch"]');
  await wait(2500);
  const wAfter = await page.textContent('.wg-card[data-wtype="weather"]');
  ck('联网获取天气后组件仍正常（在线更新/离线降级）', wAfter.includes('°C') && errs.length === 0, { hasTemp: !wAfter.includes('--'), errs: errs.length });

  /* ---- 记事本 ---- */
  await page.click('[data-wact="note-new"]');
  await wait(300);
  await page.fill('#wgNTitle', 'NAS 配置清单');
  await page.fill('#wgNBody', 'MariaDB\nSimple SQ Music Plus\nArcane');
  await page.click('.mask [data-ok]');
  await wait(350);
  ck('新建笔记出现在列表', (await page.textContent('.wg-note-list')).includes('NAS 配置清单'));
  await page.click('[data-wact="note-open"]');
  await wait(300);
  ck('笔记可再次打开编辑且内容保留', (await page.inputValue('#wgNBody')).includes('Arcane'));
  await page.click('.mask [data-cancel]');
  await wait(200);

  /* ---- 组件管理 ---- */
  await page.click('#btnWidgets');
  await wait(300);
  ck('组件管理弹窗列出 4 个组件', (await page.locator('.wg-manage-row').count()) === 4);
  await page.locator('.wg-switch').first().click();
  await wait(300);
  ck('关闭开关后对应组件从面板消失', (await page.locator('#widgetsPanel .wg-card').count()) === 3);
  await page.locator('.wg-switch').first().click();
  await wait(300);
  ck('重新开启组件恢复显示', (await page.locator('#widgetsPanel .wg-card').count()) === 4);
  await page.click('.mask [data-done]');
  await wait(200);

  /* ---- 刷新保持（关键：数据确实落进 JSON） ---- */
  await wait(1800);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(1500);
  const persisted = await page.evaluate(() => ({
    todo: document.querySelector('.wg-todo-list') ? document.querySelector('.wg-todo-list').textContent : '',
    note: document.querySelector('.wg-note-list') ? document.querySelector('.wg-note-list').textContent : '',
    weather: document.querySelector('.wg-card[data-wtype="weather"]') ? document.querySelector('.wg-card[data-wtype="weather"]').textContent : '',
    cards: document.querySelectorAll('#widgetsPanel .wg-card').length
  }));
  ck('刷新后待办保持', persisted.todo.includes('买 DDR4 内存条') && persisted.todo.includes('带日期的待办'));
  ck('刷新后笔记保持', persisted.note.includes('NAS 配置清单'));
  ck('刷新后天气设置保持', persisted.weather.includes('°C'));
  ck('刷新后组件开关状态保持', persisted.cards === 4, persisted.cards);

  const disk = fs.readFileSync(path.join(DATA, 'data.json'), 'utf8');
  ck('组件数据确实写进单个 data.json', disk.includes('买 DDR4 内存条') && disk.includes('NAS 配置清单'));

  /* ---- 截图 ---- */
  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-widgets-dark.png', fullPage: false });
  await page.click('#btnSettings');
  await wait(300);
  await page.click('#drawer [data-v="light"]');
  await wait(400);
  await page.click('#btnCloseDrawer');
  await wait(400);
  await page.screenshot({ path: 'C:/AI使用/navio-tmp/shot-widgets-light.png', fullPage: false });
  ck('浅色主题下组件仍可读', (await page.locator('#widgetsPanel .wg-card').count()) === 4);

  ck('全程无 JS 运行错误', errs.length === 0, errs.slice(0, 3));

  // headless Chromium 偶尔在 close() 上挂起，加超时兜底，避免验收脚本被外部超时掐掉
  try { await Promise.race([browser.close(), wait(4000)]); } catch (_) {}
  try { if (svr && svr.stop) await Promise.race([Promise.resolve(svr.stop()), wait(2000)]); } catch (_) {}
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.log('ERR', e && e.stack);
  process.exit(1);
});
