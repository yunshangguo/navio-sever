'use strict';
/**
 * 一键重建 Navio Server v2 免安装交付包（幂等，零 C 盘依赖）
 *
 *   node tools/build-portable.js [交付根目录，默认 C:/AI使用/NavioServer]
 *
 * 为什么不用 electron-builder：本机 C: 长期 0 字节空闲，
 * NSIS 需要在 C: 建 mmap（Internal compiler error #12345），
 * 且复制流水线会直接卡死。这里只做「Electron 运行时 + app.asar + 文档 + zip」。
 *
 * 可重复执行：目标目录已有 Navio.exe 时只重建 app.asar 和 zip，秒级完成。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DELIV = process.argv[2] || 'C:/AI使用/NavioServer';
const OUT = path.join(DELIV, 'win-unpacked');
const ASAR = path.join(OUT, 'resources', 'app.asar');
const EXE = path.join(OUT, 'Navio.exe');
const ZIP = path.join(DELIV, 'Navio-2.0.0-win-x64.zip');
const NODE = process.execPath;
const SEVENZIP = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
env.TEMP = 'C:/AI使用/navio-tmp';
env.TMP = 'C:/AI使用/navio-tmp';

function log(s) { console.log(s); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
/** fs.cpSync 在本机会异常终止进程，必须逐文件复制 */
function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) copyTree(path.join(src, n), path.join(dst, n));
  } else fs.copyFileSync(src, dst);
}
function run(exe, args, opt) {
  return spawnSync(exe, args, Object.assign({ encoding: 'utf8', env, timeout: 600000 }, opt || {}));
}

// ---- 1. Electron 运行时（幂等） ----
log('[1/5] 检查 Electron 运行时');
if (!fs.existsSync(EXE)) {
  const candidates = ['D:/electron-dist', path.join(ROOT, 'node_modules', 'electron', 'dist')];
  const ELECTRON = candidates.find((d) => fs.existsSync(path.join(d, 'electron.exe')));
  if (!ELECTRON) throw new Error('找不到 Electron 运行时：' + candidates.join(' / '));
  log('      源: ' + ELECTRON);
  fs.mkdirSync(OUT, { recursive: true });
  copyTree(ELECTRON, OUT);
  const srcExe = path.join(OUT, 'electron.exe');
  if (fs.existsSync(srcExe)) { rmrf(EXE); fs.renameSync(srcExe, EXE); }
  rmrf(path.join(OUT, 'resources', 'default_app.asar'));
  fs.writeFileSync(path.join(OUT, 'portable.flag'), '', 'utf8');
  log('      已复制到 ' + OUT);
} else {
  log('      已存在，跳过复制: ' + EXE);
}

// ---- 2. 从源码重建 app.asar ----
log('[2/5] 重建 app.asar');
const r1 = run(NODE, [path.join(ROOT, 'tools', 'pack-asar.js'), ASAR], { cwd: ROOT });
if (r1.status !== 0) throw new Error('app.asar 构建失败:\n' + (r1.stdout || '') + (r1.stderr || ''));
log('      ' + (r1.stdout || '').trim().split('\n').pop());
log('      ' + fs.statSync(ASAR).size + ' bytes');

// ---- 3. 文档 ----
log('[3/5] 同步文档');
const readme = path.join(ROOT, 'README.md');
if (fs.existsSync(readme)) {
  fs.mkdirSync(DELIV, { recursive: true });
  fs.copyFileSync(readme, path.join(DELIV, 'README.md'));
  fs.copyFileSync(readme, path.join(OUT, 'README.md'));
  log('      README.md -> ' + DELIV + ' / win-unpacked');
} else log('      跳过（项目根无 README.md）');

// ---- 4. 截图（可选） ----
const shotsDir = path.join(DELIV, 'shots');
if (fs.existsSync('C:/AI使用/navio-tmp')) {
  fs.mkdirSync(shotsDir, { recursive: true });
  let n = 0;
  for (const name of ['shot-console.png', 'shot-console-icons.png', 'shot-web.png', 'shot-web-light.png',
      'shot-widgets-dark.png', 'shot-widgets-light.png',
      'shot-home-dark.png', 'shot-home-light.png',
      'shot-engine-menu.png', 'shot-web-search.png', 'shot-live-home.png',
      'shot-icon-clean.png', 'shot-engine-menu-fixed.png',
      'shot-real-icons.png', 'shot-real-icons-full.png',
      'shot-icons-clean.png', 'shot-norm-preview.png']) {
    const s = 'C:/AI使用/navio-tmp/' + name;
    if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(shotsDir, name)); n++; }
  }
  log('[4/5] 截图 ' + n + ' 张');
} else log('[4/5] 截图 0 张');

// ---- 5. 打 zip ----
// 交付包绝不能带上宿主机的 data/：里面有 users.json 密码哈希、sessions.json 会话、
// INITIAL_ADMIN.txt 初始密码、用户书签与个人快照。别人解压后应是干净安装。
log('[5/5] 生成 zip（排除 data 用户数据）');
// 与 pack-asar.js 同理：不依赖「先删旧 zip」（本机 safe-delete shim 可能拦截），
// 生成到唯一临时文件，再用 copyFileSync 覆盖写目标。
const ZIP_TMP = ZIP + '.tmp-' + process.pid;
rmrf(ZIP_TMP);
let z = null;
if (fs.existsSync(SEVENZIP)) {
  z = run(SEVENZIP, ['a', '-tzip', ZIP_TMP, '*', '-r', '-mx=5', '-y', '-xr!data', '-xr!data\\*'],
    { cwd: OUT, maxBuffer: 64 * 1024 * 1024 });
}
if (!z || z.status !== 0) {
  log('      7za 不可用或失败，回退 PowerShell Compress-Archive（同样排除 data）');
  z = run('powershell', ['-NoProfile', '-Command',
    "$src = '" + OUT.replace(/\//g, '\\') + "'; $dst = '" + ZIP_TMP.replace(/\//g, '\\') + "'; " +
    "$items = @(Get-ChildItem -LiteralPath $src | Where-Object { $_.Name -ne 'data' } | ForEach-Object { $_.FullName }); " +
    "Compress-Archive -Path $items -DestinationPath $dst -CompressionLevel Optimal -Force"], { cwd: OUT });
}
if (z.status !== 0) throw new Error('zip 生成失败:\n' + (z.stdout || '') + (z.stderr || ''));
if (!fs.existsSync(ZIP_TMP)) throw new Error('zip 未生成: ' + ZIP_TMP);
// 原子移动覆盖，避免留下 100MB+ 的 staging 文件
try { fs.renameSync(ZIP_TMP, ZIP); }
catch (_) { fs.copyFileSync(ZIP_TMP, ZIP); rmrf(ZIP_TMP); }

log('');
log('BUILD_OK');
log('  程序   ' + EXE);
log('  压缩包 ' + ZIP + '  (' + (fs.statSync(ZIP).size / 1024 / 1024).toFixed(1) + ' MB)');
log('  文档   ' + path.join(DELIV, 'README.md'));
