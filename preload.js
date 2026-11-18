'use strict';
/**
 * 只服务于「服务端控制台」窗口。
 * 书签界面已完全 Web 化（renderer/navio-http.js），桌面端不再加载它。
 * 管理接口只走本地 IPC，不通过 HTTP 端口暴露，公网无法改端口/账号。
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('navioAdmin', {
  // 服务
  status: () => invoke('admin:status'),
  configGet: () => invoke('admin:config:get'),
  configSet: (patch) => invoke('admin:config:set', patch),
  serviceStart: () => invoke('admin:service:start'),
  serviceStop: () => invoke('admin:service:stop'),
  serviceRestart: () => invoke('admin:service:restart'),
  autoLaunch: (on) => invoke('admin:autolaunch', on),

  // 账号
  usersList: () => invoke('admin:users:list'),
  userCreate: (o) => invoke('admin:users:create', o),
  userUpdate: (id, patch) => invoke('admin:users:update', { id, patch }),
  userDelete: (id) => invoke('admin:users:delete', id),

  // 数据（数据库功能）
  dataInfo: () => invoke('admin:data:info'),
  dataBackup: () => invoke('admin:data:backup'),
  dataRestore: (name) => invoke('admin:data:restore', name),
  dataExport: () => invoke('admin:data:export'),
  dataImport: () => invoke('admin:data:import'),
  dataVerify: () => invoke('admin:data:verify'),
  dataClear: () => invoke('admin:data:clear'),
  openDataDir: () => invoke('admin:open-data-dir'),

  // 图标库 / 日志 / 杂项
  iconsList: () => invoke('admin:icons:list'),
  logs: () => invoke('admin:logs'),
  openWeb: () => invoke('admin:open-web'),
  copy: (t) => invoke('admin:copy', t),
  version: () => invoke('admin:version'),

  // 窗口
  minimize: () => ipcRenderer.send('win:minimize'),
  hide: () => ipcRenderer.send('win:hide'),
  onToast: (cb) => ipcRenderer.on('toast', (_e, m) => cb(m)),
  onStatus: (cb) => ipcRenderer.on('admin:status-changed', () => cb())
});
