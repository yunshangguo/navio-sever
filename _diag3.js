'use strict';
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

  await page.evaluate(() => {
    document.querySelector('#drawer')?.classList.remove('open');
    document.querySelector('#drawerMask')?.classList.add('hidden');
    document.querySelector('#modalRoot')?.replaceChildren();
  });
  await page.waitForTimeout(300);

  const state = async (tag) =>
    console.log(tag, await page.evaluate(() => ({
      modals: document.querySelectorAll('.modal').length,
      fUrl: !!document.querySelector('#fUrl'),
      fTitle: !!document.querySelector('#fTitle'),
      urlVal: document.querySelector('#fUrl') ? document.querySelector('#fUrl').value : null,
      titleVal: document.querySelector('#fTitle') ? document.querySelector('#fTitle').value : null,
      maskCount: document.querySelectorAll('.mask').length
    })));

  await page.click('#btnAdd');
  await state('after-open ');
  await page.fill('#fUrl', 'example.com');
  await state('after-fill ');
  await page.dispatchEvent('#fUrl', 'blur');
  await page.waitForTimeout(400);
  await state('after-blur ');
  await page.screenshot({ path: 'shots/08-add-diag.png' });
  await browser.close();
})();
