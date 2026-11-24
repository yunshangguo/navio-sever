'use strict';
/**
 * 阶段 19：移动端长按书签/分类弹出菜单（替代桌面右键 contextmenu）。
 *
 * 源码级回归断言，覆盖：
 *  - 菜单项构建已抽成共用函数 bookmarkCtxItems / groupCtxItems / blankCtxItems
 *  - contextmenu 与长按都复用 bookmarkCtxItems（功能一致）
 *  - 长按手势：touchstart 定时器、touchmove 超阈值取消、touchend/cancel 清理
 *  - 长按后抑制补发 click（时间戳方案，带超时自动失效）
 *  - #main 与 #sidebar 都绑定了长按
 *  - CSS 有粗指针/小屏下的菜单触摸目标放大
 * 可对源码目录跑，也可对 asar 解包目录跑：node _test_longpress.js [rootDir]
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
};
const app = read(path.join('renderer', 'app.js'));
const css = read(path.join('renderer', 'style.css'));

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

console.log('root = ' + ROOT);

/* ---------- 1. 菜单项共用函数 ---------- */
ck('书签菜单抽成 bookmarkCtxItems(b)',
  /function\s+bookmarkCtxItems\s*\(\s*b\s*\)/.test(app));
ck('分组菜单 groupCtxItems(g) 存在',
  /function\s+groupCtxItems\s*\(\s*g\s*\)/.test(app));
ck('空白菜单 blankCtxItems() 存在',
  /function\s+blankCtxItems\s*\(\s*\)/.test(app));
// contextmenu 分支调用共用函数
ck('右键卡片分支复用 bookmarkCtxItems',
  /showCtx\(e\.clientX,\s*e\.clientY,\s*bookmarkCtxItems\(b\)\)/.test(app));
ck('bookmarkCtxItems 含全套操作（打开/编辑/移动/尺寸/背景/刷新/删除）',
  ['open', 'edit', 'move', 'size', 'bg', 'refetch', 'del'].every((k) =>
    new RegExp("key:\\s*'" + k + "'").test(app)));

/* ---------- 2. 长按手势 ---------- */
ck('长按阈值常量 LONG_PRESS_MS 存在', /LONG_PRESS_MS\s*=\s*\d+/.test(app));
ck('移动容差常量 MOVE_TOL 存在', /MOVE_TOL\s*=\s*\d+/.test(app));
ck('bindLongPress 函数存在', /function\s+bindLongPress\s*\(/.test(app));
ck('绑定 touchstart 并启动定时器', /addEventListener\(['"]touchstart['"]/.test(app) && /setTimeout\(/.test(app));
ck('touchmove 超阈值取消', /addEventListener\(['"]touchmove['"]/.test(app) && /MOVE_TOL/.test(app));
ck('touchend 与 touchcancel 清理',
  /addEventListener\(['"]touchend['"]/.test(app) && /addEventListener\(['"]touchcancel['"]/.test(app));
ck('#main 绑定长按', /bindLongPress\(\$\('#main'\)/.test(app));
ck('#sidebar 绑定长按', /bindLongPress\(\$\('#sidebar'\)/.test(app));
ck('长按按目标元素分发对应菜单 openCtxAtTarget',
  /function\s+openCtxAtTarget\s*\(/.test(app));
ck('长按分发复用 bookmarkCtxItems',
  /openCtxAtTarget[\s\S]{0,900}bookmarkCtxItems\(b\)/.test(app));
ck('长按分发复用 groupCtxItems（分类/分组头）',
  /openCtxAtTarget[\s\S]{0,900}groupCtxItems\(g\)/.test(app));

/* ---------- 3. 抑制长按后的补发 click ---------- */
ck('时间戳抑制变量 suppressClickUntil 存在', /suppressClickUntil\s*=\s*0/.test(app));
ck('长按触发时设置抑制截止时间', /suppressClickUntil\s*=\s*Date\.now\(\)\s*\+/.test(app));
ck('#main click 检查并吞掉补发 click',
  /Date\.now\(\)\s*<\s*suppressClickUntil[\s\S]{0,120}stopPropagation\(\)/.test(app));
ck('document click 在抑制窗口内不关闭菜单（抬手后菜单保留可点）',
  /addEventListener\(['"]click['"]\s*,\s*\(\)\s*=>\s*\{\s*if\s*\(Date\.now\(\)\s*<\s*suppressClickUntil\)\s*return;\s*hideCtx\(\)/.test(app));
ck('菜单锁定 ctxLockUntil 存在且长按后设置',
  /ctxLockUntil\s*=\s*0/.test(app) && /ctxLockUntil\s*=\s*Date\.now\(\)\s*\+/.test(app));
ck('hideCtx 在锁定窗口内不关闭（force 除外）',
  /function\s+hideCtx\(force\)[\s\S]{0,120}if\s*\(!force\s*&&\s*Date\.now\(\)\s*<\s*ctxLockUntil\)\s*return/.test(app));
ck('菜单项点击用 force 强制关闭', /hideCtx\(true\)/.test(app));

/* ---------- 4. 触摸反馈 ---------- */
ck('长按触发震动反馈 navigator.vibrate', /navigator\.vibrate/.test(app));

/* ---------- 5. CSS 触摸目标放大 ---------- */
ck('CSS 有 pointer:coarse 粗指针媒体查询', /@media\s*\([^)]*pointer:\s*coarse/.test(css));
ck('移动端 .ctx-item 高度放大到 >=40px',
  /\.ctx-item\s*\{[^}]*height:\s*(4\d|[5-9]\d)px/.test(css));
ck('移动端 .ctx min-width 放大',
  /@media\s*\([^)]*coarse[^)]*\)[\s\S]{0,200}\.ctx\s*\{[^}]*min-width/.test(css));

/* ---------- 6. iOS Safari 原生长按冲突修复 ---------- */
ck('CSS 在 coarse 指针下禁用 -webkit-touch-callout（关键：苹果系统菜单）',
  /-webkit-touch-callout:\s*none/.test(css));
ck('CSS 对卡片/分类/分组头禁用 -webkit-user-select（防放大镜/选字）',
  /\.card[^{}]*\.side-item[\s\S]{0,400}-webkit-user-select:\s*none/.test(css) ||
  /-webkit-user-select:\s*none[\s\S]{0,400}\.side-item/.test(css));
ck('CSS 让图标 img 的 pointer-events:none（触摸落到卡片，防「存储图像」）',
  /\.card\s+\.ico\s+img[\s\S]{0,120}pointer-events:\s*none/.test(css));
ck('lastLongPressAt 时间戳变量存在', /lastLongPressAt\s*=\s*0/.test(app));
ck('contextmenu 长按去重守卫（吞掉 iOS 补发的 contextmenu）',
  /Date\.now\(\)\s*-\s*lastLongPressAt\s*<\s*\d+[\s\S]{0,40}e\.preventDefault\(\);\s*return/.test(app));
ck('长按触发时记录 lastLongPressAt',
  /lastLongPressAt\s*=\s*Date\.now\(\)/.test(app));
ck('长按触发时清除文本选择 removeAllRanges',
  /removeAllRanges\(\)/.test(app));

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n结果: ${pass}/${results.length} 通过, ${fail} 失败`);
console.log('RESULT ' + JSON.stringify({ total: results.length, pass, fail }));
process.exit(fail ? 1 : 0);
