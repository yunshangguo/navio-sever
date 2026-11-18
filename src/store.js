'use strict';
/**
 * 文件存储引擎
 * - 单文件 JSON（data.json）
 * - 原子写入：写 .tmp 再 rename，避免断电/崩溃写坏
 * - 滚动备份：backups/data-YYYYMMDD-HHmmss.json，默认保留 30 份
 * - 损坏自愈：parse 失败 → 回退 .bak → 回退最新备份 → 空库
 */
const fs = require('fs');
const path = require('path');

const MAX_BOOKMARKS = 200000;
const KEEP_BACKUPS = 30;
const AUTO_BACKUP_INTERVAL = 10 * 60 * 1000; // 10 分钟

/** 单个书签可独立设置的网格占格（列×行），缺省 1x1 */
const CARD_SIZES = ['1x1', '2x1', '1x2', '2x2'];
const CARD_SIZE_SET = new Set(CARD_SIZES);
function isCardSize(v) { return CARD_SIZE_SET.has(String(v)); }
function normalizeCardSize(v) { return isCardSize(v) ? String(v) : '1x1'; }

const { isCardBgColor, normalizeCardBgColor } = require('./preset-colors');

function looksLikeUrl(s) {
  return /^(https?:\/\/|ftp:\/\/|file:\/\/)/i.test(String(s || ''));
}

function defaultState() {
  return {
    version: 1,
    seeded: false,
    createdAt: new Date().toISOString(),
    settings: {
      theme: 'dark',
      accent: '#4f8cff',
      wallpaper: { type: 'preset', preset: 'aurora', value: '', blur: 0, dim: 0.12 },
      cardSize: 'md',
      cardStyle: 'icon',
      showClock: true,
      clock24h: true,
      showSearch: true,
      searchEngine: 'bing',
      openInNewTab: true,
      closeToTray: false,
      showDesc: false,
      hideGroupHeader: false
    },
    groups: [],
    bookmarks: []
  };
}

function str(v, max = 2000) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** 把任意来源的数据塑形成合法 state，缺字段补默认值 */
function normalize(input) {
  const base = defaultState();
  const src = input && typeof input === 'object' ? input : {};
  const out = base;

  out.version = 1;
  out.seeded = !!src.seeded;
  out.createdAt = str(src.createdAt, 40) || base.createdAt;

  if (src.settings && typeof src.settings === 'object') {
    const s = src.settings;
    const st = out.settings;
    ['theme', 'accent', 'cardSize', 'cardStyle', 'searchEngine'].forEach((k) => {
      if (typeof s[k] === 'string' && s[k]) st[k] = str(s[k], 40);
    });
    ['showClock', 'clock24h', 'showSearch', 'openInNewTab', 'closeToTray', 'showDesc', 'hideGroupHeader'].forEach((k) => {
      if (typeof s[k] === 'boolean') st[k] = s[k];
    });
    if (s.wallpaper && typeof s.wallpaper === 'object') {
      const w = s.wallpaper;
      st.wallpaper = {
        type: ['preset', 'color', 'image', 'url'].includes(w.type) ? w.type : 'preset',
        preset: str(w.preset, 40) || 'aurora',
        value: str(w.value, 400000),
        blur: Math.min(40, Math.max(0, num(w.blur, 0))),
        dim: Math.min(0.85, Math.max(0, num(w.dim, 0.12)))
      };
    }
  }

  const groups = [];
  const seenG = new Set();
  if (Array.isArray(src.groups)) {
    src.groups.slice(0, 5000).forEach((g, i) => {
      if (!g || typeof g !== 'object') return;
      let id = str(g.id, 64) || 'g_' + i;
      while (seenG.has(id)) id += '_';
      seenG.add(id);
      groups.push({
        id,
        name: str(g.name, 120) || '未命名分组',
        color: str(g.color, 32) || '',
        icon: str(g.icon, 400000) || '',
        order: num(g.order, i),
        collapsed: !!g.collapsed
      });
    });
  }

  const bookmarks = [];
  const seenB = new Set();
  if (Array.isArray(src.bookmarks)) {
    src.bookmarks.slice(0, MAX_BOOKMARKS).forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const url = str(b.url, 4000).trim();
      if (!url) return;
      let id = str(b.id, 64) || 'b_' + i;
      while (seenB.has(id)) id += '_';
      seenB.add(id);
      const item = {
        id,
        groupId: str(b.groupId, 64) || (groups[0] ? groups[0].id : ''),
        title: str(b.title, 200).trim() || url.replace(/^https?:\/\//, '').split('/')[0],
        url,
        icon: str(b.icon, 400000),
        desc: str(b.desc, 500),
        order: num(b.order, i),
        createdAt: str(b.createdAt, 40) || new Date().toISOString(),
        clickCount: num(b.clickCount, 0)
      };
      // 尺寸只在源数据带合法值时挂上：旧数据 normalize 结果保持逐字段不变。
      if (isCardSize(b.size)) item.size = String(b.size);
      // 阶段 12：图标背景色同样只在源数据带「系统预设色值」时挂上，
      // 非法值 / 旧数据一律不带该字段，保证逐字段向后兼容。
      if (isCardBgColor(b.bgColor)) item.bgColor = String(b.bgColor);
      bookmarks.push(item);
    });
  }

  // 悬空 groupId 归到第一个分组或自动建一个
  if (bookmarks.length) {
    if (!groups.length) {
      groups.push({ id: 'g_default', name: '默认分组', color: '', icon: '', order: 0, collapsed: false });
    }
    const ids = new Set(groups.map((g) => g.id));
    const fallback = groups[0].id;
    bookmarks.forEach((b) => {
      if (!ids.has(b.groupId)) b.groupId = fallback;
    });
  }

  groups.sort((a, b) => a.order - b.order);
  bookmarks.sort((a, b) => a.order - b.order);
  out.groups = groups;
  out.bookmarks = bookmarks;

  // v2 扩展：Navio 全量模块 + 多用户空间。
  // 只在源数据里存在时才挂上，保证 v1 数据的 normalize 结果完全不变（向后兼容）。
  const EXTRA_ARRAYS = [
    'notes', 'todos', 'todoFolders', 'widgets', 'cards', 'history',
    'tabbar', 'searchEngines', 'wallpapers', 'iconLibrary', 'quickLinks'
  ];
  EXTRA_ARRAYS.forEach((k) => {
    if (Array.isArray(src[k])) {
      out[k] = src[k].slice(0, 20000).filter((x) => x && typeof x === 'object');
    }
  });
  if (src.spaces && typeof src.spaces === 'object' && !Array.isArray(src.spaces)) {
    out.spaces = {};
    // 公共起始页会为每个游客生成独立快照，上限放宽到 2000 个身份
    Object.keys(src.spaces).slice(0, 2000).forEach((uid) => {
      const sp = src.spaces[uid];
      if (sp && typeof sp === 'object') out.spaces[uid] = normalize(sp);
    });
  }
  return out;
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'data.json');
    this.tmp = this.file + '.tmp';
    this.bak = this.file + '.bak';
    this.backupDir = path.join(dataDir, 'backups');
    this.iconDir = path.join(dataDir, 'favicons');
    this.wallDir = path.join(dataDir, 'wallpapers');
    this.state = null;
    this.timer = null;
    this.pending = null;
    this.lastBackupAt = 0;
    this.writing = Promise.resolve();
    this.lastError = null;
  }

  ensureDirs() {
    [this.dataDir, this.backupDir, this.iconDir, this.wallDir].forEach((d) => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  /** 启动加载：正常 → .bak → 最新备份 → 空库 */
  load() {
    this.ensureDirs();
    if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        if (raw.trim()) {
          this.state = normalize(JSON.parse(raw));
          this.loadSource = 'data.json';
          return { ok: true, source: 'data.json' };
        }
      } catch (e) {
        this.lastError = 'data.json 解析失败: ' + e.message;
        try {
          fs.copyFileSync(this.file, path.join(this.backupDir, 'corrupt-' + Date.now() + '.json'));
        } catch (_) {}
      }
    }
    if (fs.existsSync(this.bak)) {
      try {
        this.state = normalize(JSON.parse(fs.readFileSync(this.bak, 'utf8')));
        this.loadSource = 'data.json.bak';
        return { ok: true, source: 'data.json.bak', note: this.lastError };
      } catch (_) {}
    }
    const list = this.listBackups();
    for (const b of list) {
      try {
        this.state = normalize(JSON.parse(fs.readFileSync(path.join(this.backupDir, b.name), 'utf8')));
        this.loadSource = b.name;
        return { ok: true, source: b.name, note: this.lastError };
      } catch (_) {}
    }
    this.state = defaultState();
    this.loadSource = 'empty';
    return { ok: false, source: 'empty', note: this.lastError };
  }

  /** 排空写盘队列（退出前调用） */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      await this.writeNow(p);
    }
    await this.writing;
  }

  /** debounce 保存 */
  save(state, delay = 500) {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const p = this.pending;
      this.pending = null;
      this.timer = null;
      this.writeNow(p);
    }, delay);
  }

  /** 同步落盘（退出前兜底，不经过队列） */
  saveSync(state) {
    if (!state) return false;
    // 取消挂起的 debounce：否则 saveSync 清空 pending 后，
    // 定时器回调会拿到 null 而丢掉这次写入（或写回旧对象覆盖新状态）
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    try {
      const normalized = normalize(state);
      this.state = normalized;
      this.ensureDirs();
      if (fs.existsSync(this.file)) {
        try {
          if (fs.statSync(this.file).size > 2) fs.copyFileSync(this.file, this.bak);
        } catch (_) {}
      }
      fs.writeFileSync(this.tmp, JSON.stringify(normalized, null, 2), 'utf8');
      this.renameWithRetry(this.tmp, this.file);
      this.pending = null;
      const now = Date.now();
      if (now - this.lastBackupAt > AUTO_BACKUP_INTERVAL) {
        this.lastBackupAt = now;
        this.backupQuiet('auto');
      }
      return true;
    } catch (e) {
      this.lastError = e.message;
      return false;
    }
  }

  writeNow(state) {
    if (!state) return Promise.resolve(false);
    const normalized = normalize(state);
    this.state = normalized;
    const body = JSON.stringify(normalized, null, 2);
    this.writing = this.writing.then(() => {
      try {
        this.ensureDirs();
        // 写前把上一份留作 .bak（仅在文件确实存在且非空时）
        if (fs.existsSync(this.file)) {
          try {
            const st = fs.statSync(this.file);
            if (st.size > 2) fs.copyFileSync(this.file, this.bak);
          } catch (_) {}
        }
        fs.writeFileSync(this.tmp, body, 'utf8');
        this.renameWithRetry(this.tmp, this.file);
        const now = Date.now();
        if (now - this.lastBackupAt > AUTO_BACKUP_INTERVAL) {
          this.lastBackupAt = now;
          this.backupQuiet('auto');
        }
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = e.message;
        return false;
      }
    });
    return this.writing;
  }

  renameWithRetry(from, to, tries = 6) {
    for (let i = 0; i < tries; i++) {
      try {
        fs.renameSync(from, to);
        return true;
      } catch (e) {
        if (i === tries - 1) throw e;
        const t = Date.now() + 40;
        while (Date.now() < t) {}
      }
    }
  }

  backupQuiet(tag = 'manual') {
    try {
      if (!fs.existsSync(this.file)) return null;
      const st = fs.statSync(this.file);
      if (st.size < 3) return null;
      const raw = fs.readFileSync(this.file, 'utf8');
      // 只备份能被解析的完好数据，避免把损坏文件也存成备份
      try {
        JSON.parse(raw);
      } catch (_) {
        return null;
      }
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const name = `data-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${tag}.json`;
      const dest = path.join(this.backupDir, name);
      fs.writeFileSync(dest, raw, 'utf8');
      this.pruneBackups();
      return name;
    } catch (_) {
      return null;
    }
  }

  backup(tag) {
    const r = this.backupQuiet(tag || 'manual');
    return { ok: !!r, name: r, dir: this.backupDir };
  }

  pruneBackups(keep = KEEP_BACKUPS) {
    try {
      const list = this.listBackups();
      list.slice(keep).forEach((b) => {
        try {
          fs.unlinkSync(path.join(this.backupDir, b.name));
        } catch (_) {}
      });
    } catch (_) {}
  }

  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];
      return fs
        .readdirSync(this.backupDir)
        .filter((f) => /^data-.*\.json$/.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(this.backupDir, f));
          return { name: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (_) {
      return [];
    }
  }

  restoreBackup(name) {
    const safe = String(name || '').replace(/[\\/]/g, '');
    const src = path.join(this.backupDir, safe);
    if (!fs.existsSync(src)) return { ok: false, error: '备份不存在' };
    try {
      const parsed = normalize(JSON.parse(fs.readFileSync(src, 'utf8')));
      this.state = parsed;
      this.writeNow(parsed);
      return { ok: true, state: parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** 导出到用户选定路径 */
  exportTo(targetPath) {
    const body = JSON.stringify(this.state || defaultState(), null, 2);
    fs.writeFileSync(targetPath, body, 'utf8');
    return { ok: true, path: targetPath, bytes: Buffer.byteLength(body) };
  }

  importFrom(srcPath) {
    const raw = fs.readFileSync(srcPath, 'utf8');
    const parsed = normalize(JSON.parse(raw));
    this.state = parsed;
    this.writeNow(parsed);
    return { ok: true, state: parsed };
  }

  stats() {
    const s = this.state || defaultState();
    let bytes = 0;
    try {
      bytes = fs.statSync(this.file).size;
    } catch (_) {}
    return {
      dataDir: this.dataDir,
      file: this.file,
      bytes,
      groups: s.groups.length,
      bookmarks: s.bookmarks.length,
      backups: this.listBackups().length,
      lastError: this.lastError,
      loadFrom: this.loadSource || 'data.json'
    };
  }
}

module.exports = {
  Store, normalize, defaultState, looksLikeUrl,
  CARD_SIZES, isCardSize, normalizeCardSize,
  isCardBgColor, normalizeCardBgColor
};
