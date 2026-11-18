'use strict';
/**
 * 首页增强层：左侧竖列分组导航 + Hero 时钟/问候/快捷入口
 * 设计原则：不修改 app.js 内部状态，只镜像 #groupTabs 并转发点击，
 * 这样原有的拖拽、搜索、右键菜单、设置抽屉全部保持不变。
 */
(() => {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  // 阶段 12：自建标签不再用随机彩色方块（那会把两类分类分得很明显），
  // 统一成低调的中性图标，和公共分类在同一个连续列表里视觉一致。

  /* ---------------- Hero 时钟 / 问候 ---------------- */
  function greet(h) {
    if (h < 5) return '夜深了，注意休息';
    if (h < 9) return '早上好，新的一天开始了';
    if (h < 12) return '上午好，今天想做点什么？';
    if (h < 14) return '中午好，记得歇一会儿';
    if (h < 18) return '下午好，保持好状态';
    if (h < 23) return '晚上好，辛苦一天了';
    return '夜深了，注意休息';
  }
  function tickHero() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const clock = $('#heroClock');
    if (clock) clock.innerHTML = pad(d.getHours()) + ':' + pad(d.getMinutes()) +
      '<span class="sec">:' + pad(d.getSeconds()) + '</span>';
    const hello = $('#heroHello');
    if (hello) hello.textContent = greet(d.getHours());
    const date = $('#heroDate');
    if (date) date.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK[d.getDay()];
  }

  /* ---------------- 左侧竖列分组（阶段11：分类 + 我的标签） ---------------- */
  /**
   * 统一中性图标：自建标签与公共分类用同一套观感（淡底 + 首字母），
   * 不再按 index 取随机高饱和色。首字仍可辨识，但不会形成「两块不同区域」。
   */
  function plainIcon(name) {
    const glyph = String(name || '·').trim().charAt(0).toUpperCase();
    return '<span class="side-ico ico-plain">' + esc(glyph) + '</span>';
  }

  /** 从 tab 的 data-* 生成侧栏图标 HTML：公共分类优先系统预设 SVG，其余统一中性图标 */
  function iconHTML(tab, name) {
    const dataIcon = tab.getAttribute('data-icon') || '';
    if (dataIcon) {
      return '<span class="side-ico ico-custom"><img src="' + esc(dataIcon) + '" alt=""></span>';
    }
    return plainIcon(name);
  }

  function tabMeta(tab) {
    const key = tab.getAttribute('data-tab');
    const active = tab.classList.contains('active');
    const numEl = tab.querySelector('.n');
    const num = numEl ? parseInt(numEl.textContent, 10) || 0 : 0;
    let name = '';
    tab.childNodes.forEach((n) => { if (n.nodeType === 3) name += n.nodeValue; });
    name = name.trim() || '分组';
    return { key, active, num, name };
  }

  function syncNav() {
    const tabs = Array.from(document.querySelectorAll('#groupTabs .tab[data-tab]'));
    const catNav = $('#sideCatNav');
    const mineNav = $('#sideNav');
    if (!tabs.length || (!catNav && !mineNav)) return;

    let allCount = 0;
    let groupCount = 0;
    let activeName = '常用';
    let activeNum = 0;

    // 阶段11：公共分类（含「常用」）进「书签分类」栏，私有标签进「我的标签」栏。
    // scope=public 由 spaces.annotate() 计算，不硬编码 id。
    const catTabs = tabs.filter((t) => t.getAttribute('data-scope') === 'public' && t.getAttribute('data-tab') !== '__add');
    const mineTabs = tabs.filter((t) => {
      const k = t.getAttribute('data-tab');
      return k && k !== '__add' && t.getAttribute('data-scope') !== 'public';
    });

    tabs.forEach((t) => {
      if (t.getAttribute('data-tab') === '__add') return;
      const an = t.querySelector('.n');
      allCount += an ? parseInt(an.textContent, 10) || 0 : 0;
    });
    groupCount = mineTabs.length;

    const activeTab = tabs.find((t) => t.classList.contains('active'));
    if (activeTab) {
      const m = tabMeta(activeTab);
      activeName = m.name;
      activeNum = m.num;
    }

    const catParts = catTabs.map((tab, i) => {
      const m = tabMeta(tab);
      if (m.active) { activeName = m.name; activeNum = m.num; }
      return `<button class="side-item ${m.active ? 'active' : ''}" data-key="${esc(m.key)}">
        ${iconHTML(tab, m.name)}
        <span class="side-name">${esc(m.name)}</span>
        <span class="side-num">${m.num}</span>
      </button>`;
    });

    const mineParts = mineTabs.map((tab, i) => {
      const m = tabMeta(tab);
      if (m.active) { activeName = m.name; activeNum = m.num; }
      return `<button class="side-item ${m.active ? 'active' : ''}" data-key="${esc(m.key)}">
        ${iconHTML(tab, m.name)}
        <span class="side-name">${esc(m.name)}</span>
        <span class="side-num">${m.num}</span>
      </button>`;
    });

    const addTab = tabs.find((t) => t.getAttribute('data-tab') === '__add');
    const addHtml = addTab ? `<button class="side-item side-add" data-key="__add">
        <span class="side-ico">＋</span><span class="side-name">新建标签</span></button>` : '';

    // 阶段 12：空态提示压到最轻，不再是「自己的 / 只有你能看到」这类强调区别的说明
    if (catNav) catNav.innerHTML = catParts.join('') || '<div class="side-empty">暂无分类</div>';
    if (mineNav) mineNav.innerHTML = (mineParts.length ? mineParts.join('') : '<div class="side-empty">用下方按钮新建标签</div>') + addHtml;

    const crumb = $('#crumbText');
    if (crumb) crumb.textContent = activeName;
    const cc = $('#crumbCount');
    if (cc) cc.textContent = activeNum ? '· ' + activeNum + ' 项' : '';
    const st = $('#sideTotal');
    if (st) st.textContent = allCount;
    const sg = $('#sideGroups');
    if (sg) sg.textContent = groupCount;
    stripTitles();
  }

  function bindNav() {
    const bindContainer = (nav) => {
      if (!nav) return;
      nav.addEventListener('click', (e) => {
        const item = e.target.closest('.side-item');
        if (!item) return;
        const key = item.getAttribute('data-key');
        const tab = document.querySelector('#groupTabs .tab[data-tab="' + key + '"]');
        if (tab) tab.click();
        // 乐观更新两个容器
        [$('#sideCatNav'), $('#sideNav')].forEach((box) => {
          if (box) box.querySelectorAll('.side-item').forEach((x) => x.classList.remove('active'));
        });
        if (key !== '__add') item.classList.add('active');
        const nm = item.querySelector('.side-name');
        const crumb = $('#crumbText');
        if (crumb && nm && key !== '__add') crumb.textContent = nm.textContent;
      });
    };
    bindContainer($('#sideCatNav'));
    bindContainer($('#sideNav'));

    // app.js 每次 render 都会重写 #groupTabs，用观察器同步侧栏
    const host = $('#groupTabs');
    if (host && window.MutationObserver) {
      new MutationObserver(() => syncNav()).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ---------------- 侧栏快捷按钮 ---------------- */
  function clickById(id) {
    const el = document.getElementById(id);
    if (el) el.click();
  }
  function toggleTheme() {
    clickById('btnSettings');
    const target = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const btn = document.querySelector('#drawerBody [data-seg="theme"] button[data-v="' + target + '"]');
      if (btn) {
        clearInterval(timer);
        btn.click();
        const mask = $('#drawerMask');
        if (mask) mask.click();
      } else if (tries > 40) {
        clearInterval(timer);
      }
    }, 50);
  }
  /** 点品牌 / 面包屑回到「通用 + 我的」总览（触发隐藏的 all 标签） */
  function bindHomeNav() {
    const goAll = () => {
      // 回到第一个系统预设分类（常用）
      const tab = document.querySelector('#groupTabs .tab[data-scope="public"]');
      if (tab) tab.click();
    };
    ['.side-brand', '.stage-crumb'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.style.cursor = 'pointer';
      el.addEventListener('click', goAll);
    });
  }

  /** 底部身份提示：游客说明「改动仅自己可见」，登录用户显示账号名 */
  async function initIdentity() {
    const box = $('#sideIdentity');
    if (!box || !window.navio || !window.navio.readState) return;
    try {
      const r = await window.navio.readState();
      const id = r && r.identity;
      if (!id) return;
      if (id.kind === 'user') box.textContent = '已登录 · ' + id.name;
      else box.textContent = '访客 · 登录后可跨设备保留';
      const pm = r.publicMode;
      if (pm && pm.hasSnapshot) {
        const reset = document.createElement('button');
        reset.className = 'side-reset';
        reset.textContent = '恢复通用书签';
        reset.onclick = async () => {
          if (!window.confirm('恢复后将丢弃你自己对通用书签的删改与全部私有标签，确定吗？')) return;
          await window.navio.resetPublic();
          location.reload();
        };
        box.appendChild(document.createElement('br'));
        box.appendChild(reset);
      }
    } catch (_) {}
  }

  function bindQuick() {
    const map = { sideWidgets: 'btnWidgets', sideSettings: 'btnSettings', sideAdd: 'btnAdd' };
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => clickById(map[id]));
    });
    const th = $('#sideTheme');
    if (th) th.addEventListener('click', toggleTheme);
  }

  /* ---------------- Hero 快捷站点 ---------------- */
  function hostOf(u) {
    try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).host; }
    catch (_) { return String(u || '').replace(/^https?:\/\//, '').split('/')[0]; }
  }
  function hueOf(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 360;
  }
  async function renderQuick() {
    const host = $('#heroQuick');
    if (!host || !window.navio || !window.navio.readState) return;
    let state;
    try { state = (await window.navio.readState()).state; } catch (_) { return; }
    const list = (state && Array.isArray(state.bookmarks)) ? state.bookmarks.slice() : [];
    list.sort((a, b) => (Number(b.clickCount) || 0) - (Number(a.clickCount) || 0));
    const top = list.slice(0, 8);
    if (!top.length) { host.innerHTML = ''; return; }
    host.innerHTML = top.map((b) => {
      const url = String(b.url || '');
      const title = String(b.title || hostOf(url));
      const h = hueOf(hostOf(url) || title);
      const grad = `linear-gradient(135deg, hsl(${h} 58% 54%), hsl(${(h + 42) % 360} 64% 40%))`;
      const icon = '/api/icon?host=' + encodeURIComponent(hostOf(url)) + '&title=' + encodeURIComponent(title) +
        '&url=' + encodeURIComponent(url);
      return `<a class="quick-chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
        <img src="${esc(icon)}" alt="" data-grad="${esc(grad)}" data-letter="${esc(title.charAt(0).toUpperCase())}">
        <span>${esc(title)}</span></a>`;
    }).join('');
    host.querySelectorAll('img[data-grad]').forEach((img) => {
      img.addEventListener('error', () => {
        const d = document.createElement('span');
        d.className = 'qd';
        d.style.background = img.getAttribute('data-grad');
        d.textContent = img.getAttribute('data-letter') || '·';
        img.replaceWith(d);
      }, { once: true });
    });
  }

  /* ---------------- 启动 ---------------- */
  /* 首页不显示任何原生 title 悬浮提示文字 */
  function stripTitles() {
    ['#sideNav', '#heroQuick', '#sections', '#topbar', '#sidebar', '#titlebar'].forEach((sel) => {
      const root = $(sel);
      if (!root) return;
      if (root.hasAttribute('title')) root.removeAttribute('title');
      root.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'));
    });
  }

  function init() {
    tickHero();
    setInterval(tickHero, 1000);
    bindNav();
    bindQuick();
    bindHomeNav();
    syncNav();
    stripTitles();
    setTimeout(initIdentity, 700);
    // 书签整合后需要刷新一次快捷入口
    setTimeout(renderQuick, 900);
    if (window.MutationObserver) {
      const secs = $('#sections');
      if (secs) {
        let t = null;
        new MutationObserver(() => {
          stripTitles();
          clearTimeout(t);
          t = setTimeout(renderQuick, 600);
        }).observe(secs, { childList: true });
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
