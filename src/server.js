'use strict';
/**
 * Navio Server —— 内嵌 HTTP(S) 服务（零第三方依赖）
 *
 * 职责：
 *  - 静态托管 renderer/（Web 端与 Electron 本地端共用同一套前端）
 *  - /api/* 用户侧接口（原 Electron IPC 1:1 映射）
 *  - 登录鉴权、会话、IP 白名单、登录失败锁定、安全响应头
 *  - 图标三级降级：本地缓存 → 在线抓取 → 内置图标库 SVG
 *  - 多用户数据空间（同一个 data.json，spaces[uid]）
 *
 * 注意：服务端管理接口（账号、端口、重启）不在这里暴露，只走 Electron 本地 IPC，
 * 避免公网可改配置。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const { normalize, defaultState } = require('./store');
const { Spaces, PUBLIC_GID, PUBLIC_NAME } = require('./spaces');
const { parseNetscape, buildNetscape, parseChromiumBookmarks } = require('./importer');
const preset = require('./preset-icons');
const presetColors = require('./preset-colors');
const { SiteIcons } = require('./site-icons');
const { siteInfo } = require('./favicon');
const weather = require('./weather');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

const MAX_BODY = 8 * 1024 * 1024;

// 未登录游客可调用的接口（只读 / 个人视图）。备份、恢复、导入、宿主机探测等一律不放行。
const PUBLIC_API = new Set([
  '/api/state', '/api/state/flush', '/api/state/reset',
  '/api/weather', '/api/icon', '/api/preset-icon', '/api/preset-icons', '/api/preset-colors',
  '/api/auth/session', '/api/wall', '/api/copy', '/api/open-external',
  '/api/bookmarks/import-html', '/api/bookmarks/export-html'
]);

function send(res, code, body, headers) {
  const extra = res.__navioExtra || {};
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
    ...(headers || {})
  };
  // 可能同时下发「匿名身份 cookie」与「会话/清理 cookie」：
  // 统一扁平化成数组，兼容调用方传字符串或数组两种情况。
  const ec = extra['Set-Cookie'];
  const hc = headers && headers['Set-Cookie'];
  if (ec || hc) h['Set-Cookie'] = [].concat(ec || [], hc || []).flat().filter(Boolean);
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj, headers) {
  return send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}
function clientIp(req, cfg) {
  if (cfg.security && cfg.security.trustProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress || '';
}
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + String(rel || '/').replace(/\\/g, '/'));
  return p.startsWith(path.resolve(base)) ? p : null;
}

/** 探测宿主机浏览器书签（Web 端也能导入宿主机书签） */
function detectBrowserBookmarks() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cands = [
    ['Chrome', path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks')],
    ['Edge', path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks')],
    ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Bookmarks')],
    ['Vivaldi', path.join(appdata, 'Vivaldi', 'Default', 'Bookmarks')],
    ['Chrome Beta', path.join(local, 'Google', 'Chrome Beta', 'User Data', 'Default', 'Bookmarks')]
  ];
  const out = [];
  for (const [name, p] of cands) {
    try {
      if (fs.existsSync(p)) out.push({ name, path: p, size: fs.statSync(p).size });
    } catch (_) {}
  }
  // 多 Profile
  for (const [browser, base] of [
    ['Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
    ['Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')]
  ]) {
    try {
      for (const d of fs.readdirSync(base)) {
        if (!/^(Profile \d+|Default)$/.test(d)) continue;
        const p = path.join(base, d, 'Bookmarks');
        if (fs.existsSync(p) && !out.some((x) => x.path === p)) out.push({ name: `${browser} / ${d}`, path: p, size: fs.statSync(p).size });
      }
    } catch (_) {}
  }
  return out;
}

class NavioServer {
  /**
   * @param {object} o { store, auth, config, icons, rendererDir, dataDir, log }
   */
  constructor(o) {
    this.store = o.store;
    this.auth = o.auth;
    this.config = o.config;
    this.icons = o.icons;
    this.rendererDir = o.rendererDir;
    this.dataDir = o.dataDir;
    this.log = o.log || (() => {});
    this.server = null;
    this.startedAt = null;
    this.requestCount = 0;
    this.rateMap = new Map(); // ip -> {n, reset}
    // 退出后轮换出的新 anon id → 过期时间戳。窗口内该身份携带「私有内容」的写入
    // 一律视为旧登录态 beforeunload 的迟到 flush 而忽略，避免个人书签串到游客视图。
    this.logoutQuarantine = new Map();
    this.onRestart = o.onRestart || null;
    this.spaces = new Spaces(this.store, this.rendererDir);
    this.siteIcons = new SiteIcons(this.rendererDir); // 打包在各站点官网抓取的真实 favicon
  }

  cfg() {
    return this.config.get();
  }

  /**
   * 身份解析：登录用户 = 账号 id；游客 = 匿名 HttpOnly cookie（首次访问下发）。
   * 两种身份的快照 key 完全不同，因此天然互相不可见。
   */
  identityOf(req, res, sess, publicOn, pm) {
    if (sess) {
      return {
        id: sess.user.id, kind: 'user',
        name: sess.user.name || sess.user.username || '用户',
        admin: sess.user.role === 'admin'
      };
    }
    if (!publicOn) return { id: 'guest_no_public', kind: 'guest', name: '访客', admin: false };
    const name = pm.cookieName || 'navio_anon';
    let aid = this.auth.cookieValue(req.headers.cookie, name);
    if (!aid || !/^anon_[a-f0-9]{32}$/.test(aid)) {
      aid = 'anon_' + crypto.randomBytes(16).toString('hex');
      const days = Number(pm.cookieTtlDays) || 365;
      res.__navioExtra = {
        'Set-Cookie': name + '=' + aid + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(days * 86400)
      };
    }
    return { id: aid, kind: 'anon', name: '访客', admin: false };
  }

  /* ---------------- 数据空间 ---------------- */
  primaryUid() {
    const admins = this.auth.users.filter((u) => u.role === 'admin' && u.enabled);
    return admins.length ? admins[0].id : 'u_admin';
  }
  spaceFor(uid) {
    const st = this.store.state;
    if (!uid || uid === this.primaryUid()) return st; // 顶层 = 主管理员空间（兼容 v1）
    st.spaces = st.spaces || {};
    if (!st.spaces[uid]) {
      st.spaces[uid] = normalize({ ...defaultState(), seeded: false, groups: [], bookmarks: [] });
      this.store.saveSync(st);
    }
    return st.spaces[uid];
  }
  saveSpace(uid, space) {
    const st = this.store.state;
    const clean = normalize(space);
    if (!uid || uid === this.primaryUid()) {
      // 保留其他用户空间；内存立即替换，保证「保存后马上读」看到新数据
      clean.spaces = st.spaces;
      this.store.state = clean;
      this.store.save(clean, 500);
    } else {
      st.spaces = st.spaces || {};
      st.spaces[uid] = clean;
      this.store.save(st, 500);
    }
    return { ok: true };
  }
  flushSpace(uid, space) {
    const st = this.store.state;
    const clean = normalize(space);
    if (!uid || uid === this.primaryUid()) {
      clean.spaces = st.spaces;
      this.store.saveSync(clean);
    } else {
      st.spaces = st.spaces || {};
      st.spaces[uid] = clean;
      this.store.saveSync(st);
    }
    return { ok: true };
  }

  /* ---------------- 启动 / 停止 ---------------- */
  start() {
    return new Promise((resolve) => {
      const c = this.cfg();
      const handler = (req, res) => {
        this.handle(req, res).catch((e) => {
          this.log('request-error', e);
          try {
            json(res, 500, { ok: false, error: '服务器内部错误' });
          } catch (_) {}
        });
      };
      let srv;
      if (c.https && c.https.enabled && c.https.cert && c.https.key) {
        try {
          const opts = {
            cert: fs.readFileSync(c.https.cert),
            key: fs.readFileSync(c.https.key)
          };
          if (c.https.pfx) {
            opts.pfx = fs.readFileSync(c.https.pfx);
            opts.passphrase = c.https.passphrase || '';
          }
          srv = https.createServer(opts, handler);
        } catch (e) {
          this.log('https-init-failed', e);
          srv = http.createServer(handler);
        }
      } else {
        srv = http.createServer(handler);
      }
      this.server = srv;
      srv.on('error', (e) => {
        this.log('listen-error', e);
        resolve({ ok: false, error: e.message, code: e.code });
      });
      srv.listen(c.port, c.host, () => {
        this.startedAt = Date.now();
        this.scheme = this.server instanceof https.Server ? 'https' : 'http';
        this.log('listen', `${this.scheme}://${c.host}:${c.port}`);
        resolve({ ok: true, scheme: this.scheme, host: c.host, port: c.port });
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve({ ok: true });
      const s = this.server;
      this.server = null;
      this.startedAt = null;
      s.close(() => resolve({ ok: true }));
      setTimeout(() => resolve({ ok: true, timeout: true }), 3000);
    });
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  status() {
    const c = this.cfg();
    const ips = [];
    try {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
      }
    } catch (_) {}
    return {
      running: !!this.startedAt,
      scheme: this.scheme || (c.https && c.https.enabled ? 'https' : 'http'),
      host: c.host,
      port: c.port,
      startedAt: this.startedAt,
      uptimeSec: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      requests: this.requestCount,
      urls: [
        `${this.scheme || 'http'}://127.0.0.1:${c.port}`,
        ...ips.map((ip) => `${this.scheme || 'http'}://${ip}:${c.port}`)
      ],
      authEnabled: c.auth.enabled,
      ipWhitelist: c.ipWhitelist,
      httpsEnabled: !!(c.https && c.https.enabled),
      onlineSessions: Object.keys(this.auth.sessions).length,
      icons: this.icons.size(),
      dataDir: this.dataDir
    };
  }

  /* ---------------- 限流 ---------------- */
  rateOk(ip) {
    const now = Date.now();
    const k = ip || 'unknown';
    let r = this.rateMap.get(k);
    if (!r || r.reset < now) {
      r = { n: 0, reset: now + 60 * 1000 };
      this.rateMap.set(k, r);
    }
    r.n += 1;
    return r.n <= 600; // 每 IP 每分钟 600 次
  }

  /* ---------------- 主分发 ---------------- */
  async handle(req, res) {
    this.requestCount++;
    const u = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(u.pathname);
    const cfg = this.cfg();
    const ip = clientIp(req, cfg);

    if (!this.rateOk(ip)) return json(res, 429, { ok: false, error: '请求过于频繁' });
    if (!require('./auth').ipAllowed(ip, cfg.ipWhitelist)) return json(res, 403, { ok: false, error: 'IP 不在白名单内' });

    // CORS：同源使用，不开放跨域（避免被别的站点带 cookie 调用）
    if (req.method === 'OPTIONS') return send(res, 204, '');

    const token = this.auth.sessionToken(req.headers.cookie, cfg.auth.cookieName);
    const sess = cfg.auth.enabled ? this.auth.session(token) : { user: { id: this.primaryUid(), username: 'local', role: 'admin' } };
    const isApi = pathname.startsWith('/api/');
    const pm = cfg.publicMode || {};
    const publicOn = pm.enabled !== false;
    const ident = this.identityOf(req, res, sess, publicOn, pm);

    /* ---- 公开接口 ---- */
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      const r = this.auth.login(b.username, b.password, ip, req.headers['user-agent']);
      if (!r.ok) return json(res, 401, { ok: false, code: r.code, error: r.error });
      // 游客先编辑过再登录：若该账号还没有快照，把游客的内存快照一次性迁过去并落盘。
      // 游客快照从不落盘，只存在于 spaces.volatiles；登录是「转为持久身份」的合法迁移。
      try {
        const anon = this.auth.cookieValue(req.headers.cookie, (cfg.publicMode || {}).cookieName || 'navio_anon');
        const st = this.store.state;
        st.spaces = st.spaces || {};
        const memo = anon ? this.spaces.volatileSnapshot(anon) : null;
        if (memo && r.user && r.user.id && !st.spaces[r.user.id]) {
          st.spaces[r.user.id] = normalize(memo);
          this.store.saveSync(st);
          this.spaces.volatiles.delete(anon);
        }
      } catch (_) {}
      return json(res, 200, { ok: true, user: r.user, mustChangePassword: !!r.user.mustChangePassword }, { 'Set-Cookie': this.auth.sessionCookie(r.token, r.ttl) });
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      this.auth.logout(token);
      // 退出后轮换匿名身份：旧的 anon 快照可能已被登录态的 beforeunload flush 污染，
      // 换一个全新的 anon id 才能让访客重新看到公共模板（默认书签），避免串到登录后的个人书签。
      const pmOut = cfg.publicMode || {};
      const anonName = pmOut.cookieName || 'navio_anon';
      const freshAnon = 'anon_' + crypto.randomBytes(16).toString('hex');
      const daysOut = Number(pmOut.cookieTtlDays) || 365;
      const anonCookie = anonName + '=' + freshAnon + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(daysOut * 86400);
      this.logoutQuarantine.set(freshAnon, Date.now() + 8000);
      if (this.logoutQuarantine.size > 64) {
        const now = Date.now();
        for (const [k, exp] of this.logoutQuarantine) if (exp < now) this.logoutQuarantine.delete(k);
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': [this.auth.clearCookie(), anonCookie] });
    }
    if (pathname === '/api/auth/session') {
      return json(res, 200, {
        authenticated: !!sess,
        user: sess ? sess.user : null,
        authEnabled: cfg.auth.enabled,
        serverName: 'Navio Server'
      });
    }
    if (pathname === '/api/auth/password' && req.method === 'POST' && sess) {
      const b = await readBody(req).catch(() => ({}));
      const r = this.auth.changePassword(sess.user.id, b.oldPassword, b.newPassword);
      return json(res, r.ok ? 200 : 400, r);
    }
    if (pathname === '/api/version') return json(res, 200, { ok: true, version: '2.0.0', name: 'Navio Server' });

    // 登录页与静态资源放行
    if (pathname === '/login.html' || pathname === '/login.js' || pathname === '/login.css') {
      return this.staticFile(res, pathname.slice(1));
    }

    // 桌面控制台资源由 Electron 通过 loadFile 本地加载，管理面不走 HTTP。
    if (['console.html', 'console.js', 'console.css'].includes(path.basename(pathname).toLowerCase())) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    // 公共模式关闭时恢复「必须登录」的老行为
    if (!sess && !publicOn) {
      if (isApi) return json(res, 401, { ok: false, code: 'unauthorized', error: '请先登录' });
      return send(res, 302, '', { Location: '/login.html' });
    }
    // 游客只允许白名单接口
    if (!sess && isApi && !PUBLIC_API.has(pathname)) {
      return json(res, 401, { ok: false, code: 'need_login', error: '该功能需要登录' });
    }

    const uid = ident.id;
    const role = sess ? sess.user.role : 'guest';

    if (isApi) return this.api(req, res, pathname, u, uid, role, ip, sess, ident, pm);

    // 根路径 / 静态资源（游客可直接进首页）
    if (pathname === '/' || pathname === '/index.html') return this.staticFile(res, 'index.html');
    return this.staticFile(res, pathname.slice(1));
  }

  /* ---------------- 静态文件 ---------------- */
  staticFile(res, rel) {
    const p = safeJoin(this.rendererDir, '/' + rel);
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const ext = path.extname(p).toLowerCase();
    const body = fs.readFileSync(p);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') {
      headers['Content-Security-Policy'] =
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";
      headers['Cache-Control'] = 'no-store';
    } else {
      headers['Cache-Control'] = 'public, max-age=300';
    }
    return send(res, 200, body, headers);
  }

  /* ---------------- 图标（五级降级：缓存 → 真实图标包 → 在线 → 自绘 → 首字母） ---------------- */
  /**
   * 由 host 参数（可能带端口）或完整 url 推断用于抓取的真实 origin。
   * 本地/内网地址走 http 并保留端口；公网域名走 https。
   * 返回 null 表示无法推断（例如纯域名也不算错，会退回 https 拼接）。
   */
  iconOrigin(hostParam, urlParam) {
    const raw = String(urlParam || '').trim();
    if (raw) {
      const info = siteInfo(raw);
      if (info) return info.origin;
    }
    const h = String(hostParam || '').trim();
    if (!h) return null;
    // 已经是带协议的地址
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) {
      const info = siteInfo(h);
      return info ? info.origin : null;
    }
    // 本地 / 内网 / 环回 → http；公网 → https
    const bare = h.replace(/^\[/, '').replace(/^www\./i, '');
    const local = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i.test(bare);
    try {
      const u = new URL((local ? 'http://' : 'https://') + h);
      return u.origin;
    } catch (_) {
      return null;
    }
  }

  /**
   * https 抓取失败后是否值得回退到 http。
   * 仅对「带端口的地址」或「内网域名后缀」返回 http origin；公网普通域名返回 null。
   * 内网域名后缀（路由器 hosts / mDNS 常见）：.local .lan .home .internal .test .home.arpa 等。
   */
  httpFallbackOrigin(origin, host) {
    const raw = String(origin || '');
    if (!/^https:\/\//i.test(raw)) return null;
    let u;
    try { u = new URL(raw); } catch (_) { return null; }
    const hostname = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const hasPort = !!u.port && u.port !== '443';
    const lanSuffix = /\.(local|lan|home|internal|intranet|test|home\.arpa|localhost)$/i.test(hostname) ||
      hostname === 'localhost';
    if (!hasPort && !lanSuffix) return null;
    return 'http://' + u.host; // 保留端口
  }

  async icon(req, res, u) {
    const hostParam = u.searchParams.get('host') || '';
    const title = String(u.searchParams.get('title') || '');
    // 前端 host 参数来自 URL.host，可能带端口（如 127.0.0.1:6363）。
    // 抓取目标必须保留端口并选对协议：本地/内网地址走 http，公网走 https。
    const originHint = this.iconOrigin(hostParam, u.searchParams.get('url'));
    const host = preset.cleanHost(hostParam || String(u.searchParams.get('url') || ''));
    if (!host && !originHint) return json(res, 400, { ok: false, error: '缺少 host' });

    const c = this.cfg();
    // 1. 本地缓存（用真实 origin 作键，本地不同端口互不串图）
    const cached = originHint ? this.icons.findCached(originHint) : this.icons.findCached(host);
    if (cached) {
      try {
        const buf = fs.readFileSync(cached);
        const ext = path.extname(cached).toLowerCase();
        return send(res, 200, buf, { 'Content-Type': MIME[ext] || 'image/png', 'Cache-Control': 'public, max-age=86400' });
      } catch (_) {}
    }
    // 2. 内置真实站点图标包：官网抓取的 favicon，随程序打包，离线也能显示
    //    放在缓存之后，保证用户主动「刷新图标」抓到的新图仍优先
    const siteIcon = this.siteIcons.find(host);
    if (siteIcon) {
      try {
        const buf = fs.readFileSync(siteIcon.file);
        return send(res, 200, buf, {
          'Content-Type': siteIcon.type,
          'Cache-Control': 'public, max-age=604800',
          'X-Navio-Icon': 'site'
        });
      } catch (_) {}
    }
    // 3. 在线抓取（本地地址带端口 + http；公网 https）
    if (c.icons && c.icons.fetchEnabled) {
      const timeoutMs = c.icons.timeoutMs || 6000;
      const primary = originHint || (host ? 'https://' + host : '');
      const grab = (target) => Promise.race([
        this.icons.get(target),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
      ]);
      try {
        const r = await grab(primary);
        if (r) {
          const buf = r.file ? fs.readFileSync(r.file) : r.buf;
          if (buf) return send(res, 200, buf, { 'Content-Type': r.type || 'image/png', 'Cache-Control': 'public, max-age=86400' });
        }
      } catch (_) {}
      // 3b. 协议回退：内网域名/带端口服务常被前端补成 https，失败后再用 http 抓一次。
      //     只对带端口或内网域名后缀的地址回退，避免公网域名无谓翻倍请求。
      const fallback = this.httpFallbackOrigin(primary, host);
      if (fallback) {
        try {
          const r = await grab(fallback);
          if (r) {
            const buf = r.file ? fs.readFileSync(r.file) : r.buf;
            if (buf) return send(res, 200, buf, { 'Content-Type': r.type || 'image/png', 'Cache-Control': 'public, max-age=86400' });
          }
        } catch (_) {}
      }
    }
    // 4. 内置自绘图标库（仅在前三级都失败时兜底）
    if (!c.icons || c.icons.presetFallback !== false) {
      const item = preset.match(host, title || originHint || host);
      if (item) {
        return send(res, 200, preset.renderSvg(item), {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=604800'
        });
      }
    }
    // 5. 无匹配 → 让前端降级为渐变首字母
    return send(res, 404, '');
  }

  /**
   * 判断一次游客写入是否是「刚退出登录的旧会话迟到 flush」。
   * 退出时服务端轮换出一个全新 anon id 并把它加入 8 秒隔离窗口；
   * 若窗口内该 anon 提交的数据携带 scope='mine' 的书签/分组（游客初始视图不会有），
   * 说明这是登录态 beforeunload 污染回写，忽略掉，避免个人书签串进游客视图。
   */
  _isStaleLogoutFlush(identityId, body) {
    const exp = this.logoutQuarantine && this.logoutQuarantine.get(identityId);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.logoutQuarantine.delete(identityId);
      return false;
    }
    if (!body || typeof body !== 'object') return false;
    // 游客的初始视图只有系统公共分组（g_common / g_public / g_more / g_cat_*）。
    // 出现任何其它分组（带不带 scope 都算），或个人书签，即为登录态残留数据。
    const isPublicGid = (id) => /^(g_common|g_public|g_more|g_cat_)/.test(String(id || ''));
    const hasPrivateGroup = Array.isArray(body.groups) && body.groups.some((g) => g && !isPublicGid(g.id));
    const hasMineScope = (Array.isArray(body.bookmarks) && body.bookmarks.some((b) => b && b.scope === 'mine')) ||
      (Array.isArray(body.groups) && body.groups.some((g) => g && g.scope === 'mine'));
    if (!hasPrivateGroup && !hasMineScope) return false;
    // 命中：解除隔离（旧 flush 只会有一次），后续游客的真实编辑可正常写入
    this.logoutQuarantine.delete(identityId);
    this.log('忽略退出后迟到的登录态 flush: ' + identityId);
    return true;
  }

  /* ---------------- API ---------------- */
  async api(req, res, pathname, u, uid, role, ip, sess, ident, pm) {
    const method = req.method;
    const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? await readBody(req).catch(() => null) : null;
    if (body === null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      return json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
    }
    const who = ident || { id: uid, kind: sess ? 'user' : 'anon', name: '访客', admin: role === 'admin' };
    const guest = !sess;
    const pcfg = pm || {};

    /* --- 状态：公共模板只读 + 每人一份独立快照 --- */
    if (pathname === '/api/state' && method === 'GET') {
      const meta = this.store.stats();
      return json(res, 200, {
        state: this.spaces.view(who.id), meta, dataDir: null,
        user: sess ? sess.user : { id: who.id, username: who.name, role: 'guest' },
        identity: { id: who.id, kind: who.kind, name: who.name, admin: who.admin },
        publicMode: {
          enabled: pcfg.enabled !== false,
          groupName: pcfg.groupName || PUBLIC_NAME,
          canEdit: !guest || pcfg.anonymousEdit !== false,
          hasSnapshot: this.spaces.hasSnapshotView(who.id)
        }
      });
    }
    if (pathname === '/api/state' && method === 'POST') {
      if (guest && pcfg.anonymousEdit === false) return json(res, 401, { ok: false, code: 'need_login', error: '请先登录后再保存' });
      if (this._isStaleLogoutFlush(who.id, body)) return json(res, 200, { ok: true, ignored: 'stale-logout-flush' });
      return json(res, 200, this.spaces.save(who.id, body));
    }
    if (pathname === '/api/state/flush' && method === 'POST') {
      if (guest && pcfg.anonymousEdit === false) return json(res, 401, { ok: false, code: 'need_login', error: '请先登录后再保存' });
      if (this._isStaleLogoutFlush(who.id, body)) return json(res, 200, { ok: true, ignored: 'stale-logout-flush' });
      return json(res, 200, this.spaces.flush(who.id, body));
    }
    if (pathname === '/api/state/reset' && method === 'POST') return json(res, 200, this.spaces.reset(who.id));
    if (pathname === '/api/stats') return json(res, 200, this.store.stats());

    /* --- 天气（服务端代理；前端 CSP 只允许同源） --- */
    if (pathname === '/api/weather' && method === 'GET') {
      const city = String(u.searchParams.get('city') || '').slice(0, 60);
      if (!city) return json(res, 400, { ok: false, error: '缺少 city' });
      return json(res, 200, await weather.fetchWeather(city));
    }

    /* --- 图标 / 图标库 --- */
    if (pathname === '/api/icon') return this.icon(req, res, u);
    if (pathname === '/api/icon/refresh' && method === 'POST') {
      const rawUrl = body && (body.url || body.host);
      const host = preset.cleanHost(rawUrl || '');
      // 用真实 origin 清缓存（保留协议+端口），与抓取/persist 的键一致，
      // 否则本地带端口地址（如 127.0.0.1:6363）清不掉旧缓存、memMiss 也会残留。
      const origin = this.iconOrigin('', rawUrl);
      if (origin) this.icons.clear(origin);
      if (host) this.icons.clear(host);
      return json(res, 200, { ok: true, host });
    }
    if (pathname === '/api/preset-icons') {
      const q = String(u.searchParams.get('q') || '').toLowerCase();
      const all = preset.list();
      return json(res, 200, { ok: true, total: all.length, items: q ? all.filter((x) => x.name.toLowerCase().includes(q) || x.id.includes(q)) : all });
    }
    if (pathname === '/api/preset-icon') {
      const item = preset.match(u.searchParams.get('url'), u.searchParams.get('title'));
      if (!item) return send(res, 404, '');
      return send(res, 200, preset.renderSvg(item), { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    }
    // 阶段 12：系统预设图标背景色板（只读，游客可用）
    if (pathname === '/api/preset-colors') {
      const items = presetColors.list();
      return json(res, 200, { ok: true, total: items.length, items });
    }

    /* --- 壁纸（本地文件） --- */
    if (pathname === '/api/wall') {
      const name = path.basename(String(u.searchParams.get('f') || ''));
      const p = path.join(this.store.wallDir, name);
      if (!name || !fs.existsSync(p)) return send(res, 404, '');
      return send(res, 200, fs.readFileSync(p), { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'image/jpeg' });
    }
    if (pathname === '/api/wall/upload' && method === 'POST') {
      const { name, data } = body || {};
      if (!data || !/^data:image\/[a-z+]+;base64,/i.test(data)) return json(res, 400, { ok: false, error: '不是图片数据' });
      const ext = (data.match(/^data:image\/([a-z+]+);/i) || [])[1] || 'png';
      const safe = (String(name || 'wall') + '.' + ext).replace(/[^a-zA-Z0-9_.-]/g, '_');
      try {
        if (!fs.existsSync(this.store.wallDir)) fs.mkdirSync(this.store.wallDir, { recursive: true });
        fs.writeFileSync(path.join(this.store.wallDir, safe), Buffer.from(data.split(',')[1], 'base64'));
        return json(res, 200, { ok: true, name: safe });
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
    }

    /* --- 备份 / 导入导出 --- */
    if (pathname === '/api/backup' && method === 'POST') return json(res, 200, this.store.backup('web'));
    if (pathname === '/api/backups') return json(res, 200, this.store.listBackups());
    if (pathname === '/api/restore' && method === 'POST') {
      // 恢复备份会覆盖整个 data.json（含所有人的空间），只允许管理员
      if (role !== 'admin') return json(res, 403, { ok: false, error: '只有管理员可以恢复全库备份' });
      const r = this.store.restoreBackup(String((body || {}).name || ''));
      return json(res, r.ok ? 200 : 400, r);
    }
    if (pathname === '/api/export' && method === 'POST') {
      // 只导出当前身份的视图，绝不把别人的 spaces 带出去
      return json(res, 200, { ok: true, path: 'navio-data.json', data: this.spaces.view(who.id) });
    }
    if (pathname === '/api/import' && method === 'POST') {
      const data = (body || {}).data;
      if (!data || typeof data !== 'object') return json(res, 400, { ok: false, error: '没有数据' });
      // 导入只落进自己的快照，不覆盖公共模板、不碰别人的空间
      this.store.backup('before-web-import');
      const r = this.spaces.save(who.id, data);
      return json(res, 200, { ok: true, meta: this.store.stats(), ...r });
    }

    /* --- 浏览器书签 --- */
    if (pathname === '/api/bookmarks/detect') return json(res, 200, detectBrowserBookmarks());
    if (pathname === '/api/bookmarks/import-browser' && method === 'POST') {
      const p = String((body || {}).path || '');
      if (!fs.existsSync(p)) return json(res, 400, { ok: false, error: '文件不存在' });
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = /\.json$/i.test(p) || raw.trim().startsWith('{') ? parseChromiumBookmarks(raw) : parseNetscape(raw);
        return json(res, 200, { ok: true, ...parsed, source: path.basename(p) });
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
    }
    if (pathname === '/api/bookmarks/import-html' && method === 'POST') {
      const raw = String((body || {}).content || '');
      if (!raw) return json(res, 400, { ok: false, error: '文件为空' });
      try {
        const parsed = raw.trim().startsWith('{') ? parseChromiumBookmarks(raw) : parseNetscape(raw);
        return json(res, 200, { ok: true, ...parsed });
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
    }
    if (pathname === '/api/bookmarks/export-html' && method === 'POST') {
      const html = buildNetscape((body || {}).groups || [], (body || {}).bookmarks || []);
      return json(res, 200, { ok: true, count: ((body || {}).bookmarks || []).length, html, name: 'navio-bookmarks.html' });
    }

    /* --- 本地能力（Web 端由 navio-http.js 直接实现，这里给出统一回执） --- */
    if (pathname === '/api/open-external' && method === 'POST') return json(res, 200, { ok: true, web: true });
    if (pathname === '/api/open-data-dir') return json(res, 200, { ok: false, error: '请在桌面端控制台打开数据目录' });
    if (pathname === '/api/copy' && method === 'POST') return json(res, 200, { ok: true, web: true });
    if (pathname === '/api/wall/pick') return json(res, 200, { ok: false, canceled: true, error: 'Web 端请用「上传图片」' });

    return json(res, 404, { ok: false, error: '接口不存在: ' + pathname });
  }
}

module.exports = { NavioServer, detectBrowserBookmarks };
