'use strict';
// 探测浅色主题下正文文字与背景对比度
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost';
const { chromium } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/AI使用/NavioServer/win-unpacked/Navio.exe';
const PORT = 9334;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function cdpUp() {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/json/version', timeout: 1200 }, (r) => res(r.statusCode === 200));
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NAVIO_DEBUG_PORT = String(PORT);
  env.NAVIO_GPU = 'off';
  const child = spawn(EXE, [], { env, stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 40; i++) { if (await cdpUp()) break; await wait(500); }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const page = browser.contexts()[0].pages()[0];
  await wait(1200);
  await page.evaluate(() => {
    const btn = document.querySelector('#btnSettings');
    if (btn) btn.click();
  });
  await wait(400);
  await page.click('#drawer [data-v="light"]');
  await wait(2500);
  const probe = await page.evaluate(() => {
    const g = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of props) o[p] = cs[p];
      o.text = el.textContent.trim().slice(0, 20);
      return o;
    };
    return {
      theme: document.documentElement.dataset.theme,
      wall: g('#wall', ['backgroundImage', 'backgroundColor', 'opacity', 'filter']),
      dim: g('#wall-dim', ['backgroundColor', 'opacity']),
      sections: g('#sections', ['opacity', 'filter']),
      secTitle: g('#sections .sec-title, #sections h3, #sections .ghead', ['color', 'opacity']),
      cardName: g('#sections .card .name', ['color', 'opacity']),
      tab: g('#groupTabs .tab', ['color', 'backgroundColor']),
      innerHTMLHead: (document.querySelector('#sections') || {}).innerHTML ? document.querySelector('#sections').innerHTML.slice(0, 260) : ''
    };
  });
  console.log(JSON.stringify(probe, null, 1));
  await page.screenshot({ path: path.join(__dirname, '_shot-light-settled.png') });
  await browser.close();
  await wait(300);
  try { execSync('taskkill /IM Navio.exe /F /T', { stdio: 'ignore' }); } catch (_) {}
  process.exit(0);
})().catch((e) => {
  console.log('ERR', e.message);
  try { execSync('taskkill /IM Navio.exe /F /T', { stdio: 'ignore' }); } catch (_) {}
  process.exit(1);
});
