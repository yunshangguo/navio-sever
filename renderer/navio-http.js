'use strict';
/**
 * Web 端 API 兼容层
 * 在浏览器里实现与 Electron preload 完全相同的 window.navio 接口，
 * 因此 renderer/app.js（1711 行书签 UI）可以原样复用，不需要两套前端。
 *
 * 本地能力（打开外链、复制、选文件、下载）用浏览器原生 API 直接实现。
 */
(function () {
  const BASE = '/api';

  async function call(path, payload, method) {
    const opt = {
      method: method || (payload === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (payload !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(payload);
    }
    let r;
    try {
      r = await fetch(BASE + path, opt);
    } catch (e) {
      return { ok: false, error: '无法连接服务：' + e.message };
    }
    let data;
    try {
      data = await r.json();
    } catch (_) {
      return { ok: false, error: 'HTTP ' + r.status };
    }
    if (r.status === 401) {
      // 公共起始页下游客仍可浏览，只有需要登录的功能才返回提示，不强制跳走
      return { ok: false, needLogin: true, code: data && data.code, error: (data && data.error) || '请先登录' };
    }
    return data;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  /** 弹出文件选择并读成文本 */
  function pickText(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) {
          input.remove();
          return resolve(null);
        }
        const rd = new FileReader();
        rd.onload = () => {
          input.remove();
          resolve({ name: f.name, text: String(rd.result || '') });
        };
        rd.onerror = () => {
          input.remove();
          resolve(null);
        };
        rd.readAsText(f, 'utf-8');
      };
      input.click();
    });
  }

  function pickImage() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) {
          input.remove();
          return resolve(null);
        }
        const rd = new FileReader();
        rd.onload = () => {
          input.remove();
          resolve({ name: f.name.replace(/\.[^.]+$/, ''), data: String(rd.result || '') });
        };
        rd.onerror = () => {
          input.remove();
          resolve(null);
        };
        rd.readAsDataURL(f);
      };
      input.click();
    });
  }

  const toastListeners = [];
  const flushListeners = [];

  window.navio = {
    // ---- 数据 ----
    readState: () => call('/state'),
    // 轻量版本探测：只取 rev，不改数据，供多标签/多设备同步轮询
    stateRev: () => call('/state/rev'),
    saveState: (state) => call('/state', state),
    flush: (state) => {
      // 关页/切后台时尽量保证落盘
      try {
        return fetch(BASE + '/state/flush', {
          method: 'POST',
          keepalive: true,
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        })
          .then(() => ({ ok: true }))
          .catch(() => ({ ok: false }));
      } catch (_) {
        return Promise.resolve({ ok: false });
      }
    },
    stats: () => call('/stats'),

    // ---- 备份 / 导入导出 ----
    backup: () => call('/backup', {}),
    listBackups: () => call('/backups').then((r) => (Array.isArray(r) ? r : [])),
    restoreBackup: (name) => call('/restore', { name }),
    exportData: async () => {
      const r = await call('/export', {});
      if (!r.ok) return r;
      download(r.path || 'navio-data.json', JSON.stringify(r.data, null, 2), 'application/json');
      return { ok: true, path: r.path };
    },
    importData: async () => {
      const f = await pickText('.json,application/json');
      if (!f) return { ok: false, canceled: true };
      try {
        const data = JSON.parse(f.text);
        return await call('/import', { data });
      } catch (e) {
        return { ok: false, error: '不是合法的 Navio JSON：' + e.message };
      }
    },

    // ---- 浏览器书签 ----
    detectBrowsers: () => call('/bookmarks/detect').then((r) => (Array.isArray(r) ? r : [])),
    importBrowser: (p) => call('/bookmarks/import-browser', { path: p }),
    importHtml: async () => {
      const f = await pickText('.html,.htm,.json,text/html');
      if (!f) return { ok: false, canceled: true };
      return call('/bookmarks/import-html', { content: f.text });
    },
    exportHtml: async (payload) => {
      const r = await call('/bookmarks/export-html', payload);
      if (r && r.ok && r.html) download(r.name || 'navio-bookmarks.html', r.html, 'text/html');
      return r;
    },

    // ---- 系统 ----
    openExternal: (url) => {
      const u = String(url || '').trim();
      const full = /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u;
      window.open(full, '_blank', 'noopener,noreferrer');
      return Promise.resolve({ ok: true });
    },
    openDataDir: () => Promise.resolve({ ok: false, dir: '', error: '请在桌面端控制台打开' }),
    copy: (t) => {
      const s = String(t == null ? '' : t);
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).then(() => ({ ok: true }));
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (_) {}
      ta.remove();
      return Promise.resolve({ ok: true });
    },
    version: () => call('/version').then((r) => ({ app: r.version || '2.0.0', electron: 'Web', chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || '', node: 'Server' })),
    refreshIcon: (url) => call('/icon/refresh', { url }),
    fetchTitle: async (url) => {
      try {
        const r = await call('/title', { url });
        return { ok: true, title: r && r.title ? String(r.title) : '' };
      } catch (_) {
        return { ok: false, title: '' };
      }
    },
    pickWallpaper: async () => {
      const img = await pickImage();
      if (!img) return { ok: false, canceled: true };
      return call('/wall/upload', { name: img.name, data: img.data });
    },

    // ---- 图标库（新增能力，供后续组件调用） ----
    presetIcons: (q) => call('/preset-icons' + (q ? '?q=' + encodeURIComponent(q) : '')),
    presetIconSvg: (url, title) => '/api/preset-icon?url=' + encodeURIComponent(url || '') + '&title=' + encodeURIComponent(title || ''),

    // ---- 窗口（Web 模式为 no-op） ----
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    onMaximized: () => {},
    onToast: (cb) => {
      if (typeof cb === 'function') toastListeners.push(cb);
    },
    onFlushRequest: (cb) => {
      if (typeof cb !== 'function') return;
      flushListeners.push(cb);
      window.addEventListener('pagehide', () => cb());
    },
    flushDone: () => {},

    // 公共起始页：丢弃自己的快照，重新回到通用模板
    resetPublic: () => call('/state/reset', {}),

    // Web 模式标记
    isWeb: true,
    emitToast: (m) => toastListeners.forEach((f) => f(m))
  };

  document.documentElement.classList.add('web-mode');

  /* ---------- 多标签页即时同步（同一浏览器内）----------
     保存/刷新后广播一个信号，其它标签页收到后立刻走 /api/state/rev 比对，
     比纯轮询更快。跨设备则靠 app.js 的定时轮询。 */
  const CHANNEL = 'navio-state-sync';
  let bc = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = (ev) => {
        const d = ev && ev.data;
        if (d && d.type === 'changed' && typeof window.__navioOnPeerChange === 'function') {
          window.__navioOnPeerChange(d.rev);
        }
      };
    }
  } catch (_) {}
  window.navioSync = {
    /** 本页数据已变更，通知其它标签页（等本地落盘后再调用） */
    broadcast: (rev) => {
      if (!bc) return;
      try { bc.postMessage({ type: 'changed', rev: rev || 0, at: Date.now() }); } catch (_) {}
    }
  };

  /** 顶部账号条：显示当前用户、改密、退出 */
  async function initWebBar() {
    const el = document.getElementById('webUser');
    const btnOut = document.getElementById('btnLogout');
    const btnPw = document.getElementById('btnChangePw');
    const btnLogin = document.getElementById('btnLogin');
    const s = await call('/auth/session');
    const authed = !!(s && s.authenticated && s.user);
    if (el) el.textContent = authed ? s.user.name || s.user.username : '访客';
    if (btnLogin) {
      btnLogin.hidden = authed;
      btnLogin.onclick = () => { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); };
    }
    if (btnOut) btnOut.hidden = !authed;
    if (btnPw) btnPw.hidden = !authed;
    if (btnOut) {
      btnOut.onclick = async () => {
        // 必须先同步置位：location.href 触发的 beforeunload 不能再把登录后的状态
        // 以「服务端轮换出的新游客身份」回写，否则私有书签会串到游客视图。
        window.__navioLoggingOut = true;
        // 退出前把当前登录态的待保存改动落盘（此时会话仍有效，写到自己的空间）。
        // 用普通 saveState（非 keepalive），确保请求在退出前真正完成、用的是管理员会话。
        try { if (window.__navioFlushPending) await window.__navioFlushPending(); } catch (_) {}
        await call('/auth/logout', {});
        location.href = '/';
      };
    }
    if (btnPw) {
      btnPw.onclick = async () => {
        const oldPassword = window.prompt('请输入当前密码');
        if (oldPassword === null) return;
        const newPassword = window.prompt('新密码（至少 8 位）');
        if (newPassword === null) return;
        const r = await call('/auth/password', { oldPassword, newPassword });
        window.alert(r.ok ? '密码已修改' : '修改失败：' + (r.error || '未知错误'));
      };
    }
    if (s && s.user && s.user.mustChangePassword && btnPw) {
      window.setTimeout(() => {
        if (window.navio && window.navio.emitToast) window.navio.emitToast('当前是初始密码，请尽快点击右上角「修改密码」');
      }, 1200);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWebBar);
  else initWebBar();
})();
