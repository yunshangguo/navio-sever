'use strict';
/**
 * 阶段 17：自动抓取网站名称（不是网址域名）。
 * 纯 Node：验证标题解析逻辑 + 接口/前端接线；不起 Electron。
 * 用法：node _test_title.js [rootDir]
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const { parseTitleFromHtml, decodeEntities } = require(path.join(ROOT, 'src/favicon'));

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

/* ---------- 1. 标题解析 ---------- */
ck('解析标准 <title>', parseTitleFromHtml('<html><head><title>示例站点 - 首页</title></head></html>') === '示例站点 - 首页');
ck('<title> 优先于 og:title',
  parseTitleFromHtml('<meta property="og:title" content="OG标题"><title>页面标题</title>') === '页面标题');
ck('无 <title> 时用 og:title',
  parseTitleFromHtml('<meta property="og:title" content="OG站点名">') === 'OG站点名');
ck('og:title 属性顺序颠倒也能解析',
  parseTitleFromHtml('<meta content="OG名" property="og:title">') === 'OG名');
ck('twitter:title 兜底',
  parseTitleFromHtml('<meta name="twitter:title" content="推特名">') === '推特名');
ck('HTML 实体解码', parseTitleFromHtml('<title>百度一下&#xff0c;你就知道 &amp; 更多</title>') === '百度一下，你就知道 & 更多');
ck('压缩空白与 trim', parseTitleFromHtml('<title>\n  空格  很多  \n</title>') === '空格 很多');
ck('去 title 内嵌标签', parseTitleFromHtml('<title>新闻 <b>快报</b></title>') === '新闻 快报');
ck('空 HTML 返回空串', parseTitleFromHtml('<html></html>') === '');
ck('超长标题截断到 120', parseTitleFromHtml('<title>' + 'x'.repeat(300) + '</title>').length === 120);
ck('decodeEntities 数字实体', decodeEntities('&#65;&#x42;') === 'AB');

/* ---------- 2. 后端接口接线 ---------- */
const server = read('src/server.js');
ck('后端注册 /api/title 接口', /pathname === '\/api\/title'/.test(server));
ck('/api/title 调用 icons.fetchTitle', /this\.icons\.fetchTitle\(raw\)/.test(server));
ck('/api/title 加入游客白名单', /['"]\/api\/title['"]/.test(server));
ck('favicon.js 实现 fetchTitle 方法', /async fetchTitle\(rawUrl\)/.test(read('src/favicon.js')));

/* ---------- 3. 前端接线 ---------- */
const http = read('renderer/navio-http.js');
const app = read('renderer/app.js');
ck('navio-http 暴露 fetchTitle', /fetchTitle:\s*async/.test(http) && /call\('\/title'/.test(http));
ck('添加书签 blur 调 API.fetchTitle', /API\.fetchTitle\(url\)/.test(app));
ck('抓取失败/空时保留域名兜底', /\$t\.value = host/.test(app));
ck('有竞态序号防串改', /titleFetchSeq/.test(app) && /seq !== titleFetchSeq/.test(app));
ck('用户已填名称则不覆盖', /\$t\.value\.trim\(\)\) return/.test(app));

const fail = results.filter((r) => !r.ok).length;
console.log(`\nRESULT  total=${results.length}  pass=${results.length - fail}  fail=${fail}`);
process.exit(fail ? 1 : 0);
