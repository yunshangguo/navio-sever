'use strict';
const PW = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core';
const { chromium } = require(PW);

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = b.contexts()[0].pages()[0];
  await p.evaluate(() => {
    document.querySelector('#drawer')?.classList.remove('open');
    document.querySelector('#drawerMask')?.classList.add('hidden');
    document.querySelector('#modalRoot')?.replaceChildren();
    document.querySelector('#groupTabs [data-tab="all"]').click();
  });
  await p.waitForTimeout(500);

  await p.evaluate(() => {
    window.__drag = { start: 0, over: 0, drop: 0, target: '', ids: [] };
    document.addEventListener('dragstart', (e) => {
      window.__drag.start++;
      window.__drag.src = e.target.closest('.card') ? e.target.closest('.card').dataset.id : 'nocard';
    }, true);
    document.addEventListener('dragover', () => { window.__drag.over++; }, true);
    document.addEventListener('drop', (e) => {
      window.__drag.drop++;
      const c = e.target.closest ? e.target.closest('.card') : null;
      window.__drag.target = c ? c.dataset.id : 'nocard';
    }, true);
  });

  const before = await p.evaluate(() => Array.from(document.querySelectorAll('#sections .group:first-child .card[data-id]')).map((c) => c.dataset.id));
  const loc = p.locator('#sections .group:first-child .card[data-id]');
  console.log('cards:', await loc.count());
  await loc.nth(0).dragTo(loc.nth(2), { timeout: 15000 }).catch((e) => console.log('dragTo err:', e.message.split('\n')[0]));
  await p.waitForTimeout(1000);

  const after = await p.evaluate(() => Array.from(document.querySelectorAll('#sections .group:first-child .card[data-id]')).map((c) => c.dataset.id));
  const stats = await p.evaluate(() => window.__drag);
  console.log('events:', JSON.stringify(stats));
  console.log('before:', before.join(','));
  console.log('after :', after.join(','));
  console.log('changed:', before.join(',') !== after.join(','));
  await b.close();
})();
