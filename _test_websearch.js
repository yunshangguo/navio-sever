'use strict';
/* 搜索框纯网络搜索专项测试：源码断言 + 提取函数体做行为级验证 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.resolve(__dirname);
let pass = 0;
let fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
  const m = app.match(re);
  return m ? m[0] : '';
}
function bodyOf(src, sig) {
  return src.replace(sig, '').replace(/\n  \}\s*$/, '');
}

console.log('=== 搜索框纯网络搜索测试 ===');

const runSrc = extractFn('runSearch');
const subSrc = extractFn('submitSearch');
ck('runSearch 函数存在', !!runSrc);
ck('submitSearch 函数存在', !!subSrc);

/* ---- 源码断言：不再搜索书签、输入时不碰页面 ---- */
ck('runSearch 不再遍历 S.bookmarks', !!runSrc && !/S\.bookmarks/.test(runSrc));
ck('runSearch 不操作 DOM', !!runSrc && !/classList|innerHTML|\$|#sections|#searchResults/.test(runSrc));
ck('runSearch 只记录 UI.q', !!runSrc && /UI\.q\s*=\s*q/.test(runSrc));
ck('全局无 searchHits 残留', !/\bsearchHits\b/.test(app));
ck('无结果面板点击监听', !/\[data-web\]/.test(app));
ck('submitSearch 不再打开书签', !!subSrc && !/openBookmark\(/.test(subSrc));
ck('submitSearch 走引擎 URL', !!subSrc && /engineUrl\(S\.settings\.searchEngine\)\s*\+\s*encodeURIComponent\(q\)/.test(subSrc));
ck('submitSearch 保留网址直达', !!subSrc && /looksLikeUrl\(q\)/.test(subSrc) && /normalizeUrl\(q\)/.test(subSrc));
ck('同步刷新保留搜索态', /if \(UI\.q\) runSearch\(UI\.q, false\)/.test(app));
ck('placeholder 指向联网搜索', /placeholder="输入关键词联网搜索/.test(html));
ck('placeholder 不再提示搜索书签', !/placeholder="搜索书签/.test(html));

/* ---- 行为级：submitSearch ---- */
function runSubmit(q) {
  const opened = [];
  const fn = new Function(
    '$', 'S', 'engineUrl', 'openUrl', 'looksLikeUrl', 'normalizeUrl', 'encodeURIComponent',
    bodyOf(subSrc, 'function submitSearch() {')
  );
  fn(
    () => ({ value: q }),
    { settings: { searchEngine: 'bing' } },
    () => 'https://www.bing.com/search?q=',
    (u) => opened.push(u),
    (s) => /^https?:\/\/\S+$/i.test(String(s || '')),
    (u) => String(u || ''),
    encodeURIComponent
  );
  return opened;
}
const kwOpened = runSubmit('hello world');
ck('关键词回车 → 用选中引擎搜索', kwOpened.length === 1 && kwOpened[0] === 'https://www.bing.com/search?q=hello%20world');
const urlOpened = runSubmit('https://example.com/path');
ck('网址回车 → 直接访问', urlOpened.length === 1 && urlOpened[0] === 'https://example.com/path');
ck('网址不会被当成关键词搜', !String(urlOpened[0] || '').includes('bing.com/search'));
const emptyOpened = runSubmit('   ');
ck('空输入不触发任何跳转', emptyOpened.length === 0);

/* ---- 行为级：runSearch 输入时不碰页面 ---- */
function runSearchUI(q) {
  const UI = {};
  let domTouched = false;
  const $ = () => { domTouched = true; return {}; };
  const fn = new Function('$', 'UI', 'S', 'q', 'focus', bodyOf(runSrc, 'function runSearch(q, focus = true) {'));
  fn($, UI, { settings: { searchEngine: 'bing' } }, q, false);
  return { UI, domTouched };
}
const r1 = runSearchUI('hello');
ck('输入关键词 → 只记录搜索词', r1.UI.q === 'hello');
ck('输入关键词 → 完全不碰 DOM', r1.domTouched === false);
const r2 = runSearchUI('');
ck('清空 → UI.q 归零且不碰 DOM', r2.UI.q === '' && r2.domTouched === false);
const r3 = runSearchUI('https://example.com');
ck('网址输入 → 同样不碰 DOM', r3.UI.q === 'https://example.com' && r3.domTouched === false);

console.log('\n结果: ' + pass + '/' + (pass + fail) + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
