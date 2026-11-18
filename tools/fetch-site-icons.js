'use strict';
/**
 * 构建期工具：批量抓取「推荐书签目录」里各站点的真实 favicon，落地成静态资源包。
 *
 * 产物：renderer/site-icons/
 *   - <sha1(host)>.<ext>   真实图标原始字节
 *   - map.json              host -> { file, type, bytes, source, sha1 }
 *
 * 抓取优先级（每个站点并发尝试，按「清晰度优先」挑选结果）：
 *   1. 首页 <link rel=icon> 里的 PNG / SVG / apple-touch-icon（最清晰）
 *   2. /apple-touch-icon.png
 *   3. /favicon.ico  /favicon.png
 *   4. https://favicon.im/<host>?larger=true （第三方真实 favicon 兜底）
 *
 * 幂等：可反复运行；只覆盖同名文件，不删除历史文件。
 * 纯只读网络 + 只写 site-icons 目录，不碰任何用户数据。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RENDERER = path.join(__dirname, '..', 'renderer');
const OUT = path.join(RENDERER, 'site-icons');
const PRESETS = path.join(RENDERER, 'presets.js');

const TIMEOUT = 7000;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02)) return 'image/x-icon';
  const head = buf.slice(0, 400).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/x-icon': 'ico', 'image/svg+xml': 'svg'
};
// 清晰度权重：SVG / PNG 大图 > webp > jpg > gif > ico
const RANK = { 'image/svg+xml': 6, 'image/png': 5, 'image/webp': 4, 'image/jpeg': 3, 'image/gif': 2, 'image/x-icon': 1 };

async function grab(url, asText) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: asText ? 'text/html,*/*' : 'image/*,*/*' }
    });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!buf.length || buf.length > 512 * 1024) return null;
    if (asText) return { buf: buf.slice(0, 250 * 1024), kind: 'html' };
    const type = sniff(buf);
    if (!type) return null;
    return { buf, type, kind: 'image' };
  } catch (_) { return null; }
}

function linkIcons(html, origin) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*icon/i.test(tag)) continue;
    const h = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!h || h[1].startsWith('data:')) continue;
    try {
      const abs = new URL(h[1].trim(), origin).href;
      if (!/^https?:/i.test(abs)) continue;
      const sizesM = /sizes\s*=\s*["']([^"']+)["']/i.exec(tag);
      let size = 0;
      if (sizesM) {
        const n = /(\d+)/.exec(sizesM[1]);
        if (n) size = Math.min(999, parseInt(n[1], 10));
      }
      if (/apple-touch/.test(tag)) size = Math.max(size, 180);
      out.push({ url: abs, size });
    } catch (_) {}
  }
  out.sort((a, b) => b.size - a.size);
  return out.slice(0, 4);
}

function presetHosts() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(PRESETS, 'utf8'), sandbox, { timeout: 1000 });
  const groups = ((sandbox.window || {}).NAVIO_PRESETS || {}).groups || [];
  const seen = new Map();
  for (const g of groups) {
    for (const it of (g.items || [])) {
      const url = String(it[1] || '');
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) continue;
        if (!seen.has(u.host)) seen.set(u.host, { host: u.host, origin: u.origin, title: String(it[0] || '') });
      } catch (_) {}
    }
  }
  return [...seen.values()];
}

async function one(site) {
  const { host, origin } = site;
  const candidates = [];
  // 首页 link 图标（最清晰）
  const page = await grab(origin + '/', true);
  if (page && page.kind === 'html') {
    const html = page.buf.toString('utf8');
    for (const it of linkIcons(html, origin)) candidates.push({ url: it.url, tag: 'link', bonus: it.size });
  }
  // 常见固定路径
  candidates.push({ url: origin + '/apple-touch-icon.png', tag: 'apple', bonus: 180 });
  candidates.push({ url: origin + '/favicon.ico', tag: 'ico', bonus: 0 });
  candidates.push({ url: origin + '/favicon.png', tag: 'png', bonus: 0 });
  candidates.push({ url: 'https://favicon.im/' + host + '?larger=true', tag: 'favicon.im', bonus: 0 });

  // 分批并发，先到先得，但按「类型清晰度 + link 尺寸」择优
  const found = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = candidates.slice(i, i + 4);
    const rs = await Promise.all(batch.map((c) => grab(c.url)));
    rs.forEach((r, k) => { if (r && r.kind === 'image') found.push({ ...r, tag: batch[k].tag, bonus: batch[k].bonus, url: batch[k].url }); });
    // 若已有高质量结果（SVG/PNG 且来自站点自身），可提前停止
    if (found.some((f) => (RANK[f.type] >= 5) && f.tag !== 'favicon.im')) break;
  }
  if (!found.length) return { host, title: site.title, ok: false, reason: 'no-image' };

  found.sort((a, b) => {
    const ra = RANK[a.type] || 0, rb = RANK[b.type] || 0;
    if (ra !== rb) return rb - ra;
    if (a.tag === 'favicon.im' && b.tag !== 'favicon.im') return 1;
    if (b.tag === 'favicon.im' && a.tag !== 'favicon.im') return -1;
    if (a.bonus !== b.bonus) return b.bonus - a.bonus;
    return b.buf.length - a.buf.length;
  });
  const best = found[0];
  const sha1 = crypto.createHash('sha1').update(best.buf).digest('hex').slice(0, 16);
  const file = crypto.createHash('sha1').update(host).digest('hex') + '.' + EXT[best.type];
  fs.writeFileSync(path.join(OUT, file), best.buf);
  return {
    host, title: site.title, ok: true, file, type: best.type, bytes: best.buf.length,
    source: best.tag, sha1, candidates: found.length
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const sites = presetHosts();
  console.log('SITES=' + sites.length + '  OUT=' + OUT);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < sites.length) {
      const s = sites[idx++];
      const r = await one(s);
      results.push(r);
      console.log((r.ok ? 'OK   ' : 'MISS ') + String(r.host).padEnd(30) +
        (r.ok ? (r.type.padEnd(14) + String(r.bytes).padStart(7) + '  ' + r.source) : r.reason));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok);
  const map = {};
  for (const r of ok) map[r.host] = { file: r.file, type: r.type, bytes: r.bytes, source: r.source, sha1: r.sha1 };
  fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');

  // 质量检查：大量相同 sha1 说明可能被统一反代 / 默认图标污染
  const bySha = {};
  for (const r of ok) (bySha[r.sha1] = bySha[r.sha1] || []).push(r.host);
  const dup = Object.entries(bySha).filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);

  const report = {
    sites: sites.length, ok: ok.length, miss: results.length - ok.length,
    byType: ok.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {}),
    bySource: ok.reduce((a, r) => (a[r.source] = (a[r.source] || 0) + 1, a), {}),
    duplicates: dup.map(([sha, hosts]) => ({ sha, count: hosts.length, hosts: hosts.slice(0, 12) })),
    misses: results.filter((r) => !r.ok).map((r) => r.host + ' (' + r.title + ')')
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
