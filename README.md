# overboard-web

The public face of [Overboard](https://github.com/MikePaNtZ/overboard) — a DIY self-balancing
onewheel with a Rust real-time control stack. **This repo is the marketing site only.** The control
software, simulation, and design docs live in the `overboard` repo next door; nothing here is built,
tested, or deployed alongside them.

Deliberately boring technology: **two files, no build step, no dependencies, no framework.** Open
`index.html` in a browser and it works; drop the folder on any static host and it works there too.

- `index.html` — the whole page. Inline CSS using the brand tokens from the Notion *Visual Design &
  Brand* doc; the logo is inline SVG, the favicon is a data URI. Nothing is fetched from a CDN.
- `analytics.js` — the measurement layer (below). Loaded `defer`, so it never blocks paint.
- `brand/overboard-logo.html` — the editable logo source: full mark, wordmark, app icon, 1-color,
  favicon. Hand-authored inline SVG. Update this and the Notion brand doc together.
- `assets/` — video clip, poster, and OG image go here when they exist.

## Run it locally

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

The live sink is the collector on `e.overboardproject.com`. To inspect the funnel locally without
writing to it, set `window.OB_CONFIG = { sink: 'console' }` before `analytics.js` loads and the
events print to the browser console instead.

## Hosting

Any static host. Ranked by how little there is to run:

| Option | Custom domain | Notes |
| --- | --- | --- |
| **Cloudflare Pages** (recommended) | yes, free TLS | Also gives you Workers + D1 for the analytics sink and the email form on the same origin — no CORS, no third party. |
| GitHub Pages | yes, free TLS | Zero extra accounts if the repo is already on GitHub, but no server side, so the sink has to live elsewhere. |
| Netlify / Vercel | yes | Fine; more product than this page needs. |
| Own VPS + Caddy | yes | Most control, most upkeep. |

Set the canonical URL, the OG `og:url` / `og:image`, and the GitHub/Hackaday links (`OWNER/overboard`)
before the first public share — they are placeholders.

## Measurement

The defaults live in `analytics.js` and are wired to the live collector. Override them by defining
`window.OB_CONFIG` **before** `analytics.js` loads:

```html
<script>
  window.OB_CONFIG = {
    site: 'overboard',                          // REQUIRED on every event; never defaulted
    sink: 'endpoint',                           // 'console' | 'endpoint' | 'plausible' | 'none'
    endpoint: 'https://e.overboardproject.com/e', // Cloudflare Worker → D1
    signupEndpoint: ''                          // empty until a list exists
  };
</script>
```

Two things about the endpoint sink are load-bearing and look like sloppiness if you do not know why:

- **`site` is required.** The collector rejects a batch without it and never defaults it — an
  unlabelled row cannot be attributed to a project later, or told apart from synthetic data. It
  rejects the *whole batch*, and `sendBeacon` cannot read a response, so a client that forgets it
  loses every event silently while `/health` still looks fine.
- **The body is sent as `text/plain`.** `sendBeacon` cannot perform a CORS preflight, so a JSON
  content type would make the request non-simple, fire a preflight, and fail silently. The collector
  parses the body as JSON regardless.

No cookies, no third-party scripts, no cross-site identifiers — so no consent banner is required.
The session id lives in `sessionStorage` and dies with the tab. One first-party `localStorage` key,
`ob-visit`, outlives it: `{"first_seen": "YYYY-MM-DD", "n": <visits>}` — a **date, never a
timestamp**, because a precise first-seen time is far more identifying and buys nothing. It is what
makes a first visit and a fifth distinguishable, which is M0's primary metric. `Do Not Track` and
Global Privacy Control disable collection entirely, **including that write** — a visitor we do not
measure leaves nothing behind.

### Event schema (v1.2)

| Event | Key props | Answers |
| --- | --- | --- |
| `page_view` | `title`, `lang` | How many arrived, from where (`src.utm_*`, `referrer_host`) |
| `section_view` | `section` | Which sections got reached at all |
| `scroll_depth` | `percent` (25/50/75/100) | Where people stop reading |
| `cta_click` | `id`, `text` | Which call to action actually pulls |
| `outbound_click` | `target` (`github`), `href` | Did the page hand off to the repo |
| `video_play` / `video_progress` / `video_complete` | `id`, `percent` | Played vs. actually watched |
| `signup_submit` / `signup_success` / `signup_error` | — | Email capture funnel — **console sink only, see below** |
| `session_end` | `duration_ms`, `dwell[]` (`section`, `ms`, `max_ratio`) | **Time spent per section** — the attention map |

**Changed in v1.2** (2026-07-31): the sink points at the live collector, every event carries `site`,
and every event carries `visit` when storage is available. The three `signup_*` events are **not in
the collector's accepted list**, and it rejects a whole batch over one unknown name — so
`analytics.js` holds them back from the endpoint rather than letting one of them delete the
`session_end` travelling with it. They still print to the console sink. Remove that filter in
`analytics.js` when the collector accepts them ([#45](https://github.com/MikePaNtZ/overboard-web/issues/45)).

**Changed in v1.1** (2026-07-26): `theme_toggle` removed and `page_view.theme` dropped — the
page is dark-only, so neither carried signal. `outbound_click` no longer emits `hackaday`; that
link comes back at L1 when the project page exists.

Every event also carries `site`, `v` (schema version), `sid`, `path`, `t_ms` since load, `viewport`,
the `src` attribution block, and `visit` (`first_seen`, `n`). Adding a prop is safe; renaming one
breaks the funnel — bump `schemaVersion` instead.

### Swapping in the real video

The `#demo-media` frame is deliberately empty — no play button exists until there is something to
play. When the clip is ready, delete the `.media-empty` block and uncomment the `<video>` element
already sitting in `index.html`. The `data-ob-video="sim-balance"` attribute is all the analytics
layer needs — play, quartile progress, and completion start reporting automatically.

### Theme

**Dark only.** There is one palette, defined in the `:root` block of `index.html`. The light theme,
the header toggle, and the `localStorage` preference were removed on 2026-07-26 — the page does not
follow the OS color scheme and has no theme switch. Measured contrast ratios are recorded in a
comment alongside the tokens; verify them numerically before changing any color.
