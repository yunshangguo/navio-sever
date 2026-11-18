'use strict';
/**
 * 构建期工具：把 renderer/site-icons/ 里各站点的真实 favicon 归一化成统一规格。
 *
 * 背景：94 枚官网图标原始尺寸从 16x16 到 180x180 不等，还各带不同的透明留白，
 * 直接 object-fit:contain 显示出来视觉大小参差。本工具用 Chromium Canvas 逐张：
 *   1) 解码 PNG / ICO / SVG / WEBP / GIF / JPEG（浏览器原生支持，无需 sharp / Pillow）
 *   2) 扫描 alpha 通道，裁掉四周透明留白，得到内容包围盒 bbox
 *   3) 把 bbox 等比缩放、居中绘制到统一 128x128 全透明画布的 84% 内切区
 *   4) 输出统一 PNG 到 renderer/site-icons/std/<sha1(host)>.png
 *
 * 只统一「视觉大小」，不裁圆角、不改形状、不加底板、不改颜色 —— 圆形/方形等
 * 品牌原生形状与配色全部忠实保留。原始图标文件完全不动，随时可回滚（删掉 std/ 即可）。
 *
 * 服务端 src/site-icons.js 的 find() 会优先返回 std/ 下的归一化文件；
 * 若 std/ 不存在（例如重新抓取后尚未归一化），自动回退到原始文件，向后兼容。
 *
 * 用法：
 *   node tools/normalize-site-icons.js           生成（需要本机 Chromium，仅构建期）
 *   node tools/normalize-site-icons.js --check   纯 Node 校验产物完整性，不启动浏览器
 *
 * 幂等；只写 site-icons/std/，不碰任何用户数据，不联网。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'renderer', 'site-icons');
const STD = path.join(DIR, 'std');
const MAP_FILE = path.join(DIR, 'map.json');
const REPORT = path.join(STD, 'normalize-report.json');

const SIZE = 128;      // 统一画布边长
const FILL = 0.84;     // 内容最大边占画布比例
const TAG = 'v1-128-f84';
const ALPHA_TH = 12;   // alpha 阈值，忽略抗锯齿极淡像素

const isCheck = process.argv.includes('--check');

/* ---------------- 纯 Node 校验模式 ---------------- */
function pngSize(buf) {
  if (!buf || buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 ||
      buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function check() {
  const fails = [];
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const hosts = Object.keys(map);
  if (!fs.existsSync(STD)) fails.push('std/ 目录不存在');
  const files = fs.existsSync(STD) ? fs.readdirSync(STD).filter((f) => f.endsWith('.png')) : [];
  if (files.length < hosts.length) fails.push('std PNG 数量不足: ' + files.length + '/' + hosts.length);
  let badSize = 0, badHead = 0, missing = 0, total = 0;
  for (const h of hosts) {
    const stem = path.basename(String(map[h].file)).replace(/\.[^.]+$/, '');
    const p = path.join(STD, stem + '.png');
    if (!fs.existsSync(p)) { missing++; continue; }
    const b = fs.readFileSync(p);
    total += b.length;
    const s = pngSize(b);
    if (!s) badHead++;
    else if (s.w !== SIZE || s.h !== SIZE) badSize++;
  }
  if (missing) fails.push('缺失归一化文件: ' + missing);
  if (badHead) fails.push('非法 PNG 文件头: ' + badHead);
  if (badSize) fails.push('尺寸不是 ' + SIZE + 'x' + SIZE + ': ' + badSize);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch (_) {}
  if (!report || report.tag !== TAG || report.ok !== hosts.length) fails.push('report 标记/数量不匹配');
  console.log('CHECK hosts=' + hosts.length + ' stdPng=' + files.length +
    ' totalBytes=' + total + ' missing=' + missing + ' badSize=' + badSize + ' badHead=' + badHead);
  if (fails.length) {
    fails.forEach((f) => console.log('FAIL ' + f));
    console.log('NORMALIZE_CHECK=FAIL');
    process.exit(1);
  }
  console.log('NORMALIZE_CHECK=OK  ' + TAG + '  ' + hosts.length + ' x ' + SIZE + 'x' + SIZE + ' PNG');
  process.exit(0);
}

if (isCheck) { check(); }

/* ---------------- 生成模式 ---------------- */
function loadChromium() {
  const tries = [
    () => require('playwright-core'),
    () => require(path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator',
      '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'))
  ];
  for (const f of tries) { try { return f(); } catch (_) {} }
  throw new Error('生成模式需要 playwright-core（仅构建期依赖）；可改用 --check 校验');
}

function chromePath() {
  const la = process.env.LOCALAPPDATA || '';
  const cands = [
    process.env.NAVIO_CHROME,
    path.join(la, 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe'),
    path.join(la, 'ms-playwright', 'chromium-1247', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  throw new Error('找不到 Chromium/Chrome，可设环境变量 NAVIO_CHROME 指定路径');
}

const MIME = {
  'image/png': 'image/png', 'image/x-icon': 'image/x-icon',
  'image/svg+xml': 'image/svg+xml', 'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp', 'image/gif': 'image/gif'
};

/** 在页面里执行：解码 → 裁透明边 → 等比居中 → 输出 PNG dataURL */
async function normalizeInPage(page, items) {
  return page.evaluate(async (arg) => {
    const SIZE = arg.SIZE, FILL = arg.FILL, TH = arg.TH;
    const out = [];
    for (const it of arg.items) {
      try {
        const img = new Image();
        img.decoding = 'sync';
        await new Promise((res, rej) => {
          img.onload = () => res(true);
          img.onerror = () => rej(new Error('decode-failed'));
          img.src = it.dataUrl;
        });
        const sw = img.naturalWidth || 256, sh = img.naturalHeight || 256;
        const src = document.createElement('canvas');
        src.width = sw; src.height = sh;
        const sc = src.getContext('2d', { willReadFrequently: true });
        sc.clearRect(0, 0, sw, sh);
        sc.drawImage(img, 0, 0, sw, sh);
        let d;
        try { d = sc.getImageData(0, 0, sw, sh).data; } catch (e) { throw new Error('tainted-canvas'); }

        // alpha 包围盒：只裁四周透明留白，不改形状/不改颜色/不加底板
        let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            if (d[(y * sw + x) * 4 + 3] > TH) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) { x0 = 0; y0 = 0; x1 = sw - 1; y1 = sh - 1; }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        const BOX = Math.round(SIZE * FILL);
        const scale = Math.min(BOX / bw, BOX / bh);
        const dw = Math.max(1, Math.round(bw * scale));
        const dh = Math.max(1, Math.round(bh * scale));

        const dst = document.createElement('canvas');
        dst.width = SIZE; dst.height = SIZE;
        const dc = dst.getContext('2d');
        dc.imageSmoothingEnabled = true;
        dc.imageSmoothingQuality = 'high';
        dc.drawImage(src, x0, y0, bw, bh,
          Math.round((SIZE - dw) / 2), Math.round((SIZE - dh) / 2), dw, dh);

        out.push({
          stem: it.stem, host: it.host, ok: true,
          png: dst.toDataURL('image/png'),
          source: [sw, sh], bbox: [x0, y0, bw, bh], scale: +scale.toFixed(4)
        });
      } catch (e) {
        out.push({ stem: it.stem, host: it.host, ok: false, reason: String(e.message || e) });
      }
    }
    return out;
  }, { items, SIZE, FILL, TH: ALPHA_TH });
}

(async () => {
  const { chromium } = loadChromium();
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const hosts = Object.keys(map);
  fs.mkdirSync(STD, { recursive: true });

  const jobs = [];
  for (const h of hosts) {
    const v = map[h];
    const base = path.basename(String(v.file));
    const stem = base.replace(/\.[^.]+$/, '');
    const raw = path.join(DIR, base);
    if (!fs.existsSync(raw)) { jobs.push({ host: h, stem, skip: 'raw-missing' }); continue; }
    const buf = fs.readFileSync(raw);
    const mime = MIME[v.type] || 'image/png';
    jobs.push({ host: h, stem, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') });
  }

  const tmp = 'C:/AI使用/navio-tmp';
  const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    env,
    args: ['--no-sandbox', '--disable-gpu', '--in-process-gpu', '--disable-dev-shm-usage',
      '--disable-crash-reporter', '--no-crash-upload', '--disk-cache-dir=C:/AI使用/navio-tmp/pwcache-norm']
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.goto('about:blank');

  const results = [];
  const BATCH = 8;
  const todo = jobs.filter((j) => !j.skip);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const rs = await normalizeInPage(page, batch);
    for (const r of rs) {
      if (r.ok) {
        const buf = Buffer.from(r.png.slice(r.png.indexOf(',') + 1), 'base64');
        fs.writeFileSync(path.join(STD, r.stem + '.png'), buf);
        results.push({ host: r.host, stem: r.stem, ok: true, source: r.source,
          bbox: r.bbox, scale: r.scale, bytes: buf.length });
      } else {
        results.push({ host: r.host, stem: r.stem, ok: false, reason: r.reason });
      }
    }
    process.stdout.write('  normalized ' + Math.min(i + BATCH, todo.length) + '/' + todo.length + '\r');
  }
  jobs.filter((j) => j.skip).forEach((j) =>
    results.push({ host: j.host, stem: j.stem, ok: false, reason: j.skip }));

  try { await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]); } catch (_) {}

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const kinds = {};
  ok.forEach((r) => { const k = r.source.join('x'); kinds[k] = (kinds[k] || 0) + 1; });
  const report = {
    tag: TAG, size: SIZE, fill: FILL, alphaThreshold: ALPHA_TH,
    hosts: hosts.length, ok: ok.length, fail: bad.length,
    sourceKinds: Object.keys(kinds).length,
    totalBytes: ok.reduce((a, r) => a + r.bytes, 0),
    failures: bad,
    items: results
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('\n=== SUMMARY ===');
  console.log('tag=' + TAG + '  hosts=' + hosts.length + '  ok=' + ok.length +
    '  fail=' + bad.length + '  sourceKinds=' + Object.keys(kinds).length +
    '  totalBytes=' + report.totalBytes);
  if (bad.length) console.log('FAILURES=' + JSON.stringify(bad.slice(0, 12)));
  // 生成后立刻做一次完整性自检
  try { check(); } catch (_) { process.exit(bad.length ? 1 : 0); }
  setTimeout(() => process.exit(bad.length ? 1 : 0), 100);
})().catch((e) => { console.error('FATAL ' + e.stack); process.exit(1); });
