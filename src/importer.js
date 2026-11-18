'use strict';
/**
 * 浏览器书签 HTML（Netscape Bookmark File）导入 / 导出
 * 兼容 Chrome / Edge / Firefox 导出的 bookmarks.html
 */
const crypto = require('crypto');

function uid(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).trim();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 解析 Netscape 书签 HTML → {groups, bookmarks} */
function parseNetscape(html) {
  const src = String(html || '');
  const re = /<DT>\s*<H3\b([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A\b([^>]*)>([\s\S]*?)<\/A>|<DL\b[^>]*>|<\/DL>/gi;

  const stack = []; // 每层：{name} 或 null（根）
  const groups = new Map(); // path -> group
  const bookmarks = [];
  let pending = null;
  let m;
  let guard = 0;

  const pathNow = () => stack.filter(Boolean).map((x) => x.name).join(' / ');

  while ((m = re.exec(src)) && guard++ < 500000) {
    const tok = m[0];
    if (/^<DL/i.test(tok)) {
      stack.push(pending);
      pending = null;
    } else if (/^<\/DL/i.test(tok)) {
      stack.pop();
      pending = null;
    } else if (m[2] !== undefined) {
      pending = { name: stripTags(m[2]) || '未命名文件夹' };
    } else if (m[4] !== undefined) {
      const attrs = m[3] || '';
      const hrefM = /HREF\s*=\s*"([^"]*)"/i.exec(attrs) || /HREF\s*=\s*'([^']*)'/i.exec(attrs);
      const iconM = /ICON\s*=\s*"([^"]*)"/i.exec(attrs);
      let url = decodeEntities(hrefM ? hrefM[1] : '').trim();
      if (!url) continue;
      if (/^(javascript|place|about):/i.test(url)) continue;
      const title = stripTags(m[4]) || url;
      const path = pathNow();
      if (!groups.has(path)) {
        groups.set(path, {
          id: uid('g_'),
          name: path || '默认分组',
          color: '',
          icon: '',
          order: groups.size,
          collapsed: false
        });
      }
      const g = groups.get(path);
      bookmarks.push({
        id: uid('b_'),
        groupId: g.id,
        title: title.slice(0, 200),
        url: url.slice(0, 4000),
        icon: iconM && /^data:image\//i.test(iconM[1]) ? iconM[1].slice(0, 400000) : '',
        desc: '',
        order: bookmarks.length,
        createdAt: new Date().toISOString(),
        clickCount: 0
      });
    }
  }

  return { groups: Array.from(groups.values()), bookmarks };
}

/** 生成可被 Chrome/Edge 导入的 HTML */
function buildNetscape(groups, bookmarks) {
  const now = Math.floor(Date.now() / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ];
  const sorted = [...(groups || [])].sort((a, b) => a.order - b.order);
  const list = [...(bookmarks || [])].sort((a, b) => a.order - b.order);
  for (const g of sorted) {
    lines.push(`    <DT><H3 ADD_DATE="${now}">${escapeHtml(g.name)}</H3>`);
    lines.push('    <DL><p>');
    for (const b of list.filter((x) => x.groupId === g.id)) {
      lines.push(`        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${now}">${escapeHtml(b.title)}</A>`);
    }
    lines.push('    </DL><p>');
  }
  const orphans = list.filter((b) => !sorted.some((g) => g.id === b.groupId));
  if (orphans.length) {
    lines.push('    <DT><H3>未分组</H3>');
    lines.push('    <DL><p>');
    orphans.forEach((b) => {
      lines.push(`        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${now}">${escapeHtml(b.title)}</A>`);
    });
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join('\n');
}

/** 解析 Chrome/Edge 的 Bookmarks JSON（可直接读 D 盘用户目录那个文件） */
function parseChromiumBookmarks(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const groups = [];
  const bookmarks = [];

  function walk(node, pathArr) {
    if (!node) return;
    if (node.type === 'url' && node.url) {
      const path = pathArr.join(' / ') || '默认分组';
      let g = groups.find((x) => x.name === path);
      if (!g) {
        g = { id: uid('g_'), name: path, color: '', icon: '', order: groups.length, collapsed: false };
        groups.push(g);
      }
      bookmarks.push({
        id: uid('b_'),
        groupId: g.id,
        title: String(node.name || node.url).slice(0, 200),
        url: String(node.url).slice(0, 4000),
        icon: '',
        desc: '',
        order: bookmarks.length,
        createdAt: new Date((node.date_added || Date.now() / 1000) * 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
        clickCount: 0
      });
      return;
    }
    const kids = node.children || [];
    const here = node.type === 'folder' || node.name ? pathArr.concat(node.name === '书签栏' || node.name === 'Bookmarks bar' ? [] : [node.name]) : pathArr;
    kids.forEach((c) => walk(c, node.name && c.type !== 'url' ? here : here));
  }

  const roots = data.roots || {};
  Object.values(roots).forEach((r) => walk(r, []));
  return { groups, bookmarks };
}

module.exports = { parseNetscape, buildNetscape, parseChromiumBookmarks, escapeHtml };
