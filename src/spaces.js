'use strict';
/**
 * 公共模板 + 个人快照（copy-on-write）
 *
 * 数据约定（仍然只有一个 data.json）：
 *   - 顶层 groups/bookmarks/settings = 「通用」公共模板，任何人（含未登录游客）都能看到。
 *     公共模板本身永远不被 Web 端写入，因此一个人删掉/改动通用书签，别人看到的仍是原样。
 *   - spaces[身份id] = 该身份的完整可编辑快照。
 *     身份 = 登录账号 id，或未登录时的匿名 cookie id（anon_xxx）。
 *     首次访问没有快照 → 以公共模板生成一份视图；第一次保存才落快照。
 *   - 视图里每项带 scope 标记：'public'（来自公共模板）/ 'mine'（本身份自建或被改动后新增）。
 *     scope 不落盘，读取时按 id 现算，避免脏标记。
 *
 * 这样天然满足：游客可浏览可编辑、改动只影响自己、不同账号的私有标签互不可见。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalize, defaultState, isCardSize, isCardBgColor } = require('./store');
const presetIcons = require('./preset-icons');

const PUBLIC_GID = 'g_public';       // 旧版扁平通用分组（兼容已有个人快照）
const COMMON_GID = 'g_common';       // 常用（系统预设分类的第一组）
const MORE_GID = 'g_more';           // 兜底分组（不在预设目录里的历史公共书签）
const PUBLIC_NAME = '通用';
const CAT_PREFIX = 'g_cat_';         // 系统预设分类分组 id 前缀
const PUBLIC_GIDS = new Set([PUBLIC_GID, COMMON_GID, MORE_GID]);

/**
 * 从 renderer/presets.js 读出系统预设分类定义（同步、只读、带缓存）。
 * 分组 id 稳定：第一组复用 COMMON_GID，其余为 g_cat_<key>，
 * 这样旧的 g_common / g_more 个人快照仍能被识别为公共分组。
 */
let _presetDefs = null;
/** 按 iconKey 取系统预设分类图标（data URI），取不到返回空串 */
function categoryIcon(iconKey) {
  const key = String(iconKey || '');
  if (!key) return '';
  try {
    const hit = presetIcons.list().find((x) => x.id === key);
    return hit ? hit.svg : '';
  } catch (_) {
    return '';
  }
}
function presetDefs() {
  if (_presetDefs) return _presetDefs;
  const out = [];
  try {
    const f = path.join(__dirname, '..', 'renderer', 'presets.js');
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(f, 'utf8'), sandbox, { timeout: 1000 });
    const groups = ((sandbox.window || {}).NAVIO_PRESETS || {}).groups || [];
    groups.forEach((g, i) => {
      const key = String(g.id || '');
      const gid = i === 0 ? COMMON_GID : CAT_PREFIX + key.replace(/^p_/, '');
      out.push({
        id: gid,
        name: String(g.name || '分类'),
        glyph: String(g.glyph || '·'),
        color: String(g.color || ''),
        icon: categoryIcon(g.iconKey),
        order: -1000 + i,
        items: (g.items || []).map((it) => String(it[1] || ''))
      });
    });
  } catch (_) {}
  _presetDefs = out;
  return out;
}
presetDefs().forEach((g) => PUBLIC_GIDS.add(g.id));

function isPublicGid(gid) {
  const s = String(gid || '');
  return PUBLIC_GIDS.has(s) || s.startsWith(CAT_PREFIX);
}
function normHost(url) {
  let h = '';
  try { h = new URL(String(url || '')).hostname.toLowerCase(); }
  catch (_) { h = String(url || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); }
  return h.replace(/^www\./, '');
}

/**
 * 高频站点：命中则归「常用」，其余全部归「更多」。
 * 只看 host，不依赖顶层那 11 个历史分类，因此线上数据 / 全新安装 / 个人快照
 * 三种来源都能得到一致的两个分组。
 */
const COMMON_HOSTS = [
  'baidu.com', 'bing.com', 'google.com', 'zhihu.com', 'bilibili.com',
  'weibo.com', 'douban.com', 'taobao.com', 'tmall.com', 'jd.com',
  'github.com', 'gitee.com', 'douyin.com', 'xiaohongshu.com',
  'music.163.com', 'v.qq.com', 'iqiyi.com', 'meituan.com', 'alipay.com',
  'pan.baidu.com', 'mail.qq.com', 'docs.qq.com', 'juejin.cn',
  'chatgpt.com', 'youtube.com', 'ele.me', 'pinduoduo.com', 'weixin.qq.com'
];

function hostOfUrl(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); }
  catch (_) {
    return String(url || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
}
function isCommonUrl(url) {
  const h = hostOfUrl(url);
  return COMMON_HOSTS.some((x) => h === x || h.endsWith('.' + x));
}
function isCommonHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return COMMON_HOSTS.some((x) => h === x || h.endsWith('.' + x));
}

class Spaces {
  constructor(store, rendererDir) {
    this.store = store;
    this.rendererDir = rendererDir || '';
  }

  top() {
    return this.store.state || {};
  }

  /**
   * 公共模板书签列表：优先用顶层 data.json；全新安装（空库）时从
   * renderer/presets.js 动态生成一份，保证「通用」标签开箱就有内容。
   * 这里只读不写盘，避免为每个游客生成一份 94 条的快照。
   */
  _publicList() {
    const st = this.top();
    if (Array.isArray(st.bookmarks) && st.bookmarks.length) return st.bookmarks;
    return this.presetBookmarks();
  }

  presetBookmarks() {
    if (!this.rendererDir) return [];
    const f = path.join(this.rendererDir, 'presets.js');
    if (!fs.existsSync(f)) return [];
    try {
      const sandbox = { window: {} };
      vm.runInNewContext(fs.readFileSync(f, 'utf8'), sandbox, { timeout: 1000 });
      const groups = ((sandbox.window || {}).NAVIO_PRESETS || {}).groups || [];
      const out = [];
      groups.forEach((g, gi) => {
        (g.items || []).forEach((it, i) => {
          const url = String(it[1] || '');
          const title = String(it[0] || '');
          if (!/^https?:\/\//i.test(url)) return;
          let host = '';
          try { host = new URL(url).host; } catch (_) {}
          out.push({
            id: 'bp_' + String(g.id) + '_' + i,
            groupId: COMMON_GID,
            title,
            url,
            desc: String(it[2] || ''),
            // 真实 favicon：服务端优先返回随包内置的官网图标，绝不写死自绘 SVG
            icon: host ? '/api/icon?host=' + encodeURIComponent(host) + '&title=' + encodeURIComponent(title) : '',
            order: gi * 1000 + i,
            createdAt: '',
            clickCount: 0
          });
        });
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  /** 系统预设分类目录 + host→分组 映射（供 project 使用，只读、不写盘） */
  presetCatalog() {
    const defs = presetDefs();
    const byHost = new Map();
    defs.forEach((g) => {
      g.items.forEach((u) => {
        const h = normHost(u);
        if (h && !byHost.has(h)) byHost.set(h, g.id);
      });
    });
    return { defs, byHost };
  }

  /** 公共模板中的书签 id 集合（用于计算 scope） */
  publicBookmarkIds() {
    return new Set(this._publicList().map((b) => String(b.id)));
  }

  /**
   * 生成「通用」视图：把公共模板里的所有分组合并成一个平铺分组，
   * 不含任何个人数据（待办 / 笔记 / 历史一律置空）。
   */
  template() {
    const st = this.top();
    const out = defaultState();
    out.seeded = true;
    if (st.createdAt) out.createdAt = st.createdAt;

    if (st.settings && typeof st.settings === 'object') {
      for (const k of Object.keys(out.settings)) {
        if (st.settings[k] !== undefined) out.settings[k] = st.settings[k];
      }
    }

    const commonDef = presetDefs().find((g) => g.id === COMMON_GID);
    out.groups = [{
      id: COMMON_GID,
      name: commonDef ? commonDef.name : '常用',
      color: commonDef ? commonDef.color : '',
      icon: commonDef ? commonDef.icon : '',
      order: -1000, collapsed: false
    }];
    out.bookmarks = this._publicList()
      .map((b, i) => {
        const item = {
          id: String(b.id || 'b_' + i),
          groupId: PUBLIC_GID,
          title: String(b.title || ''),
          url: String(b.url || ''),
          icon: String(b.icon || ''),
          desc: String(b.desc || ''),
          order: Number.isFinite(Number(b.order)) ? Number(b.order) : i,
          createdAt: String(b.createdAt || ''),
          clickCount: Number(b.clickCount) || 0
        };
        // 公共模板也可预设占格尺寸；缺省 1x1 由前端兜底。
        if (isCardSize(b.size)) item.size = String(b.size);
        // 阶段 12：图标背景色同样要逐层透传，否则公共模板上的预设色会丢失。
        if (isCardBgColor(b.bgColor)) item.bgColor = String(b.bgColor);
        return item;
      })
      .filter((b) => b.url);

    // 组件开关等「无隐私的配置」沿用公共默认值；待办 / 笔记 / 历史属于个人，不复制
    for (const k of ['widgets', 'todoFolders', 'cards', 'tabbar', 'searchEngines', 'wallpapers', 'iconLibrary', 'quickLinks']) {
      if (Array.isArray(st[k])) out[k] = st[k].slice(0, 20000);
    }
    out.todos = [];
    out.notes = [];
    out.history = [];
    return out;
  }

  /**
   * 把任意来源的视图投影成「常用 + 系统预设分类」区块（阶段 9）。
   * 幂等：重复执行结果不变；不写盘、不改 store.state。
   *  - 只有「公共模板里的书签」且当前仍挂在公共分组下才重新分配 groupId
   *  - 用户自建书签、以及用户主动移进私有分组的公共书签一律保持原样
   *  - 空的公共分组不输出，避免首页出现空区块
   *  - 私有分组定义完整保留（顺序、名称、颜色、order）
   *  - 不在预设目录里的历史公共书签兜底进「更多」，不会变成悬空 groupId
   */
  project(state, pubIds) {
    const ids = pubIds || this.publicBookmarkIds();
    const cat = this.presetCatalog();
    const out = { ...state };
    const groups = Array.isArray(state.groups) ? state.groups : [];
    const privateGroups = groups.filter((g) => !isPublicGid(g.id));

    const books = (Array.isArray(state.bookmarks) ? state.bookmarks : []).map((b) => {
      const gid = String(b.groupId || '');
      if (!ids.has(String(b.id))) return b;        // 用户自建书签
      if (!isPublicGid(gid)) return b;             // 已被移入私有分组，尊重用户
      // 阶段 11：所有公共书签（含旧的 g_cat_* / g_more / g_public）统一归入唯一「常用」分类。
      return { ...b, groupId: COMMON_GID };
    });

    // 阶段 11：系统预设分类只剩「常用」一组，带预设分类图标。
    // 阶段 13：若个人快照里存在同 id 的分组且带 custom 标记（用户右键改过名称/图标/顺序），
    // 则尊重个人快照值；否则仍用预设覆盖。顶层公共模板永不被写，隔离语义不变。
    const defs = cat.defs.filter((g) => g.id === COMMON_GID);
    const pub = defs
      .map((g) => {
        const own = groups.find((x) => x.id === g.id && x.custom);
        if (own) {
          return {
            id: g.id,
            name: own.name || g.name,
            color: own.color || g.color || '',
            icon: own.icon || '',
            order: Number.isFinite(own.order) ? own.order : g.order,
            collapsed: !!own.collapsed,
            custom: true
          };
        }
        return { id: g.id, name: g.name, color: g.color || '', icon: g.icon || '', order: g.order, collapsed: false };
      });

    out.groups = [...pub, ...privateGroups];
    out.bookmarks = books;
    return out;
  }

  /** 给视图里的分组 / 书签贴上 scope 标记（不改 store.state） */
  annotate(state, pubIds) {
    const ids = pubIds || this.publicBookmarkIds();
    const out = { ...state };
    out.groups = (Array.isArray(state.groups) ? state.groups : [])
      .map((g) => ({ ...g, scope: isPublicGid(g.id) ? 'public' : 'mine' }));
    out.bookmarks = (Array.isArray(state.bookmarks) ? state.bookmarks : [])
      .map((b) => ({ ...b, scope: ids.has(String(b.id)) ? 'public' : 'mine' }));
    return out;
  }

  /** 按身份取视图：有快照用快照，没有就用公共模板 */
  view(identityId) {
    const st = this.top();
    const own = st.spaces && st.spaces[identityId];
    let base;
    if (own && typeof own === 'object') {
      base = normalize(own);
      delete base.spaces;
    } else {
      base = this.template();
    }
    const pubIds = this.publicBookmarkIds();
    return this.annotate(this.project(base, pubIds), pubIds);
  }

  /** 保存个人快照：只写 spaces[id]，绝不触碰顶层公共模板 */
  save(identityId, incoming) {
    const st = this.store.state;
    const clean = normalize(incoming);
    delete clean.spaces; // 防止前端把整个视图（含 spaces）回传造成嵌套膨胀
    st.spaces = st.spaces || {};
    st.spaces[identityId] = clean;
    this.store.save(st, 500);
    return { ok: true };
  }

  /** 立即落盘（页面关闭 / 切后台） */
  flush(identityId, incoming) {
    const st = this.store.state;
    const clean = normalize(incoming);
    delete clean.spaces;
    st.spaces = st.spaces || {};
    st.spaces[identityId] = clean;
    this.store.saveSync(st);
    return { ok: true };
  }

  /** 丢弃个人快照，重新回到公共模板（用于通用书签更新后重新同步） */
  reset(identityId) {
    const st = this.store.state;
    if (st.spaces && st.spaces[identityId]) {
      delete st.spaces[identityId];
      this.store.saveSync(st);
    }
    return { ok: true };
  }

  /** 个人空间数量（控制台 / 测试用） */
  count() {
    const s = this.top().spaces;
    return s && typeof s === 'object' ? Object.keys(s).length : 0;
  }
}

module.exports = {
  Spaces, PUBLIC_GID, PUBLIC_NAME, COMMON_GID, MORE_GID, PUBLIC_GIDS,
  CAT_PREFIX, isPublicGid, presetDefs,
  COMMON_HOSTS, isCommonUrl, isCommonHost
};
