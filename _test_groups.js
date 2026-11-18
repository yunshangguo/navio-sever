'use strict';
/**
 * 阶段 11 专项单测：所有预设书签归入唯一「常用」分类 + 数据迁移。
 * 纯 Node（Store + Spaces + migrate-catalog），不起 HTTP、不起 Electron。
 * 用法：node _test_groups.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { Store } = require('./src/store');
const { Spaces, COMMON_GID, MORE_GID, isCommonHost, isCommonUrl, isPublicGid } = require('./src/spaces');
const { migrateState } = require('./tools/migrate-catalog');
const { mergeTopGroups } = require('./tools/merge-groups');

const results = [];
function ck(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}

const DATA = path.join('C:/AI使用/navio-tmp', 'groups-test-' + Date.now());
fs.mkdirSync(DATA, { recursive: true });
const store = new Store(DATA);
store.load();
const spaces = new Spaces(store, path.join(ROOT, 'renderer'));
const groupIds = (v) => v.groups.map((g) => g.id);
const pubGroups = (v) => v.groups.filter((g) => g.scope === 'public');

(async () => {
  /* ---------- 1. 全新空库：51 站点全部归入唯一「常用」 ---------- */
  const v0 = spaces.view('anon_a');
  ck('空库预设生成 51 个公共书签', v0.bookmarks.length === 51, v0.bookmarks.length);
  ck('视图恰好 1 个公共分组', v0.groups.length === 1 && pubGroups(v0).length === 1, groupIds(v0));
  ck('唯一分组为「常用」且 id 固定',
    v0.groups[0].name === '常用' && v0.groups[0].id === COMMON_GID, v0.groups.map((g) => g.name));
  ck('「常用」带系统预设分类图标（data URI）',
    /^data:image\/svg\+xml/.test(v0.groups[0].icon || ''), (v0.groups[0].icon || '').slice(0, 40));
  ck('全部分组 scope=public', v0.groups.every((g) => g.scope === 'public'), groupIds(v0));
  ck('公共书签全部 scope=public', v0.bookmarks.every((b) => b.scope === 'public'));
  ck('所有书签都挂「常用」分组',
    v0.bookmarks.every((b) => b.groupId === COMMON_GID),
    v0.bookmarks.filter((b) => b.groupId !== COMMON_GID).map((b) => [b.title, b.groupId]));
  ck('投影后无悬空 groupId',
    v0.bookmarks.every((b) => v0.groups.some((g) => g.id === b.groupId)));
  ck('预设目录 id 可被 isPublicGid 识别',
    v0.groups.every((g) => isPublicGid(g.id)), groupIds(v0));
  const titles = v0.bookmarks.map((b) => b.title);
  ck('用户保留的站点都在（GitHub / 淘宝 / ChatGPT / 微博）',
    ['GitHub', '淘宝', 'ChatGPT', '微博'].every((t) => titles.includes(t)), titles.length);

  /* ---------- 2. 历史多分类数据：迁移后全部归「常用」且不写盘 ---------- */
  const pubBooks = spaces.presetBookmarks();
  const HIST_NAMES = ['常用', '工具', 'AI 工具', '开发', '社区资讯', '影音娱乐',
    '购物生活', '效率办公', '设计素材', '学习阅读', '云与运维'];
  const legacy = pubBooks.map((b, i) => ({
    ...b, id: 'b_old_' + i, groupId: 'g_hist_' + (i % 11), order: i, icon: ''
  }));
  const online = {
    version: 1, seeded: true, createdAt: '2026-01-01T00:00:00.000Z',
    settings: { theme: 'light', searchEngine: 'bing', wallpaper: { type: 'preset', preset: 'dawn' } },
    widgets: [{ id: 'w_todo', type: 'todo' }],
    groups: HIST_NAMES.map((name, i) => ({ id: 'g_hist_' + i, name, color: '', icon: '', order: i, collapsed: false })),
    bookmarks: legacy
  };
  const catDefs = spaces.presetCatalog().defs;
  const mig = migrateState(online, pubBooks, catDefs, isPublicGid);
  ck('迁移未跳过（旧式 id 被识别为待迁移）', mig.skipped === false, mig.stats);
  ck('迁移后顶层 1 个分组 / 51 个书签',
    mig.state.groups.length === 1 && mig.state.bookmarks.length === 51, mig.stats);
  ck('迁移顶层书签全部归「常用」',
    mig.state.bookmarks.every((b) => b.groupId === COMMON_GID), mig.stats);
  ck('迁移不改入参', online.groups.length === 11 && online.bookmarks.length === 51 && mig.state !== online);

  store.saveSync(JSON.parse(JSON.stringify(mig.state)));
  const v1 = spaces.view('anon_b');
  ck('迁移后视图为 1 个公共分组',
    v1.groups.length === 1 && pubGroups(v1).length === 1 && v1.groups[0].name === '常用', groupIds(v1));
  ck('视图未写入顶层（顶层仍 1 组 / 51 书签）',
    store.state.groups.length === 1 && store.state.bookmarks.length === 51);

  /* ---------- 3. 旧版个人快照（扁平 g_public）投影 + 私有数据保留 ---------- */
  const st = store.state;
  const topBooks = JSON.parse(JSON.stringify(st.bookmarks));
  st.spaces = st.spaces || {};
  st.spaces.u_old = {
    version: 1, seeded: true,
    settings: { theme: 'dark', searchEngine: 'bing' },
    groups: [
      { id: 'g_public', name: '通用', order: -1000, collapsed: false },
      { id: 'mine_g', name: '我的收藏', color: '#f00', order: 10, collapsed: false }
    ],
    bookmarks: topBooks.slice(0, 30).map((b) => ({ ...b, groupId: 'g_public' })).concat([
      { id: 'mine_b', groupId: 'mine_g', title: '我的站点', url: 'https://mine.example.com', order: 999, clickCount: 0 },
      { id: 'moved_b', groupId: 'mine_g', title: '移过来的', url: 'https://www.baidu.com/moved', order: 998, clickCount: 0 }
    ])
  };
  store.saveSync(st);
  const v2 = spaces.view('u_old');
  ck('旧快照的公共书签投影进「常用」（不再是扁平 g_public）',
    pubGroups(v2).length === 1 && v2.groups[0].id === COMMON_GID && !v2.groups.some((g) => g.id === 'g_public'), groupIds(v2));
  ck('旧快照里的私有分组完整保留',
    (() => { const g = v2.groups.find((x) => x.id === 'mine_g');
      return !!g && g.name === '我的收藏' && g.color === '#f00' && g.scope === 'mine'; })(),
    v2.groups.map((g) => g.id));
  ck('私有书签仍留在私有分组且 scope=mine',
    (() => { const b = v2.bookmarks.find((x) => x.id === 'mine_b');
      return !!b && b.groupId === 'mine_g' && b.scope === 'mine'; })());
  ck('用户主动移入私有分组的公共书签不被拉回',
    (() => { const b = v2.bookmarks.find((x) => x.id === 'moved_b');
      return !!b && b.groupId === 'mine_g' && b.scope === 'mine'; })());
  ck('投影后无悬空 groupId',
    v2.bookmarks.every((b) => v2.groups.some((g) => g.id === b.groupId)));

  /* ---------- 4. 身份隔离 + 幂等 + reset ---------- */
  const firstPubId = (v2.bookmarks.find((b) => b.scope === 'public') || {}).id;
  const del = JSON.parse(JSON.stringify(v2));
  del.bookmarks = del.bookmarks.filter((b) => b.id !== firstPubId && b.id !== 'mine_b');
  spaces.save('anon_del', del);
  const vDel = spaces.view('anon_del');
  ck('某身份删书签不影响他人', spaces.view('anon_b').bookmarks.length === 51 &&
    vDel.bookmarks.length === v2.bookmarks.length - 2,
    { expect: v2.bookmarks.length - 2, got: vDel.bookmarks.length });
  const before = JSON.stringify({ g: groupIds(v2), n: v2.bookmarks.length });
  spaces.save('u_old', v2);
  const v2b = spaces.view('u_old');
  ck('投影幂等：写回再读分组结构不变',
    before === JSON.stringify({ g: groupIds(v2b), n: v2b.bookmarks.length }), groupIds(v2b));
  spaces.reset('anon_del');
  ck('reset 后回到完整的 51 个公共书签 / 1 分组',
    spaces.view('anon_del').groups.length === 1 && spaces.view('anon_del').bookmarks.length === 51);

  /* ---------- 5. 迁移纯函数的数据安全 ---------- */
  const fixture = {
    version: 1, seeded: true,
    settings: { theme: 'light' }, widgets: [{ id: 'w1', type: 'todo' }],
    todos: [{ id: 't1', text: '别删我' }], notes: [{ id: 'n1', text: '也别删' }],
    groups: [
      { id: 'g_common', name: '常用', order: -1000, collapsed: false },
      { id: 'g_more', name: '更多', order: -999, collapsed: false }
    ],
    bookmarks: legacy.map((b, i) => ({
      ...b, groupId: i < 20 ? 'g_common' : 'g_more',
      size: i === 0 ? '2x2' : undefined, clickCount: i === 0 ? 7 : 0
    })),
    spaces: {
      u_x: {
        version: 1, seeded: true,
        groups: [
          { id: 'g_more', name: '更多', order: -999, collapsed: false },
          { id: 'g_priv', name: '私人', color: '#f0f', order: 8, collapsed: false }
        ],
        bookmarks: legacy.slice(0, 10).map((b) => ({ ...b, groupId: 'g_more', clickCount: 5 })).concat([
          { id: 'priv_1', groupId: 'g_priv', title: '私人站点', url: 'https://private.example.com', order: 800, clickCount: 0 },
          { id: 'priv_2', groupId: 'g_more', title: '挂公共组的私人', url: 'https://orphan2.example.com', order: 801, clickCount: 0 }
        ])
      }
    }
  };
  const frozen = JSON.stringify(fixture);
  const m = migrateState(fixture, pubBooks, catDefs, isPublicGid);
  ck('迁移纯函数不修改入参', JSON.stringify(fixture) === frozen);
  ck('迁移后顶层恰为 51 书签 / 1 分类',
    m.state.bookmarks.length === 51 && m.state.groups.length === 1 &&
    m.state.groups.every((g) => isPublicGid(g.id)), m.stats);
  ck('顶层为纯公共模板（51 个稳定 bp_ 书签，不再夹带旧式 id）',
    m.state.bookmarks.every((b) => String(b.id).startsWith('bp_')), m.state.bookmarks.length);
  ck('settings / widgets / todos / notes 原样保留',
    JSON.stringify(m.state.settings) === JSON.stringify(fixture.settings) &&
    JSON.stringify(m.state.widgets) === JSON.stringify(fixture.widgets) &&
    JSON.stringify(m.state.todos) === JSON.stringify(fixture.todos) &&
    JSON.stringify(m.state.notes) === JSON.stringify(fixture.notes));
  const legacyTop = fixture.bookmarks[0];
  const newFirst = m.state.bookmarks.find((b) => b.url === legacyTop.url);
  ck('阶段 8 的 size 与 clickCount 按 url 继承',
    !!newFirst && newFirst.size === '2x2' && newFirst.clickCount === 7, newFirst);
  const sx = m.state.spaces.u_x;
  ck('个人快照同步为 51 公共 + 自建书签',
    sx.bookmarks.filter((b) => String(b.id).startsWith('bp_')).length === 51 &&
    ['priv_1', 'priv_2'].every((id) => sx.bookmarks.some((b) => b.id === id)),
    sx.bookmarks.length);
  ck('个人快照私有分组保留、公共旧分组被替换',
    sx.groups.some((g) => g.id === 'g_priv' && g.color === '#f0f') &&
    sx.groups.filter((g) => isPublicGid(g.id)).length === 1, sx.groups.map((g) => g.id));
  ck('挂在旧公共分组的自建书签被兜底到私有分组',
    (() => { const b = sx.bookmarks.find((x) => x.id === 'priv_2');
      return !!b && b.groupId === 'g_priv'; })());
  ck('个人快照无悬空 groupId',
    sx.bookmarks.every((b) => sx.groups.some((g) => g.id === b.groupId)));
  const m2 = migrateState(m.state, pubBooks, catDefs, isPublicGid);
  ck('迁移幂等：二次执行直接跳过', m2.skipped === true, m2.stats);

  /* ---------- 6. 历史合并工具仍为纯函数（兼容保留，不再用于视图投影） ---------- */
  const r1 = mergeTopGroups(fixture);
  ck('历史合并工具输出 2 组且不改书签字段',
    r1.state.groups.length === 2 &&
    r1.state.bookmarks.every((b, i) => b.id === fixture.bookmarks[i].id &&
      b.url === fixture.bookmarks[i].url), r1.stats);
  const r2 = mergeTopGroups(r1.state);
  ck('历史合并工具幂等', JSON.stringify(r2.state) === JSON.stringify(r1.state));
  ck('历史合并工具不修改入参', JSON.stringify(fixture) === frozen);

  /* ---------- 7. host 判定边界 ---------- */
  ck('host 判定支持 www / 子域 / 大小写',
    isCommonHost('www.baidu.com') && isCommonHost('PAN.BAIDU.COM') &&
    isCommonHost('mail.qq.com') === true && isCommonUrl('https://github.com/a') &&
    isCommonUrl('https://WWW.GOOGLE.COM/search'));
  ck('非白名单域名不误判',
    !isCommonHost('coursera.org') && !isCommonHost('grafana.com') &&
    !isCommonHost('notbaidu.com') && !isCommonUrl('https://example.com'));
  ck('MORE_GID 仍被识别为公共分组（历史兜底）', isPublicGid(MORE_GID));

  /* ---------- 汇总 ---------- */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT ${pass}/${results.length} PASS`);
  fs.writeFileSync('C:/AI使用/navio-tmp/groups-test-result.json',
    JSON.stringify({ pass, total: results.length, results }, null, 2), 'utf8');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e && e.stack || e);
  process.exit(1);
});
