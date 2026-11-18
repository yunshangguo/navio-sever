'use strict';
/**
 * 服务端配置（独立于书签数据）
 * 存 <dataDir>/server.json，改动端口/绑定/HTTPS 需要重启服务。
 * 环境变量优先级最高，便于自动化与临时调试：
 *   NAVIO_PORT / NAVIO_HOST / NAVIO_AUTH / NAVIO_DATA_DIR / NAVIO_NO_GPU
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  version: 2,
  host: '0.0.0.0',
  port: 9200,
  // 服务是否在应用启动时自动开启
  autoStart: true,
  auth: {
    enabled: true,
    sessionTtlHours: 168, // 7 天
    maxFail: 5, // 连续失败次数
    lockMinutes: 15,
    cookieName: 'navio_sid'
  },
  // 公网加固
  ipWhitelist: [], // 空数组 = 不限制；支持 '1.2.3.4' 或 '192.168.1.' 前缀
  https: { enabled: false, cert: '', key: '', pfx: '', passphrase: '' },
  // 安全响应头
  security: {
    hsts: false,
    frameAncestors: 'none',
    trustProxy: false // 反代场景设 true，从 X-Forwarded-For 取真实 IP
  },
  // 开机自启（Windows 注册表 CurrentVersion\Run）
  autoLaunch: false,
  // 图标抓取
  icons: { fetchEnabled: true, timeoutMs: 6000, presetFallback: true },
  // 公共起始页：顶层书签作为所有人的「通用」只读模板，每人（含未登录游客）
  // 获得一份独立的可编辑快照，改动互不影响；登录后新建的标签按账号隔离。
  publicMode: {
    enabled: true,        // 关掉即恢复「必须登录才能访问」
    anonymousEdit: true,  // 游客是否也能保存自己的视图
    cookieName: 'navio_anon',
    cookieTtlDays: 365,
    groupName: '通用'
  }
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function merge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in patch)) continue;
    const b = base[k];
    const p = patch[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p)) merge(b, p);
    else if (Array.isArray(b) && Array.isArray(p)) base[k] = p.slice();
    else if (typeof p === typeof b) base[k] = p;
  }
  return base;
}

class ServerConfig {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'server.json');
    this.value = clone(DEFAULTS);
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        if (raw.trim()) merge(this.value, JSON.parse(raw));
      }
      // 环境变量覆盖（不落盘）
      if (process.env.NAVIO_PORT) this.value.port = Number(process.env.NAVIO_PORT) || this.value.port;
      if (process.env.NAVIO_HOST) this.value.host = process.env.NAVIO_HOST;
      if (process.env.NAVIO_AUTH === '0' || process.env.NAVIO_AUTH === 'false') this.value.auth.enabled = false;
      if (process.env.NAVIO_AUTH === '1' || process.env.NAVIO_AUTH === 'true') this.value.auth.enabled = true;
      this.value.port = Math.min(65535, Math.max(1, Number(this.value.port) || 9200));
    } catch (e) {
      this.lastError = 'server.json 读取失败，已使用默认值: ' + e.message;
    }
    return this.value;
  }

  save(patch) {
    if (patch && typeof patch === 'object') merge(this.value, patch);
    this.value.port = Math.min(65535, Math.max(1, Number(this.value.port) || 9200));
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  get() {
    return this.value;
  }
}

module.exports = { ServerConfig, DEFAULTS };
