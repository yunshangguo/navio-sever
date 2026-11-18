'use strict';
/* Navio Server 服务端控制台：所有管理操作只走本地 IPC，不暴露到 HTTP 端口 */
(function () {
  const API = window.navioAdmin;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pane = $('#pane');

  let TAB = 'overview';
  let STATUS = null;
  let CONFIG = null;
  let CACHE = {};

  function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    $('#toastHost').appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }
  function fmtUptime(s) {
    s = Number(s) || 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h} 小时 ${m} 分` : `${m} 分 ${s % 60} 秒`;
  }

  function modal(title, bodyHTML, okLabel, onOk) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="mask"><div class="modal"><h3>${esc(title)}</h3><div class="mbody">${bodyHTML}</div>
      <div class="mfoot"><button class="btn" data-no>取消</button><button class="btn pri" data-yes>${esc(okLabel || '确定')}</button></div></div></div>`;
    const close = () => (root.innerHTML = '');
    $('[data-no]', root).onclick = close;
    $('.mask', root).onclick = (e) => { if (e.target.classList.contains('mask')) close(); };
    $('[data-yes]', root).onclick = async () => {
      const r = await onOk($('.mbody', root));
      if (r !== false) close();
    };
    return close;
  }

  function confirmBox(title, text, okLabel, onOk) {
    return modal(title, `<div class="hint" style="font-size:12px;line-height:1.7">${esc(text)}</div>`, okLabel, onOk);
  }

  /* ---------------- 概览 ---------------- */
  function renderOverview(s) {
    const urls = (s.urls || []).map((u) => `<div class="urlbox"><span>${esc(u)}</span><button data-copy="${esc(u)}">复制</button></div>`).join('');
    pane.innerHTML = `
      <h2>概览</h2>
      <p class="desc">服务运行在 Windows 宿主机上，浏览器/手机访问下面的地址即可使用书签导航。桌面端不再显示书签窗口。</p>
      <div class="card">
        <h3>服务状态 <span class="tag">${s.running ? '运行中' : '已停止'}</span></h3>
        <div class="grid">
          <div class="stat"><div class="k">状态</div><div class="v" style="color:${s.running ? 'var(--ok)' : 'var(--bad)'}">${s.running ? '在线' : '离线'}</div></div>
          <div class="stat"><div class="k">监听</div><div class="v" style="font-size:15px">${esc(s.host)}:${s.port}</div></div>
          <div class="stat"><div class="k">协议</div><div class="v">${esc((s.scheme || 'http').toUpperCase())}</div></div>
          <div class="stat"><div class="k">运行时间</div><div class="v" style="font-size:15px">${esc(fmtUptime(s.uptimeSec))}</div></div>
          <div class="stat"><div class="k">在线会话</div><div class="v">${s.onlineSessions || 0}<small>个</small></div></div>
          <div class="stat"><div class="k">累计请求</div><div class="v">${s.requests || 0}</div></div>
        </div>
        <div class="btnbar" style="margin-top:14px">
          <button class="btn pri" data-act="open-web">在浏览器中打开</button>
          <button class="btn" data-act="restart">重启服务</button>
          <button class="btn ${s.running ? 'warn' : ''}" data-act="toggle-service">${s.running ? '停止服务' : '启动服务'}</button>
        </div>
      </div>
      <div class="card">
        <h3>访问地址 <span class="tag">局域网 / 本机</span></h3>
        ${urls || '<div class="hint">服务未启动</div>'}
        <div class="hint" style="margin-top:10px">公网访问需要路由器端口转发或内网穿透；建议先在「访问安全」里确认已启用密码与登录锁定。Windows 防火墙若拦截，见「服务与端口」页的放行命令。</div>
      </div>
      <div class="card">
        <h3>数据文件</h3>
        <div class="row"><div class="lbl"><div class="t">${esc(s.dataDir || '')}</div><div class="d">data.json（书签/分组/设置/全量组件）· users.json（账号哈希）· sessions.json（会话）</div></div>
          <div class="acts"><button class="btn sm" data-act="open-dir">打开目录</button></div></div>
      </div>`;
  }

  /* ---------------- 服务与端口 ---------------- */
  function renderService(c, s) {
    pane.innerHTML = `
      <h2>服务与端口</h2>
      <p class="desc">修改端口 / 绑定地址后点击「保存并重启服务」。端口范围 1–65535，绑定 <code>0.0.0.0</code> 才能被局域网与公网访问。</p>
      <div class="card">
        <h3>监听设置</h3>
        <div class="fgrid">
          <div><label class="f">端口</label><input class="i" id="fPort" type="number" min="1" max="65535" value="${esc(c.port)}"></div>
          <div><label class="f">绑定地址</label><input class="i" id="fHost" value="${esc(c.host)}"></div>
          <div class="full"><label class="f">开机自动启动服务</label>
            <div class="row" style="border:0;padding:0"><div class="lbl"><div class="d">登录 Windows 后自动运行 Navio Server（写入当前用户启动项）</div></div>
            <div class="acts"><button class="btn sm ${c.autoLaunch ? 'pri' : ''}" data-act="autolaunch">${c.autoLaunch ? '已启用' : '未启用'}</button></div></div>
          </div>
        </div>
        <div class="btnbar">
          <button class="btn pri" data-act="save-service">保存并重启服务</button>
          <button class="btn" data-act="restart">仅重启</button>
        </div>
      </div>
      <div class="card">
        <h3>HTTPS（可选）</h3>
        <div class="fgrid">
          <div class="full"><div class="row" style="border:0;padding:0"><div class="lbl"><div class="t">启用 HTTPS</div><div class="d">公网访问建议开启；证书可用自签证书或反向代理</div></div>
            <div class="acts"><button class="btn sm ${c.https && c.https.enabled ? 'pri' : ''}" data-act="toggle-https">${c.https && c.https.enabled ? '已启用' : '未启用'}</button></div></div></div>
          <div><label class="f">证书文件 cert.pem 绝对路径</label><input class="i" id="fCert" value="${esc((c.https && c.https.cert) || '')}" placeholder="D:\\cert\\cert.pem"></div>
          <div><label class="f">私钥文件 key.pem 绝对路径</label><input class="i" id="fKey" value="${esc((c.https && c.https.key) || '')}" placeholder="D:\\cert\\key.pem"></div>
        </div>
        <div class="btnbar"><button class="btn" data-act="save-https">保存证书设置</button></div>
      </div>
      <div class="card">
        <h3>Windows 防火墙放行</h3>
        <div class="hint">若局域网其他设备访问不到，用管理员 PowerShell 执行（把端口换成你设置的端口）：</div>
        <pre class="log" style="margin-top:10px">New-NetFirewallRule -DisplayName "Navio Server ${esc(c.port)}" -Direction Inbound -LocalPort ${esc(c.port)} -Protocol TCP -Action Allow</pre>
        <div class="btnbar"><button class="btn sm" data-act="copy-fw">复制命令</button></div>
      </div>`;
  }

  /* ---------------- 访问安全 ---------------- */
  function renderSecurity(c) {
    const a = c.auth || {};
    pane.innerHTML = `
      <h2>访问安全</h2>
      <p class="desc">服务会暴露到网络，以下设置务必保持开启。密码用 scrypt 加盐哈希存储，明文只出现在首次生成的 <code>INITIAL_ADMIN.txt</code>。</p>
      ${c.https && c.https.enabled ? '<div class="okbox">已启用 HTTPS。公网访问仍建议配合强密码与 IP 白名单。</div>' : '<div class="warnbox">当前是明文 HTTP。若要从公网访问，密码和 Cookie 可能被窃听，建议启用 HTTPS 或用反向代理终结 TLS。</div>'}
      <div class="card">
        <h3>登录保护</h3>
        <div class="fgrid">
          <div><label class="f">需要登录才能访问</label><select class="i" id="fAuth"><option value="1" ${a.enabled ? 'selected' : ''}>开启（强烈建议）</option><option value="0" ${!a.enabled ? 'selected' : ''}>关闭（仅内网调试）</option></select></div>
          <div><label class="f">会话有效期（小时）</label><input class="i" id="fTtl" type="number" min="1" max="8760" value="${esc(a.sessionTtlHours || 168)}"></div>
          <div><label class="f">连续失败几次锁定</label><input class="i" id="fMaxFail" type="number" min="2" max="50" value="${esc(a.maxFail || 5)}"></div>
          <div><label class="f">锁定时长（分钟）</label><input class="i" id="fLock" type="number" min="1" max="1440" value="${esc(a.lockMinutes || 15)}"></div>
        </div>
        <div class="btnbar"><button class="btn pri" data-act="save-auth">保存安全设置</button></div>
      </div>
      <div class="card">
        <h3>IP 白名单 <span class="tag">留空 = 不限制</span></h3>
        <label class="f">每行一个 IP 或前缀（如 <code>192.168.1.</code>），命中前缀即放行</label>
        <textarea class="i" id="fIp" rows="4" style="height:auto;padding:9px;line-height:1.6">${esc((c.ipWhitelist || []).join('\n'))}</textarea>
        <div class="btnbar" style="margin-top:10px"><button class="btn" data-act="save-ip">保存白名单</button></div>
        <div class="hint" style="margin-top:8px">注意：远程访问时先看「运行日志」里的来源 IP，配错会把自己锁在外面（桌面控制台不受白名单限制）。</div>
      </div>
      <div class="card">
        <h3>反向代理</h3>
        <div class="row"><div class="lbl"><div class="t">信任 X-Forwarded-For</div><div class="d">服务部署在 Nginx / frp 后面时开启，才能正确识别来源 IP 做限流与白名单</div></div>
          <div class="acts"><button class="btn sm ${c.security && c.security.trustProxy ? 'pri' : ''}" data-act="toggle-proxy">${c.security && c.security.trustProxy ? '已开启' : '未开启'}</button></div></div>
      </div>`;
  }

  /* ---------------- 账号 ---------------- */
  function renderUsers(list, initPw) {
    const rows = list.map((u) => `
      <tr>
        <td><b>${esc(u.username)}</b><div class="hint">${esc(u.name || '')}</div></td>
        <td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
        <td><span class="badge ${u.enabled ? 'on' : 'off'}">${u.enabled ? '启用' : '禁用'}</span></td>
        <td class="hint">${esc(u.loginAt || '从未登录')}<br>${esc(u.loginIp || '')}</td>
        <td>
          <div class="acts">
            <button class="btn sm" data-user-pw="${esc(u.id)}">改密</button>
            <button class="btn sm" data-user-role="${esc(u.id)}">${u.role === 'admin' ? '降为用户' : '升为管理员'}</button>
            <button class="btn sm ${u.enabled ? 'warn' : ''}" data-user-toggle="${esc(u.id)}">${u.enabled ? '禁用' : '启用'}</button>
            <button class="btn sm bad" data-user-del="${esc(u.id)}">删除</button>
          </div>
        </td>
      </tr>`).join('');
    pane.innerHTML = `
      <h2>账号密码</h2>
      <p class="desc">每个账号拥有独立的书签空间，但全部数据仍然写在同一个 <code>data.json</code> 里（<code>spaces[用户ID]</code>）。管理员可管理所有账号。</p>
      ${initPw ? `<div class="warnbox">检测到初始管理员密码：<b style="font-family:Consolas,monospace">${esc(initPw)}</b><br>文件位置：数据目录 <code>INITIAL_ADMIN.txt</code>。请登录后立刻改密并删除该文件。</div>` : ''}
      <div class="card">
        <h3>账号列表 <span class="tag">共 ${list.length} 个</span></h3>
        <table class="t"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">暂无账号</td></tr>'}</tbody></table>
        <div class="btnbar" style="margin-top:14px"><button class="btn pri" data-act="user-add">+ 新建账号</button></div>
      </div>`;
  }

  /* ---------------- 数据 / 数据库 ---------------- */
  function renderData(d) {
    const bks = (d.backups || []).slice(0, 10).map((b) => `
      <div class="row"><div class="lbl"><div class="t">${esc(b.name)}</div><div class="d">${esc(fmtSize(b.size))} · ${esc(b.mtime || '')}</div></div>
      <div class="acts"><button class="btn sm" data-restore="${esc(b.name)}">恢复</button></div></div>`).join('');
    pane.innerHTML = `
      <h2>数据库 / 文件管理</h2>
      <p class="desc">没有 MySQL，全部数据是宿主机上的纯文本 JSON 文件。这里提供备份、恢复、校验、导入导出和迁移。</p>
      <div class="card">
        <h3>数据概览</h3>
        <div class="grid">
          <div class="stat"><div class="k">书签</div><div class="v">${d.stats.bookmarks || 0}</div></div>
          <div class="stat"><div class="k">分组</div><div class="v">${d.stats.groups || 0}</div></div>
          <div class="stat"><div class="k">图标缓存</div><div class="v">${d.stats.icons || 0}</div></div>
          <div class="stat"><div class="k">备份份数</div><div class="v">${(d.backups || []).length}</div></div>
          <div class="stat"><div class="k">文件大小</div><div class="v" style="font-size:15px">${esc(fmtSize(d.stats.size))}</div></div>
          <div class="stat"><div class="k">用户空间</div><div class="v">${d.spaces || 1}</div></div>
        </div>
        <div class="hint" style="margin-top:12px">主文件：<code>${esc(d.file || '')}</code></div>
      </div>
      <div class="card">
        <h3>备份与恢复</h3>
        <div class="btnbar" style="margin-bottom:12px">
          <button class="btn pri" data-act="backup">立即备份</button>
          <button class="btn" data-act="verify">校验 / 修复</button>
          <button class="btn" data-act="export">导出 JSON</button>
          <button class="btn" data-act="import">导入 JSON</button>
          <button class="btn" data-act="open-dir">打开数据目录</button>
          <button class="btn bad" data-act="clear">清空全部数据</button>
        </div>
        ${bks || '<div class="empty">还没有备份</div>'}
      </div>`;
  }

  /* ---------------- 图标库 ---------------- */
  function renderIcons(items) {
    pane.innerHTML = `
      <h2>内置图标库</h2>
      <p class="desc">共 ${items.length} 枚自绘图标。书签图标的降级顺序：<b>本地缓存 → 在线抓取 → 按域名/关键词匹配本库 → 渐变首字母</b>。内网站点或被墙站点也能有辨识度。</p>
      <div class="card">
        <h3>预览 <span class="tag"><input class="i" id="iconSearch" placeholder="搜索图标…" style="width:180px;height:28px;display:inline-block"></span></h3>
        <div class="icon-grid" id="iconGrid">${items.map((x) => `<div class="icon-cell" data-n="${esc((x.name + ' ' + x.id).toLowerCase())}"><img src="${esc(x.svg)}" alt="">${esc(x.name)}</div>`).join('')}</div>
      </div>`;
    $('#iconSearch').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$('#iconGrid .icon-cell').forEach((c) => (c.style.display = !q || c.dataset.n.includes(q) ? '' : 'none'));
    };
  }

  /* ---------------- 日志 ---------------- */
  function renderLogs(text) {
    pane.innerHTML = `
      <h2>运行日志</h2>
      <p class="desc">服务端启动、监听、请求错误与崩溃记录。文件位于 <code>%APPDATA%\\Navio\\navio-boot.log</code> / <code>navio-crash.log</code>。</p>
      <div class="card">
        <h3>最近记录 <span class="tag"><button class="btn sm" data-act="refresh-logs">刷新</button></span></h3>
        <pre class="log">${esc(text || '(暂无日志)')}</pre>
      </div>`;
  }

  /* ---------------- 渲染调度 ---------------- */
  async function load(tab) {
    TAB = tab || TAB;
    $$('.nav').forEach((n) => n.classList.toggle('on', n.dataset.tab === TAB));
    try {
      if (TAB === 'overview') {
        STATUS = await API.status();
        const chip = $('#stateChip');
        chip.textContent = STATUS.running ? '服务运行中' : '服务已停止';
        chip.className = 'chip ' + (STATUS.running ? 'on' : 'off');
        renderOverview(STATUS);
      } else if (TAB === 'service') {
        CONFIG = await API.configGet();
        STATUS = await API.status();
        renderService(CONFIG, STATUS);
      } else if (TAB === 'security') {
        CONFIG = await API.configGet();
        renderSecurity(CONFIG);
      } else if (TAB === 'users') {
        const r = await API.usersList();
        renderUsers(r.users || [], r.initialPassword);
      } else if (TAB === 'data') {
        const r = await API.dataInfo();
        renderData(r);
      } else if (TAB === 'icons') {
        const r = await API.iconsList();
        renderIcons(r.items || []);
      } else if (TAB === 'logs') {
        const r = await API.logs();
        renderLogs(r.text);
      }
    } catch (e) {
      pane.innerHTML = `<div class="warnbox">加载失败：${esc(e.message)}</div>`;
    }
  }

  /* ---------------- 事件 ---------------- */
  $$('.nav').forEach((n) => (n.onclick = () => load(n.dataset.tab)));
  $('#btnMin').onclick = () => API.minimize();
  $('#btnHide').onclick = () => API.hide();
  $('#btnOpenWeb').onclick = () => API.openWeb();

  pane.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.copy) return toast((await API.copy(t.dataset.copy)).ok ? '已复制到剪贴板' : '复制失败');

    if (t.dataset.restore) {
      const name = t.dataset.restore;
      return confirmBox('恢复备份', `将用「${name}」覆盖当前全部数据。当前数据会先自动备份一次。`, '恢复', async () => {
        const r = await API.dataRestore(name);
        toast(r.ok ? '已恢复' : '失败：' + r.error);
        load();
      });
    }
    if (t.dataset.userPw) {
      return modal('修改密码', `<label class="f">新密码（至少 8 位）</label><input class="i" id="mPw" type="password" placeholder="输入新密码">`, '保存', async (b) => {
        const v = $('#mPw', b).value;
        if (v.length < 8) { toast('密码至少 8 位'); return false; }
        const r = await API.userUpdate(t.dataset.userPw, { password: v });
        toast(r.ok ? '密码已修改，该账号需重新登录' : '失败：' + r.error);
      });
    }
    if (t.dataset.userRole) {
      const r = await API.usersList();
      const u = (r.users || []).find((x) => x.id === t.dataset.userRole);
      if (!u) return;
      const rr = await API.userUpdate(u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
      toast(rr.ok ? '角色已更新' : '失败：' + rr.error);
      return load();
    }
    if (t.dataset.userToggle) {
      const r = await API.usersList();
      const u = (r.users || []).find((x) => x.id === t.dataset.userToggle);
      if (!u) return;
      const rr = await API.userUpdate(u.id, { enabled: !u.enabled });
      toast(rr.ok ? '状态已更新' : '失败：' + rr.error);
      return load();
    }
    if (t.dataset.userDel) {
      return confirmBox('删除账号', '删除后该账号的书签空间会保留在 data.json 里，但账号无法再登录。', '删除', async () => {
        const r = await API.userDelete(t.dataset.userDel);
        toast(r.ok ? '已删除' : '失败：' + r.error);
        load();
      });
    }

    const act = t.dataset.act;
    if (!act) return;
    switch (act) {
      case 'open-web': return API.openWeb();
      case 'open-dir': return API.openDataDir();
      case 'restart': {
        toast('正在重启服务…');
        const r = await API.serviceRestart();
        toast(r.ok ? `服务已重启：${r.scheme}://${r.host}:${r.port}` : '重启失败：' + r.error);
        return load();
      }
      case 'toggle-service': {
        const r = STATUS && STATUS.running ? await API.serviceStop() : await API.serviceStart();
        toast(r.ok ? '操作完成' : '失败：' + r.error);
        return load();
      }
      case 'autolaunch': {
        const r = await API.autoLaunch(!CONFIG.autoLaunch);
        toast(r.ok ? (CONFIG.autoLaunch ? '已关闭开机自启' : '已开启开机自启') : '失败：' + r.error);
        return load();
      }
      case 'save-service': {
        const port = Number($('#fPort').value);
        const host = $('#fHost').value.trim() || '0.0.0.0';
        if (!Number.isInteger(port) || port < 1 || port > 65535) return toast('端口不合法');
        await API.configSet({ port, host });
        const r = await API.serviceRestart();
        toast(r.ok ? `已保存并重启：${host}:${port}` : '重启失败：' + r.error);
        return load();
      }
      case 'save-https': {
        await API.configSet({ https: { cert: $('#fCert').value.trim(), key: $('#fKey').value.trim() } });
        toast('证书路径已保存，重启服务后生效');
        return load();
      }
      case 'toggle-https': {
        const cert = $('#fCert') ? $('#fCert').value.trim() : (CONFIG.https && CONFIG.https.cert) || '';
        const key = $('#fKey') ? $('#fKey').value.trim() : (CONFIG.https && CONFIG.https.key) || '';
        if (!(CONFIG.https && CONFIG.https.enabled) && (!cert || !key)) return toast('请先填写证书和私钥路径');
        await API.configSet({ https: { enabled: !(CONFIG.https && CONFIG.https.enabled), cert, key } });
        await API.serviceRestart();
        return load();
      }
      case 'copy-fw': return API.copy(`New-NetFirewallRule -DisplayName "Navio Server" -Direction Inbound -LocalPort ${CONFIG.port} -Protocol TCP -Action Allow`).then(() => toast('命令已复制'));
      case 'save-auth': {
        await API.configSet({
          auth: {
            enabled: $('#fAuth').value === '1',
            sessionTtlHours: Number($('#fTtl').value) || 168,
            maxFail: Number($('#fMaxFail').value) || 5,
            lockMinutes: Number($('#fLock').value) || 15
          }
        });
        toast('安全设置已保存');
        return load();
      }
      case 'save-ip': {
        const list = $('#fIp').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        await API.configSet({ ipWhitelist: list });
        toast(`已保存 ${list.length} 条白名单规则`);
        return load();
      }
      case 'toggle-proxy': {
        await API.configSet({ security: { trustProxy: !(CONFIG.security && CONFIG.security.trustProxy) } });
        return load();
      }
      case 'user-add': {
        return modal('新建账号', `
          <label class="f">用户名（字母/数字/._-，2-32 位）</label><input class="i" id="mUser" placeholder="例如 family">
          <label class="f" style="margin-top:10px">显示名称</label><input class="i" id="mName" placeholder="例如 家人">
          <label class="f" style="margin-top:10px">密码（至少 8 位）</label><input class="i" id="mPw2" type="password">
          <label class="f" style="margin-top:10px">角色</label><select class="i" id="mRole"><option value="user">普通用户</option><option value="admin">管理员</option></select>`, '创建', async (b) => {
          const r = await API.userCreate({
            username: $('#mUser', b).value,
            name: $('#mName', b).value,
            password: $('#mPw2', b).value,
            role: $('#mRole', b).value
          });
          toast(r.ok ? '账号已创建' : '失败：' + r.error);
          if (!r.ok) return false;
        });
      }
      case 'backup': {
        const r = await API.dataBackup();
        toast(r.ok ? '已备份：' + r.name : '失败：' + r.error);
        return load();
      }
      case 'verify': {
        const r = await API.dataVerify();
        toast(r.ok ? `校验通过：${r.groups} 组 / ${r.bookmarks} 书签` : '校验失败：' + r.error);
        return load();
      }
      case 'export': {
        const r = await API.dataExport();
        return toast(r.ok ? '已导出：' + r.path : r.canceled ? '已取消' : '失败：' + r.error);
      }
      case 'import': {
        return confirmBox('导入 JSON', '导入会覆盖当前全部数据，导入前会自动备份。', '选择文件并导入', async () => {
          const r = await API.dataImport();
          toast(r.ok ? '导入完成' : r.canceled ? '已取消' : '失败：' + r.error);
          load();
        });
      }
      case 'clear': {
        return confirmBox('清空全部数据', '这会删除所有书签、分组与组件数据（账号保留），并先做一次备份。不可撤销。', '确认清空', async () => {
          const r = await API.dataClear();
          toast(r.ok ? '已清空' : '失败：' + r.error);
          load();
        });
      }
      case 'refresh-logs': return load();
    }
  });

  API.onToast((m) => toast(m));
  API.onStatus(() => load());
  API.version().then((v) => ($('#verLine').textContent = 'v' + (v.app || '2.0.0')));
  load('overview');
})();
