'use strict';
(() => {
  const API = window.navio;

  /* ================= 基础工具 ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const uid = (p) => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function hostOf(url) {
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url);
      return u.host;
    } catch (_) {
      return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
    }
  }

  function normalizeUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
    if (/^(mailto|tel):/i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (/^localhost(:\d+)?(\/|$)/i.test(u)) return 'http://' + u;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(u)) return 'http://' + u;
    return 'https://' + u;
  }

  function hostKey(url) {
    try {
      return new URL(normalizeUrl(url)).host;
    } catch (_) {
      return '';
    }
  }

  function looksLikeUrl(q) {
    const s = String(q || '').trim();
    if (!s || /\s/.test(s)) return false;
    if (/^https?:\/\/\S+$/i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s) || /^localhost(:\d+)?(\/\S*)?$/i.test(s);
  }

  function hueOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % 360;
  }

  function letterOf(b) {
    const t = String(b.title || '').trim();
    if (t) return t[0].toUpperCase();
    const h = hostKey(b.url).replace(/^www\./, '');
    return (h[0] || '?').toUpperCase();
  }

  function gradOf(b) {
    const h = hueOf(hostKey(b.url) || b.title || b.id);
    return `linear-gradient(135deg, hsl(${h} 58% 54%), hsl(${(h + 42) % 360} 64% 40%))`;
  }

  /** 预设 hex 转 rgba（只接受 #rrggbb，色值来自白名单，无注入风险） */
  function hexToRgba(hex, alpha) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 'transparent';
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
  }

  function iconSrc(b) {
    const cur = String(b.icon || '');
    // 历史数据里公共书签的 icon 曾被写死为自绘 SVG（/api/preset-icon），
    // 这里统一改回网站自身的真实 favicon；用户自行上传/填写的自定义图标原样保留。
    // 这样不必改写任何用户数据，旧快照、导入的旧备份也能一起升级。
    // 需要重建的旧图标：空 / 自绘 SVG 遗留 / 旧 /api/icon 但没带 url 参数
    // （缺 url 就无法把内网域名识别成 http，必须补上完整地址重新生成）
    const staleIcon = !cur || cur.indexOf('/api/preset-icon') === 0 ||
      (cur.indexOf('/api/icon?') === 0 && cur.indexOf('url=') < 0);
    if (staleIcon) {
      const host = hostKey(b.url);
      // 带上完整 url（含协议+端口）：内网域名/本地服务需要据此判断用 http 还是 https，
      // 只传 host 会让内网域名被误判为公网而走 https 抓取失败。
      return host ? '/api/icon?host=' + encodeURIComponent(host) +
        '&title=' + encodeURIComponent(String(b.title || '')) +
        '&url=' + encodeURIComponent(String(b.url || '')) : '';
    }
    return cur;
  }

  /* ================= 单书签网格尺寸 ================= */
  // 每个书签可独立占 1x1 / 2x1 / 1x2 / 2x2 个格子（列×行），缺省 1x1。
  // 与 Navio 的图标大小一致；改动只落在当前身份的个人快照里，互不影响。
  const CARD_SIZES = [
    { key: '1x1', label: '标准', hint: '1 × 1', w: 1, h: 1 },
    { key: '2x1', label: '加宽', hint: '2 × 1', w: 2, h: 1 },
    { key: '1x2', label: '加高', hint: '1 × 2', w: 1, h: 2 },
    { key: '2x2', label: '大图标', hint: '2 × 2', w: 2, h: 2 }
  ];
  const SIZE_KEYS = new Set(CARD_SIZES.map((s) => s.key));
  const normSize = (v) => (SIZE_KEYS.has(String(v)) ? String(v) : '1x1');

  /* ================= 单书签图标背景色（阶段 12） ================= */
  // 色板来自 window.NAVIO_PRESETS.bgColors（与服务端 src/preset-colors.js 同源）。
  // 缺省 / 非法值一律 '' = 无背景，沿用阶段 7 的纯透明图标容器，视觉零变化。
  const BG_COLORS = (window.NAVIO_PRESETS && Array.isArray(window.NAVIO_PRESETS.bgColors))
    ? window.NAVIO_PRESETS.bgColors
    : [{ key: 'none', name: '无背景', hex: '' }];
  const BG_HEX_SET = new Set(BG_COLORS.map((c) => c.hex).filter(Boolean));
  const normBg = (v) => (typeof v === 'string' && BG_HEX_SET.has(v) ? v : '');

  /** 色板选择器：编辑弹窗与右键快捷弹窗共用；第一项为「无背景」 */
  function bgPickerHTML(cur) {
    const active = normBg(cur);
    return `<div class="bg-pick" data-bg-pick>
      ${BG_COLORS.map((c) => `<button type="button" class="bg-opt${active === c.hex ? ' on' : ''}"
          data-bg="${esc(c.hex)}" aria-pressed="${active === c.hex}" title="${esc(c.name)}">
        <span class="bg-swatch ${c.hex ? '' : 'bg-none'}" ${c.hex ? `style="--sw:${esc(c.hex)}"` : ''}></span>
        <span class="bg-txt">${esc(c.name)}</span>
      </button>`).join('')}
    </div>`;
  }

  function bindBgPicker(root, onPick) {
    const host = root.querySelector('[data-bg-pick]');
    if (!host) return;
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bg]');
      if (!btn) return;
      const v = normBg(btn.dataset.bg);
      host.querySelectorAll('.bg-opt').forEach((x) => {
        const on = x === btn;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      onPick(v);
    });
  }

  /** 可视化占格选择器：2x2 点阵里点亮实际占用的格子 */
  function sizePickerHTML(cur) {
    const active = normSize(cur);
    return `<div class="size-pick" data-size-pick>
      ${CARD_SIZES.map((s) => `<button type="button" class="size-opt${active === s.key ? ' on' : ''}" data-size="${s.key}" aria-pressed="${active === s.key}">
        <span class="size-prev" style="--pwp:${s.w * 50}%;--php:${s.h * 50}%"><i></i><i></i><i></i><i></i></span>
        <span class="size-txt"><b>${s.hint}</b><small>${s.label}</small></span>
      </button>`).join('')}
    </div>`;
  }

  function bindSizePicker(root, onPick) {
    const host = root.querySelector('[data-size-pick]');
    if (!host) return;
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-size]');
      if (!btn) return;
      const v = normSize(btn.dataset.size);
      host.querySelectorAll('.size-opt').forEach((x) => {
        const on = x === btn;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      onPick(v);
    });
  }

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ================= 搜索引擎 ================= */
  /** 单一清单：搜索栏下拉、结果页联网按钮、设置抽屉、回车兜底共用 */
  const ENGINES = [
    { id: 'baidu', name: '百度', mark: '百', color: '#e8393a', tpl: 'https://www.baidu.com/s?wd=' },
    { id: 'google', name: '谷歌', mark: 'G', color: '#4285f4', tpl: 'https://www.google.com/search?q=' },
    { id: 'bing', name: '必应', mark: 'B', color: '#008373', tpl: 'https://www.bing.com/search?q=' },
    { id: 'so360', name: '360', mark: '3', color: '#19b955', tpl: 'https://www.so.com/s?q=' },
    { id: 'sogou', name: '搜狗', mark: '搜', color: '#f5512d', tpl: 'https://www.sogou.com/web?query=' },
    { id: 'duckduckgo', name: 'DuckDuckGo', mark: 'D', color: '#de5833', tpl: 'https://duckduckgo.com/?q=' },
    { id: 'github', name: 'GitHub', mark: 'G', color: '#6e7681', tpl: 'https://github.com/search?q=' }
  ];
  const DEFAULT_ENGINE = 'bing';
  function engineById(id) {
    return ENGINES.find((e) => e.id === id) ||
      ENGINES.find((e) => e.id === DEFAULT_ENGINE) || ENGINES[0];
  }
  function engineUrl(id) { return engineById(id).tpl; }

  /** 切换引擎：写 settings、同步所有 UI、落个人快照（游客也有自己的空间） */
  function setEngine(id, save) {
    if (!ENGINES.some((e) => e.id === id)) return;
    if (!S || !S.settings) return;
    S.settings.searchEngine = id;
    syncEngineUI();
    if (save) scheduleSave();
  }

  /** 把当前引擎同步到：搜索栏按钮、下拉选中态、设置抽屉 select */
  function syncEngineUI() {
    if (!S || !S.settings) return;
    const e = engineById(S.settings.searchEngine);
    const nameEl = $('#engineName');
    const dotEl = $('#engineDot');
    if (nameEl) nameEl.textContent = e.name;
    if (dotEl) { dotEl.textContent = e.mark; dotEl.style.background = e.color; }
    const sel = $('#setEngine');
    if (sel && sel.value !== e.id) sel.value = e.id;
    $$('#engineMenu [data-engine]').forEach((it) => {
      it.classList.toggle('active', it.getAttribute('data-engine') === e.id);
    });
  }

  function initEnginePicker() {
    const btn = $('#enginePick');
    const menu = $('#engineMenu');
    if (!btn || !menu) return;
    menu.innerHTML = ENGINES.map((e) =>
      '<button class="eng-item" type="button" data-engine="' + e.id + '" role="option">' +
        '<span class="eng-dot" style="background:' + e.color + '">' + esc(e.mark) + '</span>' +
        '<span class="eng-label">' + esc(e.name) + '</span>' +
        '<span class="eng-check">✓</span>' +
      '</button>'
    ).join('');
    const close = () => {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-engine]');
      if (!item) return;
      e.stopPropagation();
      setEngine(item.getAttribute('data-engine'), true);
      close();
      const q = $('#searchInput').value.trim();
      if (q) runSearch(q, true);   // 立即刷新联网按钮上的引擎名
    });
    document.addEventListener('click', close);
    syncEngineUI();
  }

  /* ================= 状态 ================= */
  let S = null;
  let DATA_DIR = '';
  const UI = { tab: null, q: '', drawer: false, ctxFor: null };
  let saveTimer = null;
  let pendingSave = false;

  /* ================= 持久化 ================= */
  function scheduleSave() {
    pendingSave = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 700);
  }

  async function doSave() {
    if (!pendingSave || !S) return;
    pendingSave = false;
    try {
      await API.saveState(S);
    } catch (e) {
      toast('保存失败：' + e.message);
    }
  }

  async function flush() {
    clearTimeout(saveTimer);
    try {
      await API.flush(S);
      pendingSave = false;
    } catch (_) {}
  }

  /* ================= Toast ================= */
  function toast(msg, ms = 2200) {
    const host = $('#toastHost');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  /* ================= 主题 / 壁纸 ================= */
  const PRESETS = {
    aurora: {
      name: '极光',
      tone: 'dark',
      css: 'radial-gradient(1100px 620px at 12% -8%, #1c3f74 0%, transparent 58%), radial-gradient(900px 620px at 88% 4%, #4a1f66 0%, transparent 55%), radial-gradient(1000px 700px at 50% 108%, #07293c 0%, transparent 62%), linear-gradient(160deg, #0a0e16 0%, #090b12 100%)'
    },
    dusk: {
      name: '暮色',
      tone: 'dark',
      css: 'radial-gradient(900px 600px at 80% -10%, #6b2a2a 0%, transparent 55%), radial-gradient(900px 700px at 10% 100%, #2a1c4d 0%, transparent 58%), linear-gradient(160deg, #120d10 0%, #0b0a10 100%)'
    },
    forest: {
      name: '深林',
      tone: 'dark',
      css: 'radial-gradient(900px 620px at 18% -10%, #10402f 0%, transparent 58%), radial-gradient(800px 600px at 92% 22%, #1c3a2a 0%, transparent 55%), linear-gradient(170deg, #08110d 0%, #070c0a 100%)'
    },
    ocean: {
      name: '深海',
      tone: 'dark',
      css: 'radial-gradient(1000px 640px at 50% -20%, #0d3f5c 0%, transparent 60%), radial-gradient(800px 600px at 100% 90%, #10294a 0%, transparent 58%), linear-gradient(160deg, #060c14 0%, #040810 100%)'
    },
    mono: {
      name: '墨黑',
      tone: 'dark',
      css: 'radial-gradient(900px 620px at 50% -10%, #1c1f26 0%, transparent 62%), linear-gradient(160deg, #0b0c0f 0%, #05060a 100%)'
    },
    mesh: {
      name: '网格',
      tone: 'dark',
      css: 'radial-gradient(800px 520px at 20% 0%, #1a2f52 0%, transparent 58%), radial-gradient(700px 520px at 85% 100%, #2b1b47 0%, transparent 55%), repeating-linear-gradient(0deg, rgba(255,255,255,.028) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(255,255,255,.028) 0 1px, transparent 1px 44px), linear-gradient(#080b11, #06080d)'
    },
    dawn: {
      name: '晨光',
      tone: 'light',
      css: 'radial-gradient(900px 600px at 15% -10%, #c9dcfb 0%, transparent 60%), radial-gradient(800px 620px at 90% 0%, #ffe0cc 0%, transparent 58%), linear-gradient(160deg, #eef3fb 0%, #dde5f2 100%)'
    },
    paper: {
      name: '素纸',
      tone: 'light',
      css: 'radial-gradient(760px 520px at 50% -12%, #ffffff 0%, transparent 62%), linear-gradient(160deg, #f2f4f8 0%, #e4e9f2 100%)'
    }
  };

  function applyTheme() {
    const t = S.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    document.documentElement.style.setProperty('--accent', S.settings.accent || '#4f8cff');
  }

  function applyWallpaper() {
    const w = S.settings.wallpaper || { type: 'preset', preset: 'aurora' };
    const wall = $('#wall');
    const blur = w.blur || 0;
    const isLight = S.settings.theme === 'light';
    wall.style.filter = blur ? `blur(${blur}px)` : 'none';
    wall.style.transform = blur ? 'scale(1.06)' : 'none';
    if (w.type === 'image' && w.value) {
      wall.style.backgroundImage = `url("/api/wall?f=${encodeURIComponent(w.value)}")`;
    } else if (w.type === 'url' && w.value) {
      wall.style.backgroundImage = `url("${w.value.replace(/"/g, '')}")`;
    } else if (w.type === 'color' && w.value) {
      wall.style.backgroundImage = 'none';
      wall.style.backgroundColor = w.value;
    } else {
      const p = PRESETS[w.preset] || PRESETS.aurora;
      wall.style.backgroundImage = p.css;
      wall.style.backgroundColor = 'transparent';
    }
    // 主题与壁纸明暗不同时，用蒙版保证文字对比度
    const presetTone = w.type === 'preset' ? (PRESETS[w.preset] || PRESETS.aurora).tone : 'dark';
    const dim = typeof w.dim === 'number' ? w.dim : 0.18;
    let dimColor;
    if (isLight) {
      dimColor = presetTone === 'dark' ? `rgba(247,250,255,${0.55 + dim * 0.4})` : `rgba(255,255,255,${dim * 0.6})`;
    } else {
      dimColor = presetTone === 'light' ? `rgba(8,11,17,${0.5 + dim * 0.4})` : `rgba(6,9,14,${dim})`;
    }
    $('#wall-dim').style.background = dimColor;
  }

  function applyCardSize() {
    const sz = S.settings.cardSize || 'md';
    const map = { sm: ['72px', '42px'], md: ['86px', '52px'], lg: ['110px', '64px'] };
    const v = map[sz] || map.md;
    document.documentElement.style.setProperty('--card-w', v[0]);
    document.documentElement.style.setProperty('--ico', v[1]);
  }

  /* ================= 渲染：分组标签 ================= */
  function orderedGroups() {
    return [...S.groups].sort((a, b) => a.order - b.order);
  }

  function countOf(gid) {
    return S.bookmarks.filter((b) => b.groupId === gid).length;
  }

  function renderTabs() {
    const host = $('#groupTabs');
    const groups = orderedGroups();
    // 阶段 10：分类不再堆在同一页；导航条只负责切换，一次只展示一个分组。
    const parts = groups.map((g) =>
      `<button class="tab ${UI.tab === g.id ? 'active' : ''}" data-tab="${esc(g.id)}" data-scope="${esc(g.scope || '')}" data-icon="${esc(g.icon || '')}" data-glyph="${esc(g.glyph || '')}" data-color="${esc(g.color || '')}" title="${esc(g.name)}">${esc(g.name)}<span class="n">${countOf(g.id)}</span></button>`
    );
    parts.push(
      `<button class="tab" data-tab="__add" title="新建分组"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round"><path d="M12 5v14M5 12h14"/></svg></button>`
    );
    host.innerHTML = parts.join('');
  }

  /* ================= 渲染：卡片 ================= */
  function cardHTML(b) {
    const src = iconSrc(b);
    const letter = letterOf(b);
    const desc = S.settings.showDesc && b.desc ? `<div class="desc">${esc(b.desc)}</div>` : '';
    const mine = b.scope === 'mine';
    const size = normSize(b.size);
    const bg = normBg(b.bgColor);
    // 阶段 12：只有用户主动选了系统预设色才加底色；默认仍是纯透明图标容器。
    // 底色走 CSS 变量，且只作用于 .ico（图标底），不污染卡片本身。
    const bgVars = bg
      ? ` style="--ico-bg:${esc(bg)};--ico-bg-soft:${esc(hexToRgba(bg, 0.22))};--ico-bg-line:${esc(hexToRgba(bg, 0.42))}"`
      : '';
    const fbStyle = bg ? 'background:transparent' : `background:${gradOf(b)}`;
    return `<div class="card${mine ? ' mine' : ''} sz-${size}" data-id="${esc(b.id)}" data-size="${size}" data-bg="${esc(bg)}" draggable="true">
      ${mine ? '<span class="mine-badge">我的</span>' : ''}
      <div class="ico ${bg ? 'has-bg' : ''} ${S.settings.cardStyle === 'tile' ? 'tile' : ''}"${bgVars}>
        <span class="fallback" style="${fbStyle}">${esc(letter)}</span>
        ${src ? `<img src="${esc(src)}" alt="" draggable="false" loading="lazy">` : ''}
      </div>
      <div class="name">${esc(b.title || hostOf(b.url))}</div>
      ${desc}
    </div>`;
  }

  function renderEmpty() {
    $('#emptyState').innerHTML = `
      <div class="big">还没有书签</div>
      <div class="sub">从浏览器一键导入最省事，或者手动添加第一个。<br>所有数据都存在本机的一个 JSON 文件里，随时可备份、可迁移。</div>
      <div class="acts">
        <button class="btn primary" data-empty="import">从浏览器导入</button>
        <button class="btn" data-empty="add">手动添加</button>
      </div>`;
  }

  function renderSections() {
    const wrap = $('#sections');
    const groups = orderedGroups().filter((g) => UI.tab === 'all' || g.id === UI.tab);
    if (!S.bookmarks.length) {
      wrap.innerHTML = '';
      renderEmpty();
      $('#emptyState').classList.remove('hidden');
      return;
    }
    $('#emptyState').classList.add('hidden');

    const html = groups
      .map((g) => {
        // 必须按 order 排序：S.bookmarks 的数组顺序不等于展示顺序
        const list = S.bookmarks.filter((b) => b.groupId === g.id).sort((a, b) => a.order - b.order);
        if (UI.tab !== 'all' && !list.length && g.id !== UI.tab) return '';
        const isPublic = g.scope === 'public';
        const isMine = g.scope === 'mine';
        const gbadge = isMine ? '<span class="g-badge mine">我的</span>' : (isPublic ? '<span class="g-badge pub">公共 · 人人可见</span>' : '');
        // 通用组是公共模板的投影，不允许整体改名/删除（但可以往里加书签，改动只落自己快照）
        const dangerActs = isPublic ? '' : `
            <button class="mini-btn" data-act="rename-group" data-gid="${esc(g.id)}" title="重命名分组">
              <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button class="mini-btn danger" data-act="del-group" data-gid="${esc(g.id)}" title="删除分组">
              <svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>`;
        return `<section class="group${isMine ? ' mine-group' : ''}" data-gid="${esc(g.id)}">
        <div class="group-head" data-gid="${esc(g.id)}" draggable="true">
          <span class="gname">${esc(g.name)}</span>
          ${gbadge}
          <span class="gcount">${list.length}</span>
          <span class="gh-line"></span>
          <div class="gactions">
            <button class="mini-btn" data-act="add-to-group" data-gid="${esc(g.id)}" title="在此分组添加书签">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            </button>${dangerActs}
          </div>
        </div>
        <div class="grid cards-grid" data-gid="${esc(g.id)}">
          ${list.map(cardHTML).join('')}
          <div class="card add" data-act="add-to-group" data-gid="${esc(g.id)}" title="添加书签">
            <div class="ico"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
          </div>
        </div>
      </section>`;
      })
      .join('');
    wrap.innerHTML = html;
  }

  function render() {
    // 阶段 10：UI.tab 恒为某个有效分组 id；删分组/导入后自动回到首个公共分类（常用）。
    const gs = orderedGroups();
    if (!gs.some((g) => g.id === UI.tab)) {
      const first = gs.find((g) => g.scope === 'public') || gs[0];
      UI.tab = first ? first.id : 'all';
    }
    applyTheme();
    applyWallpaper();
    applyCardSize();
    syncEngineUI();
    renderTabs();
    renderSections();
    if (UI.q) runSearch(UI.q, false);
  }

  /* ================= 搜索 ================= */
  let searchHits = [];

  function runSearch(q, focus = true) {
    UI.q = q;
    const box = $('#searchResults');
    const secs = $('#sections');
    if (!q.trim()) {
      box.classList.add('hidden');
      box.innerHTML = '';
      secs.classList.remove('hidden');
      searchHits = [];
      return;
    }
    secs.classList.add('hidden');
    box.classList.remove('hidden');
    const kw = q.trim().toLowerCase();
    searchHits = S.bookmarks
      .map((b) => {
        const g = S.groups.find((x) => x.id === b.groupId);
        const hay = (b.title + ' ' + b.url + ' ' + (b.desc || '') + ' ' + (g ? g.name : '')).toLowerCase();
        if (!hay.includes(kw)) return null;
        let score = 0;
        if ((b.title || '').toLowerCase().startsWith(kw)) score += 100;
        else if ((b.title || '').toLowerCase().includes(kw)) score += 60;
        if ((b.url || '').toLowerCase().includes(kw)) score += 20;
        score += (b.clickCount || 0) * 0.5;
        return { b, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map((x) => x.b);

    const urlHint = looksLikeUrl(q)
      ? `<div class="sr-head" style="margin-bottom:8px">直接访问 <b>${esc(normalizeUrl(q))}</b> · 回车打开</div>`
      : '';
    const eng = engineById(S.settings.searchEngine);
    const webKw = q.trim();
    const webBtn =
      '<div class="sr-web">' +
        '<button class="sr-web-btn" type="button" data-web="1" data-q="' + esc(webKw) + '">' +
          '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>' +
          '<span>用 <b>' + esc(eng.name) + '</b> 联网搜索「<em>' + esc(webKw) + '</em>」</span>' +
          '<span class="sr-web-go">↗</span>' +
        '</button>' +
        '<div class="sr-web-tip">回车仍打开第一个匹配书签 · 点此直接用 ' + esc(eng.name) +
          ' 搜索 · 可在搜索框左侧切换引擎</div>' +
      '</div>';
    const list = searchHits.map(cardHTML).join('');
    box.innerHTML =
      urlHint +
      webBtn +
      `<div class="sr-head">找到 <b>${searchHits.length}</b> 个书签${searchHits.length ? '' : '，回车将自动联网搜索'}</div>` +
      `<div class="grid">${list}</div>`;
    if (focus) $('#searchInput').focus();
  }

  function submitSearch() {
    const q = $('#searchInput').value.trim();
    if (!q) return;
    if (looksLikeUrl(q)) {
      openUrl(normalizeUrl(q));
      return;
    }
    if (searchHits.length) {
      openBookmark(searchHits[0]);
      return;
    }
    openUrl(engineUrl(S.settings.searchEngine) + encodeURIComponent(q));
  }

  /* ================= 打开 / 操作书签 ================= */
  function openUrl(url) {
    API.openExternal(url).then((r) => {
      if (!r || !r.ok) toast('无法打开：' + (r && r.error ? r.error : url));
    });
  }

  function openBookmark(b) {
    b.clickCount = (b.clickCount || 0) + 1;
    scheduleSave();
    openUrl(normalizeUrl(b.url));
  }

  function nextOrder(gid) {
    const list = S.bookmarks.filter((b) => b.groupId === gid);
    return list.length ? Math.max(...list.map((x) => x.order)) + 1 : 0;
  }

  function addBookmarkAt(gid) {
    openBookmarkDialog(null, gid);
  }

  function reindexGroup(gid, orderedIds) {
    orderedIds.forEach((id, i) => {
      const b = S.bookmarks.find((x) => x.id === id);
      if (b) b.order = i;
    });
  }

  function moveBookmark(id, targetGid, targetIndex) {
    const b = S.bookmarks.find((x) => x.id === id);
    if (!b) return;
    const fromGid = b.groupId;
    const targetList = S.bookmarks
      .filter((x) => x.groupId === targetGid && x.id !== id)
      .sort((a, c) => a.order - c.order)
      .map((x) => x.id);
    const idx = Math.max(0, Math.min(targetIndex, targetList.length));
    targetList.splice(idx, 0, id);
    b.groupId = targetGid;
    reindexGroup(targetGid, targetList);
    if (fromGid !== targetGid) {
      const fromList = S.bookmarks
        .filter((x) => x.groupId === fromGid)
        .sort((a, c) => a.order - c.order)
        .map((x) => x.id);
      reindexGroup(fromGid, fromList);
    }
    scheduleSave();
    render();
  }

  function moveGroup(gid, targetIndex) {
    const ids = orderedGroups().map((g) => g.id).filter((id) => id !== gid);
    const idx = Math.max(0, Math.min(targetIndex, ids.length));
    ids.splice(idx, 0, gid);
    ids.forEach((id, i) => {
      const g = S.groups.find((x) => x.id === id);
      if (g) g.order = i;
    });
    scheduleSave();
    render();
  }

  function deleteBookmark(id) {
    const b = S.bookmarks.find((x) => x.id === id);
    if (!b) return;
    S.bookmarks = S.bookmarks.filter((x) => x.id !== id);
    scheduleSave();
    render();
    toast('已删除 ' + (b.title || hostOf(b.url)), 2600);
  }

  function addGroup(name) {
    const g = {
      id: uid('g_'),
      name: name || '新分组',
      color: '',
      icon: '',
      order: S.groups.length,
      collapsed: false
    };
    S.groups.push(g);
    scheduleSave();
    render();
    return g;
  }

  function deleteGroup(gid) {
    const g = S.groups.find((x) => x.id === gid);
    if (!g) return;
    const n = countOf(gid);
    confirmDialog(
      `删除分组「${g.name}」？`,
      n ? `该分组下的 ${n} 个书签会一并删除。删除后可到「设置 → 数据」里用备份恢复。` : '该分组为空。',
      '删除',
      () => {
        S.bookmarks = S.bookmarks.filter((b) => b.groupId !== gid);
        S.groups = S.groups.filter((x) => x.id !== gid);
        if (UI.tab === gid) UI.tab = null;
        scheduleSave();
        render();
        toast('已删除分组');
      }
    );
  }

  /* ================= 弹窗框架 ================= */
  function showModal({ title, body, foot, width, onMount, onClose }) {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = `<div class="modal" style="${width ? 'width:' + width + 'px' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><span class="sp"></span>
        <button class="ibtn sm" data-x><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
    $('#modalRoot').appendChild(mask);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      if (onClose) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close();
    });
    mask.querySelector('[data-x]').addEventListener('click', close);
    if (onMount) onMount(mask, close);
    return { el: mask, close };
  }

  /** 替代 window.prompt（Electron 不支持） */
  function promptDialog({ title, label, placeholder, value, okText }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const m = showModal({
        title: title || '输入',
        width: 420,
        body: `<div class="field"><label>${esc(label || '')}</label>
          <input class="input" id="pdIn" placeholder="${esc(placeholder || '')}" value="${esc(value || '')}" autocomplete="off"></div>`,
        foot: `<button class="btn ghost" data-cancel>取消</button><button class="btn primary" data-ok>${esc(okText || '确定')}</button>`,
        onClose: () => finish(null),
        onMount: (el, close) => {
          const inp = el.querySelector('#pdIn');
          const submit = () => {
            const v = inp.value.trim();
            finish(v);
            close();
          };
          el.querySelector('[data-cancel]').onclick = () => {
            finish(null);
            close();
          };
          el.querySelector('[data-ok]').onclick = submit;
          inp.onkeydown = (e) => {
            if (e.key === 'Enter') submit();
          };
          setTimeout(() => {
            inp.focus();
            inp.select();
          }, 60);
        }
      });
      m.el.querySelector('#pdIn').addEventListener('mousedown', (e) => e.stopPropagation());
    });
  }

  function confirmDialog(title, msg, okText, onOk, danger = true) {
    showModal({
      title,
      width: 440,
      body: `<p style="font-size:13px;line-height:1.7;color:var(--text-2);margin:2px 0 14px">${esc(msg)}</p>`,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okText || '确定')}</button>`,
      onMount: (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelector('[data-ok]').onclick = () => {
          close();
          onOk();
        };
      }
    });
  }

  /* ================= 图标处理 ================= */
  function fileToIconDataUrl(file, max = 96) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const w = img.width || max;
          const h = img.height || max;
          const scale = Math.min(1, max / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * scale));
          const ch = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = cw;
          c.height = ch;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, cw, ch);
          try {
            resolve(c.toDataURL('image/png'));
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('图片无法解析'));
        img.src = String(fr.result);
      };
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  /* ================= 书签编辑弹窗 ================= */
  function openBookmarkDialog(existing, presetGid) {
    const isEdit = !!existing;
    const b = existing
      ? { ...existing }
      : {
          id: uid('b_'),
          groupId: presetGid || (orderedGroups()[0] ? orderedGroups()[0].id : ''),
          title: '',
          url: '',
          icon: '',
          desc: '',
          order: 0,
          createdAt: new Date().toISOString(),
          clickCount: 0
        };

    const groupOpts = orderedGroups()
      .map((g) => `<option value="${esc(g.id)}" ${g.id === b.groupId ? 'selected' : ''}>${esc(g.name)}</option>`)
      .join('');

    const body = `
      <div class="field">
        <label>网址</label>
        <input class="input" id="fUrl" placeholder="https://example.com" value="${esc(b.url)}" autocomplete="off">
        <div class="hint">输入后按 Tab 自动抓取标题与图标</div>
      </div>
      <div class="field">
        <label>名称</label>
        <input class="input" id="fTitle" placeholder="留空则自动使用域名" value="${esc(b.title)}" autocomplete="off">
      </div>
      <div class="row2">
        <div class="field">
          <label>分组</label>
          <select class="select" id="fGroup">${groupOpts}<option value="__new">＋ 新建分组…</option></select>
        </div>
        <div class="field">
          <label>备注（可选）</label>
          <input class="input" id="fDesc" placeholder="一句话说明" value="${esc(b.desc || '')}">
        </div>
      </div>
      <div class="field">
        <label>图标</label>
        <div class="icon-picker">
          <div class="icon-preview" id="icoPrev"></div>
          <div class="icon-acts">
            <button class="chip" data-ico="auto"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>自动抓取</button>
            <button class="chip" data-ico="upload"><svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>上传图片</button>
            <button class="chip" data-ico="url">链接</button>
            <button class="chip" data-ico="none">字母图标</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>图标尺寸</label>
        ${sizePickerHTML(b.size)}
        <div class="hint">每个书签可单独占格，改动只影响你自己的起始页</div>
      </div>
      <div class="field">
        <label>图标背景色</label>
        ${bgPickerHTML(b.bgColor)}
        <div class="hint">系统预设色板，可为单个图标挑一个底色；选「无背景」恢复纯透明</div>
      </div>`;

    showModal({
      title: isEdit ? '编辑书签' : '添加书签',
      width: 540,
      body,
      foot: `${isEdit ? '<button class="btn danger left" data-del>删除</button>' : ''}
             <button class="btn ghost" data-cancel>取消</button>
             <button class="btn primary" data-ok>${isEdit ? '保存' : '添加'}</button>`,
      onMount: (m, close) => {
        const $u = m.querySelector('#fUrl');
        const $t = m.querySelector('#fTitle');
        const $g = m.querySelector('#fGroup');
        const $d = m.querySelector('#fDesc');
        const $prev = m.querySelector('#icoPrev');

        const paintIcon = () => {
          const bg = normBg(b.bgColor);
          if (b.icon) {
            $prev.innerHTML = `<img src="${esc(b.icon)}" alt="">`;
            $prev.style.background = bg ? hexToRgba(bg, 0.22) : '';
          } else {
            const tmp = { title: $t.value || b.title, url: $u.value || b.url, id: b.id };
            $prev.style.background = bg ? hexToRgba(bg, 0.9) : gradOf(tmp);
            $prev.innerHTML = '';
            $prev.textContent = letterOf(tmp);
          }
          $prev.classList.toggle('has-bg', !!bg);
        };
        paintIcon();
        bindSizePicker(m, (v) => { b.size = v; });
        bindBgPicker(m, (v) => { b.bgColor = v; paintIcon(); });

        $u.addEventListener('input', paintIcon);
        $t.addEventListener('input', paintIcon);

        $u.addEventListener('blur', () => {
          if (!$u.value.trim()) return;
          $u.value = normalizeUrl($u.value);
          if (!$t.value.trim()) {
            try {
              const host = hostKey($u.value).replace(/^www\./, '');
              $t.value = host;
            } catch (_) {}
          }
          paintIcon();
        });

        $u.addEventListener('keydown', (e) => {
          if (e.key === 'Tab' && !e.shiftKey && !$t.value.trim()) {
            e.preventDefault();
            $u.dispatchEvent(new Event('blur'));
            $t.focus();
          }
        });

        m.querySelectorAll('[data-ico]').forEach((btn) => {
          btn.onclick = async () => {
            const k = btn.dataset.ico;
            m.querySelectorAll('[data-ico]').forEach((x) => x.classList.remove('on'));
            btn.classList.add('on');
            if (k === 'none') {
              b.icon = '';
              paintIcon();
            } else if (k === 'auto') {
              b.icon = '';
              paintIcon();
              if ($u.value.trim()) {
                const host = hostKey(normalizeUrl($u.value));
                try {
                await API.refreshIcon(normalizeUrl($u.value));
              } catch (_) {}
              b.icon = '/api/icon?host=' + encodeURIComponent(host) +
                '&url=' + encodeURIComponent(normalizeUrl($u.value)) + '&t=' + Date.now();
                paintIcon();
                toast('已尝试重新抓取图标');
              }
            } else if (k === 'upload') {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*';
              inp.onchange = async () => {
                const f = inp.files && inp.files[0];
                if (!f) return;
                if (f.size > 4 * 1024 * 1024) return toast('图片太大（>4MB）');
                try {
                  b.icon = await fileToIconDataUrl(f);
                  paintIcon();
                } catch (e) {
                  toast(e.message);
                }
              };
              inp.click();
            } else if (k === 'url') {
              const v = await promptDialog({
                title: '使用图标链接',
                label: '图片地址',
                placeholder: 'https://example.com/icon.png',
                value: b.icon && /^https?:/i.test(b.icon) ? b.icon : '',
                okText: '使用'
              });
              if (v !== null) {
                b.icon = v;
                paintIcon();
              }
            }
          };
        });

        $g.onchange = async () => {
          if ($g.value === '__new') {
            const name = await promptDialog({
              title: '新建分组',
              label: '分组名称',
              placeholder: '例如：工作 / 学习 / 常用',
              value: '',
              okText: '创建'
            });
            if (name) {
              const ng = addGroup(name);
              const opt = document.createElement('option');
              opt.value = ng.id;
              opt.textContent = ng.name;
              $g.insertBefore(opt, $g.querySelector('[value="__new"]'));
              $g.value = ng.id;
            } else {
              $g.value = b.groupId || '';
            }
          }
        };

        m.querySelector('[data-cancel]').onclick = close;
        const delBtn = m.querySelector('[data-del]');
        if (delBtn)
          delBtn.onclick = () => {
            close();
            deleteBookmark(b.id);
          };

        m.querySelector('[data-ok]').onclick = () => {
          const url = normalizeUrl($u.value);
          if (!url) {
            $u.focus();
            return toast('请填写网址');
          }
          const gid = $g.value === '__new' ? b.groupId : $g.value;
          if (!gid) return toast('请先创建分组');
          b.url = url;
          b.title = ($t.value || '').trim() || hostKey(url).replace(/^www\./, '');
          b.groupId = gid;
          b.desc = ($d.value || '').trim();

          if (isEdit) {
            const idx = S.bookmarks.findIndex((x) => x.id === b.id);
            if (idx >= 0) S.bookmarks[idx] = { ...S.bookmarks[idx], ...b };
            else S.bookmarks.push(b);
          } else {
            b.order = nextOrder(gid);
            S.bookmarks.push(b);
          }
          scheduleSave();
          render();
          close();
          toast(isEdit ? '已保存' : '已添加 ' + b.title);
        };

        setTimeout(() => $u.focus(), 60);
      }
    });
  }

  /** 右键快捷调整单个书签的占格：点选即时生效并落盘 */
  function openSizeDialog(b) {
    showModal({
      title: '图标尺寸 · ' + (b.title || hostOf(b.url)),
      width: 440,
      body: `<div class="field">
        <label>选择占格（列 × 行）</label>
        ${sizePickerHTML(b.size)}
        <div class="hint">可随时改回 1 × 1；网格会自动紧凑排布，其他书签顺序不变</div>
      </div>`,
      foot: `<button class="btn ghost" data-reset-1x1>全部恢复 1 × 1</button>
             <button class="btn primary" data-ok>完成</button>`,
      onMount: (m, close) => {
        bindSizePicker(m, (v) => {
          b.size = v;
          scheduleSave();
          render();
        });
        m.querySelector('[data-ok]').onclick = close;
        m.querySelector('[data-reset-1x1]').onclick = () => {
          S.bookmarks.forEach((x) => { if (x.size && x.size !== '1x1') x.size = '1x1'; });
          m.querySelectorAll('.size-opt').forEach((x) => {
            const on = x.dataset.size === '1x1';
            x.classList.toggle('on', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          scheduleSave();
          render();
          toast('已恢复全部图标为 1 × 1');
        };
      }
    });
  }

  /** 阶段 12：右键快捷设置图标背景色，点选即时生效并落盘 */
  function openBgDialog(b) {
    showModal({
      title: '图标背景色 · ' + (b.title || hostOf(b.url)),
      width: 440,
      body: `<div class="field">
        <label>选择系统预设底色</label>
        ${bgPickerHTML(b.bgColor)}
        <div class="hint">只作用于该书签的图标底，其他书签不变；选「无背景」恢复纯透明</div>
      </div>`,
      foot: `<button class="btn ghost" data-clear-bg>全部恢复无背景</button>
             <button class="btn primary" data-ok>完成</button>`,
      onMount: (m, close) => {
        bindBgPicker(m, (v) => {
          b.bgColor = v;
          scheduleSave();
          render();
        });
        m.querySelector('[data-ok]').onclick = close;
        m.querySelector('[data-clear-bg]').onclick = () => {
          S.bookmarks.forEach((x) => { if (x.bgColor) x.bgColor = ''; });
          m.querySelectorAll('.bg-opt').forEach((x) => {
            const on = x.dataset.bg === '';
            x.classList.toggle('on', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          scheduleSave();
          render();
          toast('已恢复全部图标为无背景');
        };
      }
    });
  }

  /* ================= 分组弹窗 ================= */
  function openGroupDialog(existing) {
    const isEdit = !!existing;
    let pickedIcon = existing ? (existing.icon || '') : '';
    showModal({
      title: isEdit ? '编辑分组' : '新建分组',
      width: 460,
      body: `<div class="field"><label>分组名称</label>
          <input class="input" id="gName" placeholder="例如：工作 / 学习 / 常用" value="${esc(existing ? existing.name : '')}"></div>
        <div class="field"><label>分类图标（可选）</label>
          <div class="grp-icon-grid" id="gIconGrid"><div class="grp-icon-loading">加载图标库…</div></div>
          <div class="hint">选择一个系统预设图标；不选则按名称首字符显示</div>
        </div>`,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn primary" data-ok>${isEdit ? '保存' : '创建'}</button>`,
      onMount: (m, close) => {
        const inp = m.querySelector('#gName');
        const grid = m.querySelector('#gIconGrid');

        // 异步加载内置图标库；只取 kind=category 的「分类图标」（约 19 枚）
        const renderIcons = (all) => {
          const cats = (all || []).filter((x) => x.kind === 'category');
          if (!cats.length) { grid.innerHTML = '<div class="grp-icon-loading">暂无可选图标</div>'; return; }
          grid.innerHTML = cats.map((it) =>
            `<button type="button" class="grp-icon-opt${pickedIcon === it.svg ? ' on' : ''}" data-svg="${esc(it.svg)}" data-name="${esc(it.name)}" title="${esc(it.name)}">
               <img src="${esc(it.svg)}" alt=""><span>${esc(it.name)}</span>
             </button>`).join('') +
            `<button type="button" class="grp-icon-opt grp-icon-none${!pickedIcon ? ' on' : ''}" data-svg="" data-name="默认">
               <span class="grp-icon-auto">Aa</span><span>默认</span>
             </button>`;
          grid.onclick = (e) => {
            const opt = e.target.closest('.grp-icon-opt');
            if (!opt) return;
            pickedIcon = opt.getAttribute('data-svg') || '';
            grid.querySelectorAll('.grp-icon-opt').forEach((x) => x.classList.toggle('on', x === opt));
          };
        };
        if (window.navio && window.navio.presetIcons) {
          Promise.resolve(window.navio.presetIcons()).then((r) => {
            const list = Array.isArray(r) ? r : (r && r.items) || (r && r.icons) || (r && r.list) || [];
            renderIcons(list);
          }).catch(() => renderIcons([]));
        } else {
          renderIcons([]);
        }

        const submit = () => {
          const v = inp.value.trim();
          if (!v) return inp.focus();
          if (isEdit) {
            existing.name = v;
            existing.icon = pickedIcon;
          } else {
            const g = addGroup(v);
            if (pickedIcon) { g.icon = pickedIcon; scheduleSave(); }
          }
          scheduleSave();
          render();
          close();
        };
        inp.onkeydown = (e) => {
          if (e.key === 'Enter') submit();
        };
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelector('[data-ok]').onclick = submit;
        setTimeout(() => {
          inp.focus();
          inp.select();
        }, 60);
      }
    });
  }

  /* ================= 设置抽屉 ================= */
  const ACCENTS = ['#4f8cff', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

  function openDrawer() {
    UI.drawer = true;
    renderDrawer();
    $('#drawer').classList.add('open');
    $('#drawerMask').classList.remove('hidden');
  }

  function closeDrawer() {
    UI.drawer = false;
    $('#drawer').classList.remove('open');
    $('#drawerMask').classList.add('hidden');
  }

  async function renderDrawer() {
    const st = S.settings;
    const meta = await API.stats();
    const backups = await API.listBackups();
    const ver = await API.version();

    const presetTiles = Object.entries(PRESETS)
      .map(
        ([k, p]) =>
          `<div class="wall-tile ${p.tone === 'light' ? 'lt' : ''} ${st.wallpaper.type === 'preset' && st.wallpaper.preset === k ? 'on' : ''}" data-wall="preset:${k}" style="background-image:${p.css}"><span class="lbl">${p.name}</span></div>`
      )
      .join('');

    const backupHTML = backups.length
      ? backups
          .slice(0, 8)
          .map(
            (b) =>
              `<div class="backup-item"><span class="bn" title="${esc(b.name)}">${esc(b.name)}</span><span class="bs">${(b.size / 1024).toFixed(1)}KB</span><button class="mini-btn" data-restore="${esc(b.name)}" title="恢复"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button></div>`
          )
          .join('')
      : '<div class="hint">暂无备份</div>';

    $('#drawerBody').innerHTML = `
      <div class="set-sec">
        <h4>外观</h4>
        <div class="set-row">
          <div class="lbl"><div class="t">主题</div></div>
          <div class="seg" data-seg="theme">
            <button data-v="dark" class="${st.theme === 'dark' ? 'on' : ''}">深色</button>
            <button data-v="light" class="${st.theme === 'light' ? 'on' : ''}">浅色</button>
          </div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">强调色</div></div>
          <div class="swatches">${ACCENTS.map((c) => `<div class="swatch ${st.accent === c ? 'on' : ''}" data-accent="${c}" style="background:${c}"></div>`).join('')}</div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">卡片大小</div></div>
          <div class="seg" data-seg="cardSize">
            <button data-v="sm" class="${st.cardSize === 'sm' ? 'on' : ''}">小</button>
            <button data-v="md" class="${st.cardSize === 'md' ? 'on' : ''}">中</button>
            <button data-v="lg" class="${st.cardSize === 'lg' ? 'on' : ''}">大</button>
          </div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">单个图标尺寸</div><div class="d">右键任意书签 →「图标尺寸…」可单独设为 1×1 / 2×1 / 1×2 / 2×2</div></div>
          <button class="btn" data-act="reset-sizes">全部复位</button>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">单个图标背景色</div><div class="d">右键任意书签 →「图标背景色…」可从系统预设色板挑底色</div></div>
          <button class="btn" data-act="reset-bg">恢复无背景</button>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">显示备注文字</div><div class="d">卡片下方显示一句话备注</div></div>
          <div class="switch ${st.showDesc ? 'on' : ''}" data-toggle="showDesc"></div>
        </div>
      </div>

      <div class="set-sec">
        <h4>背景</h4>
        <div class="wall-grid">${presetTiles}</div>
        <div class="set-row">
          <div class="lbl"><div class="t">自定义图片</div><div class="d">${st.wallpaper.type === 'image' && st.wallpaper.value ? esc(st.wallpaper.value) : '选择本地图片作为背景'}</div></div>
          <button class="btn" data-act="pick-wall">选择图片</button>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">背景模糊</div></div>
          <input type="range" min="0" max="30" value="${st.wallpaper.blur || 0}" data-range="blur" style="width:130px">
          <span style="font-size:11px;color:var(--text-3);width:32px;text-align:right">${st.wallpaper.blur || 0}px</span>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">暗化程度</div></div>
          <input type="range" min="0" max="80" value="${Math.round((st.wallpaper.dim || 0) * 100)}" data-range="dim" style="width:130px">
          <span style="font-size:11px;color:var(--text-3);width:32px;text-align:right">${Math.round((st.wallpaper.dim || 0) * 100)}%</span>
        </div>
      </div>

      <div class="set-sec">
        <h4>行为</h4>
        <div class="set-row">
          <div class="lbl"><div class="t">点击书签用系统浏览器打开</div><div class="d">关闭则用内置窗口（不推荐）</div></div>
          <div class="switch ${st.openInNewTab ? 'on' : ''}" data-toggle="openInNewTab"></div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">关闭窗口时最小化到托盘</div><div class="d">开启后点 × 只是隐藏，从托盘退出</div></div>
          <div class="switch ${st.closeToTray ? 'on' : ''}" data-toggle="closeToTray"></div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">搜索框</div></div>
          <div class="switch ${st.showSearch ? 'on' : ''}" data-toggle="showSearch"></div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">标题栏显示时间</div></div>
          <div class="switch ${st.showClock ? 'on' : ''}" data-toggle="showClock"></div>
        </div>
        <div class="set-row">
          <div class="lbl"><div class="t">默认搜索引擎</div><div class="d">搜索框左侧下拉可随时切换；零匹配时回车自动联网</div></div>
          <select class="select" id="setEngine" style="width:130px;height:32px">
            ${ENGINES
              .map((e) => `<option value="${e.id}" ${st.searchEngine === e.id ? 'selected' : ''}>${esc(e.name)}</option>`)
              .join('')}
          </select>
        </div>
      </div>

      <div class="set-sec">
        <h4>数据</h4>
        <div class="stat-grid" style="margin-bottom:12px">
          <div class="stat-card"><div class="v">${meta.bookmarks}</div><div class="k">书签</div></div>
          <div class="stat-card"><div class="v">${meta.groups}</div><div class="k">分组</div></div>
          <div class="stat-card"><div class="v">${(meta.bytes / 1024).toFixed(0)}<span style="font-size:12px">KB</span></div><div class="k">数据文件</div></div>
          <div class="stat-card"><div class="v">${meta.backups}</div><div class="k">备份</div></div>
        </div>
        <div class="path-box" style="margin-bottom:10px">${esc(meta.file)}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn" data-act="open-dir">打开数据文件夹</button>
          <button class="btn" data-act="backup-now">立即备份</button>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn" data-act="import-browser">从浏览器导入</button>
          <button class="btn" data-act="export-html">导出为书签 HTML</button>
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn" data-act="export-json">导出数据 JSON</button>
          <button class="btn" data-act="import-json">导入数据 JSON</button>
        </div>
        <h4 style="margin-top:18px">最近备份</h4>
        <div>${backupHTML}</div>
      </div>

      <div class="set-sec">
        <h4>关于</h4>
        <div class="set-row" style="display:block">
          <div class="hint" style="margin:0">
            Navio Server v${ver.app} · ${ver.electron} 端<br>
            ${ver.chrome} · Node ${ver.node}<br>
            书签、账号与全部组件数据都保存在宿主机的单个 JSON 文件里，不依赖任何数据库服务。
          </div>
        </div>
      </div>`;

    bindDrawer();
  }

  function bindDrawer() {
    const body = $('#drawerBody');
    const st = S.settings;

    body.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((btn) => {
        btn.onclick = () => {
          const key = seg.dataset.seg;
          st[key] = btn.dataset.v;
          if (key === 'theme') {
            // 主题和壁纸明暗自动配对，避免深色壁纸配深色文字
            const w = S.settings.wallpaper;
            if (w.type === 'preset') {
              const tone = (PRESETS[w.preset] || PRESETS.aurora).tone || 'dark';
              const want = btn.dataset.v === 'light' ? 'light' : 'dark';
              if (tone !== want) w.preset = want === 'light' ? 'dawn' : 'aurora';
            }
            applyTheme();
            applyWallpaper();
          }
          if (key === 'cardSize') applyCardSize();
          scheduleSave();
          renderDrawer();
        };
      });
    });

    body.querySelectorAll('[data-toggle]').forEach((sw) => {
      sw.onclick = () => {
        const k = sw.dataset.toggle;
        st[k] = !st[k];
        sw.classList.toggle('on', st[k]);
        scheduleSave();
        if (k === 'showDesc') render();
        if (k === 'showSearch') applySearchVisible();
        if (k === 'showClock') applyClockVisible();
      };
    });

    body.querySelectorAll('[data-accent]').forEach((sw) => {
      sw.onclick = () => {
        st.accent = sw.dataset.accent;
        applyTheme();
        scheduleSave();
        renderDrawer();
      };
    });

    body.querySelectorAll('[data-wall]').forEach((tile) => {
      tile.onclick = () => {
        const [, key] = tile.dataset.wall.split(':');
        st.wallpaper = { ...st.wallpaper, type: 'preset', preset: key, value: '' };
        applyWallpaper();
        scheduleSave();
        renderDrawer();
      };
    });

    body.querySelectorAll('[data-range]').forEach((r) => {
      r.oninput = () => {
        const k = r.dataset.range;
        if (k === 'blur') st.wallpaper.blur = Number(r.value);
        else st.wallpaper.dim = Number(r.value) / 100;
        r.nextElementSibling.textContent = k === 'blur' ? r.value + 'px' : r.value + '%';
        applyTheme();
        applyWallpaper();
      };
      r.onchange = () => {
        scheduleSave();
      };
    });

    const eng = body.querySelector('#setEngine');
    if (eng)
      eng.onchange = () => {
        st.searchEngine = eng.value;
        syncEngineUI();
        scheduleSave();
      };
    syncEngineUI();

    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        if (act === 'reset-sizes') {
          let n = 0;
          S.bookmarks.forEach((b) => { if (b.size && b.size !== '1x1') { b.size = '1x1'; n++; } });
          scheduleSave();
          render();
          toast(n ? '已复位 ' + n + ' 个图标为 1 × 1' : '当前没有自定义尺寸');
        }
        else if (act === 'reset-bg') {
          let n = 0;
          S.bookmarks.forEach((b) => { if (b.bgColor) { b.bgColor = ''; n++; } });
          scheduleSave();
          render();
          toast(n ? '已恢复 ' + n + ' 个图标为无背景' : '当前没有自定义背景色');
        }
        else if (act === 'open-dir') API.openDataDir().then((r) => toast('已打开：' + r.dir));
        else if (act === 'backup-now')
          API.backup().then((r) => {
            toast(r.ok ? '已备份：' + r.name : '备份失败');
            renderDrawer();
          });
        else if (act === 'pick-wall') pickWallpaper();
        else if (act === 'import-browser') openImportDialog();
        else if (act === 'export-html')
          API.exportHtml({ groups: S.groups, bookmarks: S.bookmarks }).then((r) => {
            if (r.ok) toast(`已导出 ${r.count} 个书签`);
            else if (!r.canceled) toast('导出失败');
          });
        else if (act === 'export-json')
          API.exportData().then((r) => {
            if (r.ok) toast('已导出：' + r.path);
            else if (!r.canceled) toast('导出失败');
          });
        else if (act === 'import-json')
          confirmDialog(
            '导入数据 JSON',
            '导入会覆盖当前全部书签与分组，导入前会自动备份当前数据。',
            '选择文件并导入',
            async () => {
              const r = await API.importData();
              if (r.ok) {
                await reload();
                toast('导入完成：' + r.meta.bookmarks + ' 个书签');
              } else if (!r.canceled) toast('导入失败');
            }
          );
      };
    });

    body.querySelectorAll('[data-restore]').forEach((btn) => {
      btn.onclick = () => {
        const name = btn.dataset.restore;
        confirmDialog('恢复备份', `将用「${name}」覆盖当前数据，当前数据会先自动备份。`, '恢复', async () => {
          const r = await API.restoreBackup(name);
          if (r.ok) {
            await reload();
            toast('已恢复到该备份');
          } else toast('恢复失败：' + r.error);
        });
      };
    });
  }

  async function pickWallpaper() {
    const r = await API.pickWallpaper();
    if (!r.ok) return;
    S.settings.wallpaper = { type: 'image', preset: S.settings.wallpaper.preset, value: r.name, blur: S.settings.wallpaper.blur, dim: S.settings.wallpaper.dim };
    applyWallpaper();
    scheduleSave();
    renderDrawer();
    toast('背景已更新');
  }

  /* ================= 导入浏览器书签 ================= */
  async function openImportDialog() {
    const found = await API.detectBrowsers();
    const list = found.length
      ? found
          .map(
            (f) =>
              `<div class="set-row" style="padding:6px 0"><div class="lbl"><div class="t">${esc(f.name)}</div><div class="d">${esc(f.path)}</div></div><button class="btn" data-bp="${esc(f.path)}">导入</button></div>`
          )
          .join('')
      : '<div class="hint">没有在本机常见位置找到浏览器书签文件。可以在浏览器里导出为 HTML 后手动选择。</div>';

    showModal({
      title: '从浏览器导入书签',
      width: 560,
      body: `<div class="hint" style="margin-bottom:12px">导入后会按原文件夹结构生成分组，重复网址自动跳过。</div>
        ${list}
        <div style="height:1px;background:var(--line);margin:12px 0"></div>
        <button class="btn" data-html>选择书签 HTML 文件…</button>`,
      foot: `<button class="btn ghost" data-cancel>关闭</button>`,
      onMount: (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelectorAll('[data-bp]').forEach((b) => {
          b.onclick = async () => {
            b.disabled = true;
            b.textContent = '读取中…';
            const r = await API.importBrowser(b.dataset.bp);
            b.disabled = false;
            b.textContent = '导入';
            if (!r.ok) return toast('导入失败：' + r.error);
            close();
            previewImport(r);
          };
        });
        m.querySelector('[data-html]').onclick = async () => {
          const r = await API.importHtml();
          if (!r.ok) return;
          close();
          previewImport(r);
        };
      }
    });
  }

  function previewImport(res) {
    const groups = res.groups || [];
    const bms = res.bookmarks || [];
    const preview = groups
      .slice(0, 12)
      .map((g) => {
        const items = bms.filter((b) => b.groupId === g.id);
        return `<div class="ig"><span class="n">${esc(g.name)}</span><span class="u">${items.length} 项</span>
          ${items.slice(0, 4).map((b) => `<div class="ib">· ${esc(b.title)}</div>`).join('')}
          ${items.length > 4 ? `<div class="ib">… 还有 ${items.length - 4} 项</div>` : ''}
        </div>`;
      })
      .join('');

    showModal({
      title: '确认导入',
      width: 560,
      body: `<div class="hint" style="margin-bottom:10px">来源：${esc(res.source || '')} · 共 ${bms.length} 个书签 / ${groups.length} 个分组</div>
        <div class="imp-preview">${preview || '<div class="hint">没有解析到书签</div>'}</div>`,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn" data-replace>清空后导入</button>
             <button class="btn primary" data-merge>合并导入</button>`,
      onMount: (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
          const doImport = (replace) => {
            if (replace) {
              S.groups = [];
              S.bookmarks = [];
            }
            UI.tab = null;
          const urlSet = new Set(S.bookmarks.map((b) => normalizeUrl(b.url)));
          const idMap = new Map();
          groups.forEach((g, i) => {
            const exist = S.groups.find((x) => x.name === g.name);
            if (exist) {
              idMap.set(g.id, exist.id);
            } else {
              const ng = { ...g, id: uid('g_'), order: S.groups.length + i };
              S.groups.push(ng);
              idMap.set(g.id, ng.id);
            }
          });
          // 每组下一个可用 order（一次算好，避免逐个遍历全表）
          const orderMap = new Map();
          S.bookmarks.forEach((b) => {
            orderMap.set(b.groupId, Math.max(orderMap.has(b.groupId) ? orderMap.get(b.groupId) : -1, b.order));
          });
          const takeOrder = (gid) => {
            const v = (orderMap.has(gid) ? orderMap.get(gid) : -1) + 1;
            orderMap.set(gid, v);
            return v;
          };
          const fallbackGid = (S.groups[0] && S.groups[0].id) || '';
          let added = 0;
          let skipped = 0;
          bms.forEach((b) => {
            const u = normalizeUrl(b.url);
            if (!u || urlSet.has(u)) {
              skipped++;
              return;
            }
            urlSet.add(u);
            const gid = idMap.get(b.groupId) || fallbackGid;
            S.bookmarks.push({ ...b, id: uid('b_'), url: u, groupId: gid, order: takeOrder(gid) });
            added++;
          });
          scheduleSave();
          render();
          close();
          toast(`导入完成：新增 ${added} 个${skipped ? `，跳过重复 ${skipped} 个` : ''}`);
        };
        m.querySelector('[data-merge]').onclick = () => doImport(false);
        m.querySelector('[data-replace]').onclick = () =>
          confirmDialog('清空当前数据？', '当前所有分组与书签会被删除（导入前已自动备份到 backups 目录）。', '确认清空并导入', () => doImport(true));
      }
    });
  }

  /* ================= 右键菜单 ================= */
  function showCtx(x, y, items) {
    const menu = $('#ctxMenu');
    menu.innerHTML = items
      .map((it) => {
        if (it.sep) return '<div class="ctx-sep"></div>';
        return `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-k="${esc(it.key)}">${it.icon || ''}<span>${esc(it.label)}</span>${it.kbd ? `<span class="k">${esc(it.kbd)}</span>` : ''}</div>`;
      })
      .join('');
    menu.classList.remove('hidden');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';

    menu.querySelectorAll('[data-k]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const item = items.find((i) => i.key === el.dataset.k);
        hideCtx();
        if (item && item.run) item.run();
      };
    });
  }

  function hideCtx() {
    $('#ctxMenu').classList.add('hidden');
  }

  const IC = {
    open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    move: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    resize: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v18"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4 5 5 0 0 0-5-5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/></svg>'
  };

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    // 图片加载失败 → 露出底下的字母图标（CSP 禁止内联 onerror，用捕获阶段统一处理）
    document.addEventListener(
      'error',
      (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.closest && t.closest('.ico')) t.dataset.failed = '1';
      },
      true
    );

    // 空状态按钮
    $('#emptyState').addEventListener('click', (e) => {
      const b = e.target.closest('[data-empty]');
      if (!b) return;
      if (b.dataset.empty === 'import') openImportDialog();
      else openBookmarkDialog(null, UI.tab !== 'all' ? UI.tab : undefined);
    });

    // 关窗前主进程会请求落盘
    API.onFlushRequest(() => {
      API.flush(S).finally(() => API.flushDone());
    });

    // 窗口按钮
    $('#btnMin').onclick = () => API.minimize();
    $('#btnMax').onclick = () => API.maximize();
    $('#btnClose').onclick = () => API.close();

    // 顶部
    $('#btnAdd').onclick = () => openBookmarkDialog(null, UI.tab !== 'all' ? UI.tab : undefined);
    $('#btnSettings').onclick = () => openDrawer();
    bindWidgetsPanel();
    $('#btnCloseDrawer').onclick = () => closeDrawer();
    $('#drawerMask').onclick = () => closeDrawer();

    // 搜索
    const si = $('#searchInput');
    si.addEventListener('input', () => runSearch(si.value, false));
    si.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitSearch();
      if (e.key === 'Escape') {
        si.value = '';
        runSearch('');
        si.blur();
      }
    });

    // 搜索引擎下拉 + 结果页联网按钮
    initEnginePicker();
    $('#searchResults').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-web]');
      if (!btn) return;
      const qw = btn.getAttribute('data-q') || si.value.trim();
      if (qw) openUrl(engineUrl(S.settings.searchEngine) + encodeURIComponent(qw));
    });

    // 分组标签
    $('#groupTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      const t = btn.dataset.tab;
      if (t === '__add') return openGroupDialog(null);
      UI.tab = t;
      render();
      $('#main').scrollTop = 0;
    });

    // 主区域：卡片点击 / 分组动作
    $('#main').addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.dataset.act;
        const gid = actBtn.dataset.gid;
        if (act === 'add-to-group') return addBookmarkAt(gid);
        if (act === 'rename-group') return openGroupDialog(S.groups.find((g) => g.id === gid) || null);
        if (act === 'del-group') return deleteGroup(gid);
      }
      const card = e.target.closest('.card[data-id]');
      if (card) {
        const b = S.bookmarks.find((x) => x.id === card.dataset.id);
        if (b) openBookmark(b);
      }
    });

    // 右键菜单
    $('#main').addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card[data-id]');
      const head = e.target.closest('.group-head');
      e.preventDefault();
      hideCtx();
      if (card) {
        const b = S.bookmarks.find((x) => x.id === card.dataset.id);
        if (!b) return;
        const others = orderedGroups().filter((g) => g.id !== b.groupId);
        const items = [
          { key: 'open', label: '打开', icon: IC.open, run: () => openBookmark(b) },
          { key: 'edit', label: '编辑…', icon: IC.edit, run: () => openBookmarkDialog(b) },
          { key: 'copy', label: '复制网址', icon: IC.copy, run: () => API.copy(normalizeUrl(b.url)).then(() => toast('已复制网址')) },
          { key: 'copyTitle', label: '复制名称', run: () => API.copy(b.title).then(() => toast('已复制名称')) },
          { sep: true }
        ];
        if (others.length) {
          items.push({
            key: 'move',
            label: '移动到分组',
            icon: IC.move,
            run: () => {
              showModal({
                title: '移动到分组',
                width: 380,
                body: `<div style="display:flex;flex-direction:column;gap:6px;padding-bottom:8px">${others
                  .map((g) => `<button class="btn" style="justify-content:flex-start" data-mv="${esc(g.id)}">${esc(g.name)}</button>`)
                  .join('')}</div>`,
                foot: `<button class="btn ghost" data-cancel>取消</button>`,
                onMount: (m, close) => {
                  m.querySelector('[data-cancel]').onclick = close;
                  m.querySelectorAll('[data-mv]').forEach((btn) => {
                    btn.onclick = () => {
                      moveBookmark(b.id, btn.dataset.mv, 9999);
                      close();
                    };
                  });
                }
              });
            }
          });
        }
        items.push({
          key: 'size',
          label: '图标尺寸…',
          icon: IC.resize,
          run: () => openSizeDialog(b)
        });
        items.push({
          key: 'bg',
          label: '图标背景色…',
          icon: IC.palette,
          run: () => openBgDialog(b)
        });
        items.push({
          key: 'refetch',
          label: '重新抓取图标',
          icon: IC.refresh,
          run: async () => {
            await API.refreshIcon(normalizeUrl(b.url));
            b.icon = '/api/icon?host=' + encodeURIComponent(hostKey(b.url)) +
              '&url=' + encodeURIComponent(normalizeUrl(b.url)) + '&t=' + Date.now();
            scheduleSave();
            render();
            toast('图标已刷新');
          }
        });
        items.push({ sep: true });
        items.push({ key: 'del', label: '删除', icon: IC.trash, danger: true, run: () => deleteBookmark(b.id) });
        return showCtx(e.clientX, e.clientY, items);
      }
      if (head) {
        const gid = head.dataset.gid;
        const g = S.groups.find((x) => x.id === gid);
        if (!g) return;
        return showCtx(e.clientX, e.clientY, [
          { key: 'addB', label: '在此分组添加书签', icon: IC.plus, run: () => addBookmarkAt(gid) },
          { key: 'rename', label: '重命名分组', icon: IC.edit, run: () => openGroupDialog(g) },
          { sep: true },
          { key: 'delg', label: '删除分组', icon: IC.trash, danger: true, run: () => deleteGroup(gid) }
        ]);
      }
      // 空白处
      showCtx(e.clientX, e.clientY, [
        { key: 'newb', label: '新建书签', icon: IC.plus, run: () => openBookmarkDialog(null, UI.tab !== 'all' ? UI.tab : undefined) },
        { key: 'newg', label: '新建分组', icon: IC.plus, run: () => openGroupDialog(null) },
        { sep: true },
        { key: 'refresh', label: '刷新界面', icon: IC.refresh, run: () => render() }
      ]);
    });

    // 左侧分类右键：与主区域分组头保持一致的菜单
    const sidebar = $('#sidebar');
    if (sidebar) {
      sidebar.addEventListener('contextmenu', (e) => {
        const item = e.target.closest('.side-item[data-key]');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        hideCtx();
        const gid = item.dataset.key;
        if (gid === '__add') return; // 「新建标签」不走分类菜单
        const g = S.groups.find((x) => x.id === gid);
        if (!g) return;
        showCtx(e.clientX, e.clientY, [
          { key: 'addB', label: '在此分类添加书签', icon: IC.plus, run: () => addBookmarkAt(gid) },
          { key: 'rename', label: '重命名分类', icon: IC.edit, run: () => openGroupDialog(g) },
          { sep: true },
          { key: 'delg', label: '删除分类', icon: IC.trash, danger: true, run: () => deleteGroup(gid) }
        ]);
      });
    }

    document.addEventListener('click', () => hideCtx());
    window.addEventListener('blur', () => hideCtx());

    // 拖拽
    bindDrag();

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const si2 = $('#searchInput');
        si2.focus();
        si2.select();
      } else if (mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        openBookmarkDialog(null, UI.tab !== 'all' ? UI.tab : undefined);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        openDrawer();
      } else if (e.key === 'Escape') {
        if (!$('#ctxMenu').classList.contains('hidden')) hideCtx();
        else if (UI.drawer) closeDrawer();
      }
    });

    // 退出前落盘
    window.addEventListener('beforeunload', () => {
      if (pendingSave) API.flush(S);
    });

    API.onToast((m) => toast(m));
    API.onMaximized((v) => {
      const b = $('#btnMax');
      b.title = v ? '还原' : '最大化';
    });
  }

  /* ================= 拖拽 ================= */
  let DRAG = null;

  function bindDrag() {
    const main = $('#main');

    main.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.card[data-id]');
      const head = e.target.closest('.group-head');
      if (card) {
        DRAG = { type: 'bookmark', id: card.dataset.id };
        card.classList.add('dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.dataset.id);
        } catch (_) {}
      } else if (head) {
        DRAG = { type: 'group', id: head.dataset.gid };
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', head.dataset.gid);
        } catch (_) {}
        head.style.opacity = '.4';
      }
    });

    main.addEventListener('dragend', () => {
      DRAG = null;
      $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
      $$('.card.drag-over-left,.card.drag-over-right').forEach((c) => c.classList.remove('drag-over-left', 'drag-over-right'));
      $$('.group-head').forEach((h) => (h.style.opacity = ''));
      $$('.group.drop-target').forEach((g) => g.classList.remove('drop-target'));
    });

    main.addEventListener('dragover', (e) => {
      if (!DRAG) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (DRAG.type === 'bookmark') {
        const card = e.target.closest('.card[data-id]');
        $$('.card.drag-over-left,.card.drag-over-right').forEach((c) => c.classList.remove('drag-over-left', 'drag-over-right'));
        if (card && card.dataset.id !== DRAG.id) {
          const r = card.getBoundingClientRect();
          const mid = r.left + r.width / 2;
          card.classList.add(e.clientX < mid ? 'drag-over-left' : 'drag-over-right');
        }
      }
    });

    main.addEventListener('drop', (e) => {
      if (!DRAG) return;
      e.preventDefault();

      if (DRAG.type === 'bookmark') {
        const card = e.target.closest('.card[data-id]');
        const grid = e.target.closest('.grid');
        if (card && card.dataset.id !== DRAG.id) {
          const r = card.getBoundingClientRect();
          const after = e.clientX >= r.left + r.width / 2;
          const targetB = S.bookmarks.find((x) => x.id === card.dataset.id);
          if (targetB) {
            const list = S.bookmarks.filter((b) => b.groupId === targetB.groupId && b.id !== DRAG.id).sort((a, b) => a.order - b.order);
            let idx = list.findIndex((b) => b.id === targetB.id);
            if (after) idx += 1;
            moveBookmark(DRAG.id, targetB.groupId, idx);
          }
        } else if (grid) {
          const gid = grid.dataset.gid;
          moveBookmark(DRAG.id, gid, 9999);
        }
      } else if (DRAG.type === 'group') {
        const targetGid = e.target.closest('.group') ? e.target.closest('.group').dataset.gid : null;
        if (targetGid && targetGid !== DRAG.id) {
          const ids = orderedGroups().map((g) => g.id).filter((x) => x !== DRAG.id);
          moveGroup(DRAG.id, ids.indexOf(targetGid));
        }
      }
      DRAG = null;
    });

    // 左侧分类作为拖放目标：把书签卡片拖到分类上即移动过去
    const sidebar = $('#sidebar');
    if (sidebar) {
      const clearSideHover = () => {
        $$('.side-item.cat-drop').forEach((el) => el.classList.remove('cat-drop'));
        sidebar.classList.remove('cat-drop-root');
      };

      sidebar.addEventListener('dragover', (e) => {
        if (!DRAG || DRAG.type !== 'bookmark') return;
        const item = e.target.closest('.side-item[data-key]');
        if (!item || item.dataset.key === '__add') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearSideHover();
        item.classList.add('cat-drop');
        sidebar.classList.add('cat-drop-root');
      });

      sidebar.addEventListener('dragleave', (e) => {
        if (e.target === sidebar || !sidebar.contains(e.relatedTarget)) clearSideHover();
      });

      sidebar.addEventListener('drop', (e) => {
        if (!DRAG || DRAG.type !== 'bookmark') return;
        const item = e.target.closest('.side-item[data-key]');
        clearSideHover();
        if (!item || item.dataset.key === '__add') return;
        e.preventDefault();
        const gid = item.dataset.key;
        const b = S.bookmarks.find((x) => x.id === DRAG.id);
        const targetG = S.groups.find((x) => x.id === gid);
        DRAG = null;
        if (!b || !targetG) return;
        if (b.groupId === gid) {
          toast('已在此分类');
          return;
        }
        const n = countOf(gid);
        moveBookmark(b.id, gid, 9999);
        toast('已移动到「' + targetG.name + '」· ' + (n + 1) + ' 项');
      });
    }
  }

  /* ================= 显示开关应用 ================= */
  function applySearchVisible() {
    $('#searchWrap').style.display = S.settings.showSearch ? '' : 'none';
  }
  function applyClockVisible() {
    $('#tbClock').style.display = S.settings.showClock ? '' : 'none';
  }

  /* ================= 时钟 ================= */
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function tickClock() {
    if (!S || !S.settings.showClock) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const hm = S.settings.clock24h ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${((d.getHours() + 11) % 12) + 1}:${p(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    $('#tbClock').textContent = `${d.getMonth() + 1}-${p(d.getDate())} ${WEEK[d.getDay()]} ${hm}`;
  }

  /* ================= 阶段 2：卡片组件（待办 / 日历 / 天气 / 记事本）v2 ================= */
  const WIDGET_DEFS = {
    todo: {
      name: '待办事项', desc: '快速记下要做的事，可关联日期与优先级',
      icon: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'
    },
    calendar: {
      name: '日历', desc: '月历 + 农历节日，点日期看当天待办',
      icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
    },
    weather: {
      name: '天气', desc: '天气图标 / 体感 / 湿度 / 多日预报，离线可手动填',
      icon: '<path d="M6 16a4 4 0 0 1 .6-7.95A6 6 0 0 1 18 10a3.5 3.5 0 0 1 0 7H6z"/>'
    },
    notes: {
      name: '记事本', desc: '多条笔记，卡片预览，支持置顶与搜索',
      icon: '<path d="M5 3h11l3 3v15H5zM16 3v3h3M8 11h8M8 15h8"/>'
    }
  };
  const WIDGET_TYPES = ['todo', 'calendar', 'weather', 'notes'];
  const WG = {
    show: true, calY: 0, calM: 0, pickedDate: '', busy: false, bound: false,
    todoFilter: 'active', noteSearch: '', editTodoId: '', cityDraft: ''
  };
  const WG_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '重庆'];

  /* ---------- 农历（1900-2100 精简算法，用于日历节日显示） ---------- */
  const LUNAR_INFO = [
    0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
    0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
    0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
    0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
    0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
    0x06ca0,0x0b550,0x15355,0x04da0,0x0a5d0,0x14573,0x052d0,0x0a9a8,0x0e950,0x06aa0,
    0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
    0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
    0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
    0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,
    0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
    0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
    0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
    0x05aa0,0x076a3,0x096d0,0x04bd7,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
    0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
    0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,
    0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
    0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
    0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
    0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,
    0x0d520
  ];
  const LUNAR_MONTHS = ['正','二','三','四','五','六','七','八','九','十','冬','腊'];
  const LUNAR_DAYS = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
  const SOLAR_FEST = { '1-1':'元旦','2-14':'情人节','3-8':'妇女节','3-12':'植树节','4-1':'愚人节','5-1':'劳动节','5-4':'青年节','6-1':'儿童节','7-1':'建党节','8-1':'建军节','9-10':'教师节','10-1':'国庆节','11-11':'双十一','12-24':'平安夜','12-25':'圣诞节' };
  const LUNAR_FEST = { '1-1':'春节','1-15':'元宵','2-2':'龙抬头','5-5':'端午','7-7':'七夕','7-15':'中元','8-15':'中秋','9-9':'重阳','12-8':'腊八' };

  function lLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
  function lLeapDays(y) { return lLeapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0; }
  function lMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
  function lYearDays(y) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
    return sum + lLeapDays(y);
  }
  function solarToLunar(y, m, d) {
    if (y < 1900 || y > 2100) return null;
    let offset = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);
    let temp = 0, i;
    for (i = 1900; i < 2101 && offset > 0; i++) { temp = lYearDays(i); offset -= temp; }
    if (offset < 0) { offset += temp; i--; }
    const ly = i, leap = lLeapMonth(ly);
    let isLeap = false;
    for (i = 1; i < 13 && offset > 0; i++) {
      if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = lLeapDays(ly); }
      else { temp = lMonthDays(ly, i); }
      if (isLeap && i === leap + 1) isLeap = false;
      if (offset < temp) break;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && i === leap + 1) {
      if (isLeap) isLeap = false; else { isLeap = true; --i; }
    }
    if (offset < 0) { offset += temp; --i; }
    return { year: ly, month: i, day: offset + 1, isLeap };
  }
  function dayLabel(y, m, d) {
    const sk = m + '-' + d;
    if (SOLAR_FEST[sk]) return SOLAR_FEST[sk];
    const l = solarToLunar(y, m, d);
    if (!l) return '';
    const lk = l.month + '-' + l.day;
    if (!l.isLeap && LUNAR_FEST[lk]) return LUNAR_FEST[lk];
    if (l.day === 1) return (l.isLeap ? '闰' : '') + LUNAR_MONTHS[l.month - 1] + '月';
    return LUNAR_DAYS[l.day - 1];
  }

  /* ---------- 天气图标（按 icon 类型） ---------- */
  function wgWeatherIcon(type, big) {
    const cls = big ? 'wg-wico big' : 'wg-wico';
    const sun = '<circle cx="12" cy="12" r="4.2"/>';
    const sunRays = '<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>';
    const cloud = '<path d="M6.5 18a4 4 0 0 1 .5-7.96A6 6 0 0 1 18.5 11.5 3.5 3.5 0 0 1 18 18H6.5z"/>';
    const rain = '<path d="M7 15.5l-1 3M12 15.5l-1 3M17 15.5l-1 3"/>';
    const snow = '<path d="M8 17h.01M12 18.5h.01M16 17h.01"/>';
    const fog = '<path d="M5 16h14M7 19h10"/>';
    const storm = '<path d="M13 14l-3 4h3l-1 3 4-5h-3l1-2z"/>';
    let inner = cloud;
    if (type === 'sun') inner = sun + sunRays;
    else if (type === 'cloud') inner = cloud;
    else if (type === 'rain') inner = cloud + rain;
    else if (type === 'snow') inner = cloud + snow;
    else if (type === 'fog') inner = cloud + fog;
    else if (type === 'storm') inner = cloud + storm;
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>';
  }

  function wgShortTime(iso) {
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (_) { return ''; }
  }
  function wgTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 数据层字段 store.normalize 已预留，这里只做兜底、首次播种与旧字段升级 */
  function ensureWidgetState() {
    if (!Array.isArray(S.widgets)) S.widgets = [];
    if (!Array.isArray(S.todos)) S.todos = [];
    if (!Array.isArray(S.notes)) S.notes = [];
    // 旧数据补默认字段（不覆盖已有值）
    let upgraded = false;
    (S.todos || []).forEach((t) => {
      if (typeof t.priority !== 'number') { t.priority = 0; upgraded = true; }
    });
    (S.notes || []).forEach((n) => {
      if (typeof n.pinned !== 'boolean') { n.pinned = false; upgraded = true; }
    });
    if (!S.widgets.length) {
      S.widgets = WIDGET_TYPES.map((t, i) => ({ id: uid('w_'), type: t, enabled: true, order: i, data: {} }));
      upgraded = true;
    }
    if (upgraded) scheduleSave();
  }
  function widgetByType(type) {
    return (S.widgets || []).find((w) => w.type === type && w.enabled);
  }

  /* ---------- 待办 ---------- */
  function wgTodoHTML() {
    let todos = (S.todos || []).slice();
    const total = todos.length;
    const done = todos.filter((t) => t.done).length;
    const active = total - done;
    // 优先级高的排前，其余保持原顺序
    todos.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    if (WG.todoFilter === 'active') todos = todos.filter((t) => !t.done);
    else if (WG.todoFilter === 'done') todos = todos.filter((t) => t.done);
    const pct = total ? Math.round(done / total * 100) : 0;
    const ring = `<div class="wg-ring" style="--pct:${pct}">
        <svg viewBox="0 0 36 36"><circle class="r-bg" cx="18" cy="18" r="15.5"/><circle class="r-fg" cx="18" cy="18" r="15.5"/></svg>
        <span>${pct}<small>%</small></span>
      </div>`;
    const list = todos.slice(0, 8).map((t) => {
      const editing = WG.editTodoId === t.id;
      const main = editing
        ? `<input class="wg-todo-edit" data-tid="${esc(t.id)}" value="${esc(t.text)}" maxlength="200">`
        : `<span class="wg-todo-text ${t.done ? 'done-txt' : ''}" data-wact="todo-edit" data-tid="${esc(t.id)}" title="双击编辑">${esc(t.text)}</span>`;
      return `<div class="wg-todo-item ${t.done ? 'done' : ''}">
        <button class="wg-check ${t.done ? 'on' : ''}" data-wact="todo-toggle" data-tid="${esc(t.id)}" title="切换完成">${t.done ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : ''}</button>
        ${main}
        <button class="wg-star ${t.priority ? 'on' : ''}" data-wact="todo-priority" data-tid="${esc(t.id)}" title="标星优先级">★</button>
        ${t.due ? `<span class="wg-todo-due" title="关联日期">${esc(String(t.due).slice(5))}</span>` : ''}
        <button class="wg-del" data-wact="todo-del" data-tid="${esc(t.id)}" title="删除">×</button>
      </div>`;
    }).join('');
    const filterBar = `<div class="wg-seg">
        <button data-wact="todo-filter" data-f="active" class="${WG.todoFilter === 'active' ? 'on' : ''}">未完成 ${active}</button>
        <button data-wact="todo-filter" data-f="done" class="${WG.todoFilter === 'done' ? 'on' : ''}">已完成 ${done}</button>
        <button data-wact="todo-filter" data-f="all" class="${WG.todoFilter === 'all' ? 'on' : ''}">全部 ${total}</button>
      </div>`;
    return {
      sub: `${active} 项待办`,
      body: `${ring}<div class="wg-todo-list">${list || `<div class="wg-empty">${WG.todoFilter === 'active' && done ? '未完成都清光啦 🎉' : '还没有待办，在下面添加一条。'}</div>`}</div>`,
      foot: `${filterBar}
        <div class="wg-addrow"><input class="wg-input" name="todo" placeholder="添加待办，回车确认…" autocomplete="off"><button class="wg-mini primary" data-wact="todo-add">添加</button></div>
        <div class="wg-hint">${WG.pickedDate ? `新待办关联 <b>${esc(WG.pickedDate)}</b> · <span data-wact="cal-clear" class="wg-link">清除</span>` : '双击文字可编辑 · 点日历选日期'}${done ? ` · <span class="wg-link" data-wact="todo-clear-done">清空已完成</span>` : ''}</div>`
    };
  }

  /* ---------- 日历 ---------- */
  function wgCalendarHTML() {
    const now = new Date();
    if (!WG.calY) { WG.calY = now.getFullYear(); WG.calM = now.getMonth(); }
    const y = WG.calY, m = WG.calM;
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const dueMap = {};
    (S.todos || []).forEach((t) => {
      if (t.due && !t.done) { (dueMap[t.due] = dueMap[t.due] || []).push(t); }
    });
    const weeks = ['日','一','二','三','四','五','六'].map((x) => `<div class="wg-cal-w">${x}</div>`).join('');
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<div class="wg-cal-cell blank"></div>';
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const label = dayLabel(y, m + 1, d);
      const cls = [ds === wgTodayStr() ? 'today' : '', dueMap[ds] ? 'has-due' : '', WG.pickedDate === ds ? 'picked' : ''].filter(Boolean).join(' ');
      cells += `<button class="wg-cal-cell ${cls}" data-wact="cal-day" data-date="${ds}" title="${ds} ${esc(label)}">
        <span class="d">${d}</span><span class="l">${esc(label)}</span>${dueMap[ds] ? `<i class="dot">${Math.min(dueMap[ds].length, 9)}</i>` : ''}
      </button>`;
    }
    // 选中日的待办清单
    let pickedList = '';
    if (WG.pickedDate) {
      const dayTodos = (S.todos || []).filter((t) => t.due === WG.pickedDate);
      pickedList = `<div class="wg-daylist">
        <div class="wg-daylist-h">${esc(WG.pickedDate.slice(5))} 的待办 <span data-wact="cal-clear" class="wg-link">清除选择</span></div>
        ${dayTodos.length ? dayTodos.map((t) => `<div class="wg-dayitem ${t.done ? 'done' : ''}"><button class="wg-check ${t.done ? 'on' : ''}" data-wact="todo-toggle" data-tid="${esc(t.id)}">${t.done ? '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' : ''}</button><span>${esc(t.text)}</span></div>`).join('') : '<div class="wg-empty">这天没有待办</div>'}
      </div>`;
    }
    return {
      sub: `${y}年${m + 1}月`,
      body: `<div class="wg-cal-nav">
          <button data-wact="cal-prev" title="上个月">‹</button>
          <span>${y} 年 ${m + 1} 月</span>
          <button data-wact="cal-next" title="下个月">›</button>
          <button data-wact="cal-today" class="wg-today-btn" title="回到本月">今天</button>
        </div>
        <div class="wg-cal-grid">${weeks}${cells}</div>${pickedList}`,
      foot: `<div class="wg-hint">${WG.pickedDate ? `已选 <b>${esc(WG.pickedDate)}</b>，新待办会带上这个日期` : '点日期查看当天待办 / 为待办设日期'}</div>`
    };
  }

  /* ---------- 天气 ---------- */
  function wgWeatherHTML(w) {
    const d = w.data || {};
    const num = Number(d.temp);
    const hasTemp = d.temp !== null && d.temp !== undefined && d.temp !== '' && Number.isFinite(num);
    const shown = hasTemp ? String(Math.round(num)) : '--';
    const fcs = Array.isArray(d.forecast) ? d.forecast.slice(0, 5) : [];
    const forecastHTML = fcs.length ? `<div class="wg-fc">${fcs.map((f, i) => `
        <div class="wg-fc-day">
          <span class="fd">${i === 0 ? '今天' : esc(f.date || '')}</span>
          ${wgWeatherIcon(f.icon || 'cloud')}
          <span class="ft">${f.tmax != null ? Math.round(f.tmax) + '°' : '--'}<em>${f.tmin != null ? Math.round(f.tmin) + '°' : ''}</em></span>
        </div>`).join('')}</div>` : '';
    const chipBar = `<div class="wg-city-chips">${WG_CITIES.slice(0, 6).map((c) => `<button data-wact="weather-city" data-city="${esc(c)}" class="${d.city === c ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>`;
    return {
      sub: d.updatedAt ? '已更新' : '离线',
      body: `<div class="wg-weather-main">
          ${wgWeatherIcon(d.icon || 'cloud', true)}
          <div class="wg-wx-info">
            <div class="wg-temp">${shown}<small>°C</small></div>
            <div class="wg-desc">${esc(d.desc || '点「联网获取」或手动填写')}</div>
          </div>
        </div>
        <div class="wg-weather-meta">
          <span class="wg-city">📍 ${esc(d.city || '未设置城市')}${d.country ? ' · ' + esc(d.country) : ''}</span>
          ${d.apparent != null ? `<span title="体感温度">体感 ${Math.round(d.apparent)}°</span>` : ''}
          ${d.humidity != null ? `<span title="湿度">湿度 ${Math.round(d.humidity)}%</span>` : ''}
          ${d.wind != null ? `<span title="风速">风 ${Math.round(d.wind)}km/h</span>` : ''}
          ${d.updatedAt ? `<span>${esc(wgShortTime(d.updatedAt))}</span>` : ''}
        </div>${forecastHTML}`,
      foot: `<div class="wg-addrow"><input class="wg-input" name="city" placeholder="城市，如 北京" value="${esc(d.city || '')}" autocomplete="off"><button class="wg-mini primary" data-wact="weather-fetch">获取</button><button class="wg-mini" data-wact="weather-edit">手动</button></div>${chipBar}`
    };
  }

  /* ---------- 记事本 ---------- */
  function wgNotesHTML() {
    let notes = (S.notes || []).slice();
    const kw = WG.noteSearch.trim().toLowerCase();
    if (kw) notes = notes.filter((n) => String(n.title || '').toLowerCase().includes(kw) || String(n.body || '').toLowerCase().includes(kw));
    notes.sort((a, b) => (Number(b.pinned ? 1 : 0) - Number(a.pinned ? 1 : 0)));
    const list = notes.slice(0, 8).map((n) => {
      const preview = String(n.body || '').replace(/\s+/g, ' ').slice(0, 60);
      return `<div class="wg-note-item" data-wact="note-open" data-nid="${esc(n.id)}">
        <div class="wg-note-main"><div class="wg-note-t">${n.pinned ? '<span class="pin">📌</span>' : ''}${esc(n.title || '未命名笔记')}</div>
        <div class="wg-note-p">${esc(preview || '（空）')}</div></div>
        <button class="wg-note-pin ${n.pinned ? 'on' : ''}" data-wact="note-pin" data-nid="${esc(n.id)}" title="置顶">📌</button>
        <em>${esc(wgShortTime(n.updatedAt))}</em>
      </div>`;
    }).join('');
    return {
      sub: `${(S.notes || []).length} 条`,
      body: `<input class="wg-input wg-search" name="noteSearch" placeholder="🔍 搜索笔记标题或内容…" value="${esc(WG.noteSearch)}" autocomplete="off">
        <div class="wg-note-list">${list || `<div class="wg-empty">${kw ? '没有匹配的笔记' : '还没有笔记，点下面新建一条。'}</div>`}</div>`,
      foot: `<button class="wg-mini primary" data-wact="note-new">＋ 新建笔记</button>`
    };
  }

  function wgCardHTML(w) {
    const def = WIDGET_DEFS[w.type];
    const part = w.type === 'todo' ? wgTodoHTML()
      : w.type === 'calendar' ? wgCalendarHTML()
      : w.type === 'weather' ? wgWeatherHTML(w)
      : wgNotesHTML();
    const tone = w.type === 'todo' ? 'tone-blue' : w.type === 'calendar' ? 'tone-violet' : w.type === 'weather' ? 'tone-sky' : 'tone-amber';
    return `<div class="wg-card ${tone}" data-wid="${esc(w.id)}" data-wtype="${esc(w.type)}">
      <div class="wg-head">
        <div class="wg-ico"><svg viewBox="0 0 24 24">${def.icon}</svg></div>
        <div class="wg-title">${esc(def.name)}</div>
        <span class="wg-sub">${esc(part.sub || '')}</span>
        <button class="wg-x" data-wact="hide" title="隐藏此组件"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="wg-body">${part.body}</div>
      <div class="wg-foot">${part.foot}</div>
    </div>`;
  }

  function renderWidgets() {
    if (!S) return;
    ensureWidgetState();
    const panel = $('#widgetsPanel');
    if (!panel) return;
    const on = S.widgets.filter((w) => w.enabled && WIDGET_DEFS[w.type]).sort((a, b) => (a.order || 0) - (b.order || 0));
    const btn = $('#btnWidgets');
    if (btn) btn.classList.toggle('wg-on', WG.show && on.length > 0);
    if (!WG.show || !on.length) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    panel.innerHTML = on.map(wgCardHTML).join('');
  }

  /* ---------- 交互 ---------- */
  function wgAddTodo(text) {
    const v = String(text || '').trim().slice(0, 200);
    if (!v) { toast('先写点内容'); return; }
    S.todos.unshift({ id: uid('t_'), text: v, done: false, priority: 0, due: WG.pickedDate || '', createdAt: new Date().toISOString() });
    WG.todoFilter = 'active';
    scheduleSave();
    renderWidgets();
    const inp = $('#widgetsPanel input[name="todo"]');
    if (inp) { inp.value = ''; inp.focus(); }
  }
  function wgSaveTodoEdit(id, text) {
    const v = String(text || '').trim().slice(0, 200);
    WG.editTodoId = '';
    const t = (S.todos || []).find((x) => x.id === id);
    if (t && v) { t.text = v; scheduleSave(); }
    renderWidgets();
  }
  function wgCalMove(delta) {
    let y = WG.calY, m = WG.calM + delta;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    WG.calY = y; WG.calM = m;
    renderWidgets();
  }

  async function wgFetchWeather(w, forcedCity) {
    if (WG.busy) return;
    const inp = $('#widgetsPanel input[name="city"]');
    const city = String(forcedCity || (inp && inp.value) || (w.data && w.data.city) || '').trim();
    if (!city) { toast('先填一个城市名，例如 北京'); return; }
    WG.busy = true;
    toast('正在获取天气…');
    try {
      const r = await fetch('/api/weather?city=' + encodeURIComponent(city), { credentials: 'same-origin' });
      const j = await r.json();
      if (!j.ok) { toast(j.error || '获取失败，可点「手动填」'); return; }
      w.data = {
        city: j.city, country: j.country, temp: j.temp, apparent: j.apparent,
        humidity: j.humidity, code: j.code, icon: j.icon, isDay: j.isDay,
        desc: j.desc, wind: j.wind, updatedAt: j.updatedAt, forecast: j.forecast || []
      };
      scheduleSave();
      renderWidgets();
      toast('天气已更新：' + j.city);
    } catch (err) {
      toast('获取失败：' + err.message + '，可点「手动填」');
    } finally { WG.busy = false; }
  }

  function wgEditWeather(w) {
    const d = w.data || {};
    showModal({
      title: '手动填写天气', width: 420,
      body: `<div class="field"><label>城市</label><input class="input" id="wgWCity" value="${esc(d.city || '')}" placeholder="例如 北京"></div>
             <div class="field"><label>温度（°C）</label><input class="input" id="wgWTemp" value="${d.temp == null ? '' : esc(String(d.temp))}" placeholder="例如 26"></div>
             <div class="field"><label>天气描述</label><input class="input" id="wgWDesc" value="${esc(d.desc || '')}" placeholder="例如 晴"></div>`,
      foot: '<button class="btn ghost" data-cancel>取消</button><button class="btn primary" data-ok>保存</button>',
      onMount: (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelector('[data-ok]').onclick = () => {
          const city = m.querySelector('#wgWCity').value.trim() || '本地';
          const raw = m.querySelector('#wgWTemp').value.trim();
          const temp = raw === '' ? null : Number(raw);
          const desc = m.querySelector('#wgWDesc').value.trim() || '未知';
          const icon = /雨/.test(desc) ? 'rain' : /雪/.test(desc) ? 'snow' : /雾/.test(desc) ? 'fog' : /雷/.test(desc) ? 'storm' : /云|阴/.test(desc) ? 'cloud' : 'sun';
          w.data = {
            city, temp: Number.isFinite(temp) ? temp : null,
            desc, icon, apparent: d.apparent == null ? null : d.apparent,
            humidity: d.humidity == null ? null : d.humidity,
            wind: d.wind == null ? null : d.wind,
            updatedAt: new Date().toISOString(), forecast: d.forecast || []
          };
          scheduleSave(); renderWidgets(); close(); toast('天气已保存');
        };
      }
    });
  }

  function wgEditNote(id) {
    const note = id ? (S.notes || []).find((n) => n.id === id) : null;
    showModal({
      title: note ? '编辑笔记' : '新建笔记', width: 520,
      body: `<div class="field"><label>标题</label><input class="input" id="wgNTitle" value="${esc(note ? note.title : '')}" placeholder="标题"></div>
             <div class="field"><label>内容</label><textarea class="wg-note-editor" id="wgNBody" placeholder="写点什么…">${esc(note ? note.body : '')}</textarea></div>`,
      foot: `${note ? '<button class="btn danger" data-del>删除</button>' : ''}<span style="flex:1"></span><button class="btn ghost" data-cancel>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount: (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelector('[data-ok]').onclick = () => {
          const title = m.querySelector('#wgNTitle').value.trim() || '未命名笔记';
          const body = m.querySelector('#wgNBody').value;
          if (note) { note.title = title; note.body = body; note.updatedAt = new Date().toISOString(); }
          else S.notes.unshift({ id: uid('n_'), title, body, pinned: false, updatedAt: new Date().toISOString() });
          scheduleSave(); renderWidgets(); close(); toast('笔记已保存');
        };
        const del = m.querySelector('[data-del]');
        if (del) del.onclick = () => {
          S.notes = (S.notes || []).filter((n) => n.id !== note.id);
          scheduleSave(); renderWidgets(); close(); toast('笔记已删除');
        };
        setTimeout(() => m.querySelector('#wgNTitle').focus(), 60);
      }
    });
  }

  function openWidgetManager() {
    ensureWidgetState();
    const rows = WIDGET_TYPES.map((t) => {
      const w = (S.widgets || []).find((x) => x.type === t);
      const def = WIDGET_DEFS[t];
      return `<div class="wg-manage-row">
        <div class="wg-ico"><svg viewBox="0 0 24 24">${def.icon}</svg></div>
        <div class="m-name">${esc(def.name)}<span class="m-desc">${esc(def.desc)}</span></div>
        <button class="wg-switch ${w && w.enabled ? 'on' : ''}" data-wtype="${t}" title="启用/关闭"></button>
      </div>`;
    }).join('');
    showModal({
      title: '卡片组件', width: 480,
      body: `<div class="wg-hint" style="margin-bottom:10px">组件数据（待办、笔记、天气设置）与书签一起保存在同一个 JSON 文件里，改动自动保存。</div>
             <div class="wg-manage-list">${rows}</div>
             <div style="margin-top:14px"><button class="btn" id="wgTogglePanel">${WG.show ? '隐藏组件面板' : '显示组件面板'}</button></div>`,
      foot: '<button class="btn primary" data-done>完成</button>',
      onMount: (m, close) => {
        m.querySelectorAll('.wg-switch').forEach((b) => {
          b.onclick = () => {
            const w = (S.widgets || []).find((x) => x.type === b.dataset.wtype);
            if (!w) return;
            w.enabled = !w.enabled;
            b.classList.toggle('on', w.enabled);
            scheduleSave(); renderWidgets();
          };
        });
        m.querySelector('#wgTogglePanel').onclick = (e) => {
          WG.show = !WG.show;
          e.target.textContent = WG.show ? '隐藏组件面板' : '显示组件面板';
          renderWidgets();
        };
        m.querySelector('[data-done]').onclick = close;
      }
    });
  }

  function bindWidgetsPanel() {
    if (WG.bound) return;
    const panel = $('#widgetsPanel');
    const btn = $('#btnWidgets');
    if (!panel || !btn) return;
    WG.bound = true;
    btn.onclick = () => openWidgetManager();
    panel.addEventListener('click', onWidgetClick);
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const inp = e.target.closest('input[name="todo"], input[name="city"]');
      if (!inp) return;
      e.preventDefault();
      if (inp.name === 'todo') wgAddTodo(inp.value);
      else { const w = widgetByType('weather'); if (w) wgFetchWeather(w); }
    });
    panel.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-wact="todo-edit"]');
      if (el) { WG.editTodoId = el.dataset.tid; renderWidgets(); const edit = $('#widgetsPanel .wg-todo-edit'); if (edit) { edit.focus(); edit.select(); } }
    });
    // 编辑框失焦保存（focusout 冒泡）
    panel.addEventListener('focusout', (e) => {
      if (e.target.matches('.wg-todo-edit')) wgSaveTodoEdit(e.target.dataset.tid, e.target.value);
    });
    panel.addEventListener('input', (e) => {
      if (e.target.name === 'noteSearch') {
        WG.noteSearch = e.target.value;
        const pos = e.target.selectionStart;
        renderWidgets();
        const again = $('#widgetsPanel input[name="noteSearch"]');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
      }
    });
  }

  async function onWidgetClick(e) {
    const el = e.target.closest('[data-wact]');
    if (!el) return;
    const act = el.dataset.wact;
    const card = el.closest('.wg-card');
    const w = card ? (S.widgets || []).find((x) => x.id === card.dataset.wid) : null;
    e.stopPropagation();
    switch (act) {
      case 'hide':
        if (w) { w.enabled = false; scheduleSave(); renderWidgets(); toast('已隐藏，可在「组件」里重新开启'); }
        break;
      case 'todo-add': {
        const inp = $('#widgetsPanel input[name="todo"]');
        wgAddTodo(inp ? inp.value : '');
        break;
      }
      case 'todo-toggle': {
        const t = (S.todos || []).find((x) => x.id === el.dataset.tid);
        if (t) { t.done = !t.done; scheduleSave(); renderWidgets(); }
        break;
      }
      case 'todo-priority': {
        const t = (S.todos || []).find((x) => x.id === el.dataset.tid);
        if (t) { t.priority = t.priority ? 0 : 1; scheduleSave(); renderWidgets(); }
        break;
      }
      case 'todo-edit': WG.editTodoId = el.dataset.tid; renderWidgets(); break;
      case 'todo-del':
        S.todos = (S.todos || []).filter((x) => x.id !== el.dataset.tid);
        scheduleSave(); renderWidgets();
        break;
      case 'todo-filter': WG.todoFilter = el.dataset.f; renderWidgets(); break;
      case 'todo-clear-done':
        S.todos = (S.todos || []).filter((x) => !x.done);
        scheduleSave(); renderWidgets(); toast('已清空已完成的待办');
        break;
      case 'cal-prev': wgCalMove(-1); break;
      case 'cal-next': wgCalMove(1); break;
      case 'cal-today': {
        const d = new Date(); WG.calY = d.getFullYear(); WG.calM = d.getMonth(); renderWidgets();
        break;
      }
      case 'cal-day':
        WG.pickedDate = WG.pickedDate === el.dataset.date ? '' : el.dataset.date;
        renderWidgets();
        break;
      case 'cal-clear': WG.pickedDate = ''; renderWidgets(); break;
      case 'weather-fetch': if (w) await wgFetchWeather(w); break;
      case 'weather-city': if (w) await wgFetchWeather(w, el.dataset.city); break;
      case 'weather-edit': if (w) wgEditWeather(w); break;
      case 'note-new': wgEditNote(null); break;
      case 'note-open': wgEditNote(el.dataset.nid); break;
      case 'note-pin': {
        const n = (S.notes || []).find((x) => x.id === el.dataset.nid);
        if (n) { n.pinned = !n.pinned; scheduleSave(); renderWidgets(); }
        break;
      }
      default: break;
    }
  }

  /* ================= 推荐书签整合（只追加，不覆盖用户数据） ================= */
  /**
   * 把内置推荐目录合并进当前空间：
   * - 按 host 全局去重，用户已有的书签一律保留
   * - 同名分组直接复用，没有才新建
   * - 新增书签写死 id 前缀 bp_，重复打开页面不会重复添加
   * - 图标指向 /api/icon：服务端优先返回随包内置的官网真实 favicon，离线可用
   */
  function mergePresets() {
    const P = window.NAVIO_PRESETS;
    if (!P || !Array.isArray(P.groups) || !P.groups.length) return 0;
    const seen = new Set(S.bookmarks.map((b) => hostKey(b.url)).filter(Boolean));
    let added = 0;
    let maxGOrder = S.groups.reduce((m, g) => Math.max(m, Number(g.order) || 0), -1);

    P.groups.forEach((pg) => {
      let group = S.groups.find((g) => String(g.name).trim() === pg.name);
      if (!group) {
        maxGOrder += 1;
        group = {
          id: "pg_" + pg.id,
          name: pg.name,
          color: pg.color || "",
          icon: "",
          order: maxGOrder,
          collapsed: false
        };
        S.groups.push(group);
      }
      let order = S.bookmarks
        .filter((b) => b.groupId === group.id)
        .reduce((m, b) => Math.max(m, Number(b.order) || 0), -1);

      pg.items.forEach((it, i) => {
        const title = it[0];
        const url = it[1];
        const desc = it[2] || "";
        const h = hostKey(url);
        if (!h || seen.has(h)) return;
        seen.add(h);
        order += 1;
        S.bookmarks.push({
          id: "bp_" + pg.id + "_" + i,
          groupId: group.id,
          title: title,
          url: url,
          desc: desc,
          icon: "/api/icon?host=" + encodeURIComponent(h) + "&title=" + encodeURIComponent(title) +
                "&url=" + encodeURIComponent(normalizeUrl(url)),
          order: order,
          createdAt: new Date().toISOString(),
          clickCount: 0
        });
        added += 1;
      });
    });
    return added;
  }

  function seedIfEmpty() {
    let changed = false;
    if (!S.seeded) { S.seeded = true; changed = true; }
    // 公共起始页：通用书签由服务端模板提供。前端再播种会造出一堆空分组，
    // 而且会把公共项写进个人快照，所以 Web 端一律跳过。
    if (!(window.navio && window.navio.isWeb) && mergePresets() > 0) changed = true;
    if (changed) scheduleSave();
  }
  /* ================= 启动 ================= */
  async function reload() {
    const r = await API.readState();
    S = r.state;
    DATA_DIR = r.dataDir;
    render();
    renderWidgets();
    applySearchVisible();
    applyClockVisible();
  }

  async function boot() {
    if (!API) {
      document.body.innerHTML =
        '<div style="padding:40px;color:#fff;font-family:sans-serif">预加载脚本未生效，请重新启动程序。</div>';
      return;
    }
    try {
      const r = await API.readState();
      S = r.state;
      DATA_DIR = r.dataDir;
      seedIfEmpty();
      bindEvents();
      render();
      renderWidgets();
      applySearchVisible();
      applyClockVisible();
      tickClock();
      setInterval(tickClock, 10000);
      if (r.meta && r.meta.loadFrom && !['data.json', 'empty'].includes(r.meta.loadFrom)) {
        toast('已从备份恢复数据：' + r.meta.loadFrom, 4000);
      }
    } catch (e) {
      console.error(e);
      document.body.innerHTML =
        '<div style="padding:40px;color:#fff;font-family:sans-serif">启动失败：' + esc(e.message) + '</div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
