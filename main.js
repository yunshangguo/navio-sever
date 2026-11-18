'use strict';
/**
 * Navio Server —— Electron 主进程（服务端宿主）
 *
 * 运行形态：
 *  - 进程内启动 HTTP(S) 服务（src/server.js），监听 0.0.0.0:9200，供浏览器/手机远程访问
 *  - 桌面窗口只显示「服务端控制台」（renderer/console.html），不再显示书签界面
 *  - 关窗 = 隐藏到托盘，服务继续运行；托盘「退出」才真正停止服务
 *  - 数据仍是单个 JSON 文件，账号/会话另各一个 JSON，全部落在宿主机磁盘
 *
 * 管理接口只走本地 IPC（preload.js），不通过 HTTP 暴露。
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  net,
  shell,
  dialog,
  Tray,
  Menu,
  nativeImage,
  clipboard
} = require('electron');
const fs = require('fs');
const path = require('path');

const { Store, normalize, defaultState } = require('./src/store');
const { IconCache } = require('./src/favicon');
const { ServerConfig } = require('./src/config');
const { Auth, ipAllowed } = require('./src/auth');
const { NavioServer } = require('./src/server');
const presetIcons = require('./src/preset-icons');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const VERSION = '2.0.0';

/* ==================== 调试端口 / userData ==================== */
if (process.env.NAVIO_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', String(process.env.NAVIO_DEBUG_PORT));
if (process.env.NAVIO_USER_DATA) app.setPath('userData', process.env.NAVIO_USER_DATA);

/* ==================== 单实例 ==================== */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

/* ==================== GPU 崩溃自愈 ==================== */
// 无 GPU 环境（虚拟机/远程桌面/驱动异常）时 Electron 会 FATAL 杀掉整个进程，表现为"双击没反应"。
// 启动时留运行哨兵，正常退出删除；下次启动发现残留即自动切软件渲染并持久化。
const GPU_DIR = (() => {
  try {
    const d = app.getPath('userData');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  } catch (_) {
    return null;
  }
})();
const GPU_STATE_FILE = GPU_DIR ? path.join(GPU_DIR, 'gpu-state.json') : null;
const RUN_LOCK = GPU_DIR ? path.join(GPU_DIR, 'running.lock') : null;
function readGpuState() {
  try {
    return JSON.parse(fs.readFileSync(GPU_STATE_FILE, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}
function writeGpuState(s) {
  try {
    if (GPU_STATE_FILE) fs.writeFileSync(GPU_STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
  } catch (_) {}
}
const gpuState = readGpuState();
const prevUnclean = RUN_LOCK ? fs.existsSync(RUN_LOCK) : false;
const gpuEnv = String(process.env.NAVIO_GPU || '').toLowerCase();
let softwareRender = false;
if (gpuEnv === 'on') {
  softwareRender = false;
  if (gpuState.software) {
    gpuState.software = false;
    gpuState.crashes = 0;
    writeGpuState(gpuState);
  }
} else if (gpuEnv === 'off' || process.env.NAVIO_NO_GPU === '1') {
  softwareRender = true;
} else {
  softwareRender = !!gpuState.software || prevUnclean;
}
function applySoftwareRendering() {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.disableHardwareAcceleration();
}
if (softwareRender) applySoftwareRendering();
if (prevUnclean) {
  gpuState.crashes = (gpuState.crashes || 0) + 1;
  if (softwareRender) gpuState.software = true;
  writeGpuState(gpuState);
}
try {
  if (RUN_LOCK) fs.writeFileSync(RUN_LOCK, String(process.pid), 'utf8');
} catch (_) {}

/* ==================== 日志 ==================== */
function crashLog(where, err) {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${where}: ${err && err.stack ? err.stack : err}\n`;
    fs.appendFileSync(path.join(dir, 'navio-crash.log'), line, 'utf8');
  } catch (_) {}
}
function slog(msg) {
  try {
    const dir = app.getPath('userData');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'navio-boot.log');
    try {
      if (fs.statSync(file).size > 64 * 1024) fs.writeFileSync(file, '', 'utf8');
    } catch (_) {}
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch (_) {}
}
process.on('uncaughtException', (e) => crashLog('uncaughtException', e));
process.on('unhandledRejection', (e) => crashLog('unhandledRejection', e));

/* ==================== 全局状态 ==================== */
let win = null;
let tray = null;
let store = null;
let icons = null;
let config = null;
let auth = null;
let svr = null;
let dataDir = null;
let quitting = false;

function resolveDataDir() {
  if (process.env.NAVIO_DATA_DIR) return process.env.NAVIO_DATA_DIR;
  const portableFlag = path.join(path.dirname(process.execPath), 'portable.flag');
  if (fs.existsSync(portableFlag)) return path.join(path.dirname(process.execPath), 'data');
  if (!app.isPackaged) return path.join(__dirname, 'data');
  return path.join(app.getPath('userData'), 'navio-data');
}
function appIcon() {
  try {
    const p = path.join(__dirname, 'build', 'icon.png');
    if (!fs.existsSync(p)) return nativeImage.createEmpty();
    return nativeImage.createFromBuffer(fs.readFileSync(p));
  } catch (e) {
    crashLog('appIcon', e);
    return nativeImage.createEmpty();
  }
}
function notify(text) {
  if (win && !win.isDestroyed()) win.webContents.send('toast', text);
}
function broadcastStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('admin:status-changed');
}

/* ==================== 服务启停 ==================== */
function ensureModules() {
  if (store) return;
  dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  store = new Store(dataDir);
  const info = store.load();
  slog('store.load ' + JSON.stringify(info));
  icons = new IconCache(dataDir, () => ({ fetch: (...a) => net.fetch(...a) }));
  config = new ServerConfig(dataDir);
  config.load();
  auth = new Auth(dataDir, config);
  const a = auth.load();
  if (a.initialPassword) slog('INITIAL ADMIN PASSWORD generated (see INITIAL_ADMIN.txt)');
  svr = new NavioServer({
    store,
    auth,
    config,
    icons,
    rendererDir: RENDERER_DIR,
    dataDir,
    log: (where, e) => slog('server/' + where + ': ' + (e && e.message ? e.message : e))
  });
}

async function startService() {
  ensureModules();
  if (svr.startedAt) return { ok: true, already: true, ...svr.status() };
  const r = await svr.start();
  slog('service.start ' + JSON.stringify(r));
  broadcastStatus();
  return r;
}
async function stopService() {
  if (!svr) return { ok: true };
  const r = await svr.stop();
  slog('service.stop ' + JSON.stringify(r));
  broadcastStatus();
  return r;
}
async function restartService() {
  if (!svr) return startService();
  await svr.stop();
  const r = await svr.start();
  slog('service.restart ' + JSON.stringify(r));
  broadcastStatus();
  return r;
}
function localUrl() {
  const c = config ? config.get() : { port: 9200 };
  const scheme = svr && svr.scheme ? svr.scheme : c.https && c.https.enabled ? 'https' : 'http';
  return `${scheme}://127.0.0.1:${c.port}`;
}

/* ==================== 管理 IPC（仅本地窗口可调用） ==================== */
function registerAdminIpc() {
  ipcMain.handle('admin:version', () => ({ app: VERSION, electron: process.versions.electron, node: process.versions.node }));
  ipcMain.handle('admin:status', () => {
    ensureModules();
    const s = svr.status();
    return {
      ...s,
      render: softwareRender ? 'software' : 'gpu',
      users: auth.users.length,
      spaces: Object.keys(store.state.spaces || {}).length + 1,
      dataFileBytes: fs.existsSync(store.file) ? fs.statSync(store.file).size : 0
    };
  });

  ipcMain.handle('admin:config:get', () => {
    ensureModules();
    return JSON.parse(JSON.stringify(config.get()));
  });
  ipcMain.handle('admin:config:set', (_e, patch) => {
    ensureModules();
    const r = config.save(patch);
    slog('config.set ' + JSON.stringify(patch));
    return r;
  });

  ipcMain.handle('admin:service:start', () => startService());
  ipcMain.handle('admin:service:stop', () => stopService());
  ipcMain.handle('admin:service:restart', () => restartService());
  ipcMain.handle('admin:autolaunch', (_e, on) => {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [] });
      config.save({ autoLaunch: !!on });
      return { ok: true, enabled: !!on };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /* --- 账号 --- */
  ipcMain.handle('admin:users:list', () => {
    ensureModules();
    const f = path.join(dataDir, 'INITIAL_ADMIN.txt');
    let initialPassword = null;
    try {
      if (fs.existsSync(f)) {
        const m = fs.readFileSync(f, 'utf8').match(/密码:\s*(\S+)/);
        if (m) initialPassword = m[1];
      }
    } catch (_) {}
    return { users: auth.listUsers(), initialPassword };
  });
  ipcMain.handle('admin:users:create', (_e, o) => {
    ensureModules();
    const r = auth.createUser(o || {});
    slog('user.create ' + (r.ok ? r.user.username : r.error));
    return r;
  });
  ipcMain.handle('admin:users:update', (_e, { id, patch }) => {
    ensureModules();
    const actor = auth.users.find((u) => u.role === 'admin');
    return auth.updateUser(id, patch || {}, actor && actor.id);
  });
  ipcMain.handle('admin:users:delete', (_e, id) => {
    ensureModules();
    const actor = auth.users.find((u) => u.role === 'admin');
    return auth.deleteUser(id, actor && actor.id);
  });

  /* --- 数据（数据库功能） --- */
  ipcMain.handle('admin:data:info', () => {
    ensureModules();
    const stats = store.stats();
    let size = 0;
    try {
      size = fs.statSync(store.file).size;
    } catch (_) {}
    return {
      stats: { ...stats, size },
      backups: store.listBackups(),
      file: store.file,
      spaces: Object.keys(store.state.spaces || {}).length + 1
    };
  });
  ipcMain.handle('admin:data:backup', () => {
    ensureModules();
    return store.backup('console');
  });
  ipcMain.handle('admin:data:restore', (_e, name) => {
    ensureModules();
    const r = store.restoreBackup(String(name || ''));
    if (r.ok) broadcastStatus();
    return r;
  });
  ipcMain.handle('admin:data:export', async () => {
    ensureModules();
    const r = await dialog.showSaveDialog(win, {
      title: '导出 Navio 全部数据',
      defaultPath: `navio-data-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Navio 数据', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    return store.exportTo(r.filePath);
  });
  ipcMain.handle('admin:data:import', async () => {
    ensureModules();
    const r = await dialog.showOpenDialog(win, {
      title: '导入数据 JSON（会覆盖当前全部数据）',
      properties: ['openFile'],
      filters: [{ name: 'Navio 数据', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    store.backup('before-import');
    const res = store.importFrom(r.filePaths[0]);
    broadcastStatus();
    return { ...res, meta: store.stats() };
  });
  ipcMain.handle('admin:data:verify', () => {
    ensureModules();
    try {
      const raw = fs.readFileSync(store.file, 'utf8');
      const parsed = JSON.parse(raw);
      const clean = normalize(parsed);
      store.saveSync(clean);
      return { ok: true, groups: clean.groups.length, bookmarks: clean.bookmarks.length, bytes: raw.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('admin:data:clear', () => {
    ensureModules();
    store.backup('before-clear');
    const empty = defaultState();
    empty.seeded = true;
    empty.spaces = store.state.spaces;
    store.saveSync(empty);
    broadcastStatus();
    return { ok: true };
  });
  ipcMain.handle('admin:open-data-dir', () => {
    ensureModules();
    shell.openPath(dataDir);
    return { ok: true, dir: dataDir };
  });

  ipcMain.handle('admin:icons:list', () => ({ items: presetIcons.list(), total: presetIcons.list().length }));
  ipcMain.handle('admin:logs', () => {
    ensureModules();
    const dir = app.getPath('userData');
    let text = '';
    for (const f of ['navio-boot.log', 'navio-crash.log']) {
      try {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) {
          const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
          text += `===== ${f} (最后 ${Math.min(lines.length, 80)} 行) =====\n` + lines.slice(-80).join('\n') + '\n\n';
        }
      } catch (_) {}
    }
    return { text: text || '(暂无日志)' };
  });
  ipcMain.handle('admin:open-web', async () => {
    await shell.openExternal(localUrl());
    return { ok: true };
  });
  ipcMain.handle('admin:copy', (_e, t) => {
    clipboard.writeText(String(t == null ? '' : t));
    return { ok: true };
  });

  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:hide', () => win && win.hide());
}

/* ==================== 窗口 ==================== */
function createConsoleWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#0c1019',
    icon: appIcon(),
    title: 'Navio Server · 服务端控制台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(RENDERER_DIR, 'console.html'));
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide(); // 关窗只隐藏，服务继续
      notify('已最小化到托盘，Web 服务仍在运行');
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function createTray() {
  try {
    const img = appIcon();
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 20, height: 20 }));
    const menu = Menu.buildFromTemplate([
      { label: '打开服务端控制台', click: () => showWindow() },
      { label: '在浏览器中打开 Navio', click: () => shell.openExternal(localUrl()) },
      { type: 'separator' },
      {
        label: '服务：运行中',
        enabled: false,
        id: 'svc'
      },
      { label: '重启服务', click: () => restartService() },
      { type: 'separator' },
      {
        label: softwareRender ? '图形：软件渲染（点击恢复硬件加速）' : '图形：硬件加速（点击切软件渲染）',
        click: () => relaunchWithGpuMode(!softwareRender)
      },
      { type: 'separator' },
      {
        label: '退出（停止服务）',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ]);
    tray.setToolTip('Navio Server · Web 服务');
    tray.setContextMenu(menu);
    tray.on('double-click', () => showWindow());
  } catch (e) {
    crashLog('createTray', e);
  }
}
function showWindow() {
  if (!win) createConsoleWindow();
  else {
    win.show();
    win.focus();
  }
}
function relaunchWithGpuMode(useSoftware) {
  gpuState.software = !!useSoftware;
  gpuState.crashes = 0;
  writeGpuState(gpuState);
  try {
    if (RUN_LOCK) fs.rmSync(RUN_LOCK, { force: true });
  } catch (_) {}
  quitting = true;
  app.relaunch();
  app.exit(0);
}

/* ==================== 启动 ==================== */
app.on('second-instance', () => showWindow());

app.whenReady().then(async () => {
  slog(`whenReady packaged=${app.isPackaged} render=${softwareRender ? 'software' : 'gpu'} prevUnclean=${prevUnclean}`);
  try {
    ensureModules();
    registerAdminIpc();
    slog('ipc ok');
    createConsoleWindow();
    slog('console window ok');
    createTray();
    slog('tray ok');
    const c = config.get();
    if (c.autoStart) {
      const r = await startService();
      if (!r.ok) {
        notify('服务启动失败：' + r.error + '（端口可能被占用，可在「服务与端口」里改）');
        crashLog('service.start', r.error);
      }
    }
    if (process.env.NAVIO_DEVTOOLS === '1') console.log('[navio] dataDir =', dataDir, 'url =', localUrl());
    if (auth.initialPassword) {
      setTimeout(() => notify('初始管理员密码见数据目录 INITIAL_ADMIN.txt，请尽快修改'), 2500);
    }
  } catch (e) {
    crashLog('whenReady', e);
    slog('whenReady failed: ' + e.message);
  }
});

app.on('activate', () => showWindow());

app.on('before-quit', () => {
  quitting = true;
  // 退出路径必须同步落盘：Electron 不会等待 async handler
  if (store && store.state) {
    try {
      store.saveSync(store.state);
    } catch (_) {}
  }
  try {
    if (svr && svr.server) svr.server.close();
  } catch (_) {}
});

app.on('will-quit', () => {
  try {
    if (RUN_LOCK) fs.rmSync(RUN_LOCK, { force: true });
  } catch (_) {}
});

// 关闭所有窗口也不退出：服务需要在托盘里继续跑
app.on('window-all-closed', () => {});
