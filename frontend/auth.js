// Authentication shim for the Retail Edge frontend.
//
// Loaded before app.js, it wraps window.fetch so that:
//  - every /api request carries the stored bearer token;
//  - any JSON body containing actor_id is rewritten to the logged-in
//    username (the backend refuses mismatches to keep the audit trail
//    truthful);
//  - a 401 response opens the login overlay instead of failing silently.
// When the node runs without auth (no INVENTORY_JWT_SECRET), no 401 ever
// arrives and this shim stays invisible.
(function () {
  'use strict';

  var STORAGE_KEY = 'inventory-edge-auth';

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (_e) {
      return null;
    }
  }
  function writeSession(session) {
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_e) { /* private mode: session lives for this page only */ }
  }

  var session = readSession();
  var overlayOpen = false;

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isApi = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
    if (!isApi) return realFetch(input, init);

    init = init || {};
    var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
    if (session && session.token) headers.set('Authorization', 'Bearer ' + session.token);

    // Keep the audit trail truthful: actor_id always names the logged-in user.
    if (session && session.user && typeof init.body === 'string') {
      try {
        var parsed = JSON.parse(init.body);
        if (parsed && typeof parsed === 'object' && typeof parsed.actor_id === 'string') {
          parsed.actor_id = session.user.username;
          init.body = JSON.stringify(parsed);
        }
      } catch (_e) { /* not JSON: leave untouched */ }
    }
    init.headers = headers;

    return realFetch(input, init).then(function (response) {
      if (response.status === 401 && url.indexOf('/api/v1/auth/login') === -1) {
        showLogin();
      }
      return response;
    });
  };

  function showLogin() {
    if (overlayOpen) return;
    overlayOpen = true;
    var overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.innerHTML =
      '<style>' +
      '#auth-overlay{position:fixed;inset:0;background:rgba(15,23,42,.72);display:flex;' +
      'align-items:center;justify-content:center;z-index:1000;font:inherit}' +
      '#auth-overlay form{background:#fff;border-radius:10px;padding:28px;width:320px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
      '#auth-overlay h2{margin:0 0 4px;font-size:18px}' +
      '#auth-overlay p{margin:0 0 16px;color:#64748b;font-size:13px}' +
      '#auth-overlay label{display:block;font-size:12px;color:#475569;margin-bottom:10px}' +
      '#auth-overlay input{display:block;width:100%;box-sizing:border-box;margin-top:4px;' +
      'padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px}' +
      '#auth-overlay button{width:100%;padding:9px;border:0;border-radius:6px;' +
      'background:#0f172a;color:#fff;font-size:14px;cursor:pointer;margin-top:6px}' +
      '#auth-overlay .auth-error{color:#dc2626;font-size:12px;min-height:16px;margin:6px 0 0}' +
      '</style>' +
      '<form>' +
      '<h2>Sign in</h2><p>This node requires authentication.</p>' +
      '<label>Username<input name="username" autocomplete="username" required autofocus></label>' +
      '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<div class="auth-error" role="alert"></div>' +
      '<button type="submit">Sign in</button>' +
      '</form>';
    document.body.appendChild(overlay);
    var form = overlay.querySelector('form');
    var error = overlay.querySelector('.auth-error');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      error.textContent = '';
      realFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: form.username.value.trim(),
          password: form.password.value,
        }),
      })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) throw new Error(body.error || 'login failed');
            return body;
          });
        })
        .then(function (body) {
          writeSession({ token: body.token, user: body.user });
          location.reload();
        })
        .catch(function (err) {
          error.textContent = err.message;
        });
    });
  }

  function renderUserChip() {
    if (!session || !session.user) return;
    var header = document.querySelector('header.topbar > div');
    if (!header) return;
    var chip = document.createElement('span');
    chip.className = 'node';
    chip.textContent = session.user.username + ' (' + session.user.role + ') ';
    var logout = document.createElement('a');
    logout.href = '#';
    logout.textContent = 'sign out';
    logout.addEventListener('click', function (event) {
      event.preventDefault();
      writeSession(null);
      location.reload();
    });
    chip.appendChild(logout);
    header.appendChild(chip);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderUserChip);
  } else {
    renderUserChip();
  }
})();
