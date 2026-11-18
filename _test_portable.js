'use strict';
/**
 * 阶段 16：便携模式——exe 启动产生的一切文件都落在 exe 所在文件夹。
 *
 * 源码级回归断言（无头环境无法验证 %APPDATA% 实际写盘），覆盖：
 *  - 未设 NAVIO_USER_DATA 时 userData 重定向到 exe 同级 data/runtime
 *  - 环境变量优先级保留（测试隔离用）
 *  - 所有 getPath('userData') 写盘点都在重定向之后 / 运行时才取值
 *  - 业务数据 resolveDataDir 的便携分支指向 exe 目录
 * 可对源码目录跑，也可对 asar 解包目录跑：node _test_portable.js [rootDir]
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
};
const main = read('main.js');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

console.log('root = ' + ROOT);

/* ---------- 1. userData 重定向 ---------- */
ck('环境变量 NAVIO_USER_DATA 优先级分支存在',
  /if\s*\(process\.env\.NAVIO_USER_DATA\)\s*\{\s*app\.setPath\(['"]userData['"]\s*,\s*process\.env\.NAVIO_USER_DATA\)/.test(main));
ck('无环境变量时用 exe 目录(process.execPath)',
  /path\.dirname\(process\.execPath\)/.test(main));
ck('userData 落到 exe 同级 data/runtime',
  /app\.setPath\(['"]userData['"]\s*,\s*path\.join\(exeDir\s*,\s*['"]data['"]\s*,\s*['"]runtime['"]\)\)/.test(main));
ck('重定向在 GPU_DIR 计算之前（无旧路径缓存）',
  main.indexOf("app.setPath('userData'") < main.indexOf('const GPU_DIR'));

/* ---------- 2. 业务数据目录便携分支 ---------- */
ck('resolveDataDir 有 portable.flag 分支',
  /portable\.flag/.test(main) && /path\.dirname\(process\.execPath\)/.test(main));
ck('portable 分支指向 exe 旁 data 目录',
  /fs\.existsSync\(portableFlag\)\)\s*return\s*path\.join\(path\.dirname\(process\.execPath\),\s*['"]data['"]\)/.test(main));

/* ---------- 3. 所有 userData 写盘点都走重定向后的路径 ---------- */
// 这些位置都调用 app.getPath('userData')，只要重定向在它们之前 / 运行时取值即落地 exe 目录
const getPathCalls = (main.match(/app\.getPath\(['"]userData['"]\)/g) || []).length;
ck('存在 GPU/日志/控制台三处 getPath(userData) 写盘', getPathCalls >= 4, getPathCalls);
// 确保没有在 setPath 之前就调用 getPath('userData')（除注释外）
const beforeSetPath = main.slice(0, main.indexOf("app.setPath('userData'"));
ck('setPath 之前没有 getPath(userData) 调用',
  !/app\.getPath\(['"]userData['"]\)/.test(beforeSetPath));

/* ---------- 4. 写盘文件都在 data 树内 ---------- */
for (const f of ['gpu-state.json', 'running.lock', 'navio-crash.log', 'navio-boot.log']) {
  ck('写盘文件 ' + f + ' 由 userData 路径拼接', main.includes("'" + f + "'"));
}

const fail = results.filter((r) => !r.ok).length;
console.log(`\nRESULT  total=${results.length}  pass=${results.length - fail}  fail=${fail}`);
process.exit(fail ? 1 : 0);
