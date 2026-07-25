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
- `brand/overboard-logo.html` — the editable logo source: full mark, wordmark, app icon, 1-colour,
  favicon. Hand-authored inline SVG. Update this and the Notion brand doc together.
- `assets/` — video clip, poster, and OG image go here when they exist.

## Run it locally

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

Events print to the browser console by default (`sink: 'console'`), so the funnel is inspectable
before any collector exists.

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

Configure the sink by defining `window.OB_CONFIG` **before** `analytics.js` loads:

```html
<script>
  window.OB_CONFIG = {
    sink: 'endpoint',                         // 'console' | 'endpoint' | 'plausible' | 'none'
    endpoint: 'https://ob-collect.example/e', // Cloudflare Worker → D1
    signupEndpoint: 'https://ob-collect.example/subscribe'
  };
</script>
```

No cookies, no third-party scripts, no cross-site identifiers — so no consent banner is required.
The session id lives in `sessionStorage` and dies with the tab. `Do Not Track` and Global Privacy
Control disable collection entirely.

### Event schema (v1)

| Event | Key props | Answers |
| --- | --- | --- |
| `page_view` | `title`, `lang`, `theme` | How many arrived, from where (`src.utm_*`, `referrer_host`) |
| `section_view` | `section` | Which sections got reached at all |
| `scroll_depth` | `percent` (25/50/75/100) | Where people stop reading |
| `cta_click` | `id`, `text` | Which call to action actually pulls |
| `outbound_click` | `target` (`github`/`hackaday`), `href` | Did the page hand off to the repo — the primary conversion |
| `video_play` / `video_progress` / `video_complete` | `id`, `percent` | Played vs. actually watched |
| `signup_submit` / `signup_success` / `signup_error` | — | Email capture funnel |
| `theme_toggle` | `theme` | Minor, but cheap |
| `session_end` | `duration_ms`, `dwell[]` (`section`, `ms`, `max_ratio`) | **Time spent per section** — the attention map |

Every event also carries `v` (schema version), `sid`, `path`, `t_ms` since load, `viewport`, and the
`src` attribution block. Adding a prop is safe; renaming one breaks the funnel — bump
`schemaVersion` instead.

### Swapping in the real video

The `#demo-media` frame is deliberately empty — no play button exists until there is something to
play. When the clip is ready, delete the `.media-empty` block and uncomment the `<video>` element
already sitting in `index.html`. The `data-ob-video="sim-balance"` attribute is all the analytics
layer needs — play, quartile progress, and completion start reporting automatically.

### Theme

Light is the designed surface and the default. The page does **not** follow the OS colour scheme;
dark is reached only via the header toggle and is then remembered in `localStorage`. To restore
OS-following, add a `prefers-color-scheme: dark` block to the token section of `index.html`.
