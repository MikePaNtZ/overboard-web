# overboard-web — project rules

Extends the global `~/.claude/CLAUDE.md`. This repo is the **public landing page for Overboard**
and nothing else. The control software, simulation, and hardware design live in the sibling repo
`overboard` (`~/projects/overboard`, GitHub `MikePaNtZ/overboard`).

## Hard boundary
- **No control code, no Rust, no sim assets here.** If a change belongs to the board, it belongs in
  the other repo. The separation exists so the controls repo stays clean and so the two can be
  iterated on independently, including from remote sessions.
- The only shared artefacts are **facts** (what the board can currently do) and **brand tokens** —
  both flow through Notion, not through code.

## Ownership (as of 2026-07-26)
- **This repo is owned by Digital Marketing:** `index.html`, the markup and CSS, page copy, brand
  and visual identity, and `analytics.js`. Branch prefix **`feat/web/`**. Escalates to the CMO.
- **`overboard-viz` is owned by Digital Content Production**, not here. They produce the renders
  and deliver web-optimised derivatives into `assets/` with any constraints that travel with the
  files. We own how the page *presents* them — the markup, the framing, the copy beside them.
  Do not change render pipeline, grade or camera in this repo; ask for a re-cut instead.
- Constraints that arrive with an asset (no autoplay, no loop, no CSS filter, own poster per clip)
  are enforced in CI by `.github/scripts/check_page.py`, not by agreement.

## Lanes — every asset on the site declares one
Defined in [M3 §6](https://app.notion.com/p/3a9472a5fb6981e99789e799fd777da8): *"(a) is the
surface, (b) is the spine."*
- **Lane A — the onewheel.** The machine: clips, renders, the trail, performance numbers.
- **Lane B — the making.** The process: design docs, adversarial review, sim-first gates, AI as
  collaborator, the failures. The differentiator, and the only through-line to P0's education
  thesis.

Declared per asset (a PR may carry both) in `.github/pull_request_template.md`, alongside the
requirement ID backing any claim placed next to that asset. A lane is not a category for tidiness
— it is the check that the page is still telling both stories rather than drifting into a gadget
showcase.

## Source of truth
- **Notion is primary** for the product story. The docs that govern this repo:
  - [M0 — Product & Marketing Strategy](https://app.notion.com/p/3a8472a5fb6981ffbf73ee8297e62f07) — audience, positioning, launch moments, measurement plan.
  - [M1 — Press Release & FAQ](https://app.notion.com/p/3a8472a5fb69814dbe52cacd0f5735bf) — **the public story; the page must not say anything M1 does not.**
  - [M2 — Landing Page & Instrumentation Spec](https://app.notion.com/p/3a8472a5fb6981bb9574d7fa6caa1304) — page structure, event schema, design decisions.
  - [Visual Design & Brand](https://app.notion.com/p/3a8472a5fb69817bbad7e60b08ffc8a4) — palette, logo, voice.
  - [Requirements](https://app.notion.com/p/3a8472a5fb69817f98ebc9e52e1fb2d8) — `UR-11..13`, `SR-WEB-1..5`, `DR-WEB-1` are the ones this repo satisfies.
- Change the page and the governing Notion doc **in the same pass**. A structural change to the page
  that is not reflected in M2 is a defect.

## The lock-step rule (hard)
⚠️ A capability claim may not appear on the site unless a requirement backs it (`SR-WEB-4`). A claim
that becomes false in engineering comes off the site in the same pass. Phase status on the page is
reviewed at every phase transition in the [Program Plan](https://app.notion.com/p/3a8472a5fb698198ab1fe54c7b3efaec).
Never let the marketing outrun the code — for this audience that is the whole credibility of the project.

## Engineering conventions
- **No build step, no framework, no dependencies, no CDN.** Vanilla HTML/CSS/JS. The page must open
  from `file://`. If a change would require npm, it is the wrong change.
- **Dark is the only surface.** As of 2026-07-26 the light theme and the toggle are **deleted**, not
  hidden. There is one palette. The page does not follow the OS colour scheme and has no theme
  switch. Owner preference, stated twice — do not "helpfully" restore a light theme, a toggle, or
  OS-following. (This reverses the earlier "light is the designed surface" rule; if you find that
  wording anywhere else, it is stale.)
- **Accessibility is a requirement, not a nicety** (`SR-WEB-5`): keyboard navigable, AA contrast,
  `prefers-reduced-motion` respected. **Verify contrast numerically** before shipping a colour
  change — the deep amber failed at 2.92:1 once already. Current measured ratios against
  `--bg #0F1922` are recorded in the `index.html` token block; the tightest pairing is
  `--ghost` on `--surface` at **3.1:1**, which clears the 3:1 graphics bar with nothing spare.
- **Analytics:** no cookies, no third-party scripts, no cross-site identifiers, DNT/GPC honoured
  (`SR-WEB-3`). The event schema in `README.md` is versioned — adding a prop is safe, renaming one
  breaks the funnel.
- Keep the page **calm**. One accent that carries meaning (amber), one visual system per idea. When
  adding a section, ask what gets removed.

## Model routing (inherits the Overboard program override)
- **Oracle = `opus5-oracle`** for judgment (positioning, adversarial UX/design review, "are we
  telling the right story?"). Distill first; one call; adjudicate-not-author.
- **Opus drives; Sonnet executes** well-scoped work. Opus reviews every hand-back.
