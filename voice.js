/* LF-VOICE 1.0 – голосовые сообщения Lite Fit (общий файл, лежит рядом с sw.js и push.js: …/anketa/voice.js).
 * Запись: микрофон → MP3 (lib/lame.min.js, грузится только при первой записи). До 3 минут, моно 16 кГц – примерно 4 КБ в секунду.
 * Прослушивание: обычный плеер телефона; голосовое из Telegram (OGG) на iPhone, который такой формат не играет,
 * перекодируется прямо на телефоне (lib/ogg-opus-decoder.min.js, тоже только когда нужно).
 *
 * window.LFVoice:
 *   canRecord()                     – можно ли записывать на этом телефоне
 *   mount(el, { max, btn, onChange }) – кнопка «Записать голосовое» с таймером, прослушиванием и «Удалить»;
 *                                     el.lfv.value() → { b64, mime, dur } | null, el.lfv.busy(), el.lfv.clear()
 *   url(b64, mime)                  → Promise<адрес для <audio>>
 *   player(el, load)                – кнопка «Слушать»: load() → Promise<{ ok, data, mime, error }>, потом плеер
 */
(function () {
  if (window.LFVoice) return;
  var V = {}, BASE = '', MAX = 180, RATE = 16000, KBPS = 32;
  try { BASE = new URL('./', (document.currentScript && document.currentScript.src) || location.href).href; } catch (e) { BASE = '../'; }

  var libs = {};
  function lib(name, ready) {
    if (ready()) return Promise.resolve();
    if (!libs[name]) libs[name] = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = BASE + 'lib/' + name; s.async = true;
      s.onload = function () { ready() ? ok() : no(new Error('lib')); };
      s.onerror = function () { delete libs[name]; no(new Error('нет связи – не загрузился модуль голосовых, повторите')); };
      document.head.appendChild(s);
    });
    return libs[name];
  }
  function AC() { return window.AudioContext || window.webkitAudioContext; }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  V.canRecord = function () { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && AC()); };

  /* ---------- запись ---------- */
  function Recorder(max) {
    var R = this, ctx = null, stream = null, src = null, proc = null, mute = null, chunks = [], n = 0, rate = 44100, t0 = 0, timer = 0;
    R.sec = function () { return n / rate; };
    R.start = function (tick, auto) {
      var C = AC(); if (!C) return Promise.reject(new Error('телефон не умеет записывать звук на странице'));
      try { ctx = new C(); } catch (e) { return Promise.reject(new Error('телефон не умеет записывать звук на странице')); }
      var go = ctx.resume ? ctx.resume() : null; if (go && go.catch) go.catch(function () {});   // включаем звук ещё в нажатии
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(function (s) {
        stream = s; rate = ctx.sampleRate;
        src = ctx.createMediaStreamSource(s);
        proc = (ctx.createScriptProcessor || ctx.createJavaScriptNode).call(ctx, 4096, 1, 1);
        mute = ctx.createGain(); mute.gain.value = 0;                         // обработчик должен быть подключён к выходу – но без звука
        proc.onaudioprocess = function (e) {
          if (!stream) return;
          var d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); n += d.length;
          if (n / rate >= max) auto();
        };
        src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
        t0 = Date.now(); timer = setInterval(function () { tick(R.sec()); }, 250);
        return ctx.resume ? ctx.resume() : null;
      }, function (e) {
        R.kill();
        var nm = e && e.name;
        throw new Error(nm === 'NotAllowedError' || nm === 'SecurityError' ? 'нет доступа к микрофону – разрешите его для Lite Fit в настройках телефона'
          : nm === 'NotFoundError' ? 'микрофон не найден' : 'микрофон занят или недоступен – закройте другие приложения и повторите');
      });
    };
    R.kill = function () {
      clearInterval(timer);
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (src) src.disconnect(); if (mute) mute.disconnect(); } catch (e) {}
      try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
      stream = null; proc = null; src = null; ctx = null;
    };
    /** Остановить и сжать в MP3: { blob, mime, dur }. */
    R.stop = function () {
      var all = chunks, total = n, from = rate; R.kill(); chunks = [];
      if (total / from < 0.7) return Promise.reject(new Error('слишком коротко – нажмите и говорите'));
      return lib('lame.min.js', function () { return !!(window.lamejs && lamejs.Mp3Encoder); }).then(function () {
        // в одну дорожку 16 кГц (средним по окну)
        var k = from / RATE, outN = Math.floor(total / k), pcm = new Int16Array(outN), flat = new Float32Array(total), o = 0, i;
        for (i = 0; i < all.length; i++) { flat.set(all[i], o); o += all[i].length; }
        for (i = 0; i < outN; i++) {
          var a = Math.floor(i * k), b = Math.min(total, Math.floor((i + 1) * k)), s = 0, c = 0;
          for (var j = a; j < b; j++) { s += flat[j]; c++; }
          var x = c ? s / c : 0; x = x < -1 ? -1 : x > 1 ? 1 : x;
          pcm[i] = x < 0 ? x * 32768 : x * 32767;
        }
        var enc = new lamejs.Mp3Encoder(1, RATE, KBPS), parts = [], pos = 0, STEP = 1152 * 40;
        return new Promise(function (ok) {
          (function step() {                                                     // частями – чтобы экран не замирал
            var end = Math.min(pos + STEP, outN);
            for (var p = pos; p < end; p += 1152) { var m = enc.encodeBuffer(pcm.subarray(p, Math.min(p + 1152, end))); if (m.length) parts.push(new Uint8Array(m)); }
            pos = end;
            if (pos < outN) return setTimeout(step, 0);
            var f = enc.flush(); if (f.length) parts.push(new Uint8Array(f));
            ok({ blob: new Blob(parts, { type: 'audio/mpeg' }), mime: 'audio/mpeg', dur: Math.round(outN / RATE) });
          })();
        });
      });
    };
  }
  V.Recorder = Recorder;

  V.b64 = function (blob) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { var s = String(r.result || ''); ok(s.slice(s.indexOf(',') + 1)); }; r.onerror = function () { no(r.error); }; r.readAsDataURL(blob); });
  };

  /* ---------- оформление (подстраивается под цвета страницы) ---------- */
  function css() {
    if (document.getElementById('lfv-css')) return;
    var st = document.createElement('style'); st.id = 'lfv-css';
    st.textContent = '.lfv{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 4px}.lfv .lfv-rec{display:flex;align-items:center;gap:10px;flex:1 1 100%;min-height:44px}' +
      '.lfv-dot{width:12px;height:12px;border-radius:50%;background:#e5484d;flex:none;animation:lfvp 1.1s ease-in-out infinite}@keyframes lfvp{50%{opacity:.25}}' +
      '.lfv-t{font-variant-numeric:tabular-nums;font-weight:700}.lfv-m{opacity:.65;font-size:.9em}.lfv audio{width:100%;height:44px;flex:1 1 100%}' +
      '.lfv-bar{display:flex;gap:8px;flex-wrap:wrap;flex:1 1 100%}.lfv-bar>*{flex:1 1 0;min-width:0}.lfv-err{color:#e5484d;font-size:.92em;flex:1 1 100%;margin:0}' +
      '.lfv-pl{margin:8px 0 2px}.lfv-pl audio{width:100%;height:44px;display:block}.lfv-pl .lfv-err{margin-top:6px}' +
      '.lfv-go{display:inline-flex;align-items:center;gap:8px}.lfv-go svg{width:18px;height:18px;flex:none}';
    document.head.appendChild(st);
  }
  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  V.MIC = MIC;

  /** Кнопка записи с таймером. opt: { max, btn: классы кнопок, label, onChange(state) }. */
  V.mount = function (el, opt) {
    opt = opt || {}; css();
    var max = Math.min(opt.max || MAX, MAX), cls = opt.btn || 'btn sec', rec = null, val = null, url = '', st = 'idle', err = '';
    el.classList.add('lfv');
    function set(s) { st = s; draw(); if (opt.onChange) try { opt.onChange(s); } catch (e) {} }
    function draw() {
      if (st === 'rec') el.innerHTML = '<div class="lfv-rec" role="status"><i class="lfv-dot"></i><span class="lfv-t">' + mmss(rec ? rec.sec() : 0) + '</span><span class="lfv-m">из ' + mmss(max) + ' – говорите</span></div>' +
        '<div class="lfv-bar"><button type="button" class="' + cls + '" data-lfv="stop">Готово</button><button type="button" class="' + cls + '" data-lfv="cancel">Отмена</button></div>';
      else if (st === 'enc') el.innerHTML = '<div class="lfv-rec" role="status"><span class="lfv-m">Готовлю голосовое…</span></div>';
      else if (st === 'done') el.innerHTML = '<audio controls preload="metadata" src="' + url + '"></audio><div class="lfv-bar"><button type="button" class="' + cls + '" data-lfv="again">Записать заново</button><button type="button" class="' + cls + '" data-lfv="del">Удалить</button></div>';
      else el.innerHTML = '<button type="button" class="' + cls + ' lfv-go" data-lfv="start">' + MIC + esc(opt.label || 'Записать голосовое') + '</button>' + (err ? '<p class="lfv-err" role="alert">' + esc(err) + '</p>' : '');
    }
    function drop() { if (url) try { URL.revokeObjectURL(url); } catch (e) {} url = ''; val = null; }
    function finish() {
      if (!rec || st !== 'rec') return;
      var r = rec; rec = null; set('enc');
      r.stop().then(function (o) {
        return V.b64(o.blob).then(function (b) { drop(); val = { b64: b, mime: o.mime, dur: o.dur, blob: o.blob }; url = URL.createObjectURL(o.blob); err = ''; set('done'); });
      }).catch(function (e) { err = (e && e.message) || 'не получилось записать'; set('idle'); });
    }
    function start() {
      if (!V.canRecord()) { err = window.isSecureContext ? 'этот телефон не умеет записывать звук на странице' : 'запись работает только по защищённой ссылке'; return draw(); }
      drop(); err = ''; rec = new Recorder(max);
      var r = rec;
      r.start(function () { if (st === 'rec') { var t = el.querySelector('.lfv-t'); if (t) t.textContent = mmss(r.sec()); } }, function () { setTimeout(finish, 0); })
        .then(function () { if (rec === r) set('rec'); }, function (e) { if (rec === r) rec = null; err = (e && e.message) || 'микрофон недоступен'; set('idle'); });
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-lfv]') : null; if (!b || !el.contains(b)) return;
      e.preventDefault(); e.stopPropagation();
      var a = b.getAttribute('data-lfv');
      if (a === 'start' || a === 'again') start();
      else if (a === 'stop') finish();
      else if (a === 'cancel') { if (rec) rec.kill(); rec = null; set('idle'); }
      else if (a === 'del') { drop(); set('idle'); }
    });
    el.lfv = {
      value: function () { return val ? { b64: val.b64, mime: val.mime, dur: val.dur } : null; },
      blob: function () { return val ? val.blob : null; },
      busy: function () { return st === 'rec' || st === 'enc'; },
      state: function () { return st; },
      clear: function () { if (rec) rec.kill(); rec = null; drop(); err = ''; set('idle'); }
    };
    draw();
    return el.lfv;
  };

  /* ---------- прослушивание ---------- */
  function canPlay(mime) { try { var a = document.createElement('audio'); return !!(a.canPlayType && a.canPlayType(mime).replace('no', '')); } catch (e) { return false; } }
  function u8(b64) { var raw = atob(b64), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  function wav(chs, rate) {
    var len = chs[0].length, k = rate > 24000 ? Math.round(rate / 24000) : 1, r = Math.round(rate / k), n = Math.floor(len / k), buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf), i;
    var w = function (o, s) { for (var j = 0; j < s.length; j++) d.setUint8(o + j, s.charCodeAt(j)); };
    w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, r, true); d.setUint32(28, r * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) {
      var s = 0, c = 0;
      for (var q = 0; q < chs.length; q++) for (var z = 0; z < k; z++) { s += chs[q][i * k + z] || 0; c++; }
      var x = s / c; x = x < -1 ? -1 : x > 1 ? 1 : x;
      d.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  /** Адрес для плеера; OGG там, где телефон его не играет, – перекодировать в WAV. */
  V.url = function (b64, mime) {
    mime = String(mime || 'audio/mpeg').split(';')[0];
    var ogg = /ogg|opus/.test(mime);
    if (!ogg || canPlay('audio/ogg; codecs=opus')) return Promise.resolve(URL.createObjectURL(new Blob([u8(b64)], { type: mime })));
    return lib('ogg-opus-decoder.min.js', function () { return !!(window['ogg-opus-decoder'] && window['ogg-opus-decoder'].OggOpusDecoder); }).then(function () {
      var dec = new window['ogg-opus-decoder'].OggOpusDecoder();
      return dec.ready.then(function () { return dec.decodeFile(u8(b64)); }).then(function (r) {
        try { dec.free(); } catch (e) {}
        if (!r || !r.samplesDecoded) throw new Error('голосовое не открылось');
        return URL.createObjectURL(wav(r.channelData, r.sampleRate));
      });
    });
  };

  /** Кнопка «Слушать» на месте el: при нажатии – загрузка (load) и плеер. */
  V.player = function (el, load, label) {
    css();
    el.classList.add('lfv-pl');
    var cls = el.getAttribute('data-btn') || 'btn sec sm';
    var draw = function (h) { el.innerHTML = h; };
    draw('<button type="button" class="' + cls + ' lfv-go">' + PLAY + esc(label || 'Голосовое – слушать') + '</button>');
    var busy = false;
    el.onclick = function (e) {
      var b = e.target.closest ? e.target.closest('button') : null; if (!b || busy || el.querySelector('audio')) return;
      e.preventDefault(); e.stopPropagation();
      busy = true; draw('<button type="button" class="' + cls + ' lfv-go" disabled>' + PLAY + 'Загружаю…</button>');
      var au = new Audio(); try { au.play().catch(function () {}); } catch (x) {}   // iPhone: «разрешение» на звук берём ещё в нажатии
      Promise.resolve(load()).then(function (r) {
        if (!r || !r.ok || !r.data) throw new Error((r && r.error) || (r && r.net ? 'нет связи – повторите' : 'голосовое не загрузилось'));
        return V.url(r.data, r.mime);
      }).then(function (u) {
        busy = false; draw('');
        au.controls = true; au.preload = 'auto'; au.src = u; el.appendChild(au);       // тот же плеер, что «разрешили» в нажатии
        var p = au.play(); if (p && p.catch) p.catch(function () {});
      }).catch(function (x) {
        busy = false;
        draw('<button type="button" class="' + cls + ' lfv-go">' + PLAY + esc(label || 'Голосовое – слушать') + '</button><p class="lfv-err">' + esc((x && x.message) || 'голосовое не загрузилось') + '</p>');
      });
    };
  };

  window.LFVoice = V;
})();
