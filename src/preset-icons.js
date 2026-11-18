'use strict';
/**
 * 内置图标库（离线可用，零外部依赖）
 * 用途：网页 favicon 抓取失败时，按域名/标题关键词匹配内置图标。
 * 图标均为自绘几何图形 / 品牌色字形，不使用第三方 logo 素材，避免版权问题。
 *
 * 降级链路：本地 favicon 缓存 → 在线抓取 → 本库 SVG → 前端渐变首字母
 */
const BRANDS = [
  // id, 名称, 品牌色, 字形, 域名(空格分隔), 关键词(空格分隔)
  ['github', 'GitHub', '#24292f', 'GH', 'github.com gist.github.com github.io', 'github git gist'],
  ['gitee', 'Gitee', '#c71d23', 'G', 'gitee.com', 'gitee 码云'],
  ['gitlab', 'GitLab', '#fc6d26', 'GL', 'gitlab.com', 'gitlab'],
  ['stackoverflow', 'Stack Overflow', '#f48024', 'SO', 'stackoverflow.com', 'stack overflow'],
  ['npm', 'npm', '#cb3837', 'N', 'npmjs.com', 'npm node package'],
  ['docker', 'Docker', '#2496ed', 'D', 'docker.com hub.docker.com', 'docker container 容器'],
  ['kubernetes', 'Kubernetes', '#326ce5', 'K8', 'kubernetes.io k8s.io', 'kubernetes k8s'],
  ['nodejs', 'Node.js', '#339933', 'JS', 'nodejs.org', 'node nodejs'],
  ['vue', 'Vue', '#42b883', 'V', 'vuejs.org', 'vue'],
  ['react', 'React', '#61dafb', 'R', 'react.dev reactjs.org', 'react'],
  ['python', 'Python', '#3776ab', 'Py', 'python.org pypi.org', 'python pip'],
  ['rust', 'Rust', '#ce422b', 'Rs', 'rust-lang.org', 'rust cargo'],
  ['golang', 'Go', '#00add8', 'Go', 'go.dev golang.org', 'golang'],
  ['linux', 'Linux', '#f5b301', 'Ln', 'kernel.org linux.org', 'linux ubuntu debian'],
  ['ubuntu', 'Ubuntu', '#e95420', 'U', 'ubuntu.com', 'ubuntu'],
  ['jetbrains', 'JetBrains', '#000000', 'JB', 'jetbrains.com', 'jetbrains idea pycharm webstorm'],
  ['vscode', 'VS Code', '#007acc', 'VS', 'code.visualstudio.com', 'vscode visual studio code'],
  ['figma', 'Figma', '#f24e1e', 'F', 'figma.com', 'figma 设计'],
  ['notion', 'Notion', '#191919', 'N', 'notion.so notion.site', 'notion 笔记'],
  ['obsidian', 'Obsidian', '#7c3aed', 'O', 'obsidian.md', 'obsidian'],
  ['vercel', 'Vercel', '#000000', 'V', 'vercel.com', 'vercel'],
  ['netlify', 'Netlify', '#00c7b7', 'Nt', 'netlify.com', 'netlify'],
  ['cloudflare', 'Cloudflare', '#f38020', 'CF', 'cloudflare.com dash.cloudflare.com', 'cloudflare cdn'],
  ['aws', 'AWS', '#ff9900', 'AWS', 'aws.amazon.com', 'aws amazon cloud'],
  ['azure', 'Azure', '#0078d4', 'AZ', 'azure.microsoft.com portal.azure.com', 'azure'],
  ['googlecloud', 'Google Cloud', '#4285f4', 'GC', 'cloud.google.com', 'gcp google cloud'],
  ['aliyun', '阿里云', '#ff6a00', '阿', 'aliyun.com', '阿里云 aliyun'],
  ['tencentcloud', '腾讯云', '#006eff', '腾', 'cloud.tencent.com', '腾讯云'],
  ['huaweicloud', '华为云', '#c7000b', '华', 'huaweicloud.com', '华为云'],
  ['baidu', '百度', '#2932e1', '百', 'baidu.com', '百度 baidu 搜索'],
  ['bing', 'Bing', '#008373', 'B', 'bing.com', 'bing 必应'],
  ['google', 'Google', '#4285f4', 'G', 'google.com google.com.hk', 'google 谷歌'],
  ['duckduckgo', 'DuckDuckGo', '#de5833', 'DD', 'duckduckgo.com', 'duckduckgo 隐私搜索'],
  ['youtube', 'YouTube', '#ff0000', '▶', 'youtube.com youtu.be', 'youtube 油管'],
  ['bilibili', '哔哩哔哩', '#00a1d6', 'B', 'bilibili.com b23.tv', 'bilibili b站 哔哩'],
  ['douyin', '抖音', '#161823', '抖', 'douyin.com', '抖音 tiktok'],
  ['tiktok', 'TikTok', '#010101', 'T', 'tiktok.com', 'tiktok'],
  ['kuaishou', '快手', '#ff4906', '快', 'kuaishou.com', '快手'],
  ['weibo', '微博', '#e6162d', '微', 'weibo.com', '微博 weibo'],
  ['zhihu', '知乎', '#0084ff', '知', 'zhihu.com', '知乎 zhihu'],
  ['douban', '豆瓣', '#2e963d', '豆', 'douban.com', '豆瓣 douban'],
  ['xiaohongshu', '小红书', '#ff2442', '红', 'xiaohongshu.com xhslink.com', '小红书 红书'],
  ['wechat', '微信', '#07c160', '微', 'weixin.qq.com wechat.com', '微信 wechat'],
  ['qq', 'QQ', '#12b7f5', 'Q', 'qq.com', 'qq 腾讯'],
  ['taobao', '淘宝', '#ff5000', '淘', 'taobao.com', '淘宝 taobao'],
  ['tmall', '天猫', '#e4002b', '猫', 'tmall.com', '天猫'],
  ['jd', '京东', '#e1251b', '京', 'jd.com', '京东 jd'],
  ['pdd', '拼多多', '#e22e1f', '拼', 'pinduoduo.com yangkeduo.com', '拼多多'],
  ['amazon', 'Amazon', '#ff9900', 'a', 'amazon.com amazon.cn', '亚马逊 amazon'],
  ['ebay', 'eBay', '#e53238', 'e', 'ebay.com', 'ebay'],
  ['meituan', '美团', '#ffc300', '美', 'meituan.com', '美团'],
  ['eleme', '饿了么', '#0085ff', '饿', 'ele.me', '饿了么'],
  ['ctrip', '携程', '#2577e3', '携', 'ctrip.com', '携程 旅行'],
  ['12306', '12306', '#0f4c9c', '票', '12306.cn', '12306 火车票'],
  ['netease_music', '网易云音乐', '#c20c0c', '♪', 'music.163.com', '网易云 音乐'],
  ['qqmusic', 'QQ音乐', '#31c27c', '♫', 'y.qq.com', 'qq音乐'],
  ['spotify', 'Spotify', '#1db954', '♫', 'spotify.com', 'spotify'],
  ['applemusic', 'Apple Music', '#fa243c', '♫', 'music.apple.com', 'apple music'],
  ['iqiyi', '爱奇艺', '#00be06', '爱', 'iqiyi.com', '爱奇艺'],
  ['youku', '优酷', '#1e7cf2', '优', 'youku.com', '优酷'],
  ['tencentvideo', '腾讯视频', '#ff5c38', '腾', 'v.qq.com', '腾讯视频'],
  ['netflix', 'Netflix', '#e50914', 'N', 'netflix.com', 'netflix'],
  ['twitch', 'Twitch', '#9146ff', 'T', 'twitch.tv', 'twitch 直播'],
  ['steam', 'Steam', '#1b2838', 'S', 'store.steampowered.com steamcommunity.com', 'steam 游戏'],
  ['epic', 'Epic Games', '#2f2f2f', 'E', 'epicgames.com', 'epic'],
  ['nintendo', 'Nintendo', '#e60012', 'N', 'nintendo.com', '任天堂 switch'],
  ['playstation', 'PlayStation', '#0070d1', 'PS', 'playstation.com', 'ps5 playstation'],
  ['xbox', 'Xbox', '#107c10', 'X', 'xbox.com', 'xbox'],
  ['twitter', 'X / Twitter', '#111111', 'X', 'twitter.com x.com', 'twitter 推特'],
  ['facebook', 'Facebook', '#1877f2', 'f', 'facebook.com', 'facebook'],
  ['instagram', 'Instagram', '#e4405f', 'IG', 'instagram.com', 'instagram ins'],
  ['reddit', 'Reddit', '#ff4500', 'R', 'reddit.com', 'reddit'],
  ['telegram', 'Telegram', '#2aabee', 'T', 't.me telegram.org', 'telegram'],
  ['discord', 'Discord', '#5865f2', 'D', 'discord.com discord.gg', 'discord'],
  ['slack', 'Slack', '#4a154b', 'S', 'slack.com', 'slack'],
  ['linkedin', 'LinkedIn', '#0a66c2', 'in', 'linkedin.com', 'linkedin 领英'],
  ['wikipedia', 'Wikipedia', '#636466', 'W', 'wikipedia.org', 'wikipedia 维基'],
  ['medium', 'Medium', '#000000', 'M', 'medium.com', 'medium'],
  ['juejin', '掘金', '#1e80ff', '掘', 'juejin.cn', '掘金'],
  ['csdn', 'CSDN', '#fc5531', 'C', 'csdn.net', 'csdn'],
  ['segmentfault', 'SegmentFault', '#009a61', 'SF', 'segmentfault.com', 'segmentfault 思否'],
  ['v2ex', 'V2EX', '#001d25', 'V', 'v2ex.com', 'v2ex'],
  ['oschina', '开源中国', '#24a53b', '开', 'oschina.net', '开源中国'],
  ['yuque', '语雀', '#1abc9c', '语', 'yuque.com', '语雀'],
  ['feishu', '飞书', '#3370ff', '飞', 'feishu.cn', '飞书 lark'],
  ['dingtalk', '钉钉', '#0089ff', '钉', 'dingtalk.com', '钉钉'],
  ['wps', 'WPS', '#d81e06', 'W', 'wps.cn kdocs.cn', 'wps 金山'],
  ['docs_qq', '腾讯文档', '#0052d9', '文', 'docs.qq.com', '腾讯文档'],
  ['石墨', '石墨文档', '#2d3033', '石', 'shimo.im', '石墨文档'],
  ['dropbox', 'Dropbox', '#0061ff', 'D', 'dropbox.com', 'dropbox'],
  ['onedrive', 'OneDrive', '#0364b8', 'O', 'onedrive.live.com', 'onedrive'],
  ['gdrive', 'Google Drive', '#0f9d58', '▲', 'drive.google.com', 'google drive'],
  ['baidupan', '百度网盘', '#06a7ff', '盘', 'pan.baidu.com', '百度网盘 网盘'],
  ['lanzou', '蓝奏云', '#3b8cff', '蓝', 'lanzou.com lanzoux.com', '蓝奏云'],
  ['gmail', 'Gmail', '#ea4335', 'M', 'mail.google.com', 'gmail'],
  ['outlook', 'Outlook', '#0078d4', 'O', 'outlook.com outlook.office.com', 'outlook 邮箱'],
  ['qqmail', 'QQ邮箱', '#12b7f5', 'Q', 'mail.qq.com', 'qq邮箱'],
  ['163mail', '网易邮箱', '#d81e06', '网', 'mail.163.com', '网易邮箱 163'],
  ['openai', 'ChatGPT', '#10a37f', 'AI', 'chat.openai.com chatgpt.com openai.com', 'chatgpt openai gpt'],
  ['claude', 'Claude', '#d97757', 'C', 'claude.ai anthropic.com', 'claude anthropic'],
  ['gemini', 'Gemini', '#4285f4', 'G', 'gemini.google.com', 'gemini bard'],
  ['huggingface', 'Hugging Face', '#ffcc03', 'HF', 'huggingface.co', 'huggingface 模型'],
  ['midjourney', 'Midjourney', '#121212', 'MJ', 'midjourney.com', 'midjourney'],
  ['deepseek', 'DeepSeek', '#4d6bfe', 'DS', 'deepseek.com chat.deepseek.com', 'deepseek'],
  ['cursor', 'Cursor', '#000000', 'Cu', 'cursor.com cursor.sh', 'cursor 编辑器'],
  ['jenkins', 'Jenkins', '#d33833', 'J', 'jenkins.io', 'jenkins ci'],
  ['grafana', 'Grafana', '#f46800', 'Gr', 'grafana.com', 'grafana 监控'],
  ['jira', 'Jira', '#0052cc', 'J', 'atlassian.com', 'jira atlassian'],
  ['confluence', 'Confluence', '#0052cc', 'Cf', 'atlassian.com', 'confluence'],
  ['trello', 'Trello', '#0079bf', 'T', 'trello.com', 'trello 看板'],
  ['mdn', 'MDN', '#000000', 'MD', 'developer.mozilla.org', 'mdn 文档'],
  ['w3school', 'W3School', '#28a745', 'W3', 'w3school.com.cn runoob.com', 'w3school 菜鸟教程'],
  ['cnki', '中国知网', '#1b5fa8', '知', 'cnki.net', '知网 论文'],
  ['coursera', 'Coursera', '#0056d2', 'C', 'coursera.org', 'coursera 课程'],
  ['udemy', 'Udemy', '#a435f0', 'U', 'udemy.com', 'udemy 课程'],
  ['qidian', '起点中文网', '#c4252a', '起', 'qidian.com', '起点 小说'],
  ['fanqie', '番茄小说', '#ff5c38', '番', 'fanqienovel.com', '番茄小说'],
  ['nga', 'NGA', '#4a7ab5', 'N', 'nga.cn bbs.nga.cn', 'nga 论坛'],
  ['hupu', '虎扑', '#c8102e', '虎', 'hupu.com', '虎扑'],
  ['toutiao', '今日头条', '#f04142', '头', 'toutiao.com', '今日头条 新闻'],
  ['thepaper', '澎湃新闻', '#c8271e', '澎', 'thepaper.cn', '澎湃 新闻'],
  ['zhihu_column', '知乎专栏', '#0084ff', '专', 'zhuanlan.zhihu.com', '专栏'],
  ['alipay', '支付宝', '#1677ff', '支', 'alipay.com', '支付宝'],
  ['apple', 'Apple', '#555555', 'A', 'apple.com apple.com.cn', '苹果 apple'],
  ['microsoft', 'Microsoft', '#0078d4', 'MS', 'microsoft.com', '微软 microsoft'],
  ['xiaomi', '小米', '#ff6900', '米', 'mi.com xiaomi.com', '小米'],
  ['huawei', '华为', '#c7000b', '华', 'huawei.com', '华为'],
  ['jdcloud', '京东云', '#e1251b', '云', 'jdcloud.com', '京东云'],
  ['zoom', 'Zoom', '#2d8cff', 'Z', 'zoom.us', 'zoom 会议'],
  ['tencentmeeting', '腾讯会议', '#006eff', '会', 'meeting.tencent.com', '腾讯会议'],
  ['imdb', 'IMDb', '#f5c518', 'I', 'imdb.com', 'imdb 电影'],
  ['pinterest', 'Pinterest', '#e60023', 'P', 'pinterest.com', 'pinterest'],
  ['quora', 'Quora', '#b92b27', 'Q', 'quora.com', 'quora']
];

/** 分类图标：品牌没命中时按用途关键词给一个自绘 SVG 图标 */
const CATEGORIES = [
  // id, 名称, 颜色, 关键词, 24x24 path
  ['code', '开发', '#4f8cff', 'api dev 开发 代码 编程 sdk console dashboard git code', 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
  ['cloud', '云服务', '#06b6d4', 'cloud 云 服务器 server host 主机 nas 存储', 'M6 18h11a4 4 0 0 0 .6-7.95A6 6 0 0 0 6 11a3.5 3.5 0 0 0 0 7z'],
  ['ai', 'AI', '#8b5cf6', 'ai llm 模型 model 智能 chat bot agent 机器学习', 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z'],
  ['docs', '文档', '#10b981', 'doc 文档 wiki 手册 说明 manual guide 笔记', 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6'],
  ['shop', '购物', '#f59e0b', 'shop 商城 购物 购物网 mall 订单 buy 电商', 'M4 8h16l-1 12H5zM8 8V6a4 4 0 0 1 8 0v2'],
  ['video', '影视', '#ef4444', 'video 视频 电影 影视 movie 直播 live 播放', 'M4 5h16v14H4zM10 9l5 3-5 3z'],
  ['music', '音乐', '#ec4899', 'music 音乐 audio 音频 song 听歌', 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z'],
  ['social', '社交', '#6366f1', 'social 社区 论坛 社交 群 聊天 bbs forum', 'M16 19a4 4 0 0 0-8 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 19a4 4 0 0 1 4-4M20 19a4 4 0 0 0-4-4'],
  ['news', '资讯', '#f97316', 'news 新闻 资讯 报纸 头条 media rss blog 博客', 'M4 5h16v14H4zM7 9h5v6H7zM14 9h3M14 12h3M14 15h3'],
  ['finance', '金融', '#14b8a6', 'bank 银行 金融 支付 股票 基金 财务 pay 钱包', 'M3 9l9-5 9 5M5 10v8M19 10v8M9 10v8M15 10v8M3 19h18'],
  ['edu', '教育', '#0ea5e9', 'edu 教育 学习 课程 学校 大学 course learn 考试', 'M12 4L2 9l10 5 10-5zM6 11v5c0 2 3 4 6 4s6-2 6-4v-5'],
  ['game', '游戏', '#a855f7', 'game 游戏 手柄 电竞 steam 攻略', 'M7 8h10a4 4 0 0 1 4 4l-1 5a3 3 0 0 1-5 1l-3-3-3 3a3 3 0 0 1-5-1L3 12a4 4 0 0 1 4-4zM7 12h3M8.5 10.5v3M16 12h.01M18 14h.01'],
  ['mail', '邮箱', '#3b82f6', 'mail 邮箱 邮件 email 收件', 'M3 6h18v12H3zM3 7l9 6 9-6'],
  ['drive', '网盘', '#22c55e', 'drive 网盘 云盘 文件 上传 备份 storage 存储', 'M4 7h6l2 2h8v10H4zM4 7V5h6l2 2'],
  ['tool', '工具', '#64748b', 'tool 工具 实用 在线 转换 生成 查询 utility json 正则', 'M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.5-2.5z'],
  ['design', '设计', '#f43f5e', 'design 设计 画图 ui 素材 配色 图标 icon', 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z'],
  ['search', '搜索', '#0ea5e9', 'search 搜索 查询 引擎 检索', 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5'],
  ['link', '网址', '#6b7280', 'link 网址 链接 首页 website 站点', 'M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.7 18.2l1.2-1.2'],
  ['star', '常用', '#4f8cff', 'star 常用 星标 收藏  favorite home 首页', 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z']
];

function shade(hex, amount) {
  try {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (n & 255) + amount));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return hex;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 生成单个图标 SVG（圆角渐变底 + 字形或分类符号） */
function renderSvg(item) {
  if (!item) return '';
  const c = item.color;
  const c2 = shade(c, 34);
  const fontSize = item.glyph.length >= 3 ? 20 : item.glyph.length === 2 ? 26 : 32;
  const inner = item.path
    ? `<g transform="translate(14 14) scale(1.5)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${esc(item.path)}"/></g>`
    : `<text x="32" y="32" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif" font-size="${fontSize}" font-weight="700">${esc(item.glyph)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>` +
    `<rect x="2" y="2" width="60" height="60" rx="17" fill="url(#g)"/>` +
    `<rect x="2" y="2" width="60" height="60" rx="17" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>` +
    inner +
    `</svg>`
  );
}

function dataUri(item) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderSvg(item));
}

function cleanHost(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .trim();
}

/** 主匹配：域名 > 关键词 > 分类 > null */
function match(rawUrl, title) {
  const host = cleanHost(rawUrl);
  const hay = (String(rawUrl || '') + ' ' + String(title || '')).toLowerCase();
  const base = host.replace(/^[^.]+\./, '') === host ? host : host.split('.').slice(-2).join('.');

  // 1. 域名精确/后缀
  for (const b of BRANDS) {
    const hosts = b[4].split(/\s+/);
    if (!host) continue;
    for (const h of hosts) {
      if (!h) continue;
      if (host === h || host.endsWith('.' + h) || base === h) {
        return { kind: 'brand', id: b[0], name: b[1], color: b[2], glyph: b[3] };
      }
    }
  }
  // 2. 关键词（标题/URL 中包含品牌名）
  for (const b of BRANDS) {
    const kws = b[5].split(/\s+/);
    for (const k of kws) {
      if (k && k.length >= 2 && hay.includes(k)) {
        return { kind: 'brand', id: b[0], name: b[1], color: b[2], glyph: b[3] };
      }
    }
  }
  // 3. 分类
  for (const c of CATEGORIES) {
    const kws = c[3].split(/\s+/);
    for (const k of kws) {
      if (k && k.length >= 2 && hay.includes(k)) {
        return { kind: 'category', id: c[0], name: c[1], color: c[2], glyph: '', path: c[4] };
      }
    }
  }
  return null;
}

/** 图标库列表（供 Web 端「选择内置图标」弹窗） */
function list() {
  const out = [];
  for (const b of BRANDS) {
    const item = { kind: 'brand', id: b[0], name: b[1], color: b[2], glyph: b[3], hosts: b[4] };
    out.push({ ...item, svg: dataUri(item) });
  }
  for (const c of CATEGORIES) {
    const item = { kind: 'category', id: c[0], name: c[1], color: c[2], glyph: '', path: c[4] };
    out.push({ ...item, svg: dataUri(item) });
  }
  return out;
}

module.exports = { match, renderSvg, dataUri, list, cleanHost, BRANDS, CATEGORIES };
