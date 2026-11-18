'use strict';
(function () {
  const form = document.getElementById('form');
  const user = document.getElementById('user');
  const pw = document.getElementById('pw');
  const msg = document.getElementById('msg');
  const btn = document.getElementById('submit');
  const srv = document.getElementById('srv');
  const eye = document.getElementById('eye');

  function show(text, ok) {
    msg.textContent = text;
    msg.className = 'msg' + (ok ? ' ok' : '');
  }
  function hide() {
    msg.className = 'msg hidden';
  }

  eye.onclick = () => {
    pw.type = pw.type === 'password' ? 'text' : 'password';
    eye.style.opacity = pw.type === 'password' ? '1' : '.55';
  };

  // 已登录就直接进主界面
  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((s) => {
      srv.textContent = s.serverName || 'Navio Server';
      if (s.authenticated) location.replace('/');
      else if (!s.authEnabled) location.replace('/');
    })
    .catch(() => {
      srv.textContent = '服务未就绪';
    });

  form.onsubmit = async (e) => {
    e.preventDefault();
    hide();
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.value.trim(), password: pw.value })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        show(d.error || '登录失败', false);
        pw.value = '';
        pw.focus();
        return;
      }
      show('登录成功，正在进入…', true);
      const next = new URLSearchParams(location.search).get('next');
      location.replace(next && next.startsWith('/') ? next : '/');
    } catch (err) {
      show('无法连接服务：' + err.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  };
})();
