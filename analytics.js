/*
 * Overboard — landing page measurement layer.
 *
 * Design constraints (from the Product & Marketing Strategy doc):
 *   - No cookies, no third-party scripts, no cross-site identifiers. Nothing that
 *     needs a consent banner. A session id lives in sessionStorage and dies with the tab.
 *   - The sink is pluggable: swapping OB_CONFIG.sink is the only change needed to move
 *     between local debugging, a self-hosted collector, and Plausible-style custom events.
 *   - Events are queued and flushed with sendBeacon so nothing blocks paint and nothing
 *     is lost when the tab closes mid-read.
 *
 * The event schema is the contract — see docs/marketing/event-schema.md. Adding a field is
 * fine; renaming one breaks the funnel, so version it instead.
 */
(function () {
  'use strict';

  var OB_CONFIG = window.OB_CONFIG = Object.assign({
    // 'console' | 'endpoint' | 'plausible' | 'none'
    sink: 'console',
    // Used when sink === 'endpoint'. e.g. a Cloudflare Worker writing to D1.
    endpoint: '',
    // Used when sink === 'plausible'.
    plausibleDomain: '',
    plausibleApi: 'https://plausible.io/api/event',
    // POST target for the email form; left empty until a list exists.
    signupEndpoint: '',
    // Dwell shorter than this is scrolling past, not reading.
    minDwellMs: 1000,
    schemaVersion: 1
  }, window.OB_CONFIG || {});

  var DNT = navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
            navigator.globalPrivacyControl === true;
  var ENABLED = OB_CONFIG.sink !== 'none' && !DNT;

  /* ── session identity: ephemeral, per-tab, not a person ──────────────────── */
  function sessionId() {
    try {
      var k = 'ob-sid', v = sessionStorage.getItem(k);
      if (!v) {
        v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'no-storage'; }
  }

  /* ── source attribution: which channel actually sends people ─────────────── */
  function source() {
    var p = new URLSearchParams(location.search);
    var ref = document.referrer ? new URL(document.referrer).hostname : '';
    return {
      utm_source: p.get('utm_source') || '',
      utm_medium: p.get('utm_medium') || '',
      utm_campaign: p.get('utm_campaign') || '',
      referrer_host: ref
    };
  }

  var SID = sessionId();
  var SRC = source();
  var startedAt = Date.now();
  var queue = [];

  function track(name, props) {
    if (!ENABLED) return;
    queue.push({
      v: OB_CONFIG.schemaVersion,
      event: name,
      props: props || {},
      sid: SID,
      path: location.pathname,
      t_ms: Date.now() - startedAt,
      viewport: innerWidth + 'x' + innerHeight,
      src: SRC
    });
    if (queue.length >= 20) flush();
  }
  window.obTrack = track;

  function flush(final) {
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);

    if (OB_CONFIG.sink === 'console') {
      batch.forEach(function (e) { console.log('[ob]', e.event, e.props); });
      return;
    }

    if (OB_CONFIG.sink === 'plausible') {
      // Plausible takes one custom event at a time; props must be flat scalars.
      batch.forEach(function (e) {
        var body = JSON.stringify({
          name: e.event, url: location.href, domain: OB_CONFIG.plausibleDomain,
          referrer: document.referrer, props: e.props
        });
        if (final && navigator.sendBeacon) navigator.sendBeacon(OB_CONFIG.plausibleApi, body);
        else fetch(OB_CONFIG.plausibleApi, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body, keepalive: true
        }).catch(function () {});
      });
      return;
    }

    if (OB_CONFIG.sink === 'endpoint' && OB_CONFIG.endpoint) {
      var payload = JSON.stringify({ events: batch });
      if (navigator.sendBeacon) navigator.sendBeacon(OB_CONFIG.endpoint, new Blob([payload], { type: 'application/json' }));
      else fetch(OB_CONFIG.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: payload, keepalive: true
      }).catch(function () {});
    }
  }

  if (!ENABLED) return;

  /* ── 1. page_view ────────────────────────────────────────────────────────── */
  // `theme` was dropped in v1.1 — the page is dark-only, so it carried no signal.
  track('page_view', {
    title: document.title,
    lang: navigator.language
  });

  /* ── 2. section attention: which sections get read, and for how long ─────── */
  // Accumulates visible time per section rather than firing once on entry —
  // "scrolled past the roadmap" and "read the roadmap" are different signals.
  (function () {
    var sections = document.querySelectorAll('[data-ob-section]');
    if (!sections.length || !('IntersectionObserver' in window)) return;

    var state = new Map();
    sections.forEach(function (el) {
      state.set(el, { name: el.dataset.obSection, since: 0, total: 0, seen: false, visible: false, maxRatio: 0 });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var s = state.get(entry.target);
        if (!s) return;
        s.maxRatio = Math.max(s.maxRatio, entry.intersectionRatio);
        s.visible = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (!s.seen) { s.seen = true; track('section_view', { section: s.name }); }
          if (!s.since && !document.hidden) s.since = Date.now();
        } else if (s.since) {
          s.total += Date.now() - s.since;
          s.since = 0;
        }
      });
    }, { threshold: [0, 0.35, 0.75] });

    sections.forEach(function (el) { io.observe(el); });

    // Pause the clock when the tab is hidden — background time isn't attention.
    document.addEventListener('visibilitychange', function () {
      state.forEach(function (s) {
        if (document.hidden && s.since) { s.total += Date.now() - s.since; s.since = 0; }
        else if (!document.hidden && s.visible && !s.since) s.since = Date.now();
      });
    });

    window.__obDwell = function () {
      var out = [];
      state.forEach(function (s) {
        var total = s.total + (s.since ? Date.now() - s.since : 0);
        if (total >= OB_CONFIG.minDwellMs) {
          out.push({ section: s.name, ms: Math.round(total), max_ratio: +s.maxRatio.toFixed(2) });
        }
      });
      return out;
    };
  })();

  /* ── 3. scroll depth ─────────────────────────────────────────────────────── */
  (function () {
    var marks = [25, 50, 75, 100], hit = {};
    addEventListener('scroll', function () {
      var h = document.documentElement;
      var pct = (h.scrollTop + innerHeight) / h.scrollHeight * 100;
      marks.forEach(function (m) {
        if (!hit[m] && pct >= m) { hit[m] = true; track('scroll_depth', { percent: m }); }
      });
    }, { passive: true });
  })();

  /* ── 4. clicks: internal CTAs and outbound links ─────────────────────────── */
  document.addEventListener('click', function (e) {
    var out = e.target.closest('[data-ob-outbound]');
    if (out) {
      track('outbound_click', { target: out.dataset.obOutbound, href: out.href || '', label: out.dataset.obCta || '' });
      flush(true); // the tab may be leaving — get it out now
      return;
    }
    var cta = e.target.closest('[data-ob-cta]');
    if (cta) track('cta_click', { id: cta.dataset.obCta, text: (cta.textContent || '').trim().slice(0, 60) });
  }, true);

  /* ── 5. video engagement ─────────────────────────────────────────────────── */
  // Quartile milestones, so "played it" and "watched it" stay distinguishable.
  document.querySelectorAll('[data-ob-video]').forEach(function (v) {
    var id = v.dataset.obVideo, quartiles = { 25: false, 50: false, 75: false };
    v.addEventListener('play', function () { track('video_play', { id: id }); });
    v.addEventListener('pause', function () {
      if (!v.ended) track('video_pause', { id: id, at_pct: Math.round(v.currentTime / v.duration * 100) || 0 });
    });
    v.addEventListener('ended', function () { track('video_complete', { id: id }); });
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var pct = v.currentTime / v.duration * 100;
      Object.keys(quartiles).forEach(function (q) {
        if (!quartiles[q] && pct >= +q) { quartiles[q] = true; track('video_progress', { id: id, percent: +q }); }
      });
    });
  });

  /* ── 6. session summary on the way out ───────────────────────────────────── */
  function finish() {
    track('session_end', {
      duration_ms: Date.now() - startedAt,
      dwell: window.__obDwell ? window.__obDwell() : []
    });
    flush(true);
  }
  addEventListener('pagehide', finish);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(true); });
})();
