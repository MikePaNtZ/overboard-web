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

## Publication categories — every asset on the site declares one

> 📖 **Definitions live in exactly one place:** [Overboard — Shared Vocabulary](https://app.notion.com/p/3aa472a5fb6981ebaaa7cf2e996f1e8b).
> **Do not restate them here.** Duplicated definitions diverge — that is what forced this rename.

Four categories: **Footage · Sim Replay · Hardware Replay · Concept**. A Replay always names its
source; there is no bare "Replay". Superseded: `Lane A` → **Sim Replay**, `Lane B` → **Concept**.

**What this binds on the page, which is our half of it:** the category fixes the *tense and the
numbers* of the copy sitting next to an asset. A **Concept** clip may not be captioned as though the
thing happened, and may carry no figures. Declaring the category is therefore a copy decision, not
just a file-management one. Enforced by the PR template.

## Source of truth
- **Notion is primary** for the product story. The docs that govern this repo:
  - [M0 — Product & Marketing Strategy](https://app.notion.com/p/3a8472a5fb6981ffbf73ee8297e62f07) — audience, positioning, launch moments, measurement plan.
  - [M1 — Press Release & FAQ](https://app.notion.com/p/3a8472a5fb69814dbe52cacd0f5735bf) — **the public story; the page must not say anything M1 does not.**
  - [M2 — Landing Page & Instrumentation Spec](https://app.notion.com/p/3a8472a5fb6981bb9574d7fa6caa1304) — page structure, event schema, design decisions.
  - [Visual Design & Brand](https://app.notion.com/p/3a8472a5fb69817bbad7e60b08ffc8a4) — palette, logo, the visual half of the identity.
  - ✍️ [Voice & Style Guide](https://app.notion.com/p/3ad472a5fb6981b1b6d0d7f72a2923a5) — **how every public word is written.** Binding on page copy, captions and log entries. Read it before writing or editing any prose here; the rules are derived from the CEO's own published writing and are not restated in this file.
  - [Requirements](https://app.notion.com/p/3a8472a5fb69817f98ebc9e52e1fb2d8) — `UR-11..13`, `SR-WEB-1..5`, `DR-WEB-1` are the ones this repo satisfies.
- Change the page and the governing Notion doc **in the same pass**. A structural change to the page
  that is not reflected in M2 is a defect.

## The copy gate (CEO direction, 2026-07-29 · reviewer rule added 2026-07-31)
A PR that adds or rewrites **prose on the live page** needs an **adversarial review** before it
merges — not a rubber stamp; the reviewer is asked to argue against it. Reviewing for voice is
reviewing against the Style Guide above, which is the standard the CEO rejected the previous copy
for missing.

**⚠️ The reviewer is never the author. That is the whole mechanism.**

| Who wrote the page copy | Who must clear it |
|---|---|
| Anyone other than the Senior Digital Marketer | **Senior Digital Marketer** |
| **Senior Digital Marketer** | **CMO** |
| Both have authored part of it, or neither is available | **CEO** |

The original wording named the SDM as the reviewer and stopped there, which left **no reviewer for
the SDM's own copy** — the one case where the author and the gatekeeper are the same role. That gap
was found the first time the SDM wrote page prose (PRs #26, #28) and closed by CEO ruling on
2026-07-31: the CMO reviews SDM copy, by symmetry with the SDM reviewing the CMO's.

- **Never self-clear, and never queue your own copy with `--auto`.** If you wrote it, you do not
  merge it. If the table above leaves you without a distinct reviewer, it escalates to the CEO
  rather than merging — a gate that dissolves when it becomes inconvenient is not a gate.
- The value in this instruction is the **split**, not the review. Reviewing your own prose is a
  rubber stamp with extra steps.
- **Scope: the website only.** Build-log entries ship at their own cadence and are exempt.
- Voice is not a matter of taste here. If a sentence cannot be traced to a rule in the guide,
  the guide wins or the guide gets amended — do not split the difference in the copy.
- **A reviewer may find the guide itself is wrong.** That has already happened: two of the guide's
  worked examples contradict its own rules, so anyone applying it faithfully inherits the defect.
  File it against the guide's owner (the CMO) rather than quietly diverging in the copy.

## The lock-step rule (hard)
⚠️ A capability claim may not appear on the site unless a requirement backs it (`SR-WEB-4`). A claim
that becomes false in engineering comes off the site in the same pass. Phase status on the page is
reviewed at every phase transition in the [Program Plan](https://app.notion.com/p/3a8472a5fb698198ab1fe54c7b3efaec).
Never let the marketing outrun the code — for this audience that is the whole credibility of the project.

## Git workflow — feature branch + PR (HARD)
- ⚠️ **The default branch here is `main`, not `master`.** The sibling `overboard` and `overboard-viz`
  repos use `master`; this one does not. Any rule phrased as "never commit to master" means **`main`**
  in this repo. Never commit to it directly.
- All work goes on a feature branch (`feat/…`, `fix/…`, `docs/…`) and lands via PR. Use your role's
  branch prefix where one is assigned (e.g. `feat/web/…`).
- CI is the merge gate. Do not merge red, and do not bypass branch protection.

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
