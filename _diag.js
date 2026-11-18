'use strict';
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const drawer = q('#drawer');
    const body = q('#drawerBody');
    const rows = Array.from(document.querySelectorAll('#drawerBody .set-row'));
    return {
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      drawer: drawer ? { w: drawer.getBoundingClientRect().width, open: drawer.className } : null,
      bodyW: body ? body.clientWidth : null,
      bodyScrollW: body ? body.scrollWidth : null,
      widest: rows
        .map((r) => ({ w: r.scrollWidth, cw: r.clientWidth, txt: r.querySelector('.t') ? r.querySelector('.t').textContent : '' }))
        .filter((r) => r.w > r.cw)
        .slice(0, 5),
      maskHidden: q('#drawerMask') ? q('#drawerMask').className : 'none',
      wall: q('#wall') ? getComputedStyle(q('#wall')).backgroundImage.slice(0, 80) : 'none'
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
