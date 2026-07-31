/**
 * Overboard analytics collector.
 *
 * A Cloudflare Worker that accepts batches of events from analytics.js and
 * writes them to D1. Implements the CEO-ratified schema design (2026-07-31).
 *
 * This is a REIMPLEMENTATION of scripts/ob_events.py in the overboard-metrics
 * repo, which is the reference contract. If the two ever disagree, the Python
 * one is right and this is a bug.
 *
 * Four ratified decisions are load-bearing here, and each is a line you could
 * delete without any test failing — which is exactly why they are commented:
 *
 *   1. `site` is REQUIRED and never defaulted. Data not labelled at write time
 *      cannot be labelled later; there is no backfill for a missing dimension.
 *      It is also the axis synthetic data is separated on, so defaulting it
 *      would silently merge fabricated rows into real ones.
 *
 *   2. Validation REJECTS, it never silently repairs. A collector that quietly
 *      fixes bad events produces a dataset nobody can reason about afterwards.
 *
 *   3. `received_at` is the SERVER clock. Client clocks lie.
 *
 *   4. The request body arrives as text/plain on purpose. sendBeacon cannot
 *      perform a CORS preflight, so a JSON content type would make the request
 *      non-simple, fire a preflight, and the event would fail SILENTLY. That
 *      failure class has bitten this project four times in one week.
 */

const SCHEMA_VERSION = 1;
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 64 * 1024;

const EVENT_NAMES = new Set([
  'page_view', 'section_view', 'scroll_depth',
  'video_play', 'video_progress', 'video_complete', 'video_pause',
  'cta_click', 'outbound_click', 'session_end',
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

class Rejected extends Error {}

function validate(ev) {
  if (typeof ev !== 'object' || ev === null || Array.isArray(ev)) {
    throw new Rejected('event is not an object');
  }

  const site = ev.site;
  if (typeof site !== 'string' || site.trim() === '') {
    // The single most important check in this file.
    throw new Rejected(
      "missing required field 'site' — refusing to default it. An unlabelled " +
      'row cannot be attributed to a project later, and cannot be separated ' +
      'from synthetic data.');
  }

  if (!Number.isInteger(ev.v)) throw new Rejected("missing or non-integer 'v'");
  if (ev.v > SCHEMA_VERSION) {
    throw new Rejected(`event schema v${ev.v} is newer than this collector (v${SCHEMA_VERSION})`);
  }

  if (!EVENT_NAMES.has(ev.event)) throw new Rejected(`unknown event name ${JSON.stringify(ev.event)}`);
  if (typeof ev.sid !== 'string' || !ev.sid) throw new Rejected("missing 'sid'");

  if (ev.props !== undefined &&
      (typeof ev.props !== 'object' || ev.props === null || Array.isArray(ev.props))) {
    throw new Rejected("'props' must be an object");
  }

  if (ev.visit !== undefined && ev.visit !== null) {
    if (typeof ev.visit !== 'object' || Array.isArray(ev.visit)) {
      throw new Rejected("'visit' must be an object");
    }
    const fs = ev.visit.first_seen;
    if (fs !== undefined && fs !== null && !DATE_ONLY.test(fs)) {
      // Date only, never a timestamp: a precise first-seen time is far more
      // identifying than a date, and buys nothing.
      throw new Rejected('visit.first_seen must be YYYY-MM-DD (date only, never a timestamp)');
    }
  }

  return ev;
}

const DDL = `
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY,
  site          TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  v             INTEGER NOT NULL,
  event         TEXT NOT NULL,
  sid           TEXT NOT NULL,
  first_seen    TEXT,
  visit_n       INTEGER,
  path          TEXT,
  t_ms          INTEGER,
  viewport      TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  referrer_host TEXT,
  props         TEXT
)`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── /health — the liveness endpoint ───────────────────────────────────
    // "0 visitors today" and "the collector died eleven days ago" render
    // identically on a dashboard. This is what makes them distinguishable,
    // and it is the single most important requirement in the whole piece of
    // work — see overboard-web#25.
    if (url.pathname === '/health') {
      try {
        const row = await env.DB.prepare(
          'SELECT COUNT(*) AS n, MAX(received_at) AS last FROM events').first();
        return json({
          ok: true,
          events: row?.n ?? 0,
          last_event_at: row?.last ?? null,
          schema_version: SCHEMA_VERSION,
        });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'POST' || url.pathname !== '/e') {
      return new Response('not found', { status: 404, headers: CORS });
    }

    const body = await request.text();
    if (body.length > MAX_BATCH_BYTES) {
      return new Response('batch too large', { status: 413, headers: CORS });
    }

    let events;
    try {
      const doc = JSON.parse(body);
      if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.events)) {
        throw new Rejected('body must be {"events": [...]}');
      }
      if (doc.events.length > MAX_BATCH_EVENTS) {
        return new Response('too many events', { status: 413, headers: CORS });
      }
      events = doc.events.map(validate);
    } catch (e) {
      // 400 with a REASON. A rejection with no explanation is how a broken
      // client stays broken for weeks.
      return new Response(`rejected: ${e.message}`, { status: 400, headers: CORS });
    }

    if (events.length === 0) return new Response(null, { status: 204, headers: CORS });

    const receivedAt = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');

    await env.DB.exec(DDL.replace(/\n\s*/g, ' '));

    const stmt = env.DB.prepare(
      'INSERT INTO events (site,received_at,v,event,sid,first_seen,visit_n,path,' +
      't_ms,viewport,utm_source,utm_medium,utm_campaign,referrer_host,props) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

    await env.DB.batch(events.map((ev) => {
      const src = ev.src || {};
      const visit = ev.visit || {};
      return stmt.bind(
        ev.site, receivedAt, ev.v, ev.event, ev.sid,
        visit.first_seen ?? null, visit.n ?? null,
        ev.path ?? null, ev.t_ms ?? null, ev.viewport ?? null,
        src.utm_source ?? null, src.utm_medium ?? null,
        src.utm_campaign ?? null, src.referrer_host ?? null,
        JSON.stringify(ev.props ?? {}));
    }));

    // 204 with no body: sendBeacon cannot read a response anyway.
    return new Response(null, { status: 204, headers: CORS });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 1), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
