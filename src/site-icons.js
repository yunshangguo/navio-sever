'use strict';
/**
 * 内置「真实站点图标包」：renderer/site-icons/
 *
 * 由构建期工具 tools/fetch-site-icons.js 从各站点官网抓取真实 favicon，
 * 与程序一起打包，离线可用、不依赖运行时外网、也不是自绘 SVG。
 *
 * 服务端 /api/icon 的降级顺序：
 *   本地 favicons 缓存 → 【本图标包】 → 在线抓取 → 内置自绘 SVG → 首字母
 */
const fs = require('fs');
const path = require('path');

class SiteIcons {
  constructor(rendererDir) {
    this.dir = path.join(rendererDir || '', 'site-icons');
    this.map = {};
    this.loaded = false;
  }

  load() {
    if (this.loaded) return this.map;
    this.loaded = true;
    try {
      const f = path.join(this.dir, 'map.json');
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j && typeof j === 'object' && !Array.isArray(j)) this.map = j;
      }
    } catch (_) {
      this.map = {};
    }
    return this.map;
  }

  /** host 可能带/不带 www，也可能带协议与端口；给出全部可尝试的键 */
  static keys(host) {
    const h = String(host || '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
    if (!h) return [];
    const out = [h];
    if (h.startsWith('www.')) out.push(h.slice(4));
    else out.push('www.' + h);
    return out;
  }

  find(host) {
    const map = this.load();
    for (const k of SiteIcons.keys(host)) {
      const v = map[k];
      if (!v || !v.file) continue;
      const base = path.basename(String(v.file));
      const stem = base.replace(/\.[^.]+$/, '');
      // 优先返回构建期归一化产物（统一 128x128 全透明 PNG）：
      // 各站点 favicon 原始尺寸/留白差异极大，归一化后视觉大小才一致。
      // std/ 不存在时自动回退原始文件，抓取脚本重跑后仍可用，随时可回滚。
      const stdFile = path.join(this.dir, 'std', stem + '.png');
      const useStd = fs.existsSync(stdFile);
      const p = useStd ? stdFile : path.join(this.dir, base);
      if (fs.existsSync(p)) {
        return {
          file: p,
          type: useStd ? 'image/png' : (v.type || 'image/png'),
          bytes: v.bytes,
          source: v.source,
          key: k,
          normalized: useStd
        };
      }
    }
    return null;
  }

  count() { return Object.keys(this.load()).length; }
}

module.exports = { SiteIcons };
