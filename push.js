/* LF-PUSH 1.3 – уведомления на телефон для страниц тренировок и кабинета клиента (общий файл, лежит рядом с sw.js).
 * window.LFPush:
 *   status()              → Promise<'unsupported' | 'install' | 'denied' | 'on' | 'off'>  ('install' – iPhone: сначала значок на экран «Домой»)
 *   enable(api, k, from)  → Promise<{ ok, error }>   вызывать прямо из нажатия кнопки (iPhone спрашивает разрешение только так)
 *   disable(api, k)       → Promise<{ ok }>
 *   test(api, k, from)    → Promise<{ ok, error }>
 *   sync(api, k)          – при открытии: подписка есть на телефоне, а сервер её забыл – прислать снова
 *   prefetch(urls)        – скачать ролики заранее (сервис-воркер)
 * 1.3 (правка 02.11: окно не уходит под строку состояния iPhone, внизу «Готово»): P.panel(opt) – окно «Уведомления на телефон» для клиента (кнопка с колокольчиком в приложении и кабинете): включить,
 *   проверить, выключить на этом телефоне и выбрать, что присылать (ответы тренера, напоминание о тренировке).
 * 1.2: кабинет тренера – вместо ключа клиента k передаётся { t, d } (ключ тренера и устройство); P.prefs – о чём сообщать;
 *   status(api, auth) сверяет с сервером, выключено ли здесь; disable(…, keep) – выключить на сервере, не трогая телефон
 *   (у клиента и тренера на одном телефоне подписка общая).
 * 1.1: на iPhone со значка карточка показывается всегда – если телефон не может включить уведомления, «Включить» объясняет
 *   почему (старая iOS, служба приложения не запустилась). Проверка состояния не ждёт дольше 6 секунд.
 */
(function () {
  var SW = '../sw.js', SCOPE = '../', P = {};
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  P.ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  P.standalone = function () { return navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches); };
  P.supported = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext === true; };
  /** Почему нельзя: '' – можно. */
  P.why = function () {
    if (window.isSecureContext !== true) return 'уведомления работают только по защищённой ссылке https';
    if (P.ios && !P.standalone()) return 'на iPhone уведомления работают из значка Lite Fit на экране «Домой» (iOS 16.4 и новее)';
    if (!('serviceWorker' in navigator)) return P.ios ? 'на этом iPhone старая iOS – уведомления появятся после обновления до iOS 16.4 или новее (Настройки → Основные → Обновление ПО)' : 'этот браузер не умеет уведомления';
    if (!('PushManager' in window) || !('Notification' in window)) {
      var v = (navigator.userAgent.match(/OS (\d+)_(\d+)/) || []);
      return P.ios ? 'на этом iPhone' + (v[1] ? ' iOS ' + v[1] + '.' + v[2] : '') + ' – уведомления работают с iOS 16.4: Настройки → Основные → Обновление ПО, потом удалите значок Lite Fit и добавьте его снова' : 'этот браузер не умеет уведомления';
    }
    return '';
  };
  function wait(p, ms, val) { return Promise.race([p, new Promise(function (ok) { setTimeout(function () { ok(val); }, ms); })]); }

  var regP = null;
  P.reg = function () {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.reject(new Error('sw'));
    if (!regP) regP = navigator.serviceWorker.register(SW, { scope: SCOPE }).then(function (r) {
      return wait(navigator.serviceWorker.ready, 8000, null).then(function (x) { return x || r; });   // 1.1: не ждём бесконечно
    });
    regP.catch(function () { regP = null; });                                 // не вышло – в следующий раз заново
    return regP;
  };

  function post(api, body, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 25000) : 0;
    return fetch(api, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text(); }).then(function (x) { clearTimeout(t); return JSON.parse(x); })
      .catch(function () { clearTimeout(t); return { ok: false, net: true, error: 'нет связи с сервером – проверьте интернет и повторите' }; });
  }
  /** Кто: ключ клиента (строка) или тренер { t, d } – поля запроса. */
  function who(auth, body) {
    if (auth && typeof auth === 'object') { body.t = auth.t; body.d = auth.d; } else body.k = auth;
    return body;
  }
  function u8(b64) {
    var s = String(b64).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function serverKey(api) {
    return post(api, { a: 'push', op: 'key' }).then(function (r) {
      if (r && r.ok && r.key) { ls('lf_push_key', r.key); return r.key; }
      throw new Error((r && r.error) || 'уведомления пока недоступны');
    });
  }
  function getSub() { return P.reg().then(function (reg) { return reg.pushManager.getSubscription().then(function (s) { return { reg: reg, sub: s }; }); }); }

  P.status = function (api, auth) {
    if (P.ios && !P.standalone()) return Promise.resolve('install');
    if (!P.supported()) return Promise.resolve(P.ios ? 'off' : 'unsupported');   // 1.1: iPhone со значка – карточка есть, «Включить» скажет почему нет
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    return wait(getSub().then(function (x) {
      if (!(x.sub && Notification.permission === 'granted')) return 'off';
      if (!api || !auth) return 'on';
      return post(api, who(auth, { a: 'push', op: 'state', endpoint: x.sub.endpoint })).then(function (r) { return r && r.ok && !r.on ? 'off' : 'on'; });   // 1.2: выключено на сервере
    }), 6000, 'off').catch(function () { return P.ios ? 'off' : 'unsupported'; });
  };

  P.enable = function (api, k, from) {
    if (!P.supported()) return Promise.resolve({ ok: false, error: P.why() || 'этот браузер не умеет уведомления' });
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : new Promise(function (ok) {
      var r = Notification.requestPermission(ok); if (r && r.then) r.then(ok);                  // спрашиваем сразу – пока идёт нажатие
    });
    return ask.then(function (perm) {
      if (perm !== 'granted') return { ok: false, denied: perm === 'denied', error: perm === 'denied' ? 'уведомления запрещены в настройках телефона' : 'разрешение не дано' };
      return Promise.all([getSub(), serverKey(api)]).then(function (a) {
        var reg = a[0].reg, cur = a[0].sub, key = a[1];
        var make = function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) }); };
        var go = cur && ls('lf_push_srv') === key ? Promise.resolve(cur) : (cur ? cur.unsubscribe().then(make, make) : make());
        return go.then(function (sub) {
          ls('lf_push_srv', key);
          return post(api, who(k, { a: 'push', op: 'sub', from: from || '', sub: sub.toJSON(), ua: (P.ios ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'компьютер') + ' · ' + String(navigator.userAgent).slice(0, 60) }))
            .then(function (r) { if (r && r.ok) ls(typeof k === 'object' ? 'lf_push_tr' : 'lf_push_on', '1'); return r; });
        });
      });
    }).catch(function (e) {
      var n = e && e.name, m = String((e && e.message) || e || '');
      return { ok: false, denied: n === 'NotAllowedError', error: n === 'NotAllowedError' ? 'телефон не разрешил уведомления – проверьте настройки уведомлений для Lite Fit'
        : /[а-яё]/i.test(m) ? m : m === 'sw' || /service ?worker|registration/i.test(m) ? 'служба приложения не запустилась – закройте Lite Fit (смахните вверх) и откройте снова со значка'
        : 'служба уведомлений телефона не ответила (' + (n || 'ошибка') + ') – попробуйте ещё раз позже' };
    });
  };

  P.disable = function (api, k, keep) {
    return getSub().then(function (x) {
      ls(typeof k === 'object' ? 'lf_push_tr' : 'lf_push_on', null);
      if (!x.sub) return { ok: true };
      var e = x.sub.endpoint, srv = function () { return post(api, who(k, { a: 'push', op: 'unsub', endpoint: e })); };
      return keep ? srv() : x.sub.unsubscribe().catch(function () {}).then(srv);
    }).catch(function () { return { ok: true }; });
  };

  P.test = function (api, k, from) { return post(api, who(k, { a: 'push', op: 'test', from: from || '' })); };
  /** 1.2: тренер – о чём сообщать: прочитать (set не задан) или сохранить { com: true, … }. */
  P.prefs = function (api, auth, set) { return post(api, who(auth, set ? { a: 'push', op: 'tprefs', set: set } : { a: 'push', op: 'tprefs' })); };
  /** 1.3: клиент – что присылать: { msg, day }. */
  P.cprefs = function (api, auth, set) { return post(api, who(auth, set ? { a: 'push', op: 'cprefs', set: set } : { a: 'push', op: 'cprefs' })); };

  /* ---------- 1.3: окно настроек для клиента ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function css() {
    if (document.getElementById('lfp-css')) return;
    var st = document.createElement('style'); st.id = 'lfp-css';
    st.textContent = '.lfp-sh{position:fixed;inset:0;z-index:9000;background:rgba(3,6,7,.72);display:flex;align-items:flex-end;justify-content:center;font-family:inherit;padding-top:calc(env(safe-area-inset-top,0px) + 14px)}' +
      '.lfp-in{width:100%;max-width:560px;max-height:100%;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:var(--card,#0C1618);color:var(--text,#F2F7F7);border:1px solid var(--line2,#2A4B4D);border-bottom:0;border-radius:22px 22px 0 0;padding:8px 18px calc(env(safe-area-inset-bottom,0px) + 18px)}' +
      '@media (min-width:800px){.lfp-sh{align-items:center}.lfp-in{border-radius:22px;border-bottom:1px solid var(--line2,#2A4B4D)}}' +
      '.lfp-h{position:sticky;top:0;background:var(--card,#0C1618);display:flex;justify-content:space-between;align-items:center;padding:10px 0 12px;font-weight:800;font-size:17px}' +
      '.lfp-x{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--dim,#5E7577);background:none;border:0;font:inherit;cursor:pointer}.lfp-x svg{width:22px;height:22px}' +
      '.lfp-box{background:var(--card2,#0F1D20);border:1px solid var(--line,#1E3A3C);border-radius:16px;padding:14px;margin-bottom:16px}.lfp-box b{display:block;font-size:15px;margin-bottom:4px}' +
      '.lfp-box p{margin:0;color:var(--muted,#8FA5A7);font-size:14px;line-height:1.45}.lfp-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}' +
      '.lfp-b{flex:1 1 0;min-width:130px;min-height:46px;border-radius:13px;font:inherit;font-weight:800;font-size:15px;padding:0 14px;cursor:pointer;-webkit-appearance:none;appearance:none}' +
      '.lfp-b.pri{background:var(--accent,#3ED6CE);color:var(--on-accent,#04211F);border:0;box-shadow:0 6px 20px -8px var(--glow,rgba(62,214,206,.55))}.lfp-b.sec{background:transparent;color:var(--text,#F2F7F7);border:1px solid var(--line2,#2A4B4D)}.lfp-b[disabled]{opacity:.5}' +
      '.lfp-g{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dim,#5E7577);margin:6px 2px}' +
      '.lfp-sw{width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 2px;border:0;border-top:1px solid var(--line,#1E3A3C);background:none;color:inherit;text-align:left;font:inherit;font-size:15px;line-height:1.35;cursor:pointer}' +
      '.lfp-sw span{flex:1}.lfp-sw small{display:block;color:var(--dim,#5E7577);font-size:12.5px;margin-top:2px}' +
      '.lfp-sw i{flex:none;width:46px;height:28px;border-radius:99px;background:var(--line2,#2A4B4D);position:relative;transition:background .15s}' +
      '.lfp-sw i::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}' +
      '.lfp-sw[aria-checked="true"] i{background:var(--accent,#3ED6CE)}.lfp-sw[aria-checked="true"] i::after{transform:translateX(18px)}' +
      '.lfp-done{width:100%;min-height:50px;margin-top:14px;border-radius:14px;border:1px solid var(--line2,#2A4B4D);background:none;color:var(--text,#F2F7F7);font:inherit;font-weight:800;font-size:16px;cursor:pointer}' +
      '.lfp-note{color:var(--dim,#5E7577);font-size:12.5px;line-height:1.45;margin:12px 2px 0}.lfp-msg{min-height:20px;margin:10px 2px 0;font-size:13.5px;color:var(--muted,#8FA5A7)}.lfp-msg.bad{color:var(--warm,#FF9A52)}';
    document.head.appendChild(st);
  }
  var X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  /** opt: { api, auth (ключ клиента), from ('wk' | 'cab'), onState(st) }. */
  P.panel = function (opt) {
    css();
    var old = document.getElementById('lfp-sh'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'lfp-sh'; el.className = 'lfp-sh'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Уведомления на телефон');
    document.body.appendChild(el);
    var S = { st: '', prefs: null, list: null, busy: '', msg: '', bad: false, err: '' }, api = opt.api, auth = opt.auth;
    var tell = function () { if (opt.onState) try { opt.onState(S.st); } catch (e) {} };
    var say = function (t, bad) { S.msg = t; S.bad = !!bad; draw(); };
    function draw() {
      if (!el.parentNode) return;
      var st = S.st, B = S.busy, h = '<div class="lfp-in"><div class="lfp-h"><span>Уведомления на телефон</span><button class="lfp-x" data-p="close" aria-label="Закрыть">' + X + '</button></div>';
      var box = function (t, p, btns) { return '<div class="lfp-box"><b>' + t + '</b><p>' + p + '</p>' + (btns ? '<div class="lfp-row">' + btns + '</div>' : '') + '</div>'; };
      if (st === 'install') h += box('Нужен значок на экране «Домой»', 'На iPhone уведомления работают только из значка Lite Fit: в Safari нажмите «Поделиться» → «На экран «Домой»» и откройте приложение со значка (iOS 16.4 и новее).');
      else if (st === 'denied') h += box('Уведомления запрещены в настройках', 'Разрешите их: Настройки телефона → Уведомления → Lite Fit, затем вернитесь сюда.', '<button class="lfp-b pri" data-p="on"' + (B ? ' disabled' : '') + '>Включить</button>');
      else if (st === 'unsupported') h += box('Этот браузер не умеет уведомления', esc(P.why() || 'Откройте Lite Fit в Chrome или Safari.'));
      else if (st === 'on') h += box('Включены на этом телефоне', 'Ответы тренера и напоминания приходят на экран телефона. Бот в Telegram работает как раньше.',
        '<button class="lfp-b sec" data-p="test"' + (B ? ' disabled' : '') + '>' + (B === 'test' ? 'Отправляю…' : 'Проверить') + '</button><button class="lfp-b sec" data-p="off"' + (B ? ' disabled' : '') + '>' + (B === 'off' ? 'Выключаю…' : 'Выключить') + '</button>');
      else h += box(st ? 'Выключены на этом телефоне' : 'Проверяю…', 'Ответы тренера и напоминание о тренировке – сразу на экран телефона.', '<button class="lfp-b pri" data-p="on"' + (B || !st ? ' disabled' : '') + '>' + (B === 'on' ? 'Включаю…' : 'Включить') + '</button>');
      if (S.prefs && S.list) {
        h += '<div class="lfp-g">Что присылать</div>' + S.list.map(function (x) {
          return '<button class="lfp-sw" role="switch" aria-checked="' + !!S.prefs[x[0]] + '" data-k="' + x[0] + '"><span>' + esc(x[1]) + (x[2] ? '<small>' + esc(x[2]) + '</small>' : '') + '</span><i></i></button>';
        }).join('') + '<p class="lfp-note">Настройки общие для всех Ваших телефонов. Выключили всё – уведомлений не будет, бот в Telegram продолжит присылать сообщения.</p>';
      } else if (S.err) h += '<p class="lfp-msg bad">' + esc(S.err) + '</p>';
      h += '<p class="lfp-msg' + (S.bad ? ' bad' : '') + '" role="status">' + esc(S.msg) + '</p><button class="lfp-done" data-p="close">Готово</button></div>';
      var y = el.firstChild ? el.firstChild.scrollTop : 0;
      el.innerHTML = h;
      if (y && el.firstChild) el.firstChild.scrollTop = y;
    }
    function load() {
      P.status(api, auth).then(function (st) { S.st = st; draw(); tell(); });
      P.cprefs(api, auth).then(function (r) {
        if (r && r.ok && r.prefs) { S.prefs = r.prefs; S.list = r.list; S.err = ''; }
        else S.err = r && r.net ? 'Нет связи с сервером – настройки не загрузились.' : r && /неизвестное действие/.test(r.error || '') ? 'Выбор, что присылать, появится после обновления сервера.' : cap((r && r.error) || 'настройки не загрузились');
        draw();
      });
    }
    function close() { if (el.parentNode) el.remove(); document.removeEventListener('keydown', esc1); tell(); }
    function esc1(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc1);
    el.addEventListener('click', function (e) {
      if (e.target === el) return close();
      var b = e.target.closest ? e.target.closest('[data-p],[data-k]') : null; if (!b) return;
      var a = b.getAttribute('data-p'), k = b.getAttribute('data-k');
      if (a === 'close') return close();
      if (S.busy) return;
      if (k) {
        if (!S.prefs) return;
        var v = !S.prefs[k], set = {}; set[k] = v; S.prefs[k] = v; draw();
        P.cprefs(api, auth, set).then(function (r) {
          if (r && r.ok && r.prefs) { S.prefs = r.prefs; say('Сохранено'); }
          else { S.prefs[k] = !v; say(cap((r && r.error) || 'не сохранилось') + ' – попробуйте ещё раз', true); }
        });
        return;
      }
      if (a === 'on') {
        S.busy = 'on'; S.msg = ''; draw();
        P.enable(api, auth, opt.from).then(function (r) {                 // разрешение спрашивается сразу – пока идёт нажатие
          S.busy = '';
          if (r && r.ok) { S.st = 'on'; say('Включено. Нажмите «Проверить» – уведомление придёт за несколько секунд.'); }
          else { if (r && r.denied) S.st = 'denied'; say(cap((r && r.error) || 'не получилось'), true); }
          tell();
        });
      } else if (a === 'off') {
        S.busy = 'off'; draw();
        P.disable(api, auth, true).then(function () { S.busy = ''; S.st = 'off'; say('Выключено на этом телефоне.'); tell(); });
      } else if (a === 'test') {
        S.busy = 'test'; draw();
        P.test(api, auth, opt.from).then(function (r) {
          S.busy = '';
          say(r && r.ok ? 'Отправил – уведомление придёт через несколько секунд. Не пришло – проверьте, что для Lite Fit разрешены уведомления и выключен режим «Фокус».' : cap((r && r.error) || 'не получилось'), !(r && r.ok));
        });
      }
    });
    draw(); load();
    return { close: close };
  };

  P.sync = function (api, k) {
    var tr = typeof k === 'object', flag = tr ? 'lf_push_tr' : 'lf_push_on', sk = tr ? 'lf_push_sync_tr' : 'lf_push_sync';
    if (!P.supported() || Notification.permission !== 'granted' || !ls(flag)) return;
    var day = new Date().toISOString().slice(0, 10);
    if (ls(sk) === day) return;                                              // раз в день достаточно
    getSub().then(function (x) {
      if (!x.sub) return;
      return post(api, who(k, { a: 'push', op: 'state', endpoint: x.sub.endpoint })).then(function (r) {
        if (!r || !r.ok) return;
        ls(sk, day);
        if (!r.on) return post(api, who(k, { a: 'push', op: 'sub', sub: x.sub.toJSON(), ua: 'повторно · ' + String(navigator.userAgent).slice(0, 60) }));
      });
    }).catch(function () {});
  };

  P.prefetch = function (urls) {
    if (!urls || !urls.length) return;
    P.reg().then(function (reg) { var w = reg.active || navigator.serviceWorker.controller; if (w) w.postMessage({ type: 'prefetch', urls: urls }); }).catch(function () {});
  };

  window.LFPush = P;
  try { P.reg().catch(function () {}); } catch (e) {}
})();
