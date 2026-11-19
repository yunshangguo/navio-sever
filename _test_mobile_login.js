'use strict';
/**
 * 阶段 18：移动端（手机浏览器访问 Web 服务）必须能看到登录入口。
 *
 * 根因：登录条 #webBar（含登录/改密/退出按钮）位于侧栏底部 .side-foot 内，
 *       而 home.css 的 @media(max-width:820px) 把 .side-foot 整块 display:none，
 *       导致移动端看不到登录按钮。修复为移动端紧凑显示账号条。
 *
 * 源码级回归断言，覆盖：
 *  - DOM：登录按钮确实在侧栏底部账号条 #webBar 内
 *  - 逻辑：Web 模式标记 + initWebBar 按会话解锁登录/退出按钮（未改 JS）
 *  - 样式：移动断点不再隐藏 .side-foot，且账号条有紧凑可见样式
 *  - 样式：装饰信息（side-identity/side-stat）移动端隐藏以腾空间
 * 可对源码目录跑，也可对 asar 解包目录跑：node _test_mobile_login.js [rootDir]
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
};
const html = read(path.join('renderer', 'index.html'));
const css = read(path.join('renderer', 'home.css'));
const http = read(path.join('renderer', 'navio-http.js'));

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

console.log('root = ' + ROOT);

/* ---------- 1. DOM 结构：登录按钮在账号条内 ---------- */
ck('账号条 #webBar 存在且带 web-only 类',
  /id=["']webBar["'][^>]*class=["'][^"']*web-only|class=["'][^"']*web-only[^"']*["'][^>]*id=["']webBar["']/.test(html));
ck('登录按钮 #btnLogin 存在', /id=["']btnLogin["']/.test(html));
ck('退出按钮 #btnLogout 存在', /id=["']btnLogout["']/.test(html));
ck('修改密码按钮 #btnChangePw 存在', /id=["']btnChangePw["']/.test(html));
// webBar 区块内应包含登录按钮（截取 webBar 起始到 </div> 片段做宽松包含判断）
const webBarSeg = (html.match(/id=["']webBar["'][\s\S]{0,800}?<\/div>/) || [''])[0];
ck('登录按钮位于账号条 webBar 区块内',
  webBarSeg.includes('btnLogin') && webBarSeg.includes('btnLogout'));

/* ---------- 2. 逻辑：Web 模式标记与会话解锁（未改 JS，确保完好） ---------- */
ck('navio-http.js 标记 web-mode',
  /document\.documentElement\.classList\.add\(['"]web-mode['"]\)/.test(http));
ck('initWebBar 按会话决定登录按钮显隐',
  /btnLogin\.hidden\s*=\s*authed/.test(http));
ck('登录按钮跳转到 login.html',
  /location\.href\s*=\s*['"]\/login\.html/.test(http));

/* ---------- 3. 样式：移动端不再隐藏账号条 ---------- */
// 截取 max-width:820px 媒体查询块
const mqMatch = css.match(/@media\s*\(max-width:\s*820px\)\s*\{([\s\S]*?)\n\}/);
const mq = mqMatch ? mqMatch[1] : '';
ck('存在 max-width:820px 移动端断点', !!mqMatch);
// 关键回归：隐藏列表里不能再有 .side-foot
const hideLine = (mq.match(/\.side-brand-txt span[^;]*;/) || [''])[0];
ck('移动端隐藏列表不再包含 .side-foot',
  !!hideLine && !/\.side-foot/.test(hideLine), hideLine);
// 账号条底部区域在移动端有显示/紧凑样式
ck('移动端 .side-foot 有紧凑 padding（不再 display:none）',
  /\.side-foot\s*\{\s*padding:/.test(mq));
ck('移动端账号条 #webBar 有可见样式',
  /#webBar\s*\{[^}]*\}/.test(mq));
// 装饰信息隐藏以腾出空间
ck('移动端隐藏 side-identity / side-stat',
  /\.side-foot\s+\.side-identity,\s*\.side-foot\s+\.side-stat\s*\{[^}]*display:\s*none/.test(mq));
// 侧栏高度留足容纳账号条
ck('移动端侧栏 max-height 放宽以容纳账号条',
  /#sidebar[\s\S]{0,200}?max-height:\s*(1[89]\d|2\d\d)px/.test(mq));

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n结果: ${pass}/${results.length} 通过, ${fail} 失败`);
console.log('RESULT ' + JSON.stringify({ total: results.length, pass, fail }));
process.exit(fail ? 1 : 0);
