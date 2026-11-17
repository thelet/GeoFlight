(function () {
  'use strict';
  var doc = document.documentElement;

  /* ---------- theme ---------- */
  var themeBtn = document.getElementById('theme-toggle');
  function isDark() {
    var t = doc.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function syncThemeBtn() {
    if (!themeBtn) return;
    var d = isDark();
    themeBtn.textContent = d ? 'Light' : 'Dark';
    themeBtn.setAttribute('aria-label', d ? 'Switch to light mode' : 'Switch to dark mode');
  }
  function fireTheme() {
    var ev;
    try { ev = new CustomEvent('a360-themechange'); } catch (e) { ev = document.createEvent('Event'); ev.initEvent('a360-themechange', false, false); }
    document.dispatchEvent(ev);
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      doc.setAttribute('data-theme', next);
      try { localStorage.setItem('a360-theme', next); } catch (e) { /* storage unavailable */ }
      syncThemeBtn();
      fireTheme();
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onMq = function () { if (!doc.getAttribute('data-theme')) { syncThemeBtn(); fireTheme(); } };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  syncThemeBtn();

  /* ---------- TOC: mobile toggle, scrollspy, progress ---------- */
  var toc = document.getElementById('toc');
  var tocBtn = document.getElementById('toc-toggle');
  function closeToc() { if (toc) toc.classList.remove('open'); if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false'); }
  if (tocBtn && toc) {
    tocBtn.addEventListener('click', function () {
      var open = !toc.classList.contains('open');
      toc.classList.toggle('open', open);
      tocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var a = toc.querySelector('a.active') || toc.querySelector('a'); if (a) a.focus(); }
    });
    toc.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) closeToc(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && toc.classList.contains('open')) { closeToc(); tocBtn.focus(); } });
  }
  var tocLinks = toc ? Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]')) : [];
  var targets = [];
  tocLinks.forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) targets.push({ a: a, el: el });
  });
  var bar = document.getElementById('progress-bar');
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY || doc.scrollTop;
    var h = doc.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
    var cur = null;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].el.getBoundingClientRect().top < 120) cur = targets[i]; else break;
    }
    tocLinks.forEach(function (a) { a.classList.remove('active'); });
    toc && toc.querySelectorAll('.toc-ch.open').forEach(function (li) { li.classList.remove('open'); });
    if (cur) {
      cur.a.classList.add('active');
      var li = cur.a.closest('.toc-ch');
      if (li) {
        li.classList.add('open');
        var top = li.querySelector(':scope > a'); if (top && top !== cur.a) top.classList.add('active');
      }
    }
  }
  // targets must be in document order
  targets.sort(function (p, q) { return p.el.compareDocumentPosition(q.el) & 4 ? -1 : 1; });
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener('resize', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } });
  onScroll();

  /* ---------- open <details> that contain a hash target ---------- */
  function revealHash() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    var d = el.closest && el.closest('details');
    while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
  }
  window.addEventListener('hashchange', revealHash);
  revealHash();

  /* ---------- glossary tooltips ---------- */
  var tip = document.getElementById('gloss-tip');
  var tipFor = null;
  function showTip(el) {
    var slug = el.getAttribute('data-g');
    var dt = document.getElementById(slug);
    if (!dt || !tip) return;
    var dd = dt.nextElementSibling;
    tip.innerHTML = '';
    var b = document.createElement('b'); b.textContent = dt.textContent; tip.appendChild(b);
    var body = document.createElement('div');
    body.innerHTML = dd ? dd.innerHTML : '';
    // tooltips should not carry duplicate ids
    Array.prototype.forEach.call(body.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    tip.appendChild(body);
    var more = document.createElement('a'); more.className = 'more'; more.href = '#' + slug; more.textContent = 'Open in glossary';
    tip.appendChild(more);
    tip.style.display = 'block';
    var r = el.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + doc.clientWidth - tw - 8));
    var top = r.bottom + window.scrollY + 6;
    if (r.bottom + th + 12 > window.innerHeight && r.top > th + 12) top = r.top + window.scrollY - th - 6;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    el.setAttribute('aria-describedby', 'gloss-tip');
    tipFor = el;
  }
  function hideTip() {
    if (!tip) return;
    tip.style.display = 'none';
    if (tipFor) tipFor.removeAttribute('aria-describedby');
    tipFor = null;
  }
  var hideTimer = null;
  document.addEventListener('mouseover', function (e) {
    var g = e.target.closest && e.target.closest('.gloss');
    if (g) { clearTimeout(hideTimer); if (tipFor !== g) showTip(g); return; }
    if (tip && e.target.closest && e.target.closest('#gloss-tip')) { clearTimeout(hideTimer); return; }
    if (tipFor) { clearTimeout(hideTimer); hideTimer = setTimeout(hideTip, 250); }
  });
  document.addEventListener('focusin', function (e) {
    var g = e.target.closest && e.target.closest('.gloss');
    if (g) showTip(g);
    else if (!(e.target.closest && e.target.closest('#gloss-tip'))) hideTip();
  });
  document.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('.gloss');
    if (g) { if (tipFor === g) hideTip(); else showTip(g); return; }
    if (!(e.target.closest && e.target.closest('#gloss-tip'))) hideTip();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tipFor) { var t = tipFor; hideTip(); t.focus(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('gloss')) { e.preventDefault(); if (tipFor === e.target) hideTip(); else showTip(e.target); }
  });

  /* ---------- sortable tables ---------- */
  function cellVal(td) {
    var t = (td.textContent || '').trim();
    var m = t.replace(/[,  ]/g, '').match(/^[~≈<>≤≥]?\s*(-|−)?\d+(\.\d+)?/);
    if (m) { var v = parseFloat(m[0].replace(/[~≈<>≤≥\s]/g, '').replace('−', '-')); if (!isNaN(v)) return { n: v, s: t }; }
    return { n: null, s: t.toLowerCase() };
  }
  Array.prototype.forEach.call(document.querySelectorAll('main .table-wrap > table'), function (table) {
    if (table.closest('.widget')) return;
    var tb = table.tBodies[0];
    if (!tb || tb.rows.length < 4 || !table.tHead) return;
    var ths = table.tHead.rows[0].cells;
    Array.prototype.forEach.call(ths, function (th, ci) {
      th.classList.add('sortable');
      th.setAttribute('tabindex', '0');
      th.setAttribute('aria-sort', 'none');
      th.setAttribute('title', 'Sort by this column');
      function sort() {
        var dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        Array.prototype.forEach.call(ths, function (o) { o.setAttribute('aria-sort', 'none'); });
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        var rows = Array.prototype.slice.call(tb.rows);
        if (!tb._orig) tb._orig = rows.slice();
        rows.sort(function (r1, r2) {
          var a = cellVal(r1.cells[ci] || r1.cells[0]), b = cellVal(r2.cells[ci] || r2.cells[0]);
          if (a.n !== null && b.n !== null) return (a.n - b.n) * dir;
          if (a.n !== null) return -1; if (b.n !== null) return 1;
          return a.s.localeCompare(b.s) * dir;
        });
        rows.forEach(function (r) { tb.appendChild(r); });
      }
      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
  });

  /* ---------- per-chapter Unverified callouts ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('details.unverified-list'), function (box) {
    var sec = box.closest('section');
    if (!sec) return;
    var tags = sec.querySelectorAll('.tag-unverified[id]');
    var ol = box.querySelector('ol');
    var sum = box.querySelector('summary');
    if (!tags.length) { box.parentNode.removeChild(box); return; }
    sum.textContent = 'Unverified items in this chapter (' + tags.length + ')';
    Array.prototype.forEach.call(tags, function (tg) {
      var block = tg.closest('li, p, td, dd') || tg.parentNode;
      var txt = (block.textContent || '').replace(/\s+/g, ' ').trim();
      var tagTxt = tg.textContent.trim();
      var idx = txt.indexOf(tagTxt);
      var start = Math.max(0, txt.lastIndexOf('. ', Math.max(0, idx - 2)) + 2);
      if (idx - start > 220) start = idx - 220;
      var ctx = txt.slice(start, idx).trim();
      if (start > 0) ctx = '… ' + ctx;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + tg.id;
      a.textContent = (ctx || '(table cell)') + ' ';
      var badge = document.createElement('span'); badge.className = 'tag tag-unverified'; badge.textContent = tagTxt;
      a.appendChild(badge);
      a.addEventListener('click', function () {
        setTimeout(function () { tg.classList.remove('flash'); void tg.offsetWidth; tg.classList.add('flash'); }, 50);
      });
      li.appendChild(a);
      ol.appendChild(li);
    });
  });
})();
