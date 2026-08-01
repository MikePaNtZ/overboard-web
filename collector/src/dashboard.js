/**
 * The audience dashboard, served live from the collector's own D1.
 *
 * Implements the design at 📊 Audience Dashboard — design & v1, including the
 * rule that governs the whole page:
 *
 *   NEVER LET A MISSING PIPE LOOK LIKE A MEASURED ZERO.
 *
 * "0 visitors" and "we are not collecting" are opposite facts, and a dashboard
 * that renders them identically is worse than no dashboard. Every tile here
 * either has a real number behind it or says NOT MEASURED and why.
 *
 * It is NOT public. Audience data sits inside the confidentiality boundary set
 * 2026-07-28, and this endpoint is on a public hostname, so it requires a token.
 */

const SYNTHETIC_PREFIX = 'synthetic-';

export async function dashboard(request, env, url) {
  // ── access ────────────────────────────────────────────────────────────
  // A shared token, not because it is strong, but because the alternative is
  // publishing our audience numbers to anyone who guesses a path.
  const expected = env.DASHBOARD_TOKEN;
  if (!expected) {
    return html(page({ error: 'DASHBOARD_TOKEN is not configured on the Worker.' }), 500);
  }
  const given = url.searchParams.get('k') || '';
  if (given !== expected) {
    return new Response('not found', { status: 404 });
  }

  // Which site to show. Real by default — a synthetic site is only ever shown
  // because somebody deliberately asked for it.
  const site = url.searchParams.get('site') || 'overboard';
  const isSynthetic = site.startsWith(SYNTHETIC_PREFIX);

  const q = async (sql, ...binds) => {
    try { return await env.DB.prepare(sql).bind(...binds).all(); }
    catch (e) { return { error: String(e), results: [] }; }
  };
  const one = async (sql, ...binds) => {
    try { return await env.DB.prepare(sql).bind(...binds).first(); }
    catch (e) { return null; }
  };

  const health = await one(
    'SELECT COUNT(*) AS n, MAX(received_at) AS last FROM events WHERE site = ?', site);
  const rejects = await one('SELECT COUNT(*) AS n, MAX(received_at) AS last FROM rejects');
  const sites = await q('SELECT site, COUNT(*) AS n FROM events GROUP BY site ORDER BY n DESC');

  const totalEvents = health?.n ?? 0;

  // ── the funnel: produced → posted → seen ──────────────────────────────
  // The only row shown at its true value even in a mockup, because it cannot
  // be faked without lying. `seen` is sessions that are not us.
  const seen = (await one(
    "SELECT COUNT(DISTINCT sid) AS n FROM events WHERE site = ? AND event = 'page_view'",
    site))?.n ?? 0;

  const returning = (await one(
    'SELECT COUNT(DISTINCT first_seen) AS n FROM events WHERE site = ? AND visit_n > 1',
    site))?.n ?? 0;

  const reachedLog = (await one(
    "SELECT COUNT(DISTINCT sid) AS n FROM events WHERE site = ? AND event = 'section_view' " +
    "AND json_extract(props,'$.section') = 'log'", site))?.n ?? 0;

  const dwell = await q(
    "SELECT json_extract(value,'$.section') AS section, " +
    "       CAST(AVG(json_extract(value,'$.ms')) AS INTEGER) AS ms " +
    "FROM events, json_each(json_extract(props,'$.dwell')) " +
    "WHERE site = ? AND event = 'session_end' GROUP BY section ORDER BY ms DESC", site);

  const referrers = await q(
    "SELECT COALESCE(NULLIF(referrer_host,''),'(direct)') AS host, COUNT(DISTINCT sid) AS n " +
    "FROM events WHERE site = ? AND event = 'page_view' GROUP BY host ORDER BY n DESC LIMIT 8",
    site);

  const video = await one(
    "SELECT " +
    " (SELECT COUNT(DISTINCT sid) FROM events WHERE site = ? AND event = 'video_play') AS plays," +
    " (SELECT COUNT(DISTINCT sid) FROM events WHERE site = ? AND event = 'video_progress' " +
    "   AND json_extract(props,'$.percent') >= 75) AS to75", site, site);

  const daily = await q(
    'SELECT substr(received_at,1,10) AS day, COUNT(DISTINCT sid) AS n FROM events ' +
    "WHERE site = ? AND event = 'page_view' GROUP BY day ORDER BY day DESC LIMIT 21", site);

  return html(page({
    site, isSynthetic, totalEvents, seen, returning, reachedLog,
    dwell: dwell.results || [], referrers: referrers.results || [],
    video: video || {}, daily: (daily.results || []).reverse(),
    lastEventAt: health?.last ?? null,
    rejects: rejects?.n ?? 0, lastRejectAt: rejects?.last ?? null,
    sites: sites.results || [],
  }));
}

// ── rendering ─────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const fmtMs = (ms) => ms >= 60000
  ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  : `${Math.round(ms / 1000)}s`;

/** A tile that refuses to render a zero it cannot vouch for. */
function tile(label, value, foot, measured) {
  const v = measured
    ? `<div class="val">${esc(value)}</div>`
    : `<div class="nm">NOT MEASURED</div>`;
  return `<div class="card tile"><div class="lab">${esc(label)}</div>${v}
    <div class="foot">${esc(foot)}</div></div>`;
}

function staleness(lastEventAt) {
  if (!lastEventAt) return { cls: 'bad', text: 'no events ever received' };
  const age = (Date.now() - Date.parse(lastEventAt)) / 3600000;
  if (age > 48) return { cls: 'bad', text: `last event ${Math.round(age)}h ago — collector may be dead` };
  if (age > 24) return { cls: 'warn', text: `last event ${Math.round(age)}h ago` };
  return { cls: 'ok', text: `last event ${age < 1 ? 'under an hour' : Math.round(age) + 'h'} ago` };
}

function page(d) {
  if (d.error) return `<!doctype html><meta charset=utf-8><title>Audience</title>
    <body style="font:16px system-ui;background:#0F1922;color:#EAF1F1;padding:40px">
    <h1>Dashboard unavailable</h1><p>${esc(d.error)}</p>`;

  const s = staleness(d.lastEventAt);
  // Below this, per-session rates are noise rather than measurement. Saying so
  // is the honest move: a 100% engagement rate off two sessions is not a fact.
  const MIN_SESSIONS = 20;
  const enough = d.seen >= MIN_SESSIONS;
  const pct = (n) => d.seen ? `${Math.round((n / d.seen) * 100)}%` : '—';
  const maxDwell = Math.max(1, ...d.dwell.map((r) => r.ms || 0));
  const maxRef = Math.max(1, ...d.referrers.map((r) => r.n || 0));
  const maxDay = Math.max(1, ...d.daily.map((r) => r.n || 0));

  return `<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta name=robots content="noindex,nofollow">
<title>Audience — Overboard</title>
<style>
:root{--bg:#0F1922;--surface:#182732;--raised:#1E303D;--fg:#EAF1F1;--muted:#9AAEB4;
--edge:#2A3F4E;--ghost:#5C7480;--s1:#CE7C00;--s2:#00AA92;--good:#0ca30c;--warn:#fab219;--bad:#d03b3b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1060px;margin:0 auto;padding:0 20px 60px}
header{padding:26px 0 6px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:flex-end}
h1{font-size:20px;margin:0;font-weight:650}.sub{color:var(--muted);font-size:13px;margin-top:4px}
.banner{padding:10px 20px;text-align:center;font-size:13px}
.banner.synth{background:repeating-linear-gradient(135deg,#3a2a12 0 12px,#43310f 12px 24px);color:#F8D9A4;border-bottom:1px solid #6b4d16}
.grid{display:grid;gap:14px}
.card{background:var(--surface);border:1px solid var(--edge);border-radius:12px;padding:18px}
.card h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 2px}
.card .q{font-size:12px;color:var(--ghost);margin:0 0 14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.tile .lab{font-size:13px;color:var(--muted);margin-bottom:6px}
.tile .val{font-size:32px;font-weight:650;line-height:1.1}
.tile .nm{font-size:15px;font-weight:600;color:var(--ghost);padding:9px 0 6px;letter-spacing:.04em}
.tile .foot{font-size:12px;color:var(--ghost);margin-top:8px}
.hero{font-size:54px;font-weight:650;line-height:1;letter-spacing:-.02em}
.funnel{display:flex;gap:2px;margin-top:14px}
.fstep{flex:1;background:var(--raised);border-radius:4px;padding:12px 14px}
.fstep .n{font-size:26px;font-weight:650}.fstep .l{font-size:11px;color:var(--muted);letter-spacing:.02em;margin-top:4px}
.fstep.zero .n{color:var(--ghost)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:0 0 8px;border-bottom:1px solid var(--edge)}
td{padding:8px 0;border-bottom:1px solid #223342}tr:last-child td{border-bottom:0}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{display:block;height:6px;border-radius:0 3px 3px 0;background:var(--s1);margin-top:5px}
.health{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.hrow{display:flex;gap:10px;align-items:flex-start;font-size:13px;padding:10px 12px;background:var(--raised);border-radius:8px}
.dot{width:9px;height:9px;border-radius:50%;flex:none;margin-top:5px}
.hrow b{display:block}.hrow em{font-style:normal;color:var(--muted);font-size:12px}
.note{color:var(--ghost);font-size:12px;margin-top:10px;line-height:1.55}
.two{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}
@media(max-width:820px){.two{grid-template-columns:1fr}}
</style>
${d.isSynthetic ? `<div class="banner synth"><b>SYNTHETIC DATA.</b> This is the
 <code>${esc(d.site)}</code> site — generated for testing. Nothing here is a real person.</div>` : ''}
<div class="wrap">
<header><div><h1>Audience</h1>
<div class="sub">Overboard · internal · <strong style="color:var(--fg)">do strangers care?</strong>
 · site <code>${esc(d.site)}</code></div></div></header>

<div class="grid">

<section class="card">
  <div class="two" style="align-items:center">
    <div>
      <div class="hero">${d.seen}</div>
      <div class="sub" style="margin-top:8px">${d.seen === 1 ? 'session' : 'sessions'} recorded, all time<br>
        <span style="color:var(--ghost)">DNT and GPC honoured — people who opted out are not here</span></div>
    </div>
    <div>
      <div class="sub" style="margin-bottom:2px">Produced → posted → seen by a stranger</div>
      <div class="funnel">
        <div class="fstep"><div class="n">6</div><div class="l">PRODUCED</div></div>
        <div class="fstep zero"><div class="n">0</div><div class="l">POSTED</div></div>
        <div class="fstep${d.seen ? '' : ' zero'}"><div class="n">${d.seen}</div><div class="l">SEEN</div></div>
      </div>
      <p class="note">Replaces “content produced → published: 5 of 5”, which could
        only ever read 5 of 5. Posted is 0 because nothing has been announced yet.</p>
    </div>
  </div>
</section>

<section class="tiles">
  ${tile('Return rate', pct(d.returning), enough ? 'came back within 30 days'
      : `needs ≥${MIN_SESSIONS} sessions to mean anything (have ${d.seen})`, enough)}
  ${tile('Reached the log', pct(d.reachedLog), enough ? 'scrolled as far as the build log'
      : `needs ≥${MIN_SESSIONS} sessions (have ${d.seen})`, enough)}
  ${tile('Video play rate', pct(d.video.plays || 0), enough ? 'played at least one clip'
      : `needs ≥${MIN_SESSIONS} sessions (have ${d.seen})`, enough)}
</section>

<div class="two">
  <section class="card">
    <h2>Arrivals</h2><p class="q">Sessions per day. Is anyone finding us?</p>
    ${d.daily.length ? `<table><tbody>${d.daily.map((r) => `<tr>
      <td>${esc(r.day)}</td><td style="width:60%"><span class="bar"
        style="width:${Math.round((r.n / maxDay) * 100)}%"></span></td>
      <td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`
      : '<p class="note">No sessions recorded yet.</p>'}
  </section>

  <section class="card">
    <h2>Where they came from</h2><p class="q">Which channel is working?</p>
    ${d.referrers.length ? `<table><thead><tr><th>Source</th><th class="num">Sessions</th></tr></thead>
      <tbody>${d.referrers.map((r) => `<tr><td>${esc(r.host)}<span class="bar"
        style="width:${Math.round((r.n / maxRef) * 100)}%"></span></td>
        <td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`
      : '<p class="note">No referrers recorded yet.</p>'}
  </section>
</div>

<section class="card">
  <h2>Which part of the story works</h2>
  <p class="q">Mean time each section was actually on screen. Diagnostic, not a target —
    this is the row that says what to cut.</p>
  ${d.dwell.length ? `<table><tbody>${d.dwell.map((r) => `<tr>
    <td style="width:22%">${esc(r.section)}</td>
    <td><span class="bar" style="width:${Math.round((r.ms / maxDwell) * 100)}%"></span></td>
    <td class="num">${esc(fmtMs(r.ms))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="note">No completed sessions with dwell data yet. Dwell arrives with <code>session_end</code>, which fires when the tab closes.</p>'}
</section>

<section class="card">
  <h2>Data health</h2>
  <p class="q">Where every number above comes from, and whether it is real.
    A tile with no live source reads NOT MEASURED, never 0.</p>
  <div class="health">
    <div class="hrow"><span class="dot" style="background:var(--${s.cls === 'ok' ? 'good' : s.cls === 'warn' ? 'warn' : 'bad'})"></span>
      <div><b>${s.cls === 'ok' ? '✓' : '!'} Site events — ${s.cls === 'ok' ? 'LIVE' : 'CHECK'}</b>
      <em>${esc(s.text)}. ${d.totalEvents} events stored for this site.</em></div></div>
    <div class="hrow"><span class="dot" style="background:var(--${d.rejects ? 'warn' : 'good'})"></span>
      <div><b>${d.rejects ? '!' : '✓'} Rejected events — ${d.rejects}</b>
      <em>${d.rejects ? 'Something is sending events the collector will not accept.' : 'Nothing rejected.'}</em></div></div>
    <div class="hrow"><span class="dot" style="background:var(--good)"></span>
      <div><b>✓ Domain — LIVE</b><em>overboardproject.com, HTTPS enforced.</em></div></div>
    <div class="hrow"><span class="dot" style="background:var(--warn)"></span>
      <div><b>! GitHub traffic — SEPARATE STORE</b><em>Snapshotted daily into overboard-metrics.
        Not joined into this view yet.</em></div></div>
    <div class="hrow"><span class="dot" style="background:var(--bad)"></span>
      <div><b>✕ Email list — DOES NOT EXIST</b><em>The form posts nowhere. Signup events
        are emitted but there is no list behind them.</em></div></div>
    <div class="hrow"><span class="dot" style="background:var(--bad)"></span>
      <div><b>✕ Posted — 0</b><em>Nothing has been announced. Every arrival so far is
        direct or incidental.</em></div></div>
  </div>
  ${d.sites.length > 1 ? `<p class="note">Other sites in the store:
    ${d.sites.map((x) => `<code>${esc(x.site)}</code> ${x.n}`).join(' · ')}</p>` : ''}
</section>

<p class="note">Rates are withheld below ${MIN_SESSIONS} sessions. A 100% engagement rate
 off two visits is not a measurement, and printing it would be the vanity metric this
 dashboard exists to avoid.</p>
</div>`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
