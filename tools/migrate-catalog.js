'use strict';
/**
 * 阶段 10 数据迁移：公共书签统一为用户保留的 58 个站点，并按系统预设分类归组。
 *
 * 数据安全（最高优先）：
 *  - 纯函数 migrateState() 不写盘、不改入参；CLI 才负责备份 + 原子替换。
 *  - 只删除「迁移前顶层公共模板里的书签」（按 id 集合识别），
 *    用户自建书签、私有分组、settings / widgets / todos / notes / history 一律保留。
 *  - 按 url 归一化匹配，把旧公共书签上的 size / clickCount / 自定义标题与图标
 *    继承到新书签，避免阶段 8 设过的图标尺寸和点击统计丢失。
 *  - 用户自建书签若挂在将被移除的公共分组下，兜底移到第一个私有分组，杜绝悬空 groupId。
 *  - 幂等：顶层已经是 58 个 bp_ 预设书签时直接返回 skipped。
 */
const fs = require('fs');
const path = require('path');

// 与 src/spaces.js 保持一致：不在预设目录里的历史公共书签兜底到「更多」
const MORE_GID = 'g_more';

function normUrl(url) {
  let h = '';
  try { h = new URL(String(url || '')).hostname.toLowerCase(); }
  catch (_) { h = String(url || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); }
  return h.replace(/^www\./, '').replace(/:\d+$/, '');
}

/** 把旧书签上「用户可能改动过」的字段继承到新书签；order 一律用新的预设顺序 */
function inherit(newB, oldB) {
  const item = { ...newB };
  if (!oldB) { item.clickCount = Number(item.clickCount) || 0; return item; }
  if (oldB.size) item.size = String(oldB.size);
  if (oldB.bgColor) item.bgColor = String(oldB.bgColor);
  const cc = Number(oldB.clickCount);
  item.clickCount = Number.isFinite(cc) ? cc : (Number(item.clickCount) || 0);
  if (oldB.title && String(oldB.title) !== String(newB.title)) item.title = String(oldB.title);
  if (oldB.icon && String(oldB.icon).indexOf('/api/preset-icon') !== 0) item.icon = String(oldB.icon);
  return item;
}

function groupDefs(catDefs) {
  return catDefs.map((g) => ({
    id: g.id, name: g.name, color: '', icon: '',
    order: Number(g.order) || 0, collapsed: false
  }));
}

/**
 * @param {object} state        原始 data.json 对象（不会被修改）
 * @param {object[]} newBooks   Spaces.presetBookmarks() 的 58 条预设书签
 * @param {object[]} catDefs    Spaces.presetCatalog().defs
 * @param {function} isPublicGid 判断分组是否为公共分组
 */
function migrateState(state, newBooks, catDefs, isPublicGid) {
  const src = state && typeof state === 'object' ? state : {};
  const oldTop = Array.isArray(src.bookmarks) ? src.bookmarks : [];
  const already = oldTop.length === newBooks.length &&
    oldTop.every((b) => String(b.id || '').startsWith('bp_'));
  if (already) return { state: src, skipped: true, stats: { reason: 'already-migrated' } };

  const oldIds = new Set(oldTop.map((b) => String(b.id)));
  const defs = groupDefs(catDefs);
  const out = { ...src };

  // host → 分类分组 id：盘上数据也必须自洽，不能留下指向 g_public 的悬空 groupId
  const byHost = new Map();
  catDefs.forEach((g) => {
    (g.items || []).forEach((u) => {
      const h = normUrl(u);
      if (h && !byHost.has(h)) byHost.set(h, g.id);
    });
  });
  const withGroup = (b) => ({ ...b, groupId: byHost.get(normUrl(b.url)) || MORE_GID });

  // ---- 顶层公共模板 ----
  const topCarry = new Map();
  oldTop.forEach((b) => {
    const k = normUrl(b.url);
    if (k && !topCarry.has(k)) topCarry.set(k, b);
  });
  out.bookmarks = newBooks.map((b) => withGroup(inherit(b, topCarry.get(normUrl(b.url)))));
  out.groups = defs.map((g) => ({ ...g }));

  // ---- 每个身份的个人快照 ----
  const spaces = {};
  const rawSpaces = src.spaces && typeof src.spaces === 'object' ? src.spaces : {};
  Object.keys(rawSpaces).forEach((k) => {
    const sp = rawSpaces[k] && typeof rawSpaces[k] === 'object' ? rawSpaces[k] : {};
    const clean = { ...sp };
    const oldSp = Array.isArray(sp.bookmarks) ? sp.bookmarks : [];

    const carry = new Map();
    oldSp.forEach((b) => {
      const key = normUrl(b.url);
      if (key && !carry.has(key)) carry.set(key, b);
    });
    const pub = newBooks.map((b) => withGroup(inherit(b, carry.get(normUrl(b.url)))));
    const pubUrls = new Set(pub.map((b) => normUrl(b.url)));

    // 用户自建书签：id 不属于旧公共集合，且 url 不与新公共站点重复
    const mine = oldSp
      .filter((b) => !oldIds.has(String(b.id)))
      .filter((b) => !pubUrls.has(normUrl(b.url)))
      .map((b) => ({ ...b }));

    const privateGroups = (Array.isArray(sp.groups) ? sp.groups : [])
      .filter((g) => !isPublicGid(g.id))
      .map((g) => ({ ...g }));
    const fallback = privateGroups.length ? String(privateGroups[0].id) : defs[0].id;
    mine.forEach((b, i) => {
      if (isPublicGid(b.groupId)) mine[i] = { ...b, groupId: fallback };
    });

    clean.groups = [...defs.map((g) => ({ ...g })), ...privateGroups];
    clean.bookmarks = [...pub, ...mine];
    spaces[k] = clean;
  });
  out.spaces = spaces;

  const stats = {
    oldTopBookmarks: oldTop.length,
    newTopBookmarks: out.bookmarks.length,
    oldPublicIds: oldIds.size,
    groups: out.groups.length,
    spaces: Object.keys(spaces).length,
    inheritedSize: out.bookmarks.filter((b) => !!b.size).length,
    spaceSizes: Object.keys(spaces).map((k) => ({
      id: k,
      bookmarks: spaces[k].bookmarks.length,
      mine: spaces[k].bookmarks.filter((b) => !String(b.id).startsWith('bp_')).length,
      privateGroups: spaces[k].groups.filter((g) => !isPublicGid(g.id)).length
    }))
  };
  return { state: out, skipped: false, stats };
}

function main() {
  const target = process.argv[2] || 'C:/AI使用/NavioServer/win-unpacked/data/data.json';
  const backupDir = process.argv[3] || 'C:/AI使用/navio-tmp/pre-stage10-backup';
  const ROOT = path.join(__dirname, '..');
  const { Spaces, isPublicGid } = require(path.join(ROOT, 'src', 'spaces'));
  const { Store } = require(path.join(ROOT, 'src', 'store'));

  if (!fs.existsSync(target)) throw new Error('找不到数据文件: ' + target);
  const raw = fs.readFileSync(target, 'utf8');
  const state = JSON.parse(raw);

  // 用临时 Store 生成权威的 58 条预设书签与分类定义（与运行时完全同源）
  const tmp = path.join('C:/AI使用/navio-tmp', 'mig9-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const store = new Store(tmp);
  store.load();
  const spaces = new Spaces(store, path.join(ROOT, 'renderer'));
  const newBooks = spaces.presetBookmarks();
  const catDefs = spaces.presetCatalog().defs;
  if (newBooks.length !== 58 || catDefs.length !== 10) {
    throw new Error('预设目录异常: ' + newBooks.length + ' 书签 / ' + catDefs.length + ' 分类');
  }

  const r = migrateState(state, newBooks, catDefs, isPublicGid);
  const report = { target, skipped: r.skipped, stats: r.stats || null, backup: null, written: false };

  if (r.skipped) {
    fs.writeFileSync('C:/AI使用/navio-tmp/migrate-stage9.json', JSON.stringify(report, null, 2), 'utf8');
    console.log('SKIPPED already-migrated');
    return;
  }

  // 备份原件 + users/sessions，再原子替换
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'data.json'), raw, 'utf8');
  const dir = path.dirname(target);
  ['users.json', 'sessions.json', 'server.json'].forEach((f) => {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) fs.writeFileSync(path.join(backupDir, f), fs.readFileSync(p));
  });
  report.backup = backupDir;

  const tmpOut = target + '.stage9.tmp';
  fs.writeFileSync(tmpOut, JSON.stringify(r.state, null, 2), 'utf8');
  fs.renameSync(tmpOut, target);
  report.written = true;

  fs.writeFileSync('C:/AI使用/navio-tmp/migrate-stage9.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('MIGRATED', JSON.stringify(r.stats));
}

module.exports = { migrateState, normUrl, inherit, groupDefs };
if (require.main === module) main();
