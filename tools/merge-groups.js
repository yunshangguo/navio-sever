'use strict';
/**
 * 把顶层公共模板里 N 个历史推荐分类，合并成「常用 / 更多」两个分组。
 *
 * 设计原则（数据安全最优先）：
 *  - 这是纯函数：返回一份新 state，绝不修改入参，也不写盘。
 *  - 只动 groups 与 bookmarks[].groupId 两处；settings / spaces / todos / notes /
 *    widgets / users / sessions 等所有其它字段原样保留。
 *  - 书签 id、url、title、icon、order、clickCount 一律不改，
 *    因此已有的个人快照里引用的公共书签 id 依然有效。
 *  - 分类只看 host（与 src/spaces.js 的视图投影同一份白名单），
 *    所以「盘上数据」与「任意身份看到的视图」完全一致。
 *  - 幂等：对已合并过的数据再执行一次，结果相同。
 */
const { COMMON_GID, MORE_GID, isCommonUrl } = require('../src/spaces');

function mergeTopGroups(state) {
  const src = state && typeof state === 'object' ? state : {};
  const books = Array.isArray(src.bookmarks) ? src.bookmarks : [];

  const out = { ...src };
  out.bookmarks = books.map((b) => ({
    ...b,
    groupId: isCommonUrl(b.url) ? COMMON_GID : MORE_GID
  }));

  const hasCommon = out.bookmarks.some((b) => b.groupId === COMMON_GID);
  const hasMore = out.bookmarks.some((b) => b.groupId === MORE_GID);
  const groups = [];
  if (hasCommon) {
    groups.push({ id: COMMON_GID, name: '常用', color: '', icon: '', order: -1000, collapsed: false });
  }
  if (hasMore) {
    groups.push({ id: MORE_GID, name: '更多', color: '', icon: '', order: -999, collapsed: false });
  }
  out.groups = groups;

  const stats = {
    mergedFrom: (Array.isArray(src.groups) ? src.groups : []).map((g) => String(g && g.name || '')),
    oldGroupCount: (Array.isArray(src.groups) ? src.groups : []).length,
    newGroupCount: groups.length,
    bookmarks: out.bookmarks.length,
    common: out.bookmarks.filter((b) => b.groupId === COMMON_GID).length,
    more: out.bookmarks.filter((b) => b.groupId === MORE_GID).length
  };
  return { state: out, stats };
}

module.exports = { mergeTopGroups, COMMON_GID, MORE_GID };
