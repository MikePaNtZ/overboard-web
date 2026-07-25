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
- **Light is the designed surface.** The page does not follow the OS colour scheme; dark is reached
  only via the header toggle. Owner preference — do not "helpfully" restore OS-following.
- **Accessibility is a requirement, not a nicety** (`SR-WEB-5`): keyboard navigable, AA contrast in
  both themes, `prefers-reduced-motion` respected. **Verify contrast numerically** before shipping a
  colour change — the deep amber failed at 2.92:1 once already.
- **Analytics:** no cookies, no third-party scripts, no cross-site identifiers, DNT/GPC honoured
  (`SR-WEB-3`). The event schema in `README.md` is versioned — adding a prop is safe, renaming one
  breaks the funnel.
- Keep the page **calm**. One accent that carries meaning (amber), one visual system per idea. When
  adding a section, ask what gets removed.

## Model routing (inherits the Overboard program override)
- **Oracle = `opus5-oracle`** for judgment (positioning, adversarial UX/design review, "are we
  telling the right story?"). Distill first; one call; adjudicate-not-author.
- **Opus drives; Sonnet executes** well-scoped work. Opus reviews every hand-back.
