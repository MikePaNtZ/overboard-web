/*
 * Overboard — landing page measurement layer.
 *
 * Design constraints (from the Product & Marketing Strategy doc):
 *   - No cookies, no third-party scripts, no cross-site identifiers. Nothing that
 *     needs a consent banner. A session id lives in sessionStorage and dies with the tab.
 *   - One first-party localStorage key, `ob-visit`, is the only thing that outlives the
 *     tab: a first-seen DATE (never a timestamp) and a visit count. M0's primary metric
 *     is return and depth, and without it a first visit and a fifth are indistinguishable.
 *     It is first-party only, readable by nobody else, and DNT/GPC suppresses the write —
 *     a visitor we do not measure leaves nothing behind.
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
    // Which property produced the event. REQUIRED on every event: the collector
    // rejects a batch that omits it and never defaults it, because an unlabelled
    // row cannot be attributed to a project later and cannot be told apart from
    // synthetic data. Do not remove this, and do not send events without it.
    site: 'overboard',
    // 'console' | 'endpoint' | 'plausible' | 'none'
    sink: 'endpoint',
    // Used when sink === 'endpoint'. A Cloudflare Worker writing to D1.
    endpoint: 'https://e.overboardproject.com/e',
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

  /* ── return-visitor marker: first-party, date only, one key ──────────────── */
  // The one thing here that outlives the tab. `sessionStorage` cannot answer
  // "did they come back", which is M0's primary metric.
  var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  function today() {
    // Date only, never a timestamp. A precise first-seen time is far more
    // identifying and buys nothing — and the collector rejects anything else.
    return new Date().toISOString().slice(0, 10);
  }

  // True the first time it is called in a given tab session, false after.
  function firstCallThisSession(k) {
    try {
      if (sessionStorage.getItem(k)) return false;
      sessionStorage.setItem(k, '1');
      return true;
    } catch (e) { return true; }
  }

  function visitMarker() {
    try {
      var k = 'ob-visit', rec = null;
      try { rec = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { rec = null; }
      // Anything malformed is repaired rather than sent. One bad `first_seen`
      // would fail validation and take the whole batch down with it.
      if (!rec || typeof rec !== 'object' || !DATE_ONLY.test(rec.first_seen) ||
          typeof rec.n !== 'number' || !isFinite(rec.n)) {
        rec = { first_seen: today(), n: 0 };
      }
      // Incremented once per session, not once per page view.
      if (firstCallThisSession('ob-visit-counted')) rec.n += 1;
      if (rec.n < 1) rec.n = 1;
      localStorage.setItem(k, JSON.stringify(rec));
      return { first_seen: rec.first_seen, n: rec.n };
    } catch (e) {
      // Private mode, storage disabled, quota. Not measuring is fine; guessing
      // a return count is not, so send nothing rather than a fabricated 1.
      return null;
    }
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

  // Both of these WRITE to storage, so neither runs for a visitor who has asked
  // not to be measured. Suppressing the send but still writing the marker would
  // be honouring the letter of DNT and not the point of it.
  var SID = ENABLED ? sessionId() : '';
  var VISIT = ENABLED ? visitMarker() : null;
  var SRC = source();
  var startedAt = Date.now();
  var queue = [];
  var warnedNoSite = false;

  function track(name, props) {
    if (!ENABLED) return;
    if (!OB_CONFIG.site) {
      // Never queue an event without `site`. The collector 400s the whole batch
      // and sendBeacon cannot read the response, so the loss would be invisible:
      // the dashboard reads zero and /health still looks healthy. Fail loudly in
      // the console instead.
      if (!warnedNoSite) {
        warnedNoSite = true;
        console.warn('[ob] OB_CONFIG.site is unset — events dropped rather than sent unlabelled');
      }
      return;
    }
    var ev = {
      v: OB_CONFIG.schemaVersion,
      site: OB_CONFIG.site,
      event: name,
      props: props || {},
      sid: SID,
      path: location.pathname,
      t_ms: Date.now() - startedAt,
      viewport: innerWidth + 'x' + innerHeight,
      src: SRC
    };
    if (VISIT) ev.visit = VISIT;
    queue.push(ev);
    if (queue.length >= 20) flush();
  }
  window.obTrack = track;

  // Emitted by the page, not yet accepted by the collector — see the endpoint
  // branch below. Tracked as normal for the console sink so the signup funnel
  // stays inspectable locally.
  var HELD_BACK = { signup_submit: 1, signup_success: 1, signup_error: 1 };

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
      // The collector validates every event in the batch and rejects the WHOLE
      // batch if one fails — so a single name it does not know would silently
      // delete every other event travelling with it, including session_end and
      // the dwell map. The three signup events are emitted by index.html but are
      // not in the collector's EVENT_NAMES, so they are held back here until it
      // accepts them. Remove this filter when it does; do not add names to it.
      var accepted = batch.filter(function (e) { return !HELD_BACK[e.event]; });
      if (!accepted.length) return;

      var payload = JSON.stringify({ events: accepted });
      // text/plain, deliberately. sendBeacon cannot perform a CORS preflight, so
      // an application/json content type makes the request non-simple, fires a
      // preflight, and the event fails SILENTLY. The collector parses the body as
      // JSON regardless of the declared type. Do not "fix" this back to JSON.
      if (navigator.sendBeacon) navigator.sendBeacon(OB_CONFIG.endpoint, new Blob([payload], { type: 'text/plain' }));
      else fetch(OB_CONFIG.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
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
