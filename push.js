/* LF-PUSH 1.1 – уведомления на телефон для страниц тренировок и кабинета клиента (общий файл, лежит рядом с sw.js).
 * window.LFPush:
 *   status()              → Promise<'unsupported' | 'install' | 'denied' | 'on' | 'off'>  ('install' – iPhone: сначала значок на экран «Домой»)
 *   enable(api, k, from)  → Promise<{ ok, error }>   вызывать прямо из нажатия кнопки (iPhone спрашивает разрешение только так)
 *   disable(api, k)       → Promise<{ ok }>
 *   test(api, k, from)    → Promise<{ ok, error }>
 *   sync(api, k)          – при открытии: подписка есть на телефоне, а сервер её забыл – прислать снова
 *   prefetch(urls)        – скачать ролики заранее (сервис-воркер)
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

  P.status = function () {
    if (P.ios && !P.standalone()) return Promise.resolve('install');
    if (!P.supported()) return Promise.resolve(P.ios ? 'off' : 'unsupported');   // 1.1: iPhone со значка – карточка есть, «Включить» скажет почему нет
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    return wait(getSub().then(function (x) { return x.sub && Notification.permission === 'granted' ? 'on' : 'off'; }), 6000, 'off')
      .catch(function () { return P.ios ? 'off' : 'unsupported'; });
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
          return post(api, { a: 'push', op: 'sub', k: k, from: from || '', sub: sub.toJSON(), ua: (P.ios ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'компьютер') + ' · ' + String(navigator.userAgent).slice(0, 60) })
            .then(function (r) { if (r && r.ok) ls('lf_push_on', '1'); return r; });
        });
      });
    }).catch(function (e) {
      var n = e && e.name, m = String((e && e.message) || e || '');
      return { ok: false, denied: n === 'NotAllowedError', error: n === 'NotAllowedError' ? 'телефон не разрешил уведомления – проверьте настройки уведомлений для Lite Fit'
        : /[а-яё]/i.test(m) ? m : m === 'sw' || /service ?worker|registration/i.test(m) ? 'служба приложения не запустилась – закройте Lite Fit (смахните вверх) и откройте снова со значка'
        : 'служба уведомлений телефона не ответила (' + (n || 'ошибка') + ') – попробуйте ещё раз позже' };
    });
  };

  P.disable = function (api, k) {
    return getSub().then(function (x) {
      ls('lf_push_on', null);
      if (!x.sub) return { ok: true };
      var e = x.sub.endpoint;
      return x.sub.unsubscribe().catch(function () {}).then(function () { return post(api, { a: 'push', op: 'unsub', k: k, endpoint: e }); });
    }).catch(function () { return { ok: true }; });
  };

  P.test = function (api, k, from) { return post(api, { a: 'push', op: 'test', k: k, from: from || '' }); };

  P.sync = function (api, k) {
    if (!P.supported() || Notification.permission !== 'granted' || !ls('lf_push_on')) return;
    var day = new Date().toISOString().slice(0, 10);
    if (ls('lf_push_sync') === day) return;                                  // раз в день достаточно
    getSub().then(function (x) {
      if (!x.sub) return;
      return post(api, { a: 'push', op: 'state', k: k, endpoint: x.sub.endpoint }).then(function (r) {
        if (!r || !r.ok) return;
        ls('lf_push_sync', day);
        if (!r.on) return post(api, { a: 'push', op: 'sub', k: k, sub: x.sub.toJSON(), ua: 'повторно · ' + String(navigator.userAgent).slice(0, 60) });
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
