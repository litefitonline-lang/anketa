(function () {
'use strict';
var d = document, html = d.documentElement;
window.LF = 1;
var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
function $(s, r) { return (r || d).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
var mb = $('.menu-btn'), mn = d.getElementById('mnav');
if (mb && mn) {
var setMenu = function (open) { mn.hidden = !open; mb.setAttribute('aria-expanded', open ? 'true' : 'false'); };
mb.addEventListener('click', function () { setMenu(mn.hidden); });
mn.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mn.hidden) { setMenu(false); mb.focus(); } });
}
var CK = 'lfConsent', bn = $('.cookie');
function getConsent() {
try { var v = JSON.parse(localStorage.getItem(CK)); if (v && v.t && Date.now() - v.t < 365 * 864e5) return v; } catch (e) {}
return null;
}
window.lfConsent = getConsent;
function saveConsent(a, ads) {
var v = { analytics: !!a, ads: !!ads, t: Date.now() };
try { localStorage.setItem(CK, JSON.stringify(v)); } catch (e) {}
if (bn) bn.hidden = true;
try { window.dispatchEvent(new CustomEvent('lf:consent', { detail: v })); } catch (e) {}
}
function showBanner(force) {
if (!bn || (!force && getConsent())) return;
var v = getConsent();
if (v) { $('#ck-a', bn).checked = v.analytics; $('#ck-ads', bn).checked = v.ads; }
bn.hidden = false;
}
if (bn) {
var setBox = $('.cookie-set', bn), setBtn = $('.ck-set', bn);
$('.ck-all', bn).addEventListener('click', function () { saveConsent(true, true); });
$('.ck-need', bn).addEventListener('click', function () { saveConsent(false, false); });
setBtn.addEventListener('click', function () {
if (setBox.hidden) { setBox.hidden = false; setBtn.textContent = 'Сохранить выбор'; $('#ck-a', bn).focus(); }
else saveConsent($('#ck-a', bn).checked, $('#ck-ads', bn).checked);
});
}
$$('.ck-open').forEach(function (b) { b.addEventListener('click', function () { showBanner(true); if (bn) $('.ck-all', bn).focus(); }); });
function watchComic() {
var c = d.getElementById('comic');
if (!c) return;
var ps = $$('.panel', c);
if (reduce || !('IntersectionObserver' in window)) { ps.forEach(function (p) { p.classList.add('go'); }); return; }
var io = new IntersectionObserver(function (es) {
es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('go'); io.unobserve(e.target); } });
}, { threshold: 0.2 });
ps.forEach(function (p) { io.observe(p); });
}
function intro(done) {
var box = $('.intro'), btn = $('.intro-skip');
if (!html.classList.contains('intro-on') || !box) { done(); return; }
var cv = $('canvas', box), raf = 0, tm = 0, cap = 0, ended = false;
var skipEv = ['wheel', 'touchstart', 'keydown'];
function onAny(e) { if (e.type !== 'keydown' || e.key !== 'Shift') finish(true); }
function finish(now) {
if (ended) return; ended = true;
cancelAnimationFrame(raf); clearTimeout(tm); clearTimeout(cap);
skipEv.forEach(function (t) { window.removeEventListener(t, onAny, true); });
var hadFocus = d.activeElement === btn;
box.classList.add('out');
setTimeout(function () {
html.classList.remove('intro-on'); box.classList.remove('out');
if (hadFocus) { var m = d.getElementById('main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: true }); } }
done();
}, now || reduce ? 0 : 360);
}
if (btn) btn.addEventListener('click', function () { finish(true); });
box.addEventListener('click', function () { finish(true); });
skipEv.forEach(function (t) { window.addEventListener(t, onAny, { capture: true, passive: true }); });
cap = setTimeout(function () { finish(false); }, 2300);
var dpr = Math.min(window.devicePixelRatio || 1, 2);
var W = window.innerWidth, H = window.innerHeight;
cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
var ctx = cv.getContext('2d');
if (!ctx) { finish(true); return; }
ctx.scale(dpr, dpr);
var img = window.LFlogo || new Image();
function start() {
if (ended) return;
var lw = Math.min(380, W * 0.6), lh = lw * img.naturalHeight / img.naturalWidth;
var lx = (W - lw) / 2, ly = (H - lh) / 2;
if (reduce) { ctx.drawImage(img, lx, ly, lw, lh); tm = setTimeout(function () { finish(false); }, 700); return; }
var off = d.createElement('canvas');
off.width = Math.round(lw); off.height = Math.round(lh);
var oc = off.getContext('2d'); oc.drawImage(img, 0, 0, off.width, off.height);
var data;
try { data = oc.getImageData(0, 0, off.width, off.height).data; } catch (e) { finish(true); return; }
var step = W < 700 ? 5 : 4, P = [], R0 = Math.max(W, H);
for (var y = 0; y < off.height; y += step) {
for (var x = 0; x < off.width; x += step) {
if (data[(y * off.width + x) * 4 + 3] > 140) {
var a = Math.random() * Math.PI * 2, r = R0 * (0.35 + Math.random() * 0.45);
P.push({ tx: lx + x, ty: ly + y, sx: W / 2 + Math.cos(a) * r, sy: H / 2 + Math.sin(a) * r, d: Math.random() * 250, s: 1 + Math.random() * 1.4, w: (Math.random() - 0.5) * 120 });
}
}
}
var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
var T0 = performance.now(), CONV = 1100, HOLD = 200, FLASH = 330, pos = new Float32Array(P.length * 2);
function frame(now) {
var t = now - T0, i, p;
ctx.clearRect(0, 0, W, H);
if (t < CONV + 250) {
ctx.strokeStyle = 'rgba(62,214,206,0.18)'; ctx.lineWidth = 0.6;
ctx.beginPath();
for (i = 0; i < P.length; i++) {
p = P[i];
var k = ease(Math.min(1, Math.max(0, (t - p.d) / CONV)));
var sw = Math.sin(k * Math.PI) * p.w;
var px = p.sx + (p.tx - p.sx) * k + sw * 0.3, py = p.sy + (p.ty - p.sy) * k - sw * 0.2;
pos[2 * i] = px; pos[2 * i + 1] = py;
if (i > 0 && k < 0.97) {
var dx = px - pos[2 * i - 2], dy = py - pos[2 * i - 1];
if (dx * dx + dy * dy < 900) { ctx.moveTo(pos[2 * i - 2], pos[2 * i - 1]); ctx.lineTo(px, py); }
}
}
ctx.stroke();
ctx.fillStyle = '#3ED6CE'; ctx.globalAlpha = 0.85;
ctx.beginPath();
for (i = 0; i < P.length; i++) ctx.rect(pos[2 * i], pos[2 * i + 1], P[i].s, P[i].s);
ctx.fill();
ctx.globalAlpha = 1;
}
var tl = t - CONV;
if (tl > 0) { ctx.globalAlpha = Math.min(1, tl / HOLD); ctx.drawImage(img, lx, ly, lw, lh); ctx.globalAlpha = 1; }
var tf = t - CONV - HOLD;
if (tf > 0 && tf < FLASH) {
var kf = tf / FLASH, R = R0 * (0.2 + kf * 0.9);
var g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
g.addColorStop(0, 'rgba(255,255,255,' + (0.95 * (1 - kf)) + ')');
g.addColorStop(0.45, 'rgba(62,214,206,' + (0.55 * (1 - kf)) + ')');
g.addColorStop(1, 'rgba(62,214,206,0)');
ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
if (tf >= FLASH) { finish(false); return; }
raf = requestAnimationFrame(frame);
}
raf = requestAnimationFrame(frame);
}
if (img.complete && img.naturalWidth) requestAnimationFrame(function () { setTimeout(start, 0); });
else {
img.onload = function () { setTimeout(start, 0); };
img.onerror = function () { finish(true); };
if (!img.src) img.src = '/s/img/logo-360.webp';
tm = setTimeout(function () { if (!img.complete) finish(true); }, 700);
}
}
intro(function () { showBanner(false); watchComic(); });
var wk = d.getElementById('wk');
if (wk) {
var P = [
{ s: ['Всё тело с гантелями', 'Ноги и спина', 'Верх тела и пресс'], sub: 'гантели, коврик' },
{ s: ['Всё тело с эспандером', 'Ноги и ягодицы', 'Спина и плечи'], sub: 'эспандер, коврик' },
{ s: ['Знакомство с залом', 'Ноги и спина', 'Верх тела'], sub: 'тренажёры и гантели' }
];
var dows = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], plan = { 0: 0, 2: 1, 4: 2 }, cur = 0;
var imgs = {}; try { imgs = JSON.parse(d.getElementById('nd-data').textContent); } catch (e) {}
var renderWeek = function () {
var now = new Date(), lis = wk.children;
for (var i = 0; i < 7 && i < lis.length; i++) {
var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), k = plan[i], has = k !== undefined, li = lis[i];
li.className = has ? 'on' : '';
$('.dw', li).textContent = i === 0 ? 'Сегодня' : dows[dt.getDay()];
$('.dt', li).textContent = dt.getDate() + '.' + String(dt.getMonth() + 1).padStart(2, '0');
$('.tt', li).textContent = has ? 'Занятие ' + (k + 1) + ' из 3: ' + P[cur].s[k] : '';
$('.sb', li).textContent = has ? '≈ 40 минут · ' + P[cur].sub : '';
}
var im = imgs[cur === 2 ? 'zal' : 'doma'], el = d.getElementById('nd-img');
if (im && el) {
var src = el.parentNode.querySelector('source');
if (src) src.srcset = im.webp;
if (el.getAttribute('src') !== im.src) el.src = im.src;
el.alt = im.alt;
var cap = d.getElementById('nd-cap'); if (cap) cap.textContent = im.cap;
}
};
$$('.place').forEach(function (b) {
b.addEventListener('click', function () {
cur = +b.getAttribute('data-place');
$$('.place').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
renderWeek();
});
});
renderWeek();
}
var tabs = $$('.tab');
if (tabs.length) {
tabs.forEach(function (b) {
b.addEventListener('click', function () {
var t = +b.getAttribute('data-tab');
tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
$$('.chap').forEach(function (s) { var c = +s.getAttribute('data-chap'); s.hidden = !(t === 0 || t === c); });
});
});
}
})();
