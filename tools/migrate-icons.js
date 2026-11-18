'use strict';
/**
 * 线上数据一次性迁移：把历史上被写死成「自绘 SVG」的 icon 字段
 *   /api/preset-icon?url=...&title=...
 * 改成「网站自身的真实 favicon」
 *   /api/icon?host=...&title=...
 *
 * 纯函数、幂等：只替换 bookmarks[].icon / spaces[*].bookmarks[].icon 中
 * 以 /api/preset-icon 开头的字符串；用户自定义图标、空图标一律保持原样；
 * 其它所有字段（含 id/url/标题/分组/设置/组件数据）逐字段原样保留。
 */

function hostOf(raw) {
  try {
    const s = String(raw || '');
    return new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s).host;
  } catch (_) { return ''; }
}

function targetIcon(b) {
  const host = hostOf(b && b.url);
  if (!host) return '';
  return '/api/icon?host=' + encodeURIComponent(host) +
    '&title=' + encodeURIComponent(String((b && b.title) || ''));
}

function convertOne(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { b, changed: false };
  const cur = String(b.icon || '');
  if (cur.indexOf('/api/preset-icon') !== 0) return { b, changed: false }; // 自定义/已是真图标/空
  const next = targetIcon(b);
  if (!next) return { b, changed: false };
  return { b: { ...b, icon: next }, changed: true };
}

function convertList(arr) {
  if (!Array.isArray(arr)) return { list: arr, changed: 0 };
  let changed = 0;
  const list = arr.map((b) => {
    const r = convertOne(b);
    if (r.changed) changed++;
    return r.b;
  });
  return { list, changed };
}

/**
 * @returns {{state: object, stats: object}} 新 state（不修改入参）
 */
function migrateIcons(state) {
  const src = state && typeof state === 'object' ? state : {};
  const out = { ...src };
  const stats = { top: 0, spaces: 0, spaceCount: 0, keptCustom: 0 };

  const top = convertList(src.bookmarks);
  out.bookmarks = top.list;
  stats.top = top.changed;

  if (src.spaces && typeof src.spaces === 'object' && !Array.isArray(src.spaces)) {
    const next = {};
    for (const k of Object.keys(src.spaces)) {
      const sp = src.spaces[k];
      stats.spaceCount++;
      if (!sp || typeof sp !== 'object') { next[k] = sp; continue; }
      const r = convertList(sp.bookmarks);
      next[k] = r.changed ? { ...sp, bookmarks: r.list } : sp;
      stats.spaces += r.changed;
    }
    out.spaces = next;
  }

  // 统计保留下来的自定义图标，便于核验没有误伤用户数据
  const all = [...(Array.isArray(out.bookmarks) ? out.bookmarks : [])];
  if (out.spaces && typeof out.spaces === 'object') {
    for (const k of Object.keys(out.spaces)) {
      const arr = out.spaces[k] && out.spaces[k].bookmarks;
      if (Array.isArray(arr)) all.push(...arr);
    }
  }
  stats.keptCustom = all.filter((b) => {
    const i = String((b && b.icon) || '');
    return i && i.indexOf('/api/icon') !== 0 && i.indexOf('/api/preset-icon') !== 0;
  }).length;

  return { state: out, stats };
}

module.exports = { migrateIcons, convertOne, targetIcon, hostOf };
