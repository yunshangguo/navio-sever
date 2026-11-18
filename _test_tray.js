'use strict';
/**
 * 阶段 14：桌面托盘常驻 + 右键「设置 / 退出」+ 开机自启 + 关窗隐藏到托盘。
 *
 * Windows 托盘无法在无头环境真实渲染，这里做「源码级」回归断言：
 * 覆盖主进程、preload 桥、控制台渲染层三处关键实现，确保任一侧改动都不会
 * 让这四项能力悄悄失效。可对源码目录跑，也可对 asar 解包后的目录跑：
 *   node _test_tray.js [rootDir]     默认 __dirname（源码根）
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || __dirname;
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
};

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const main = read('main.js');
const preload = read('preload.js');
const consoleJs = read('renderer/console.js');
const config = read('src/config.js');

console.log('root = ' + ROOT);

/* ---------- 1. 开机自启 ---------- */
ck('config 有 autoLaunch 默认项', /autoLaunch:\s*false/.test(config));
ck('主进程实现 setLoginItemSettings(openAtLogin)',
  /setLoginItemSettings\(\{[^}]*openAtLogin/.test(main));
ck('主进程注册 admin:autolaunch IPC', /ipcMain\.handle\(['"]admin:autolaunch['"]/.test(main));
ck('preload 暴露 autoLaunch 给渲染层', /autoLaunch:\s*\(on\)/.test(preload));
ck('控制台有开机自启开关(data-act=autolaunch)', /data-act="autolaunch"/.test(consoleJs));
ck('控制台点击调用 API.autoLaunch', /API\.autoLaunch\(/.test(consoleJs));

/* ---------- 2. 托盘常驻 + 关窗隐藏 ---------- */
ck('主进程创建系统托盘 Tray', /new Tray\(/.test(main));
ck('托盘设置右键菜单 setContextMenu', /tray\.setContextMenu\(menu\)/.test(main));
ck('托盘双击恢复窗口', /tray\.on\(['"]double-click['"]/.test(main));
ck('关闭所有窗口不退出进程', /app\.on\(['"]window-all-closed['"]\s*,\s*\(\)\s*=>\s*\{\s*\}/.test(main));
ck('关窗拦截 preventDefault + win.hide（隐藏到托盘）',
  /win\.on\(['"]close['"]/.test(main) && /e\.preventDefault\(\)/.test(main) && /win\.hide\(\)/.test(main));
ck('退出走 quitting 标志真正 app.quit', /quitting\s*=\s*true;\s*app\.quit\(\)/.test(main));

/* ---------- 3. 托盘右键「设置」与「退出」 ---------- */
ck('托盘菜单含「设置…」入口', /label:\s*['"]设置…['"]/.test(main));
ck('托盘设置入口调用 showWindow(service)', /showWindow\(['"]service['"]\)/.test(main));
ck('托盘菜单含「退出（停止服务）」', /label:\s*['"]退出（停止服务）['"]/.test(main));
ck('showWindow 支持 tab 参数', /function showWindow\(tab\)/.test(main));
ck('主进程通过 IPC 推送导航', /webContents\.send\(['"]navio:navigate['"]/.test(main));

/* ---------- 4. 导航桥与控制台接页 ---------- */
ck('preload 监听 navio:navigate 并缓存', /ipcRenderer\.on\(['"]navio:navigate['"]/.test(preload));
ck('preload 暴露 onNavigate', /onNavigate:\s*\(cb\)/.test(preload));
ck('控制台注册 onNavigate 并切页 load(tab)',
  /API\.onNavigate\(/.test(consoleJs) && /load\(tab\)/.test(consoleJs));
ck('控制台服务与端口页存在(data-tab=service)',
  /data-tab="service"/.test(read('renderer/console.html')));

/* ---------- 汇总 ---------- */
const pass = results.filter((r) => r.ok).length;
console.log(`\nRESULT ${pass}/${results.length} PASS`);
process.exit(pass === results.length ? 0 : 1);
