'use strict';
/**
 * 打包产物验收：直接启动 C:/AI使用/NavioServer/win-unpacked/Navio.exe（真实 exe、真实 asar），
 * 走 CDP 断言 UI 是否可用，并截图。
 * 用法：node _verify_packaged.js [exe路径]
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';

const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const EXE = process.argv[2] || 'C:/AI使用/NavioServer/win-unpacked/Navio.exe';
const PORT = 9333;
const SHOT = path.join(__dirname, '_shot-packaged.png');
const SHOT2 = path.join(__dirname, '_shot-packaged-light.png');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

function cdpUp() {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/json/version', timeout: 1500 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(r.statusCode === 200));
    });
    req.on('error', () => res(false));
    req.on('timeout', () => {
      req.destroy();
      res(false);
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(EXE)) throw new Error('找不到 exe: ' + EXE);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NAVIO_DEBUG_PORT = String(PORT);
  env.NAVIO_GPU = 'off';

  const child = spawn(EXE, [], { env, stdio: 'ignore', detached: true });
  child.unref();
  console.log('启动:', EXE, 'pid', child.pid);

  let up = false;
  for (let i = 0; i < 40; i++) {
    if (await cdpUp()) {
      up = true;
      break;
    }
    await wait(500);
  }
  ck('打包 exe 启动并开放调试端口', up);
  if (!up) {
    dumpLogs();
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await wait(1500);

  const info = await page.evaluate(() => ({
    title: document.title,
    cards: document.querySelectorAll('#sections .card[data-id]').length,
    tabs: document.querySelectorAll('#groupTabs .tab[data-tab]').length,
    wall: getComputedStyle(document.querySelector('#wall')).backgroundImage.length,
    theme: document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'),
    ua: navigator.userAgent
  }));

  ck('页面标题正确', /Navio/i.test(info.title), info.title);
  ck('UA 带产品名（说明是打包 app 不是裸 Electron）', /Navio/i.test(info.ua), info.ua.slice(-40));
  ck('分组标签渲染', info.tabs >= 3, info.tabs);
  ck('书签卡片渲染（示例数据）', info.cards >= 8, info.cards);
  ck('壁纸已应用', info.wall > 100, info.wall);
  await page.screenshot({ path: SHOT });

  // 搜索
  await page.fill('#searchInput', 'github');
  await wait(500);
  const searchState = await page.evaluate(() => ({
    visible: document.querySelector('#searchResults') ? getComputedStyle(document.querySelector('#searchResults')).display : 'none',
    hits: document.querySelectorAll('#searchResults .card[data-id]').length
  }));
  ck('搜索命中结果', searchState.hits >= 1, searchState);
  await page.fill('#searchInput', '');
  await wait(400);

  // 设置抽屉 + 浅色主题
  await page.click('#btnSettings');
  await wait(500);
  const drawerOpen = await page.evaluate(() => {
    const d = document.querySelector('#drawer');
    return !!d && d.classList.contains('open') && d.getBoundingClientRect().width > 200;
  });
  ck('设置抽屉可打开', drawerOpen);
  await page.click('#drawer [data-v="light"]');
  await wait(700);
  const light = await page.evaluate(
    () => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme')
  );
  ck('切换到浅色主题', light === 'light', light);
  await page.screenshot({ path: SHOT2 });
  await page.click('#drawer [data-v="dark"]');
  await wait(500);
  await page.click('#btnCloseDrawer');
  await wait(300);

  // 数据落盘
  const dataDir = path.join(process.env.APPDATA, 'Navio', 'navio-data');
  const dataFile = path.join(dataDir, 'data.json');
  ck('data.json 已落盘（文件存储而非数据库）', fs.existsSync(dataFile), dataFile);
  if (fs.existsSync(dataFile)) {
    const st = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    ck('JSON 结构完整', st.version === 1 && Array.isArray(st.groups) && Array.isArray(st.bookmarks), {
      groups: st.groups.length,
      bookmarks: st.bookmarks.length,
      seeded: st.seeded
    });
  }

  ck('无 JS 运行错误', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  await wait(500);
  try {
    execSync('taskkill /IM Navio.exe /F /T', { stdio: 'ignore' });
  } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果: ${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(async (e) => {
  console.log('ERR', e && e.message);
  try {
    execSync('taskkill /IM Navio.exe /F /T', { stdio: 'ignore' });
  } catch (_) {}
  process.exit(1);
});

function dumpLogs() {
  const dir = path.join(process.env.APPDATA, 'Navio');
  for (const f of ['navio-boot.log', 'navio-crash.log']) {
    const p = path.join(dir, f);
    console.log('---- ' + f + ' exists=' + fs.existsSync(p));
    if (fs.existsSync(p)) console.log(fs.readFileSync(p, 'utf8').slice(-1500));
  }
}
