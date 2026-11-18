'use strict';
/**
 * 天气代理（服务端）
 * 前端 CSP 是 connect-src 'self'，浏览器不能直接请求外部天气 API，
 * 所以由 Node 主进程代查 Open-Meteo（免费、无需 API Key），前端只调 /api/weather。
 * 任何网络失败都返回 { ok:false, error }，绝不抛异常打断服务。
 */
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 6000;

// WMO weather interpretation codes（常用值）
const CODES = {
  0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴伴冰雹'
};

async function getJSON(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { data: await r.json() };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

/** @returns {Promise<{ok:boolean, city?:string, temp?:number, desc?:string, wind?:number, updatedAt?:string, error?:string}>} */
async function fetchWeather(city) {
  const name = String(city || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: '缺少城市名' };

  const g = await getJSON(GEO_URL + '?name=' + encodeURIComponent(name) + '&count=1&language=zh&format=json');
  if (g.error) return { ok: false, error: '城市查询失败：' + g.error };
  if (!g.data || !Array.isArray(g.data.results) || !g.data.results.length) {
    return { ok: false, error: '找不到城市：' + name };
  }
  const p = g.data.results[0];
  const f = await getJSON(
    FORECAST_URL +
      '?latitude=' + encodeURIComponent(p.latitude) +
      '&longitude=' + encodeURIComponent(p.longitude) +
      '&current=temperature_2m,weather_code,wind_speed_10m' +
      '&timezone=auto'
  );
  if (f.error) return { ok: false, error: '天气获取失败：' + f.error };
  const cur = (f.data && f.data.current) || {};
  return {
    ok: true,
    city: p.name || name,
    country: p.country || p.country_code || '',
    temp: typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null,
    desc: CODES[cur.weather_code] || '未知',
    wind: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
    updatedAt: new Date().toISOString()
  };
}

module.exports = { fetchWeather, weatherDesc: (c) => CODES[c] || '未知', CODES };
