/* LF-SW 1.2 – Lite Fit: приложение открывается без сети, видео тренировки – из памяти телефона, уведомления.
 * Лежит в корне папки anketa на GitHub (рядом с index.html анкеты): …/anketa/sw.js, работает для …/anketa/.
 * Трогает только страницы тренировок и кабинета клиента, видео из папки Video и шрифты. Кабинет тренера, анкета
 * и запросы к серверу (script.google.com) идут как раньше, мимо него.
 *
 * Страница: сначала сеть (до 4 секунд), нет ответа – копия из памяти, а свежая подтягивается в фоне. Новая версия
 * на GitHub приходит сама при первом открытии с интернетом.
 * Видео: страница присылает список роликов открытых тренировок ({ type:'prefetch', urls }) – они скачиваются целиком
 * заранее (пока есть Wi-Fi или связь) и в зале играют из памяти. Хранится до 40 роликов, старые вытесняются.
 * 1.1: голосовые – voice.js и библиотеки lib/lame.min.js (запись) и lib/ogg-opus-decoder.min.js (прослушивание на iPhone)
 * тоже хранятся в телефоне.
 * 1.2: fx.js (анимация панели и загрузка с логотипом) тоже хранится в телефоне – работает и без сети.
 */
var VER = '1.2';
var SHELL = 'lf-shell-2', VIDEO = 'lf-video-1', FONTS = 'lf-fonts-1', KEEP = [SHELL, VIDEO, FONTS];
var BASE = new URL('./', self.location.href).href;                     // …/anketa/
var PAGES = { 'trening/': 'trening/index.html', 'trening/index.html': 'trening/index.html', 'cabinet/': 'cabinet/index.html', 'cabinet/index.html': 'cabinet/index.html' };
var ASSETS = ['trening/index.html', 'cabinet/index.html', 'cabinet/config.js', 'push.js', 'fx.js', 'voice.js', 'lib/lame.min.js', 'lib/ogg-opus-decoder.min.js', 'trening/manifest.webmanifest', 'cabinet/manifest.webmanifest',
  'trening/icon-192.png', 'trening/apple-touch-icon.png', 'cabinet/icon-192.png', 'cabinet/apple-touch-icon.png'];
var VIDEO_MAX = 40, NET_WAIT = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(ASSETS.map(function (p) { return c.add(new Request(BASE + p, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return /^lf-/.test(k) && KEEP.indexOf(k) === -1; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function rel(url) { return url.href.indexOf(BASE) === 0 ? url.pathname.slice(new URL(BASE).pathname.length) : null; }

/** Страница: сеть до NET_WAIT, иначе копия; свежий ответ всегда кладётся в память. */
function page(req, key) {
  return caches.open(SHELL).then(function (c) {
    var net = fetch(req).then(function (r) { if (r && r.ok) c.put(BASE + key, r.clone()); return r; });
    return c.match(BASE + key).then(function (hit) {
      if (!hit) return net;
      var timer = new Promise(function (ok) { setTimeout(function () { ok(hit); }, NET_WAIT); });
      return Promise.race([net.catch(function () { return hit; }), timer]).then(function (r) { return r && r.ok ? r : hit; });
    });
  });
}

/** Файлы оформления: из памяти сразу, обновление в фоне. */
function asset(req, cacheName) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req, { ignoreSearch: cacheName === SHELL }).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; });
      if (hit) { net.catch(function () {}); return hit; }
      return net;
    });
  });
}

/** Видео: из памяти (с поддержкой запросов по частям – так играет iPhone), иначе из сети как обычно. */
function video(req) {
  var url = req.url.split('#')[0].split('?')[0];
  return caches.open(VIDEO).then(function (c) {
    return c.match(url).then(function (hit) {
      if (!hit) return fetch(req);
      var range = req.headers.get('range');
      if (!range) return hit;
      return hit.arrayBuffer().then(function (buf) {
        var size = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(range) || [], start, end;
        if (m[1] === '' && m[2]) { start = Math.max(size - +m[2], 0); end = size - 1; }
        else { start = +(m[1] || 0); end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
        return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
          'Content-Type': hit.headers.get('Content-Type') || 'video/mp4', 'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
          'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(asset(req, FONTS)); return; }
  if (url.origin !== self.location.origin) return;
  var r = rel(url);
  if (r === null) return;
  if (PAGES[r] && (req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe')) { e.respondWith(page(req, PAGES[r])); return; }
  if (/^Video\/[^/]+\.(mp4|m4v|mov|webm)$/i.test(r)) { e.respondWith(video(req)); return; }
  if (ASSETS.indexOf(r) !== -1 && !PAGES[r]) { e.respondWith(asset(req, SHELL)); return; }
});

/** Скачать ролики заранее: только свои (папка Video), по одному, до VIDEO_MAX; старые вытесняются. */
function prefetch(urls) {
  return caches.open(VIDEO).then(function (c) {
    var list = (urls || []).map(function (u) { try { return new URL(u, BASE); } catch (e) { return null; } })
      .filter(function (u) { return u && u.origin === self.location.origin && /^Video\/[^/]+\.(mp4|m4v|mov|webm)$/i.test(rel(u) || ''); })
      .map(function (u) { return u.origin + u.pathname; }).slice(0, VIDEO_MAX);
    var chain = Promise.resolve();
    list.forEach(function (u) {
      chain = chain.then(function () {
        return c.match(u).then(function (hit) {
          if (hit) { return c.delete(u).then(function () { return c.put(u, hit); }); }   // свежее – в конец очереди
          return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r && r.ok && r.status === 200) return c.put(u, r); }).catch(function () {});
        });
      });
    });
    return chain.then(function () { return c.keys(); }).then(function (ks) {
      var extra = ks.length - VIDEO_MAX;
      return Promise.all(ks.slice(0, Math.max(extra, 0)).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'prefetch') e.waitUntil(prefetch(d.urls).catch(function () {}));
  if (d.type === 'ver' && e.source) e.source.postMessage({ type: 'ver', v: VER });
});

/* ---------- уведомления ---------- */

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { b: e.data ? e.data.text() : '' }; }
  var title = d.t || 'Lite Fit', opt = { body: d.b || '', icon: BASE + 'trening/icon-192.png', badge: BASE + 'trening/icon-192.png', data: { u: d.u || BASE + 'trening/' }, lang: 'ru' };
  if (d.g) { opt.tag = d.g; opt.renotify = true; }
  e.waitUntil(self.registration.showNotification(title, opt));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.u) || BASE + 'trening/';
  if (String(u).indexOf(BASE) !== 0) u = BASE + 'trening/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var path = new URL(u).pathname;
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (new URL(w.url).pathname === path && 'focus' in w) { if ('navigate' in w) { try { w.navigate(u); } catch (err) {} } return w.focus(); }
    }
    return self.clients.openWindow ? self.clients.openWindow(u) : null;
  }));
});
