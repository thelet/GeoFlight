(function () {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var PXDEG_NATIVE = 18.3, PXDEG_8K = 21.3;
  var redrawers = [];
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(id) { return document.getElementById(id); }
  function tok(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || '#888888';
  }
  function hexRgb(h) {
    h = h.replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return [128, 128, 128];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(name, a) { var c = hexRgb(tok(name)); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function setup(c) {
    var w = +c.getAttribute('width'), h = +c.getAttribute('height');
    if (!c._lw) { c._lw = w; c._lh = h; }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(c._lw * dpr)) { c.width = Math.round(c._lw * dpr); c.height = Math.round(c._lh * dpr); }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: c._lw, h: c._lh };
  }
  function fmt(x, d) { if (!isFinite(x)) return '–'; return x.toFixed(d === undefined ? 2 : d); }
  function num(el, lo, hi, fallback) {
    var v = parseFloat(el.value);
    if (!isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, v));
  }
  function safe(name, fn) {
    try { fn(); } catch (e) { if (window.console) console.error('widget ' + name + ' failed', e); }
  }
  function canvasPos(c, e) {
    var r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * c._lw, y: (e.clientY - r.top) / r.height * c._lh };
  }
  function bars(container, items, max, thr) {
    container.innerHTML = '';
    items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'bar-row';
      var l = document.createElement('span'); l.className = 'lbl'; l.textContent = it.label; l.title = it.label;
      var tr = document.createElement('div'); tr.className = 'bar-track';
      var f = document.createElement('div'); f.className = 'bar-fill' + (thr !== undefined && it.value > thr ? ' over' : '');
      f.style.width = Math.max(0, Math.min(100, it.value / (max || 1) * 100)) + '%';
      tr.appendChild(f);
      var v = document.createElement('span'); v.className = 'val'; v.textContent = it.text || fmt(it.value, 1);
      row.appendChild(l); row.appendChild(tr); row.appendChild(v);
      container.appendChild(row);
    });
  }
  function axes(ctx, x0, y0, x1, y1) {
    ctx.strokeStyle = tok('--chart-axis'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  }

  /* =============================================================
     1. Seam parallax
     ============================================================= */
  safe('seam', function () {
    var c = $('seam-canvas'); if (!c) return;
    var bEl = $('seam-b'), dEl = $('seam-d'), d0El = $('seam-d0');
    var DMIN = 0.3, DMAX = 30;
    function sl2d(v) { return DMIN * Math.pow(DMAX / DMIN, v / 1000); }
    function d0val() { var v = num(d0El, 0, 1000, 1000); return v >= 999 ? Infinity : sl2d(v); }
    function delta(b, d, d0) { return b * Math.abs(1 / d - (isFinite(d0) ? 1 / d0 : 0)); }
    function draw() {
      var b = num(bEl, 1, 5, 3) / 100, d = sl2d(num(dEl, 0, 1000, 333)), d0 = d0val();
      $('seam-b-out').textContent = fmt(b * 100, 1) + ' cm';
      $('seam-d-out').textContent = fmt(d, 2) + ' m';
      $('seam-d0-out').textContent = isFinite(d0) ? fmt(d0, 2) + ' m' : '∞ (plain b/d)';
      var dl = delta(b, d, d0) * R2D;
      $('seam-deg').textContent = fmt(dl, 2) + '°';
      $('seam-px8').textContent = fmt(dl * PXDEG_8K, 1) + ' px';
      $('seam-pxn').textContent = fmt(dl * PXDEG_NATIVE, 1) + ' px';
      var g = setup(c), ctx = g.ctx, W = g.w, H = g.h;
      ctx.clearRect(0, 0, W, H);
      var L = 56, R = W - 16, T = 16, B = H - 40;
      var YMAX = 80;
      function xp(dd) { return L + (Math.log(dd / DMIN) / Math.log(DMAX / DMIN)) * (R - L); }
      function yp(px) { return B - Math.min(px, YMAX) / YMAX * (B - T); }
      ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillStyle = tok('--fg-muted');
      [0.5, 1, 2, 5, 10, 20].forEach(function (dd) {
        var x = xp(dd);
        ctx.strokeStyle = tok('--chart-grid'); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
        ctx.textAlign = 'center'; ctx.fillText(dd + ' m', x, B + 16);
      });
      [0, 20, 40, 60, 80].forEach(function (p) {
        var y = yp(p);
        ctx.strokeStyle = tok('--chart-grid'); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(p + ' px', L - 6, y + 4);
      });
      axes(ctx, L, B, R, T);
      ctx.textAlign = 'center'; ctx.fillText('object distance d (log scale)', (L + R) / 2, H - 6);
      // band for b = 2..4 cm
      ctx.fillStyle = rgba('--chart-1', 0.12);
      ctx.beginPath();
      var k, dd2;
      for (k = 0; k <= 200; k++) { dd2 = DMIN * Math.pow(DMAX / DMIN, k / 200); ctx.lineTo(xp(dd2), yp(delta(0.04, dd2, d0) * R2D * PXDEG_8K)); }
      for (k = 200; k >= 0; k--) { dd2 = DMIN * Math.pow(DMAX / DMIN, k / 200); ctx.lineTo(xp(dd2), yp(delta(0.02, dd2, d0) * R2D * PXDEG_8K)); }
      ctx.closePath(); ctx.fill();
      // curve for current b
      ctx.strokeStyle = tok('--chart-1'); ctx.lineWidth = 2.5; ctx.beginPath();
      for (k = 0; k <= 300; k++) { dd2 = DMIN * Math.pow(DMAX / DMIN, k / 300); var y = yp(delta(b, dd2, d0) * R2D * PXDEG_8K); if (k) ctx.lineTo(xp(dd2), y); else ctx.moveTo(xp(dd2), y); }
      ctx.stroke(); ctx.lineWidth = 1;
      // current point
      var px = dl * PXDEG_8K;
      ctx.fillStyle = tok('--chart-2');
      ctx.beginPath(); ctx.arc(xp(d), yp(px), 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = tok('--fg'); ctx.textAlign = 'left';
      var lx = Math.min(xp(d) + 10, R - 120);
      ctx.fillText(fmt(px, 1) + ' px' + (px > YMAX ? ' (off scale)' : ''), lx, Math.max(T + 12, yp(px) - 10));
      ctx.fillStyle = tok('--fg-muted');
      ctx.fillText('shaded: b = 2–4 cm; line: chosen b; 8K equirect', L + 8, T + 12);
    }
    [bEl, dEl, d0El].forEach(function (el) { el.addEventListener('input', draw); });
    redrawers.push(draw); draw();
  });

  /* =============================================================
     2. Pinhole projection playground
     ============================================================= */
  safe('pinhole', function () {
    var c = $('pin-canvas'); if (!c) return;
    var fEl = $('pin-f'), yawEl = $('pin-yaw'), xEl = $('pin-x'), yEl = $('pin-y'), zEl = $('pin-z');
    var bPin = $('pin-model-pin'), bFish = $('pin-model-fish');
    var model = 'pin';
    // scene segments (camera at origin, y down, z forward); floor y=1.5, ceiling y=-1.5
    var segs = [];
    var zs = [4, 8, 12, 16], xs = [-3, 3];
    zs.forEach(function (z) {
      xs.forEach(function (x) {
        var w = 0.3;
        [[-w, -w], [w, -w], [w, w], [-w, w]].forEach(function (o) { segs.push([[x + o[0], 1.5, z + o[1]], [x + o[0], -1.5, z + o[1]], 'p']); });
        segs.push([[x - w, -1.5, z - w], [x + w, -1.5, z - w], 'p']); segs.push([[x - w, 1.5, z - w], [x + w, 1.5, z - w], 'p']);
      });
      zs.forEach(function () {});
    });
    for (var gx = -6; gx <= 6; gx += 1.5) segs.push([[gx, 1.5, -8], [gx, 1.5, 20], 'f']);
    for (var gz = -8; gz <= 20; gz += 2) segs.push([[-6, 1.5, gz], [6, 1.5, gz], 'f']);
    // mirrored pillars behind the camera
    zs.forEach(function (z) { xs.forEach(function (x) { segs.push([[x, 1.5, -z], [x, -1.5, -z], 'p']); }); });
    function toCam(P, yaw) {
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      // world -> camera: rotate by -yaw about y
      return [cy * P[0] - sy * P[2], P[1], sy * P[0] + cy * P[2]];
    }
    function project(Pc, f, W, H) {
      var cx = W / 2, cy = H / 2;
      if (model === 'pin') {
        if (Pc[2] <= 1e-3) return null;
        return [f * Pc[0] / Pc[2] + cx, f * Pc[1] / Pc[2] + cy];
      }
      var r3 = Math.hypot(Pc[0], Pc[1], Pc[2]); if (r3 < 1e-9) return null;
      var th = Math.acos(Math.max(-1, Math.min(1, Pc[2] / r3)));
      if (th > 105 * D2R) return null;
      var rp = Math.hypot(Pc[0], Pc[1]);
      if (rp < 1e-12) return [cx, cy];
      var r = f * th;
      return [cx + r * Pc[0] / rp, cy + r * Pc[1] / rp];
    }
    function draw() {
      var f = num(fEl, 120, 900, 320), yaw = num(yawEl, -180, 180, 0) * D2R;
      var P = [num(xEl, -6, 6, 1.5), num(yEl, -1.5, 1.5, 0.5), num(zEl, -6, 12, 4)];
      $('pin-f-out').textContent = fmt(f, 0) + ' px';
      $('pin-yaw-out').textContent = fmt(yaw * R2D, 0) + '°';
      $('pin-x-out').textContent = fmt(P[0], 2) + ' m';
      $('pin-y-out').textContent = fmt(P[1], 2) + ' m';
      $('pin-z-out').textContent = fmt(P[2], 2) + ' m';
      var g = setup(c), ctx = g.ctx, W = g.w, H = g.h;
      ctx.clearRect(0, 0, W, H);
      if (model === 'fish') {
        ctx.strokeStyle = tok('--border-strong'); ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(W / 2, H / 2, f * Math.PI / 2, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = tok('--fg-faint'); ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif';
        ctx.fillText('θ = 90°', W / 2 + f * Math.PI / 2 * 0.707 + 4, H / 2 - f * Math.PI / 2 * 0.707);
      }
      segs.forEach(function (s) {
        ctx.strokeStyle = s[2] === 'p' ? tok('--fg-muted') : tok('--chart-grid');
        ctx.lineWidth = s[2] === 'p' ? 1.4 : 1;
        ctx.beginPath();
        var pen = false;
        for (var k = 0; k <= 24; k++) {
          var t = k / 24;
          var Pw = [s[0][0] + t * (s[1][0] - s[0][0]), s[0][1] + t * (s[1][1] - s[0][1]), s[0][2] + t * (s[1][2] - s[0][2])];
          var q = project(toCam(Pw, yaw), f, W, H);
          if (q && Math.abs(q[0]) < 5000 && Math.abs(q[1]) < 5000) { if (pen) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); pen = true; } else pen = false;
        }
        ctx.stroke();
      });
      ctx.lineWidth = 1;
      // principal point
      ctx.strokeStyle = tok('--fg-faint');
      ctx.beginPath(); ctx.moveTo(W / 2 - 6, H / 2); ctx.lineTo(W / 2 + 6, H / 2); ctx.moveTo(W / 2, H / 2 - 6); ctx.lineTo(W / 2, H / 2 + 6); ctx.stroke();
      var Pc = toCam(P, yaw);
      var r3 = Math.hypot(Pc[0], Pc[1], Pc[2]);
      var th = r3 > 0 ? Math.acos(Math.max(-1, Math.min(1, Pc[2] / r3))) : 0;
      var q = project(Pc, f, W, H);
      $('pin-xc').textContent = '(' + fmt(Pc[0], 2) + ', ' + fmt(Pc[1], 2) + ', ' + fmt(Pc[2], 2) + ') m';
      $('pin-theta').textContent = fmt(th * R2D, 1) + '°';
      var uv = $('pin-uv');
      if (!q) {
        uv.innerHTML = '';
        var s = document.createElement('span'); s.className = 'w-warn';
        s.textContent = model === 'pin' ? 'not projectable (Z_c ≤ 0)' : 'outside the 105° image circle';
        uv.appendChild(s);
      } else {
        var inside = q[0] >= 0 && q[0] <= W && q[1] >= 0 && q[1] <= H;
        uv.textContent = '(' + fmt(q[0], 1) + ', ' + fmt(q[1], 1) + ')' + (inside ? '' : ' off-image');
        ctx.fillStyle = tok('--chart-2');
        ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = tok('--bg-elev'); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
      ctx.fillStyle = tok('--fg-muted'); ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(model === 'pin' ? 'pinhole: u = f·X/Z + cx' : 'equidistant fisheye: r = f·θ (to 105°)', 10, 18);
    }
    function setModel(m) { model = m; bPin.setAttribute('aria-pressed', m === 'pin'); bFish.setAttribute('aria-pressed', m === 'fish'); draw(); }
    bPin.addEventListener('click', function () { setModel('pin'); });
    bFish.addEventListener('click', function () { setModel('fish'); });
    [fEl, yawEl, xEl, yEl, zEl].forEach(function (el) { el.addEventListener('input', draw); });
    redrawers.push(draw); draw();
  });

  /* =============================================================
     3. Triangulation and noise
     ============================================================= */
  safe('triang', function () {
    var c = $('tri-canvas'); if (!c) return;
    var bEl = $('tri-b'), zEl = $('tri-z'), sEl = $('tri-s');
    var BMIN = 0.01, BMAX = 10;
    function sl2b(v) { return BMIN * Math.pow(BMAX / BMIN, v / 1000); }
    function b2sl(b) { return Math.round(Math.log(b / BMIN) / Math.log(BMAX / BMIN) * 1000); }
    var seed = 12345;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function gauss() { var u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    var pts = [], noise = [];
    function resample() { noise = []; for (var i = 0; i < 400; i++) noise.push([gauss(), gauss()]); }
    function triangulate(B, Z, sth, n) {
      // cameras at (-B/2,0), (B/2,0); true point (0,Z)
      var c1 = [-B / 2, 0], c2 = [B / 2, 0];
      var a1 = Math.atan2(B / 2, Z) + n[0] * sth;   // angle from +y axis, positive toward +x
      var a2 = Math.atan2(-B / 2, Z) + n[1] * sth;
      var d1 = [Math.sin(a1), Math.cos(a1)], d2 = [Math.sin(a2), Math.cos(a2)];
      // solve c1 + t d1 = c2 + s d2
      var det = d1[0] * (-d2[1]) - d1[1] * (-d2[0]);
      if (Math.abs(det) < 1e-15) return null;
      var rx = c2[0] - c1[0], ry = c2[1] - c1[1];
      var t = (rx * (-d2[1]) - ry * (-d2[0])) / det;
      if (t <= 0) return null;
      return [c1[0] + t * d1[0], c1[1] + t * d1[1]];
    }
    function draw() {
      var B = sl2b(num(bEl, 0, 1000, 788)), Z = num(zEl, 0.5, 20, 5), spx = num(sEl, 0.1, 3, 0.5);
      var sth = spx / PXDEG_NATIVE * D2R;
      $('tri-b-out').textContent = B < 1 ? fmt(B * 100, 1) + ' cm' : fmt(B, 2) + ' m';
      $('tri-z-out').textContent = fmt(Z, 1) + ' m';
      $('tri-s-out').textContent = fmt(spx, 2) + ' px';
      pts = [];
      var fails = 0;
      noise.forEach(function (n) { var p = triangulate(B, Z, sth, n); if (p && p[1] < Z * 50) pts.push(p); else fails++; });
      var mz = 0, mx = 0; pts.forEach(function (p) { mz += p[1]; mx += p[0]; }); mz /= Math.max(1, pts.length); mx /= Math.max(1, pts.length);
      var vz = 0; pts.forEach(function (p) { vz += (p[1] - mz) * (p[1] - mz); }); var sz = Math.sqrt(vz / Math.max(1, pts.length - 1));
      var approx = Z * Z * sth / B;
      function len(m) { return m < 0.01 ? fmt(m * 1000, 2) + ' mm' : m < 1 ? fmt(m * 100, 2) + ' cm' : fmt(m, 2) + ' m'; }
      $('tri-sth').textContent = fmt(sth * R2D, 4) + '° (' + fmt(sth * 1e3, 3) + ' mrad)';
      $('tri-mc').textContent = len(sz) + (fails ? ' (' + fails + ' rays diverged)' : '');
      $('tri-ap').textContent = len(approx);
      $('tri-ang').textContent = fmt(2 * Math.atan(B / 2 / Z) * R2D, 2) + '°';
      var g = setup(c), ctx = g.ctx, W = g.w, H = g.h;
      ctx.clearRect(0, 0, W, H);
      // main view: fit cameras and point
      var spanX = Math.max(B * 1.4, Z * 0.5), spanY = Z * 1.25;
      var sc = Math.min((W * 0.55) / spanX, (H - 40) / spanY);
      var ox = W * 0.3, oy = H - 24;
      function P(x, y) { return [ox + x * sc, oy - y * sc]; }
      ctx.strokeStyle = tok('--chart-grid');
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W * 0.6, oy); ctx.stroke();
      ctx.strokeStyle = rgba('--chart-1', 0.18);
      for (var i = 0; i < 40 && i < noise.length; i++) {
        var n = noise[i];
        var a1 = Math.atan2(B / 2, Z) + n[0] * sth * 30, a2 = Math.atan2(-B / 2, Z) + n[1] * sth * 30; // exaggerated x30 for visibility
        var L = Z * 1.2;
        var p0 = P(-B / 2, 0), p1 = P(-B / 2 + L * Math.sin(a1), L * Math.cos(a1));
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        p0 = P(B / 2, 0); p1 = P(B / 2 + L * Math.sin(a2), L * Math.cos(a2));
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      [[-B / 2, 0], [B / 2, 0]].forEach(function (cc) { var p = P(cc[0], cc[1]); ctx.fillStyle = tok('--chart-1'); ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 2 * Math.PI); ctx.fill(); });
      var tp = P(0, Z); ctx.fillStyle = tok('--fg'); ctx.beginPath(); ctx.arc(tp[0], tp[1], 4, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif'; ctx.fillStyle = tok('--fg-muted');
      ctx.fillText('top view; rays drawn with noise ×30 for visibility', 8, 14);
      // inset: zoom on the scatter
      var ix = W * 0.62, iy = 20, iw = W * 0.36, ih = H - 60;
      ctx.strokeStyle = tok('--border-strong'); ctx.strokeRect(ix, iy, iw, ih);
      var ext = Math.max(4 * sz, 4 * approx, 1e-6);
      var isc = (ih / 2) / ext;
      function IP(x, y) { return [ix + iw / 2 + x * isc, iy + ih / 2 - (y - Z) * isc]; }
      ctx.fillStyle = rgba('--chart-2', 0.55);
      pts.forEach(function (p) { var q = IP(p[0], p[1]); if (q[0] > ix && q[0] < ix + iw && q[1] > iy && q[1] < iy + ih) ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); });
      var q0 = IP(0, Z); ctx.fillStyle = tok('--fg'); ctx.beginPath(); ctx.arc(q0[0], q0[1], 3.5, 0, 2 * Math.PI); ctx.fill();
      // ±σ bracket
      ctx.strokeStyle = tok('--chart-2'); ctx.setLineDash([3, 3]);
      var a = IP(0, mz - sz), b2 = IP(0, mz + sz);
      ctx.beginPath(); ctx.moveTo(ix + 6, a[1]); ctx.lineTo(ix + iw - 6, a[1]); ctx.moveTo(ix + 6, b2[1]); ctx.lineTo(ix + iw - 6, b2[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = tok('--fg-muted');
      ctx.fillText('inset: ±' + len(ext) + ' around the point (±1σ_Z dashed)', ix, iy + ih + 16);
    }
    function preset(b, z, s) { bEl.value = b2sl(b); zEl.value = z; sEl.value = s; draw(); }
    $('tri-pre-lens').addEventListener('click', function () { preset(0.03, 5, 0.5); });
    $('tri-pre-motion').addEventListener('click', function () { preset(3, 5, 0.5); });
    $('tri-resample').addEventListener('click', function () { resample(); draw(); });
    [bEl, zEl, sEl].forEach(function (el) { el.addEventListener('input', draw); });
    bEl.value = b2sl(3);
    resample();
    redrawers.push(draw); draw();
  });

  /* =============================================================
     4. ERP <-> cubemap
     ============================================================= */
  safe('erp', function () {
    var c = $('erp-canvas'); if (!c) return;
    var cc = $('cube-canvas'), dc = $('erp-dens');
    var probe = { lon: 30 * D2R, lat: 20 * D2R };
    var FACES = ['front (+Z)', 'right (+X)', 'back (−Z)', 'left (−X)', 'up (−Y)', 'down (+Y)'];
    var FCOL = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];
    function dirOf(lon, lat) { return [Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon)]; }
    function faceOf(b) {
      var ax = Math.abs(b[0]), ay = Math.abs(b[1]), az = Math.abs(b[2]);
      var f, u, v; // u right, v down in face image
      if (az >= ax && az >= ay) {
        if (b[2] > 0) { f = 0; u = b[0] / az; v = b[1] / az; } else { f = 2; u = -b[0] / az; v = b[1] / az; }
      } else if (ax >= ay) {
        if (b[0] > 0) { f = 1; u = -b[2] / ax; v = b[1] / ax; } else { f = 3; u = b[2] / ax; v = b[1] / ax; }
      } else {
        if (b[1] < 0) { f = 4; u = b[0] / ay; v = b[2] / ay; } else { f = 5; u = b[0] / ay; v = -b[2] / ay; }
      }
      return { f: f, u: (u + 1) / 2, v: (v + 1) / 2 };
    }
    var cacheKey = '', cacheImg = null;
    function erpBase(W, H) {
      var key = W + 'x' + H + FCOL.map(tok).join() + tok('--bg-sunk');
      if (key === cacheKey && cacheImg) return cacheImg;
      var off = document.createElement('canvas'); off.width = W; off.height = H;
      var octx = off.getContext('2d'); var img = octx.createImageData(W, H);
      var cols = FCOL.map(function (n) { return hexRgb(tok(n)); }), bg = hexRgb(tok('--bg-sunk'));
      for (var y = 0; y < H; y++) {
        var lat = (0.5 - (y + 0.5) / H) * Math.PI;
        for (var x = 0; x < W; x++) {
          var lon = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
          var fo = faceOf(dirOf(lon, lat)), col = cols[fo.f];
          var grid = (Math.abs(fo.u * 8 - Math.round(fo.u * 8)) < 0.035 || Math.abs(fo.v * 8 - Math.round(fo.v * 8)) < 0.035) ? 0.55 : 0.22;
          var o = (y * W + x) * 4;
          img.data[o] = bg[0] + (col[0] - bg[0]) * grid; img.data[o + 1] = bg[1] + (col[1] - bg[1]) * grid; img.data[o + 2] = bg[2] + (col[2] - bg[2]) * grid; img.data[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      cacheKey = key; cacheImg = off; return off;
    }
    function draw() {
      var g = setup(c), ctx = g.ctx, W = g.w, H = g.h;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(erpBase(360, 180), 0, 0, W, H);
      ctx.strokeStyle = rgba('--fg', 0.25); ctx.lineWidth = 1;
      for (var lo = -180; lo <= 180; lo += 30) { var x = (lo + 180) / 360 * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (var la = -60; la <= 60; la += 30) { var y = (90 - la) / 180 * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.strokeStyle = tok('--hot'); ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif'; ctx.fillStyle = tok('--fg');
      ctx.fillText('zenith = up-lens centre', 6, 14); ctx.fillText('nadir = down-lens centre', 6, H - 6);
      var px = (probe.lon + Math.PI) / (2 * Math.PI) * W, py = (Math.PI / 2 - probe.lat) / Math.PI * H;
      ctx.strokeStyle = tok('--fg'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke(); ctx.lineWidth = 1;
      var b = dirOf(probe.lon, probe.lat), fo = faceOf(b);
      $('erp-ll').textContent = fmt(probe.lon * R2D, 1) + '°, ' + fmt(probe.lat * R2D, 1) + '°';
      $('erp-px').textContent = '(' + fmt(7680 / (2 * Math.PI) * (probe.lon + Math.PI), 0) + ', ' + fmt(3840 / Math.PI * (Math.PI / 2 - probe.lat), 0) + ')';
      $('erp-face').textContent = FACES[fo.f];
      $('erp-fpx').textContent = '(' + fmt(fo.u * 1920, 0) + ', ' + fmt(fo.v * 1920, 0) + ')';
      var cl = Math.cos(probe.lat);
      $('erp-over').textContent = cl < 1e-3 ? '> 1000×' : fmt(1 / cl, 2) + '×';
      // cubemap cross
      var g2 = setup(cc), x2 = g2.ctx, CW = g2.w, CH = g2.h;
      x2.clearRect(0, 0, CW, CH);
      var s = Math.min(CW / 4, CH / 3);
      var ox = (CW - 4 * s) / 2, oy = (CH - 3 * s) / 2;
      var pos = { 0: [1, 1], 1: [2, 1], 2: [3, 1], 3: [0, 1], 4: [1, 0], 5: [1, 2] };
      for (var f = 0; f < 6; f++) {
        var p = pos[f], fx = ox + p[0] * s, fy = oy + p[1] * s;
        x2.fillStyle = rgba(FCOL[f], f === fo.f ? 0.45 : 0.16); x2.fillRect(fx, fy, s, s);
        x2.strokeStyle = tok('--border-strong'); x2.strokeRect(fx + 0.5, fy + 0.5, s - 1, s - 1);
        x2.fillStyle = tok('--fg'); x2.font = '11px "IBM Plex Sans", system-ui, sans-serif';
        x2.fillText(FACES[f].split(' ')[0], fx + 5, fy + 14);
      }
      var pp = pos[fo.f];
      var mx = ox + pp[0] * s + fo.u * s, my = oy + pp[1] * s + fo.v * s;
      x2.strokeStyle = tok('--fg'); x2.lineWidth = 2; x2.beginPath(); x2.arc(mx, my, 6, 0, 2 * Math.PI); x2.stroke(); x2.lineWidth = 1;
      // density plot
      var g3 = setup(dc), x3 = g3.ctx, DW = g3.w, DH = g3.h;
      x3.clearRect(0, 0, DW, DH);
      var L = 36, R = DW - 10, T = 10, B = DH - 26, YM = 6;
      x3.font = '10.5px "IBM Plex Sans", system-ui, sans-serif'; x3.fillStyle = tok('--fg-muted');
      [1, 2, 4, 6].forEach(function (v) { var y = B - (v - 1) / (YM - 1) * (B - T); x3.strokeStyle = tok('--chart-grid'); x3.beginPath(); x3.moveTo(L, y); x3.lineTo(R, y); x3.stroke(); x3.textAlign = 'right'; x3.fillText(v + '×', L - 4, y + 3); });
      [-90, -45, 0, 45, 90].forEach(function (v) { var x = L + (v + 90) / 180 * (R - L); x3.textAlign = 'center'; x3.fillText(v + '°', x, B + 13); });
      axes(x3, L, B, R, T);
      x3.textAlign = 'center'; x3.fillText('latitude θ → ERP oversampling 1/cos θ', (L + R) / 2, DH - 2);
      x3.strokeStyle = tok('--chart-1'); x3.lineWidth = 2; x3.beginPath();
      var started = false;
      for (var k = 0; k <= 180; k++) {
        var la2 = (-90 + k) * D2R, v2 = 1 / Math.max(1e-6, Math.cos(la2));
        if (v2 > YM) { started = false; continue; }
        var xx = L + k / 180 * (R - L), yy = B - (v2 - 1) / (YM - 1) * (B - T);
        if (started) x3.lineTo(xx, yy); else { x3.moveTo(xx, yy); started = true; }
      }
      x3.stroke(); x3.lineWidth = 1;
      var ov = 1 / Math.max(1e-6, cl);
      var xx2 = L + (probe.lat * R2D + 90) / 180 * (R - L), yy2 = B - (Math.min(ov, YM) - 1) / (YM - 1) * (B - T);
      x3.fillStyle = tok('--chart-2'); x3.beginPath(); x3.arc(xx2, yy2, 4.5, 0, 2 * Math.PI); x3.fill();
    }
    function setFrom(e) {
      var p = canvasPos(c, e);
      probe.lon = Math.max(-Math.PI, Math.min(Math.PI, (p.x / c._lw) * 2 * Math.PI - Math.PI));
      probe.lat = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, (0.5 - p.y / c._lh) * Math.PI));
      draw();
    }
    c.addEventListener('pointermove', setFrom);
    c.addEventListener('pointerdown', setFrom);
    c.addEventListener('keydown', function (e) {
      var st = 5 * D2R, used = true;
      if (e.key === 'ArrowLeft') probe.lon -= st; else if (e.key === 'ArrowRight') probe.lon += st;
      else if (e.key === 'ArrowUp') probe.lat += st; else if (e.key === 'ArrowDown') probe.lat -= st; else used = false;
      if (used) {
        e.preventDefault();
        if (probe.lon > Math.PI) probe.lon -= 2 * Math.PI; if (probe.lon < -Math.PI) probe.lon += 2 * Math.PI;
        probe.lat = Math.max(-Math.PI / 2 + 1e-4, Math.min(Math.PI / 2 - 1e-4, probe.lat));
        draw();
      }
    });
    redrawers.push(draw); draw();
  });

  /* =============================================================
     5. Direction-dependent blur
     ============================================================= */
  safe('blur', function () {
    var cu = $('blur-up'); if (!cu) return;
    var cd = $('blur-down');
    var yawEl = $('blur-yaw'), pitEl = $('blur-pitch'), vEl = $('blur-v'), hEl = $('blur-h'), tEl = $('blur-t');
    var THMAX = 105, RES = 110, THR = 2;
    // body frame: x forward, y left, z up
    function depth(r, h) {
      var ts = [];
      if (r[2] < -1e-9) ts.push(-h / r[2]);
      if (r[2] > 1e-9) ts.push(1.5 / r[2]);
      if (Math.abs(r[1]) > 1e-9) ts.push(3 / Math.abs(r[1]));
      if (Math.abs(r[0]) > 1e-9) ts.push(15 / Math.abs(r[0]));
      return Math.min.apply(null, ts.length ? ts : [1e9]);
    }
    function blurPx(r, p) {
      var w = p.w, v = p.v;
      var cx = w[1] * r[2] - w[2] * r[1], cy = w[2] * r[0] - w[0] * r[2], cz = w[0] * r[1] - w[1] * r[0];
      var d = depth(r, p.h);
      var vr = v[0] * r[0] + v[1] * r[1] + v[2] * r[2];
      var tx = (v[0] - vr * r[0]) / d, ty = (v[1] - vr * r[1]) / d, tz = (v[2] - vr * r[2]) / d;
      var rd = Math.hypot(cx + tx, cy + ty, cz + tz);
      return PXDEG_NATIVE * R2D * rd * p.t;
    }
    function dirLens(up, th, az) {
      var s = Math.sin(th);
      return up ? [s * Math.cos(az), s * Math.sin(az), Math.cos(th)] : [s * Math.cos(az), -s * Math.sin(az), -Math.cos(th)];
    }
    var lastImgs = {};
    function renderDisc(canvas, up, p, ramp, maxv) {
      var g = setup(canvas), ctx = g.ctx, W = g.w, H = g.h;
      ctx.clearRect(0, 0, W, H);
      var off = document.createElement('canvas'); off.width = RES; off.height = RES;
      var o = off.getContext('2d'), img = o.createImageData(RES, RES);
      for (var y = 0; y < RES; y++) for (var x = 0; x < RES; x++) {
        var dx = (x + 0.5) / RES * 2 - 1, dy = (y + 0.5) / RES * 2 - 1, rr = Math.hypot(dx, dy);
        var k = (y * RES + x) * 4;
        if (rr > 1) { img.data[k + 3] = 0; continue; }
        var th = rr * THMAX * D2R, az = Math.atan2(-dy, dx);
        var b = blurPx(dirLens(up, th, az), p);
        var t = Math.min(1, b / maxv), col = ramp(t);
        if (Math.abs(b - THR) < maxv * 0.012) col = hexRgb(tok('--hot'));
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
      o.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.strokeStyle = tok('--fg'); ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(W / 2, H / 2, (90 / THMAX) * W / 2, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = tok('--fg'); ctx.font = '10px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText('fwd →', W - 38, H / 2 - 4);
    }
    function draw() {
      var p = {
        w: [0, num(pitEl, 0, 60, 0) * D2R, num(yawEl, 0, 60, 30) * D2R],
        v: [num(vEl, 0, 1.5, 0), 0, 0],
        h: num(hEl, 0.6, 2.5, 1.3),
        t: parseFloat(tEl.value) || 0.01
      };
      $('blur-yaw-out').textContent = fmt(p.w[2] * R2D, 0) + '°/s';
      $('blur-pitch-out').textContent = fmt(p.w[1] * R2D, 0) + '°/s';
      $('blur-v-out').textContent = fmt(p.v[0], 2) + ' m/s';
      $('blur-h-out').textContent = fmt(p.h, 2) + ' m';
      var s0 = hexRgb(tok('--seq-0')), s1 = hexRgb(tok('--seq-1')), s2 = hexRgb(tok('--seq-2')), s3 = hexRgb(tok('--seq-3'));
      function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
      function ramp(t) { return t < 1 / 3 ? lerp(s0, s1, t * 3) : t < 2 / 3 ? lerp(s1, s2, t * 3 - 1) : lerp(s2, s3, t * 3 - 2); }
      // stats
      var rings = [['centre θ<60°', 0, 60], ['mid 60–85°', 60, 85], ['rim 85–105°', 85, 105]];
      var ringItems = [], maxv = 0.5;
      var faceSum = [0, 0, 0, 0, 0, 0], faceN = [0, 0, 0, 0, 0, 0];
      [true, false].forEach(function (up) {
        rings.forEach(function (rg) {
          var sum = 0, n = 0;
          for (var th = rg[1] + 1; th < rg[2]; th += 2) for (var az = 0; az < 360; az += 6) {
            var w = Math.sin(th * D2R);
            var bb = blurPx(dirLens(up, th * D2R, az * D2R), p); sum += bb * w; n += w; if (bb > maxv) maxv = bb;
          }
          ringItems.push({ label: (up ? 'up ' : 'down ') + rg[0], value: sum / n });
        });
      });
      // cube faces from sphere samples
      for (var la = -89; la < 90; la += 2) for (var lo = 0; lo < 360; lo += 4) {
        var r = [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
        var ax = Math.abs(r[0]), ay = Math.abs(r[1]), az2 = Math.abs(r[2]);
        var f = az2 >= ax && az2 >= ay ? (r[2] > 0 ? 4 : 5) : ax >= ay ? (r[0] > 0 ? 0 : 1) : (r[1] > 0 ? 2 : 3);
        var wgt = Math.cos(la * D2R);
        faceSum[f] += blurPx(r, p) * wgt; faceN[f] += wgt;
      }
      var faceNames = ['front', 'back', 'left', 'right', 'up (ceiling)', 'down (floor)'];
      var faceItems = faceNames.map(function (n, i) { return { label: n, value: faceSum[i] / faceN[i] }; });
      var scale = Math.max(maxv, THR * 1.5);
      renderDisc(cu, true, p, ramp, scale);
      renderDisc(cd, false, p, ramp, scale);
      var bmax = Math.max(THR * 1.5, Math.max.apply(null, ringItems.concat(faceItems).map(function (i) { return i.value; })));
      bars($('blur-rings'), ringItems.map(function (i) { i.text = fmt(i.value, 1) + ' px'; return i; }), bmax, THR);
      bars($('blur-faces'), faceItems.map(function (i) { i.text = fmt(i.value, 1) + ' px'; return i; }), bmax, THR);
      var lg = $('blur-legend'); lg.innerHTML = '';
      var a = document.createElement('span'); a.innerHTML = '<i style="background:var(--seq-0)"></i>0 px';
      var b2 = document.createElement('span'); b2.innerHTML = '<i style="background:var(--seq-3)"></i>' + fmt(scale, 1) + ' px';
      var c2 = document.createElement('span'); c2.innerHTML = '<i style="background:var(--hot)"></i>2 px contour';
      var d2 = document.createElement('span'); d2.textContent = 'dashed ring: 90° (horizon / seam)';
      [a, b2, c2, d2].forEach(function (x) { lg.appendChild(x); });
    }
    [yawEl, pitEl, vEl, hEl, tEl].forEach(function (el) { el.addEventListener('input', draw); el.addEventListener('change', draw); });
    redrawers.push(draw); draw();
  });

  /* =============================================================
     6. Scale & checkpoint calculator
     ============================================================= */
  safe('scale', function () {
    var tb = document.querySelector('#scale-table tbody'); if (!tb) return;
    var SAMPLE = [
      ['M1–M2', 8.412, 3.1271, 'control'], ['M2–M5', 12.035, 4.4720, 'control'], ['M3–M7', 21.660, 8.0571, 'control'],
      ['M5–M9', 9.884, 3.6738, 'control'], ['M1–M4', 6.205, 2.3089, 'checkpoint'], ['M4–M8', 24.318, 9.0302, 'checkpoint'],
      ['M6–M9', 4.977, 1.8519, 'checkpoint']
    ];
    function addRow(r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="text" aria-label="Line name" style="width:6em"></td>' +
        '<td><input type="number" step="0.001" min="0" aria-label="Measured distance in metres"></td>' +
        '<td><input type="number" step="0.0001" min="0" aria-label="Model distance in model units"></td>' +
        '<td><select aria-label="Role"><option value="control">control</option><option value="checkpoint">checkpoint</option></select></td>' +
        '<td class="res"></td><td class="pct"></td><td><button class="w-btn" aria-label="Remove row">×</button></td>';
      var ins = tr.querySelectorAll('input'), sel = tr.querySelector('select');
      ins[0].value = r[0]; ins[1].value = r[1]; ins[2].value = r[2]; sel.value = r[3];
      tr.querySelector('button').addEventListener('click', function () { tr.parentNode.removeChild(tr); calc(); });
      tr.addEventListener('input', calc); tr.addEventListener('change', calc);
      tb.appendChild(tr);
    }
    function calc() {
      var rows = [], bad = 0;
      Array.prototype.forEach.call(tb.rows, function (tr) {
        var ins = tr.querySelectorAll('input');
        var m = parseFloat(ins[1].value), r = parseFloat(ins[2].value);
        var ok1 = isFinite(m) && m > 0, ok2 = isFinite(r) && r > 0;
        ins[1].setAttribute('aria-invalid', ok1 ? 'false' : 'true');
        ins[2].setAttribute('aria-invalid', ok2 ? 'false' : 'true');
        if (!ok1 || !ok2) { bad++; tr.querySelector('.res').textContent = '–'; tr.querySelector('.pct').textContent = '–'; return; }
        rows.push({ tr: tr, m: m, r: r, role: tr.querySelector('select').value });
      });
      var ctrl = rows.filter(function (x) { return x.role === 'control'; });
      var err = $('scale-err');
      err.textContent = bad ? bad + ' row(s) ignored: distances must be positive numbers.' : '';
      if (!ctrl.length) {
        err.textContent += (err.textContent ? ' ' : '') + 'Mark at least one row as control to fix the scale.';
        ['scale-s', 'scale-crmse', 'scale-krmse', 'scale-kmax', 'scale-glob'].forEach(function (id) { $(id).textContent = '–'; });
        rows.forEach(function (x) { x.tr.querySelector('.res').textContent = '–'; x.tr.querySelector('.pct').textContent = '–'; });
        return;
      }
      var num_ = 0, den = 0; ctrl.forEach(function (x) { num_ += x.m * x.r; den += x.r * x.r; });
      var s = num_ / den;
      var cs = 0, ks = 0, kn = 0, kmax = null, globOk = true, globN = 0;
      rows.forEach(function (x) {
        var e = s * x.r - x.m;
        x.tr.querySelector('.res').textContent = (e >= 0 ? '+' : '') + fmt(e * 100, 2);
        x.tr.querySelector('.pct').textContent = (e >= 0 ? '+' : '') + fmt(e / x.m * 100, 3);
        if (x.role === 'control') cs += e * e;
        else {
          ks += e * e; kn++;
          if (!kmax || Math.abs(e) > Math.abs(kmax.e)) kmax = { e: e, m: x.m };
          if (x.m > 20) { globN++; if (Math.abs(e / x.m) > 0.01) globOk = false; }
        }
      });
      $('scale-s').textContent = fmt(s, 5) + ' m / unit';
      $('scale-crmse').textContent = fmt(Math.sqrt(cs / ctrl.length) * 100, 2) + ' cm (n=' + ctrl.length + ')';
      $('scale-krmse').textContent = kn ? fmt(Math.sqrt(ks / kn) * 100, 2) + ' cm (n=' + kn + ')' : 'no checkpoints';
      $('scale-kmax').textContent = kmax ? fmt(kmax.e * 100, 2) + ' cm (' + fmt(kmax.e / kmax.m * 100, 3) + '%)' : '–';
      var gl = $('scale-glob'); gl.innerHTML = '';
      var sp = document.createElement('span');
      if (!globN) { sp.textContent = 'no checkpoint > 20 m'; }
      else { sp.className = globOk ? 'w-ok' : 'w-warn'; sp.textContent = globOk ? 'yes (' + globN + ' lines)' : 'no'; }
      gl.appendChild(sp);
    }
    function sample() { tb.innerHTML = ''; SAMPLE.forEach(addRow); calc(); }
    $('scale-add').addEventListener('click', function () { addRow(['new', '', '', 'checkpoint']); calc(); });
    $('scale-sample').addEventListener('click', sample);
    sample();
    // propagation
    var nEl = $('sp-n'), lEl = $('sp-l'), pEl = $('sp-p');
    function prop() {
      var N = num(nEl, 1, 40, 10), L = num(lEl, 1, 40, 10), sp_ = num(pEl, 0.5, 10, 3) / 1000;
      $('sp-n-out').textContent = fmt(N, 0); $('sp-l-out').textContent = fmt(L, 1) + ' m'; $('sp-p-out').textContent = fmt(sp_ * 1000, 1) + ' mm';
      var ss = Math.SQRT2 * sp_ / (L * Math.sqrt(N));
      $('sp-s').textContent = fmt(ss * 100, 4) + '%';
      $('sp-100').textContent = fmt(ss * 100 * 100, 2) + ' cm';
    }
    [nEl, lEl, pEl].forEach(function (el) { el.addEventListener('input', prop); });
    prop();
  });

  /* =============================================================
     7. 2D Gaussian splatting toy
     ============================================================= */
  safe('splat', function () {
    var tc = $('splat-target'); if (!tc) return;
    var rc = $('splat-render'), lc = $('splat-loss');
    var S = 64, NPX = S * S;
    var target = new Float32Array(NPX * 3);
    var G = [], it = 0, running = false, hist = [], raf = 0;
    function makeTarget() {
      var off = document.createElement('canvas'); off.width = S; off.height = S;
      var x = off.getContext('2d', { willReadFrequently: true });
      // fixed, theme-independent "scene" colours (they are image data, not UI chrome)
      var col = function (r, g, b) { return 'rgb(' + r + ',' + g + ',' + b + ')'; };
      x.fillStyle = col(46, 50, 56); x.fillRect(0, 0, S, S);                 // dark ceiling/walls
      x.fillStyle = col(120, 122, 118); x.beginPath(); x.moveTo(0, 64); x.lineTo(64, 64); x.lineTo(44, 34); x.lineTo(20, 34); x.closePath(); x.fill(); // floor
      x.fillStyle = col(212, 180, 40); x.beginPath(); x.moveTo(30, 64); x.lineTo(34, 64); x.lineTo(32.6, 34); x.lineTo(31.4, 34); x.closePath(); x.fill(); // lane line
      x.fillStyle = col(150, 150, 146); x.fillRect(8, 8, 8, 44); x.fillRect(48, 8, 8, 44);   // pillars
      x.fillStyle = col(60, 170, 90); x.fillRect(26, 10, 12, 6);                              // exit sign
      x.fillStyle = col(230, 230, 220); x.fillRect(18, 3, 28, 2);                             // lamp
      x.fillStyle = col(170, 40, 40); x.beginPath(); x.ellipse(49, 50, 9, 5, 0, 0, 2 * Math.PI); x.fill(); // car
      var d = x.getImageData(0, 0, S, S).data;
      for (var i = 0; i < NPX; i++) { target[i * 3] = d[i * 4] / 255; target[i * 3 + 1] = d[i * 4 + 1] / 255; target[i * 3 + 2] = d[i * 4 + 2] / 255; }
      var tx = tc.getContext('2d'); tx.putImageData(x.getImageData(0, 0, S, S), 0, 0);
    }
    var seed = 7;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    function newG(x, y, l, col) {
      return { p: [x, y, Math.log(l), Math.log(l), 0, col[0], col[1], col[2]], m: new Float32Array(8), v: new Float32Array(8), g: new Float32Array(8), acc: 0 };
    }
    function reset() {
      seed = 7; it = 0; hist = []; G = [];
      var n = Math.round(num($('splat-n'), 4, 120, 24));
      for (var i = 0; i < n; i++) {
        var x = rnd() * S, y = rnd() * S, k = (Math.floor(y) * S + Math.floor(x)) * 3;
        G.push(newG(x, y, 1 / 5, [target[k] * 0.5, target[k + 1] * 0.5, target[k + 2] * 0.5]));
      }
      render(); stats();
    }
    var img = new Float32Array(NPX * 3);
    function bbox(q) {
      var l11 = Math.exp(q[2]), l22 = Math.exp(q[3]), l21 = q[4];
      // A = L L^T ; Sigma = A^-1
      var a = l11 * l11, b = l11 * l21, c = l21 * l21 + l22 * l22, det = a * c - b * b;
      if (!(det > 1e-12)) return null;
      var sxx = c / det, syy = a / det;
      return [Math.sqrt(sxx) * 3, Math.sqrt(syy) * 3, sxx, syy, -b / det];
    }
    function forward() {
      img.fill(0);
      for (var gi = 0; gi < G.length; gi++) {
        var q = G[gi].p, bb = bbox(q); if (!bb) continue;
        var l11 = Math.exp(q[2]), l22 = Math.exp(q[3]), l21 = q[4];
        var x0 = Math.max(0, Math.floor(q[0] - bb[0])), x1 = Math.min(S - 1, Math.ceil(q[0] + bb[0]));
        var y0 = Math.max(0, Math.floor(q[1] - bb[1])), y1 = Math.min(S - 1, Math.ceil(q[1] + bb[1]));
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
          var dx = x + 0.5 - q[0], dy = y + 0.5 - q[1];
          var u = l11 * dx + l21 * dy, w = l22 * dy, e = Math.exp(-0.5 * (u * u + w * w));
          var k = (y * S + x) * 3; img[k] += q[5] * e; img[k + 1] += q[6] * e; img[k + 2] += q[7] * e;
        }
      }
    }
    function mse() { var s = 0; for (var i = 0; i < NPX * 3; i++) { var d = img[i] - target[i]; s += d * d; } return s / (NPX * 3); }
    var LR = [0.25, 0.25, 0.03, 0.03, 0.03, 0.02, 0.02, 0.02];
    function step() {
      forward();
      var inv = 2 / (NPX * 3);
      for (var gi = 0; gi < G.length; gi++) {
        var Gg = G[gi], q = Gg.p, gr = Gg.g, bb = bbox(q); gr.fill(0); if (!bb) continue;
        var l11 = Math.exp(q[2]), l22 = Math.exp(q[3]), l21 = q[4];
        var x0 = Math.max(0, Math.floor(q[0] - bb[0])), x1 = Math.min(S - 1, Math.ceil(q[0] + bb[0]));
        var y0 = Math.max(0, Math.floor(q[1] - bb[1])), y1 = Math.min(S - 1, Math.ceil(q[1] + bb[1]));
        for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
          var dx = x + 0.5 - q[0], dy = y + 0.5 - q[1];
          var u = l11 * dx + l21 * dy, w = l22 * dy, e = Math.exp(-0.5 * (u * u + w * w));
          var k = (y * S + x) * 3;
          var r0 = (img[k] - target[k]) * inv, r1 = (img[k + 1] - target[k + 1]) * inv, r2 = (img[k + 2] - target[k + 2]) * inv;
          gr[5] += r0 * e; gr[6] += r1 * e; gr[7] += r2 * e;
          var gq = (r0 * q[5] + r1 * q[6] + r2 * q[7]) * (-0.5 * e); // dL/dq
          gr[0] += gq * (-2 * u * l11);
          gr[1] += gq * (-2 * u * l21 - 2 * w * l22);
          gr[2] += gq * (2 * u * dx) * l11;
          gr[3] += gq * (2 * w * dy) * l22;
          gr[4] += gq * (2 * u * dy);
        }
        Gg.acc += Math.hypot(gr[0], gr[1]);
        var t = it + 1;
        for (var j = 0; j < 8; j++) {
          Gg.m[j] = 0.9 * Gg.m[j] + 0.1 * gr[j];
          Gg.v[j] = 0.999 * Gg.v[j] + 0.001 * gr[j] * gr[j];
          var mh = Gg.m[j] / (1 - Math.pow(0.9, t)), vh = Gg.v[j] / (1 - Math.pow(0.999, t));
          q[j] -= LR[j] * mh / (Math.sqrt(vh) + 1e-8);
        }
        q[0] = Math.max(-2, Math.min(S + 2, q[0])); q[1] = Math.max(-2, Math.min(S + 2, q[1]));
        q[2] = Math.max(Math.log(0.04), Math.min(Math.log(3), q[2])); q[3] = Math.max(Math.log(0.04), Math.min(Math.log(3), q[3]));
        q[4] = Math.max(-3, Math.min(3, q[4]));
      }
      it++;
      if ($('splat-dens').checked && it % 60 === 0) densify();
      if (it % 5 === 0) { var m = mse(); hist.push(m > 0 ? 10 * Math.log10(1 / m) : 60); if (hist.length > 400) hist.shift(); }
    }
    function densify() {
      var cap = Math.round(num($('splat-cap'), 10, 400, 200));
      // prune near-transparent
      G = G.filter(function (g) { return Math.max(Math.abs(g.p[5]), Math.abs(g.p[6]), Math.abs(g.p[7])) > 0.01; });
      var cand = G.slice().sort(function (a, b) { return b.acc - a.acc; });
      var room = cap - G.length, k = Math.min(room, Math.max(1, Math.round(G.length * 0.25)));
      for (var i = 0; i < k && i < cand.length; i++) {
        var g = cand[i], q = g.p, bb = bbox(q); if (!bb) continue;
        var big = Math.max(bb[0], bb[1]) / 3 > 2.0;
        if (big) { // split: two smaller Gaussians along the major axis
          var sx = Math.sqrt(bb[2]), sy = Math.sqrt(bb[3]), ox = bb[2] >= bb[3] ? sx * 0.6 : 0, oy = bb[2] >= bb[3] ? 0 : sy * 0.6;
          q[0] -= ox; q[1] -= oy; q[2] += Math.log(1.6); q[3] += Math.log(1.6); q[4] *= 1.6;
          var n = newG(q[0] + 2 * ox, q[1] + 2 * oy, 1, [q[5], q[6], q[7]]); n.p[2] = q[2]; n.p[3] = q[3]; n.p[4] = q[4];
          G.push(n);
        } else { // clone: copy, nudge along the gradient direction, halve colour of both
          q[5] *= 0.5; q[6] *= 0.5; q[7] *= 0.5;
          var gl = Math.hypot(g.g[0], g.g[1]) || 1;
          var n2 = newG(q[0] - g.g[0] / gl * 0.8, q[1] - g.g[1] / gl * 0.8, 1, [q[5], q[6], q[7]]); n2.p[2] = q[2]; n2.p[3] = q[3]; n2.p[4] = q[4];
          G.push(n2);
        }
      }
      G.forEach(function (g) { g.acc = 0; });
    }
    function render() {
      forward();
      var g = setup(rc), ctx = g.ctx, W = g.w;
      var off = document.createElement('canvas'); off.width = S; off.height = S;
      var o = off.getContext('2d'), id = o.createImageData(S, S);
      for (var i = 0; i < NPX; i++) {
        id.data[i * 4] = Math.max(0, Math.min(255, img[i * 3] * 255)); id.data[i * 4 + 1] = Math.max(0, Math.min(255, img[i * 3 + 1] * 255));
        id.data[i * 4 + 2] = Math.max(0, Math.min(255, img[i * 3 + 2] * 255)); id.data[i * 4 + 3] = 255;
      }
      o.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, W); ctx.drawImage(off, 0, 0, W, W);
      if ($('splat-ell').checked) {
        var sc = W / S; ctx.strokeStyle = rgba('--chart-1', 0.9); ctx.lineWidth = 1;
        G.forEach(function (gg) {
          var bb = bbox(gg.p); if (!bb) return;
          var a = bb[2], c = bb[3], b = bb[4];
          var tr = (a + c) / 2, dd = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
          var l1 = tr + dd, l2 = Math.max(1e-6, tr - dd), ang = 0.5 * Math.atan2(2 * b, a - c);
          ctx.beginPath(); ctx.ellipse(gg.p[0] * sc, gg.p[1] * sc, Math.sqrt(l1) * sc, Math.sqrt(l2) * sc, ang, 0, 2 * Math.PI); ctx.stroke();
        });
      }
      // loss
      var g2 = setup(lc), x2 = g2.ctx, LW = g2.w, LH = g2.h;
      x2.clearRect(0, 0, LW, LH);
      var lo = 10, hi = 35;
      x2.font = '10.5px "IBM Plex Sans", system-ui, sans-serif'; x2.fillStyle = tok('--fg-muted');
      [10, 20, 30].forEach(function (v) { var y = LH - 14 - (v - lo) / (hi - lo) * (LH - 24); x2.strokeStyle = tok('--chart-grid'); x2.beginPath(); x2.moveTo(36, y); x2.lineTo(LW - 6, y); x2.stroke(); x2.fillText(v + ' dB', 2, y + 3); });
      x2.fillText('PSNR over iterations', 40, LH - 2);
      if (hist.length > 1) {
        x2.strokeStyle = tok('--chart-1'); x2.lineWidth = 2; x2.beginPath();
        hist.forEach(function (v, i) { var x = 36 + i / Math.max(1, hist.length - 1) * (LW - 42), y = LH - 14 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (LH - 24); if (i) x2.lineTo(x, y); else x2.moveTo(x, y); });
        x2.stroke(); x2.lineWidth = 1;
      }
    }
    function stats() {
      $('splat-it').textContent = it; $('splat-cnt').textContent = G.length;
      var m = mse(); $('splat-psnr').textContent = m > 0 ? fmt(10 * Math.log10(1 / m), 2) + ' dB' : '–';
      $('splat-n-out').textContent = $('splat-n').value; $('splat-cap-out').textContent = $('splat-cap').value;
    }
    function loop() {
      if (!running) return;
      var t0 = performance.now();
      while (performance.now() - t0 < 18) step();
      render(); stats();
      if (it > 6000) { setRun(false); return; }
      raf = requestAnimationFrame(loop);
    }
    var runBtn = $('splat-run');
    function setRun(on) { running = on; runBtn.textContent = on ? 'Pause' : 'Run'; runBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } }
    runBtn.addEventListener('click', function () { setRun(!running); });
    $('splat-step').addEventListener('click', function () { for (var i = 0; i < 20; i++) step(); render(); stats(); });
    $('splat-reset').addEventListener('click', function () { setRun(false); reset(); });
    $('splat-n').addEventListener('input', function () { setRun(false); reset(); });
    $('splat-cap').addEventListener('input', stats);
    $('splat-ell').addEventListener('change', render);
    makeTarget(); reset();
    redrawers.push(function () { render(); });
    // pause when off-screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (ents) { ents.forEach(function (e) { if (!e.isIntersecting && running) setRun(false); }); }).observe(rc);
    }
    void reduceMotion; // animation starts only on explicit user action
  });

  /* =============================================================
     8. Option comparator (scores from §6.8.1)
     ============================================================= */
  safe('compare', function () {
    var box = $('cmp-controls'); if (!box) return;
    var CRIT = ['accuracy', 'visual_quality', 'robustness', 'effort', 'compute', 'maturity', 'novelty'];
    var LABEL = { accuracy: 'Accuracy', visual_quality: 'Visual quality', robustness: 'Robustness', effort: 'Effort (5 = least)', compute: 'Compute (5 = least)', maturity: 'Maturity', novelty: 'Novelty' };
    var OPTS = [
      { name: 'A: Rig + anchored fisheye splat', s: [4, 4, 4, 3, 3, 4, 2], proto: 48 },
      { name: 'B: Unified 2DGS surface', s: [3, 3, 3, 3, 4, 3, 3], proto: 35 },
      { name: 'B-fish: GOFish unified (NC)', s: [3, 5, 2, 3, 2, 1, 3], proto: 35 },
      { name: 'C: Fisheye-native research', s: [4, 4, 3, 1, 2, 1, 5], proto: 36 }
    ];
    var PRESETS = {
      equal: [1, 1, 1, 1, 1, 1, 1],
      accuracy: [5, 2, 4, 2, 1, 3, 0],
      visual: [2, 5, 3, 2, 1, 2, 1],
      research: [3, 3, 1, 1, 1, 0, 5]
    };
    var sliders = {};
    CRIT.forEach(function (k, i) {
      var lab = document.createElement('label');
      lab.innerHTML = '<span>' + LABEL[k] + '</span><output></output><input type="range" min="0" max="5" step="1">';
      var inp = lab.querySelector('input'); inp.value = PRESETS.accuracy[i]; inp.setAttribute('aria-label', 'Weight for ' + LABEL[k]);
      inp.addEventListener('input', draw);
      sliders[k] = inp; box.appendChild(lab);
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () { var p = PRESETS[b.getAttribute('data-preset')]; CRIT.forEach(function (k, i) { sliders[k].value = p[i]; }); draw(); });
    });
    function draw() {
      var w = CRIT.map(function (k) { return num(sliders[k], 0, 5, 1); });
      CRIT.forEach(function (k, i) { sliders[k].parentNode.querySelector('output').textContent = '×' + w[i]; });
      var tw = w.reduce(function (a, b) { return a + b; }, 0);
      var res = OPTS.map(function (o) {
        var sc = tw > 0 ? o.s.reduce(function (a, v, i) { return a + v * w[i]; }, 0) / tw : 0;
        return { o: o, sc: sc };
      }).sort(function (a, b) { return b.sc - a.sc; });
      var ol = $('cmp-rank'); ol.innerHTML = '';
      res.forEach(function (r, i) {
        var li = document.createElement('li');
        var pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = (i + 1) + '.';
        var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.o.name + ' ';
        var pr = document.createElement('span'); pr.className = 'w-sub'; pr.textContent = '(protocol ' + r.o.proto + '/55)'; nm.appendChild(pr);
        var sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = tw > 0 ? fmt(r.sc, 2) : '–';
        var trk = document.createElement('div'); trk.className = 'bar-track';
        var f = document.createElement('div'); f.className = 'bar-fill'; f.style.width = (r.sc / 5 * 100) + '%'; trk.appendChild(f);
        li.appendChild(pos); li.appendChild(nm); li.appendChild(sc); li.appendChild(document.createElement('span')); li.appendChild(trk);
        ol.appendChild(li);
      });
      $('cmp-note').textContent = tw > 0 ? 'Weighted mean of the 1–5 criterion scores (max 5).' : 'All weights are zero: set at least one weight above 0.';
    }
    draw();
  });

  document.addEventListener('a360-themechange', function () { redrawers.forEach(function (f) { safe('redraw', f); }); });
  var rt = null;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { redrawers.forEach(function (f) { safe('redraw', f); }); }, 150); });
})();
