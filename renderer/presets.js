'use strict';
/**
 * 推荐书签目录（内置、离线可用）
 * - 阶段 11：用户删减后的全部预设站点归入唯一「常用」分类，分类自带系统预设图标。
 *   预设站点以用户删改后的快照为准（51 个），不再多分类平铺。
 * - 各站点图标由 tools/fetch-site-icons.js 抓取官网真实 favicon，随包内置。
 * - 服务端 src/spaces.js 读本目录做 host→分组投影；所有公共站点都投影到「常用」。
 * - 图标包 renderer/site-icons/ 仍保留全部归一化图标，随时可加回站点。
 */
(function () {
  // G(id, name, glyph, color, items) —— iconKey 指定系统预设分类图标
  const groups = [
    {
      id: 'p_common', name: '常用', glyph: '★', color: '#4f8cff', iconKey: 'star',
      items: [
      ["GitHub", "https://github.com", ""],
      ["ChatGPT", "https://chatgpt.com", "OpenAI"],
      ["Gitee", "https://gitee.com", "码云"],
      ["小红书", "https://www.xiaohongshu.com", "分享"],
      ["抖音", "https://www.douyin.com", "短视频"],
      ["腾讯文档", "https://docs.qq.com", "协作文档"],
      ["哔哩哔哩", "https://www.bilibili.com", ""],
      ["淘宝", "https://www.taobao.com", ""],
      ["拼多多", "https://www.pinduoduo.com", "购物"],
      ["知乎", "https://www.zhihu.com", ""],
      ["京东", "https://www.jd.com", ""],
      ["Gemini", "https://gemini.google.com", "Google"],
      ["爱奇艺", "https://www.iqiyi.com", "影视"],
      ["微博", "https://weibo.com", ""],
      ["腾讯视频", "https://v.qq.com", "影视"],
      ["YouTube", "https://www.youtube.com", ""],
      ["网易云音乐", "https://music.163.com", "音乐"],
      ["Google Cloud", "https://cloud.google.com", "云服务"],
      ["必应", "https://www.bing.com", "搜索"],
      ["支付宝", "https://www.alipay.com", "支付"],
      ["Google", "https://www.google.com", "搜索"],
      ["Gmail", "https://mail.google.com", "邮箱"],
      ["QQ邮箱", "https://mail.qq.com", "邮件"],
      ["百度网盘", "https://pan.baidu.com", "文件"],
      ["Claude", "https://claude.ai", "Anthropic"],
      ["DeepSeek", "https://chat.deepseek.com", ""],
      ["Midjourney", "https://www.midjourney.com", "图像生成"],
      ["OpenAI", "https://openai.com", "官方文档"],
      ["Docker", "https://www.docker.com", "容器"],
      ["Telegram", "https://telegram.org", "即时通讯"],
      ["Netflix", "https://www.netflix.com", "影视"],
      ["优酷", "https://www.youku.com", "影视"],
      ["QQ音乐", "https://y.qq.com", "音乐"],
      ["Steam", "https://store.steampowered.com", "游戏"],
      ["Twitch", "https://www.twitch.tv", "直播"],
      ["12306", "https://www.12306.cn", "火车票"],
      ["Amazon", "https://www.amazon.com", "海淘"],
      ["飞书", "https://www.feishu.cn", "协作"],
      ["金山文档", "https://www.kdocs.cn", ""],
      ["Notion", "https://www.notion.so", "笔记"],
      ["Outlook", "https://outlook.com", "邮箱"],
      ["腾讯会议", "https://meeting.tencent.com", "会议"],
      ["Coursera", "https://www.coursera.org", "在线课程"],
      ["起点中文网", "https://www.qidian.com", "小说"],
      ["番茄小说", "https://fanqienovel.com", "小说"],
      ["阿里云", "https://www.aliyun.com", "云服务"],
      ["腾讯云", "https://cloud.tencent.com", "云服务"],
      ["华为云", "https://www.huaweicloud.com", "云服务"],
      ["AWS", "https://aws.amazon.com", "云服务"],
      ["Azure", "https://portal.azure.com", "云服务"],
      ["Cloudflare", "https://dash.cloudflare.com", "CDN"],
      ]
    }
  ];

  /**
   * 阶段 12：系统预设「书签图标背景色」色板（前端渲染用）。
   * 服务端 src/preset-colors.js 持有同一份定义用于白名单校验，
   * _test_icon_bg.js 会逐项断言两份完全一致，防止漂移。
   * hex 为 '' 代表「无背景」（沿用纯透明图标容器，默认视觉零变化）。
   */
  const bgColors = [
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

  window.NAVIO_PRESETS = { version: 5, groups, bgColors };
})();
