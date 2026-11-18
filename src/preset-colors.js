'use strict';
/**
 * 系统预设「书签图标背景色」色板（阶段 12）
 *
 * 设计约定：
 *  - 这是唯一真源：服务端校验、前端色板渲染、归一化测试都从这里取，
 *    避免前后端各写一份导致漂移。
 *  - 色值一律是 6 位小写 hex（#rrggbb）。存进 bookmark.bgColor 的也是这个字符串，
 *    前端可直接放进 CSS，不接受任意 CSS 表达式 → 天然免疫样式注入。
 *  - 空串 '' 表示「无背景」，即沿用阶段 7 的纯透明图标容器（视觉零变化）。
 *  - 只做浅色/深色都协调的中低饱和色，图标是真实 favicon（自带透明边），
 *    背景用一个柔和的半透明叠加，不遮挡 logo。
 */
const CARD_BG_COLORS = [
  { key: 'none',   name: '无背景', hex: '' },
  { key: 'blue',   name: '晴蓝',   hex: '#4f8cff' },
  { key: 'indigo', name: '靛蓝',   hex: '#6366f1' },
  { key: 'purple', name: '紫罗兰', hex: '#8b5cf6' },
  { key: 'pink',   name: '玫粉',   hex: '#ec4899' },
  { key: 'red',    name: '珊瑚红', hex: '#ef4444' },
  { key: 'orange', name: '暖橙',   hex: '#f59e0b' },
  { key: 'lime',   name: '青柠',   hex: '#84cc16' },
  { key: 'green',  name: '翠绿',   hex: '#10b981' },
  { key: 'teal',   name: '蓝绿',   hex: '#14b8a6' },
  { key: 'cyan',   name: '天青',   hex: '#06b6d4' },
  { key: 'slate',  name: '石板灰', hex: '#64748b' }
];

const HEX_SET = new Set(CARD_BG_COLORS.map((c) => c.hex).filter(Boolean));

/** 是否为一个受信任的预设色值（空串不算「有色」，由前端单独判断） */
function isCardBgColor(v) {
  return typeof v === 'string' && HEX_SET.has(v);
}

/**
 * 归一化背景色：合法预设 → 原值；其它一律 → ''（不落字段 / 表示无背景）。
 * 只接受精确匹配，杜绝 'url(...)' / 'red;position:fixed' 之类的注入。
 */
function normalizeCardBgColor(v) {
  return isCardBgColor(v) ? String(v) : '';
}

/** 供前端 /api 或注入层使用的只读列表 */
function list() {
  return CARD_BG_COLORS.map((c) => ({ ...c }));
}

module.exports = { CARD_BG_COLORS, HEX_SET, isCardBgColor, normalizeCardBgColor, list };
