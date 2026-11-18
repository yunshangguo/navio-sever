'use strict';
/**
 * 天气代理（服务端）
 * 前端 CSP 是 connect-src 'self'，浏览器不能直接请求外部天气 API，
 * 所以由 Node 主进程代查 Open-Meteo（免费、无需 API Key），前端只调 /api/weather。
 * 任何网络失败都返回 { ok:false, error }，绝不抛异常打断服务。
 *
 * v2 扩展：新增体感温度、湿度、天气码、昼夜标记与未来 5 天预报。
 * 所有新增字段都是可选降级——老前端只认 city/temp/desc/wind 不受影响；
 * 拿不到 daily 时 forecast 返回空数组，前端重点显示当前天气。
 */
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8000;

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

/** 把 WMO code 归一到前端图标类型：sun / cloud / rain / snow / fog / storm */
function iconType(code) {
  const c = Number(code);
  if (c === 0 || c === 1) return 'sun';
  if (c === 2 || c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 67) return 'rain';
  if (c >= 71 && c <= 77) return 'snow';
  if (c >= 80 && c <= 82) return 'rain';
  if (c >= 85 && c <= 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'cloud';
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { data: await r.json() };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** @returns {Promise<{ok:boolean, city?:string, temp?:number, desc?:string, wind?:number, updatedAt?:string, apparent?:number, humidity?:number, code?:number, icon?:string, isDay?:boolean, country?:string, forecast?:Array, error?:string}>} */
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
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=6'
  );
  if (f.error) return { ok: false, error: '天气获取失败：' + f.error };
  const data = (f.data && f.data.current) || {};
  const daily = (f.data && f.data.daily) || {};
  const code = numOrNull(data.weather_code);

  // 未来 5 天预报（index 0 是今天，前端可自行决定从哪天开始展示）
  const forecast = [];
  if (Array.isArray(daily.time)) {
    for (let i = 0; i < Math.min(5, daily.time.length); i++) {
      const dc = numOrNull(daily.weather_code && daily.weather_code[i]);
      forecast.push({
        date: String(daily.time[i] || '').slice(5), // MM-DD
        code: dc,
        desc: CODES[dc] || '未知',
        icon: iconType(dc),
        tmax: numOrNull(daily.temperature_2m_max && daily.temperature_2m_max[i]),
        tmin: numOrNull(daily.temperature_2m_min && daily.temperature_2m_min[i]),
        pop: numOrNull(daily.precipitation_probability_max && daily.precipitation_probability_max[i])
      });
    }
  }

  return {
    ok: true,
    city: p.name || name,
    country: p.country || p.country_code || '',
    temp: numOrNull(data.temperature_2m),
    apparent: numOrNull(data.apparent_temperature),
    humidity: numOrNull(data.relative_humidity_2m),
    code,
    icon: iconType(code),
    isDay: data.is_day == null ? true : Number(data.is_day) !== 0,
    desc: CODES[code] || '未知',
    wind: numOrNull(data.wind_speed_10m),
    updatedAt: new Date().toISOString(),
    forecast
  };
}

module.exports = { fetchWeather, weatherDesc: (c) => CODES[c] || '未知', iconType, CODES };
