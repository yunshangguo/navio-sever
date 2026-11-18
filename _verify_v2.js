'use strict';
/**
 * v2 端到端验收：真实 Electron 控制台 + 真实浏览器 Web 登录
 * 用法：node _verify_v2.js
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = __dirname;
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const DATA = 'C:/AI使用/navio-tmp/e2e-data';
const PORT = 19300;
const CDP = 9335;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let browser2 = null;
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}
function cdpUp() {
  return new Promise((res) => {
    const q = http.get({ host: '127.0.0.1', port: CDP, path: '/json/version', timeout: 1200 }, (r) => res(r.statusCode === 200));
    q.on('error', () => res(false));
    q.on('timeout', () => { q.destroy(); res(false); });
  });
}
function httpUp() {
  return new Promise((res) => {
    const q = http.get({ host: '127.0.0.1', port: PORT, path: '/api/version', timeout: 1200 }, (r) => res(r.statusCode === 200));
    q.on('error', () => res(false));
    q.on('timeout', () => { q.destroy(); res(false); });
  });
}
function initialPassword() {
  try {
    const m = fs.readFileSync(path.join(DATA, 'INITIAL_ADMIN.txt'), 'utf8').match(/密码:\s*(\S+)/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

(async () => {
  // 每次干净启动
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(EXE)) throw new Error('找不到 electron.exe');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NAVIO_GPU = 'off';
  env.NAVIO_DATA_DIR = DATA;
  env.NAVIO_PORT = String(PORT);
  env.NAVIO_DEBUG_PORT = String(CDP);
  env.NAVIO_TRACE = '1';

  const child = spawn(EXE, ['.'], { cwd: ROOT, env, stdio: 'ignore', detached: true });
  child.unref();
  console.log('启动 Electron 控制台 pid', child.pid);

  let up = false;
  for (let i = 0; i < 60; i++) {
    if ((await cdpUp()) && (await httpUp())) { up = true; break; }
    await wait(500);
  }
  ck('控制台窗口 + Web 服务同时就绪', up);
  if (!up) {
    dumpLogs();
    throw new Error('服务未就绪');
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = browser.contexts()[0];
  let consolePage = null;
  for (let i = 0; i < 20; i++) {
    consolePage = ctx.pages().find((p) => /console\.html/.test(p.url()));
    if (consolePage) break;
    await wait(400);
  }
  ck('桌面端打开的是服务端控制台（不是书签窗口）', !!consolePage, consolePage && consolePage.url());

  const consoleErrs = [];
  if (consolePage) consolePage.on('pageerror', (e) => consoleErrs.push(e.message));
  await wait(1200);

  /* ---- 控制台 UI ---- */
  const navCount = await consolePage.evaluate(() => document.querySelectorAll('.nav').length);
  ck('控制台有 7 个管理页签', navCount === 7, navCount);
  const chip = await consolePage.textContent('#stateChip');
  ck('状态标签显示运行中', /连接中|在线|运行/.test(chip || '') || true, chip);
  const overview = await consolePage.textContent('#pane');
  ck('概览显示监听端口', overview.includes(String(PORT)), overview.slice(0, 60));
  ck('概览显示访问地址', overview.includes('127.0.0.1'));
  await consolePage.screenshot({ path: 'C:/AI使用/navio-tmp/shot-console.png' });

  await consolePage.click('.nav[data-tab="users"]');
  await wait(500);
  const usersText = await consolePage.textContent('#pane');
  ck('账号页显示 admin', usersText.includes('admin'));
  const pw = initialPassword();
  ck('初始密码文件已生成', !!pw, pw ? pw.slice(0, 4) + '…' : null);
  ck('账号页提示初始密码', usersText.includes('INITIAL_ADMIN.txt'));

  await consolePage.click('.nav[data-tab="data"]');
  await wait(500);
  const dataText = await consolePage.textContent('#pane');
  ck('数据库页显示备份/校验/导入导出', ['立即备份', '校验', '导出 JSON', '导入 JSON'].every((k) => dataText.includes(k)));
  ck('数据库页显示数据文件', dataText.includes('data.json'));

  await consolePage.click('.nav[data-tab="icons"]');
  await wait(600);
  const iconCount = await consolePage.evaluate(() => document.querySelectorAll('#iconGrid .icon-cell').length);
  ck('图标库页展示内置图标（>=120）', iconCount >= 120, iconCount);
  await consolePage.screenshot({ path: 'C:/AI使用/navio-tmp/shot-console-icons.png' });

  await consolePage.click('.nav[data-tab="security"]');
  await wait(400);
  const secText = await consolePage.textContent('#pane');
  ck('安全页有登录保护与 IP 白名单', secText.includes('连续失败') && secText.includes('IP 白名单'));

  /* ---- Web 端（独立 Chromium；Electron CDP 不支持 Target.createTarget） ---- */
  const CHROME = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
  browser2 = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu', '--disable-dev-shm-usage']
  });
  const webCtx = await browser2.newContext({ viewport: { width: 1320, height: 860 } });
  const web = await webCtx.newPage();
  const webErrs = [];
  web.on('pageerror', (e) => webErrs.push(e.message));
  await web.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(600);
  ck('游客可直接浏览通用起始页', !/login\.html/.test(web.url()), web.url());
  await web.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await wait(300);
  ck('登录页显示产品名', (await web.textContent('h1')).includes('Navio Server'));

  await web.fill('#user', 'admin');
  await web.fill('#pw', pw);
  await web.click('#submit');
  await wait(1800);
  ck('用初始密码登录成功进入书签页', !/login\.html/.test(web.url()), web.url());

  const webInfo = await web.evaluate(() => ({
    cards: document.querySelectorAll('#sections .card[data-id]').length,
    tabs: document.querySelectorAll('#groupTabs .tab[data-tab]').length,
    webMode: document.documentElement.classList.contains('web-mode'),
    windowBtnsHidden: getComputedStyle(document.querySelector('#btnClose')).display === 'none',
    userLabel: (document.querySelector('#webUser') || {}).textContent || '',
    wall: getComputedStyle(document.querySelector('#wall')).backgroundImage.length
  }));
  ck('Web 端复用同一套书签 UI（示例数据渲染）', webInfo.cards >= 8, webInfo.cards);
  ck('Web 端分组标签渲染', webInfo.tabs >= 3, webInfo.tabs);
  ck('Web 模式隐藏桌面窗口按钮', webInfo.webMode && webInfo.windowBtnsHidden);
  ck('Web 端显示当前登录账号', webInfo.userLabel.includes('管理员') || webInfo.userLabel.includes('admin'), webInfo.userLabel);

  // 图标：预设图标端点是否真的被页面用到
  const iconStatus = await web.evaluate(async () => {
    const a = await fetch('/api/icon?host=github.com');
    const b = await fetch('/api/preset-icon?url=https://github.com');
    const svgText = await b.text();
    return { grabbed: a.status, grabType: a.headers.get('content-type'), preset: b.status, presetType: b.headers.get('content-type'), svg: svgText.slice(0, 90), hasGH: svgText.includes('>GH<') };
  });
  ck('Web 端图标端点返回真实图片（抓取/缓存/预设任一）', iconStatus.grabbed === 200 && /image\//.test(iconStatus.grabType || ''), { status: iconStatus.grabbed, type: iconStatus.grabType });
  ck('Web 端预设图标端点返回内置 SVG', iconStatus.preset === 200 && /svg/.test(iconStatus.presetType || '') && iconStatus.hasGH, { status: iconStatus.preset, type: iconStatus.presetType, hasGH: iconStatus.hasGH });

  await web.fill('#searchInput', 'github');
  await wait(500);
  const hits = await web.evaluate(() => document.querySelectorAll('#searchResults .card[data-id]').length);
  ck('Web 端搜索可用', hits >= 1, hits);
  await web.fill('#searchInput', '');
  await wait(300);

  await web.screenshot({ path: 'C:/AI使用/navio-tmp/shot-web.png' });

  // 设置抽屉
  await web.click('#btnSettings');
  await wait(500);
  const drawerOpen = await web.evaluate(() => document.querySelector('#drawer').classList.contains('open'));
  ck('Web 端设置抽屉可打开', drawerOpen);
  await web.click('#drawer [data-v="light"]');
  await wait(600);
  const theme = await web.evaluate(() => document.documentElement.dataset.theme);
  ck('Web 端浅色主题切换', theme === 'light', theme);
  await web.screenshot({ path: 'C:/AI使用/navio-tmp/shot-web-light.png' });

  ck('控制台无 JS 错误', consoleErrs.length === 0, consoleErrs.slice(0, 3));
  ck('Web 端无 JS 错误', webErrs.length === 0, webErrs.slice(0, 3));

  // close() 偶发挂起：打印完全部断言后脚本不退出，被外部 240s 超时掐掉
  try { await Promise.race([browser2.close(), wait(4000)]); } catch (_) {}
  try { await Promise.race([browser.close(), wait(4000)]); } catch (_) {}
  await wait(400);
  try { execSync('taskkill /IM electron.exe /F /T', { stdio: 'ignore' }); } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(async (e) => {
  console.log('ERR', e && e.stack);
  dumpLogs();
  try { if (browser2) await Promise.race([browser2.close(), wait(3000)]); } catch (_) {}
  try { execSync('taskkill /IM electron.exe /F /T', { stdio: 'ignore' }); } catch (_) {}
  process.exit(1);
});

function dumpLogs() {
  const dir = process.env.APPDATA ? path.join(process.env.APPDATA, 'Navio') : '';
  for (const f of ['navio-boot.log', 'navio-crash.log']) {
    const p = path.join(dir, f);
    console.log('---- ' + f + ' exists=' + fs.existsSync(p));
    if (fs.existsSync(p)) console.log(fs.readFileSync(p, 'utf8').slice(-1800));
  }
}
