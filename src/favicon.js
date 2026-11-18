'use strict';
/**
 * 图标抓取与缓存
 * 顺序：/favicon.ico → 解析首页 <link rel=icon> → /favicon.png → /apple-touch-icon.png
 * 结果缓存在 <dataDir>/favicons/<sha1(origin)>.<ext>，走自定义协议 navio://icon/<host> 输出
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT = 6000;
const MAX_BYTES = 512 * 1024;
const HTML_LIMIT = 250 * 1024;

const memHit = new Map(); // origin -> {file, type}
const memMiss = new Map(); // origin -> ts
const MISS_TTL = 6 * 3600 * 1000;

function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02)) return 'image/x-icon';
  const head = buf.slice(0, 200).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('svg'))) return 'image/svg+xml';
  return null;
}

function extOf(type) {
  return (
    {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/x-icon': 'ico',
      'image/svg+xml': 'svg'
    }[type] || 'bin'
  );
}

function siteInfo(rawUrl) {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl);
    if (!/^https?:$/.test(u.protocol)) return null;
    return { origin: u.origin, host: u.host };
  } catch (_) {
    return null;
  }
}

async function fetchBuf(getNet, url, asText = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await getNet().fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: asText ? 'text/html,*/*' : 'image/*,*/*'
      }
    });
    if (!res.ok) return null;
    if (asText) {
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) {
        const s = await res.text();
        return { buf: Buffer.from(s.slice(0, HTML_LIMIT), 'utf8'), type: 'text/html' };
      }
      const chunks = [];
      let total = 0;
      while (total < HTML_LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        total += value.length;
      }
      try {
        reader.cancel();
      } catch (_) {}
      return { buf: Buffer.concat(chunks), type: 'text/html' };
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return null;
    const buf = Buffer.from(ab);
    return { buf, type: sniff(buf) };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function pickIconsFromHtml(html, origin) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*icon/i.test(tag)) continue;
    const hrefM = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!hrefM) continue;
    let href = hrefM[1].trim();
    if (!href || href.startsWith('data:')) continue;
    try {
      const abs = new URL(href, origin).href;
      if (/^https?:/i.test(abs)) out.push(abs);
    } catch (_) {}
  }
  // apple-touch-icon 通常更大更清晰，优先
  out.sort((a, b) => (b.includes('apple-touch') ? 1 : 0) - (a.includes('apple-touch') ? 1 : 0));
  return out.slice(0, 3);
}

class IconCache {
  constructor(dataDir, getNet) {
    this.dir = path.join(dataDir, 'favicons');
    this.getNet = getNet;
    this.inflight = new Map();
  }

  keyFor(origin) {
    return crypto.createHash('sha1').update(origin).digest('hex');
  }

  findCached(origin) {
    const k = this.keyFor(origin);
    if (!fs.existsSync(this.dir)) return null;
    for (const ext of ['png', 'ico', 'jpg', 'gif', 'webp', 'svg', 'bin']) {
      const p = path.join(this.dir, k + '.' + ext);
      if (fs.existsSync(p)) {
        const type = sniff(fs.readFileSync(p).slice(0, 300)) || 'image/png';
        return { file: p, type };
      }
    }
    return null;
  }

  async get(rawUrl) {
    const info = siteInfo(rawUrl);
    if (!info) return null;
    const { origin, host } = info;

    if (memMiss.has(origin) && Date.now() - memMiss.get(origin) < MISS_TTL) return null;
    const cached = this.findCached(origin);
    if (cached) return cached;

    if (this.inflight.has(origin)) return this.inflight.get(origin);

    const job = (async () => {
      const tries = [
        origin + '/favicon.ico',
        origin + '/favicon.png'
      ];
      for (const u of tries) {
        const r = await fetchBuf(this.getNet, u);
        if (r && r.buf && r.type) return this.persist(origin, r);
      }
      // 解析首页 link
      const page = await fetchBuf(this.getNet, origin + '/', true);
      if (page && page.buf) {
        const html = page.buf.toString('utf8');
        const icons = pickIconsFromHtml(html, origin);
        for (const u of icons) {
          const r = await fetchBuf(this.getNet, u);
          if (r && r.buf && r.type) return this.persist(origin, r);
        }
      }
      memMiss.set(origin, Date.now());
      return null;
    })();

    this.inflight.set(origin, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(origin);
    }
  }

  persist(origin, r) {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, this.keyFor(origin) + '.' + extOf(r.type));
      fs.writeFileSync(file, r.buf);
      return { file, type: r.type };
    } catch (_) {
      return { file: null, type: r.type, buf: r.buf };
    }
  }

  clear(origin) {
    const k = this.keyFor(origin);
    if (!fs.existsSync(this.dir)) return;
    fs.readdirSync(this.dir)
      .filter((f) => f.startsWith(k))
      .forEach((f) => {
        try {
          fs.unlinkSync(path.join(this.dir, f));
        } catch (_) {}
      });
    memMiss.delete(origin);
  }

  size() {
    try {
      return fs.readdirSync(this.dir).length;
    } catch (_) {
      return 0;
    }
  }
}

module.exports = { IconCache, siteInfo, sniff };
