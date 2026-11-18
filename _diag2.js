'use strict';
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForTimeout(800);

  await page.click('#btnSettings').catch((e) => console.log('click settings failed:', e.message));
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const r = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const seg = document.querySelector('[data-seg="theme"]');
    const btns = seg ? Array.from(seg.querySelectorAll('button')).map((b) => {
      const x = b.getBoundingClientRect();
      return { t: b.textContent, x: Math.round(x.x), w: Math.round(x.width), right: Math.round(x.right) };
    }) : [];
    return {
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      drawer: r('#drawer'),
      drawerBody: r('#drawerBody'),
      seg: r('[data-seg="theme"]'),
      btns,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'shots/07-drawer.png' });
  await browser.close();
})();
