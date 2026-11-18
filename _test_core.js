'use strict';
/** 后端模块单测：书签解析/生成往返、Chromium JSON、存储原子写与自愈 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseNetscape, buildNetscape, parseChromiumBookmarks } = require('./src/importer');
const { Store, normalize } = require('./src/store');

const results = [];
const check = (n, ok, e) => {
  results.push(ok);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (e !== undefined ? '  → ' + e : ''));
};

/* ---------- 1. Netscape HTML 解析 ---------- */
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000">书签栏</H3>
    <DL><p>
        <DT><A HREF="https://github.com" ADD_DATE="1700000001">GitHub</A>
        <DT><A HREF="https://news.ycombinator.com" ADD_DATE="1700000002">Hacker News &amp; Stuff</A>
        <DT><H3>前端</H3>
        <DL><p>
            <DT><A HREF="https://developer.mozilla.org" ADD_DATE="1700000003">MDN &lt;docs&gt;</A>
            <DT><A HREF="https://vuejs.org" ADD_DATE="1700000004">Vue</A>
        </DL><p>
        <DT><H3>空文件夹</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><H3>其他</H3>
    <DL><p>
        <DT><A HREF="javascript:void(0)">书签脚本(应忽略)</A>
        <DT><A HREF="https://example.com/a?b=1&amp;c=2" ICON="data:image/png;base64,iVBORw0KGgo=">带参数的链接</A>
    </DL><p>
</DL><p>`;

const p1 = parseNetscape(html);
check('解析分组数（空文件夹不建组）', p1.groups.length === 3, p1.groups.map((g) => g.name).join(' | '));
check('解析书签数（跳过 javascript:）', p1.bookmarks.length === 5, p1.bookmarks.length + ' 条');
check('HTML 实体还原', p1.bookmarks.some((b) => b.title === 'Hacker News & Stuff'), p1.bookmarks.map((b) => b.title).join(','));
check('标签剥离', p1.bookmarks.some((b) => b.title === 'MDN <docs>'));
check('嵌套分组路径', p1.groups.some((g) => g.name === '书签栏 / 前端'), p1.groups.map((g) => g.name).join(' | '));
check('URL 查询串保留', p1.bookmarks.some((b) => b.url === 'https://example.com/a?b=1&c=2'));
check('内嵌 data 图标保留', p1.bookmarks.some((b) => b.icon.startsWith('data:image/png')));
check('每本书签都有 groupId', p1.bookmarks.every((b) => !!b.groupId));

/* ---------- 2. 往返 ---------- */
const out = buildNetscape(p1.groups, p1.bookmarks);
const p2 = parseNetscape(out);
check('导出→再解析 数量一致', p2.bookmarks.length === p1.bookmarks.length, `${p1.bookmarks.length} → ${p2.bookmarks.length}`);
check('导出→再解析 URL 一致',
  p2.bookmarks.map((b) => b.url).sort().join('|') === p1.bookmarks.map((b) => b.url).sort().join('|'));
check('导出含标准头', out.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
check('导出转义正确', out.includes('Hacker News &amp; Stuff') && out.includes('MDN &lt;docs&gt;'));

/* ---------- 3. Chromium Bookmarks JSON ---------- */
const chromium = {
  roots: {
    bookmark_bar: {
      name: '书签栏',
      type: 'folder',
      children: [
        { type: 'url', name: 'Google', url: 'https://google.com', date_added: '13350000000' },
        {
          type: 'folder',
          name: '开发',
          children: [
            { type: 'url', name: 'Node', url: 'https://nodejs.org', date_added: '13350000001' },
            { type: 'url', name: 'Deno', url: 'https://deno.com', date_added: '13350000002' }
          ]
        }
      ]
    },
    other: { name: '其他书签', type: 'folder', children: [{ type: 'url', name: 'X', url: 'https://x.com', date_added: '13350000003' }] }
  }
};
const p3 = parseChromiumBookmarks(chromium);
check('Chromium JSON 书签数', p3.bookmarks.length === 4, p3.bookmarks.map((b) => b.title).join(','));
check('Chromium JSON 分组', p3.groups.length >= 2, p3.groups.map((g) => g.name).join(' | '));
check('Chromium 子文件夹归组', p3.groups.some((g) => g.name.includes('开发')), p3.groups.map((g) => g.name).join(' | '));

/* ---------- 4. normalize ---------- */
const dirty = {
  groups: [{ name: 'A', order: 1 }, { name: 'B', order: 0 }],
  bookmarks: [
    { url: 'https://a.com', title: 'A', groupId: 'nonexistent', order: 5 },
    { url: '', title: '空 url 应丢弃' },
    { url: 'https://b.com', order: 0 }
  ],
  settings: {}
};
const n1 = normalize(dirty);
check('normalize 丢弃空 URL', n1.bookmarks.length === 2, n1.bookmarks.length + ' 条');
check('normalize 补 id', n1.bookmarks.every((b) => b.id));
check('normalize 悬空 groupId 归位', n1.bookmarks.every((b) => n1.groups.some((g) => g.id === b.groupId)));
check('normalize 分组排序', n1.groups[0].name === 'B', n1.groups.map((g) => g.name).join(','));
check('normalize 补默认设置', n1.settings.theme === 'dark' && n1.settings.wallpaper.preset === 'aurora');

/* ---------- 5. Store 原子写 / 自愈 / 备份 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navio-test-'));
const st = new Store(path.join(tmp, 'data'));
const loaded = st.load();
check('空目录首次加载', loaded.ok === false && st.state.bookmarks.length === 0);

st.state.groups = [{ id: 'g1', name: '测试', color: '', icon: '', order: 0, collapsed: false }];
st.state.bookmarks = [
  { id: 'b1', groupId: 'g1', title: 'T1', url: 'https://t1.com', icon: '', desc: '', order: 0, createdAt: new Date().toISOString(), clickCount: 0 }
];
const w1 = st.saveSync(st.state);
check('saveSync 写盘成功', w1 === true && fs.existsSync(path.join(tmp, 'data', 'data.json')));

const st2 = new Store(path.join(tmp, 'data'));
const l2 = st2.load();
check('重新加载数据一致', l2.ok && st2.state.bookmarks.length === 1, l2.source);

// 健康状态下先做一份备份
const bk = st.backup('healthy');
check('生成备份', bk.ok && fs.existsSync(path.join(tmp, 'data', 'backups', bk.name)), bk.name || bk.error);
check('列出备份', st.listBackups().length >= 1, st.listBackups().length + ' 份');

// 损坏主文件 → 应从 .bak 或 backups 自愈
fs.writeFileSync(path.join(tmp, 'data', 'data.json'), '{ broken json', 'utf8');
const st3 = new Store(path.join(tmp, 'data'));
const l3 = st3.load();
check('损坏自愈（.bak / 备份）', l3.ok && st3.state.bookmarks.length === 1, l3.source);

// 恢复
st3.state.bookmarks = [];
const rs = st3.restoreBackup(bk.name);
check('从备份恢复', rs.ok && rs.state && rs.state.bookmarks.length === 1,
  rs.ok ? rs.state.bookmarks.length + ' 条' : rs.error);

check('stats 字段完整',
  ['dataDir', 'file', 'bytes', 'groups', 'bookmarks', 'backups'].every((k) => k in st3.stats()));

check('原子写无残留 .tmp', !fs.existsSync(path.join(tmp, 'data', 'data.json.tmp')));

fs.rmSync(tmp, { recursive: true, force: true });

const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
process.exit(pass === results.length ? 0 : 1);
