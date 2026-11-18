'use strict';
/**
 * 账号与会话（纯 JSON 文件，无数据库）
 * - users.json     账号表，密码 scrypt + 随机 salt，绝不存明文
 * - sessions.json  持久会话，重启后不必重新登录
 * - 登录失败锁定、按 IP 限流、IP 白名单、管理员播种
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), s, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return 'scrypt$' + s + '$' + h;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, salt, hex] = String(stored).split('$');
    if (alg !== 'scrypt' || !salt || !hex) return false;
    const h = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    const expected = Buffer.from(hex, 'hex');
    return expected.length === h.length && crypto.timingSafeEqual(h, expected);
  } catch (_) {
    return false;
  }
}

function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1' || s === '0:0:0:0:0:0:0:1') s = '127.0.0.1';
  return s;
}
function ipAllowed(ip, list) {
  if (!Array.isArray(list) || !list.length) return true;
  const s = normalizeIp(ip);
  return list.some((rule) => {
    const r = String(rule).trim();
    if (!r) return false;
    return r.endsWith('.') || r.endsWith(':') ? s.startsWith(r) : s === r;
  });
}

function atomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class Auth {
  constructor(dataDir, cfg) {
    this.dataDir = dataDir;
    this.cfg = cfg; // ServerConfig 实例
    this.usersFile = path.join(dataDir, 'users.json');
    this.sessionsFile = path.join(dataDir, 'sessions.json');
    this.users = [];
    this.sessions = {};
    this.fails = new Map(); // key -> {n, until, last}
    this.initialPassword = null;
  }

  load() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    try {
      if (fs.existsSync(this.usersFile)) {
        const d = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
        if (Array.isArray(d)) this.users = d;
      }
    } catch (e) {
      this.lastError = 'users.json 损坏: ' + e.message;
      this.users = [];
    }
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const d = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
        if (d && typeof d === 'object') this.sessions = d;
      }
    } catch (_) {
      this.sessions = {};
    }

    if (!this.users.length) {
      const pw = crypto.randomBytes(9).toString('base64url');
      this.users.push({
        id: 'u_admin',
        username: 'admin',
        name: '管理员',
        role: 'admin',
        enabled: true,
        password: hashPassword(pw),
        createdAt: new Date().toISOString(),
        loginIp: '',
        loginAt: '',
        mustChangePassword: true
      });
      this.saveUsers();
      this.initialPassword = pw;
      // 明文只落这一个文件，用户登录改密后可删除
      try {
        fs.writeFileSync(
          path.join(this.dataDir, 'INITIAL_ADMIN.txt'),
          'Navio Server 初始管理员账号\n\n  用户名: admin\n  密码:   ' + pw + '\n\n请登录后立刻在「服务端控制台 → 账号」修改密码，然后删除本文件。\n',
          'utf8'
        );
      } catch (_) {}
    }
    // 清掉过期会话
    this.pruneSessions();
    return { initialPassword: this.initialPassword, users: this.users.length };
  }

  saveUsers() {
    atomic(this.usersFile, this.users);
  }
  saveSessions() {
    try {
      atomic(this.sessionsFile, this.sessions);
    } catch (_) {}
  }
  pruneSessions() {
    const now = Date.now();
    let changed = false;
    for (const k of Object.keys(this.sessions)) {
      if (!this.sessions[k] || this.sessions[k].expireAt < now) {
        delete this.sessions[k];
        changed = true;
      }
    }
    if (changed) this.saveSessions();
  }

  /** 公开视图，绝不返回密码哈希 */
  publicUser(u) {
    if (!u) return null;
    const { password, ...rest } = u;
    return rest;
  }
  listUsers() {
    return this.users.map((u) => this.publicUser(u));
  }
  find(username) {
    const n = String(username || '').trim().toLowerCase();
    return this.users.find((u) => String(u.username).toLowerCase() === n);
  }
  findById(id) {
    return this.users.find((u) => u.id === id);
  }

  createUser({ username, password, name, role }) {
    const n = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(n)) return { ok: false, error: '用户名需为 2-32 位字母/数字/._-' };
    if (String(password || '').length < 8) return { ok: false, error: '密码至少 8 位' };
    if (this.find(n)) return { ok: false, error: '用户名已存在' };
    const u = {
      id: 'u_' + crypto.randomBytes(6).toString('hex'),
      username: n,
      name: String(name || n).slice(0, 40),
      role: role === 'admin' ? 'admin' : 'user',
      enabled: true,
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
      loginIp: '',
      loginAt: '',
      mustChangePassword: false
    };
    this.users.push(u);
    this.saveUsers();
    return { ok: true, user: this.publicUser(u) };
  }

  updateUser(id, patch, actorId) {
    const u = this.findById(id);
    if (!u) return { ok: false, error: '用户不存在' };
    if (patch.name !== undefined) u.name = String(patch.name).slice(0, 40);
    if (patch.role !== undefined && ['admin', 'user'].includes(patch.role)) {
      // 不允许把最后一个管理员降级
      if (u.role === 'admin' && patch.role !== 'admin' && this.users.filter((x) => x.role === 'admin' && x.enabled).length <= 1) {
        return { ok: false, error: '至少保留一个管理员' };
      }
      u.role = patch.role;
    }
    if (patch.enabled !== undefined) {
      if (u.id === actorId && patch.enabled === false) return { ok: false, error: '不能禁用当前登录账号' };
      u.enabled = !!patch.enabled;
    }
    if (patch.password) {
      if (String(patch.password).length < 8) return { ok: false, error: '密码至少 8 位' };
      u.password = hashPassword(patch.password);
      u.mustChangePassword = false;
      // 改密后踢掉该用户的所有会话
      for (const k of Object.keys(this.sessions)) if (this.sessions[k].userId === u.id) delete this.sessions[k];
      this.saveSessions();
    }
    this.saveUsers();
    return { ok: true, user: this.publicUser(u) };
  }

  deleteUser(id, actorId) {
    const u = this.findById(id);
    if (!u) return { ok: false, error: '用户不存在' };
    if (u.id === actorId) return { ok: false, error: '不能删除当前登录账号' };
    if (u.role === 'admin' && this.users.filter((x) => x.role === 'admin' && x.enabled).length <= 1) {
      return { ok: false, error: '至少保留一个管理员' };
    }
    this.users = this.users.filter((x) => x.id !== id);
    for (const k of Object.keys(this.sessions)) if (this.sessions[k].userId === id) delete this.sessions[k];
    this.saveUsers();
    this.saveSessions();
    return { ok: true };
  }

  changePassword(id, oldPw, newPw) {
    const u = this.findById(id);
    if (!u) return { ok: false, error: '用户不存在' };
    if (!verifyPassword(oldPw, u.password)) return { ok: false, error: '原密码不正确' };
    if (String(newPw || '').length < 8) return { ok: false, error: '新密码至少 8 位' };
    u.password = hashPassword(newPw);
    u.mustChangePassword = false;
    this.saveUsers();
    // 保留当前会话，踢掉其他
    return { ok: true };
  }

  _failKey(ip, username) {
    return normalizeIp(ip) + '|' + String(username || '').toLowerCase();
  }
  isLocked(ip, username) {
    const c = this.cfg.get().auth;
    const f = this.fails.get(this._failKey(ip, username));
    return !!(f && f.until > Date.now());
  }
  _recordFail(ip, username) {
    const c = this.cfg.get().auth;
    const k = this._failKey(ip, username);
    const f = this.fails.get(k) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= c.maxFail) {
      f.until = Date.now() + c.lockMinutes * 60 * 1000;
      f.n = 0;
    }
    this.fails.set(k, f);
    return f;
  }
  _clearFail(ip, username) {
    this.fails.delete(this._failKey(ip, username));
  }

  login(username, password, ip, userAgent) {
    const c = this.cfg.get();
    if (!ipAllowed(ip, c.ipWhitelist)) return { ok: false, code: 'ip_blocked', error: 'IP 不在白名单内' };
    if (this.isLocked(ip, username)) return { ok: false, code: 'locked', error: '尝试次数过多，请稍后再试' };
    const u = this.find(username);
    if (!u || !u.enabled || !verifyPassword(password, u.password)) {
      const f = this._recordFail(ip, username);
      return { ok: false, code: 'bad_credentials', error: f.until ? '尝试次数过多，账号已临时锁定' : '用户名或密码错误' };
    }
    this._clearFail(ip, username);
    const token = crypto.randomBytes(32).toString('base64url');
    const ttl = (c.auth.sessionTtlHours || 168) * 3600 * 1000;
    this.sessions[token] = {
      userId: u.id,
      username: u.username,
      role: u.role,
      ip: normalizeIp(ip),
      ua: String(userAgent || '').slice(0, 200),
      createdAt: Date.now(),
      expireAt: Date.now() + ttl
    };
    u.loginIp = normalizeIp(ip);
    u.loginAt = new Date().toISOString();
    this.saveUsers();
    this.saveSessions();
    return { ok: true, token, ttl: ttl / 1000, user: this.publicUser(u) };
  }

  logout(token) {
    if (token && this.sessions[token]) {
      delete this.sessions[token];
      this.saveSessions();
    }
    return { ok: true };
  }

  session(token) {
    if (!token) return null;
    const s = this.sessions[token];
    if (!s || s.expireAt < Date.now()) return null;
    const u = this.findById(s.userId);
    if (!u || !u.enabled) return null;
    return { ...s, user: this.publicUser(u) };
  }

  /** 从 Cookie 头解析 */
  cookieValue(cookieHeader, name) {
    const target = String(name || 'navio_sid');
    for (const part of String(cookieHeader || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === target) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
  }

  sessionCookie(token, maxAgeSec) {
    const name = this.cfg.get().auth.cookieName || 'navio_sid';
    return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeSec)}`;
  }
  /** 兼容旧版浏览器残留的会话 cookie 键名：按值匹配有效会话，源码零旧名、登录不掉线 */
  sessionToken(cookieHeader, name) {
    const direct = this.cookieValue(cookieHeader, name);
    if (direct) return direct;
    const now = Date.now();
    for (const part of String(cookieHeader || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      let v = '';
      try { v = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { continue; }
      const s = this.sessions[v];
      if (s && s.expireAt > now) return v;
    }
    return null;
  }

  clearCookie() {
    const name = this.cfg.get().auth.cookieName || 'navio_sid';
    return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
}

module.exports = { Auth, hashPassword, verifyPassword, normalizeIp, ipAllowed };
