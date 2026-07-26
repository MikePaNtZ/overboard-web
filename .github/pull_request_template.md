<!--
  overboard-web PR template.

  Two things below are gates, not paperwork: the Lane declaration and the
  claim/requirement table. Everything else is a reminder.

  A preview URL is posted as a comment once checks pass. Review the rendered
  page, not the diff — the diff cannot tell you whether the page is honest.
-->

## What this changes

<!-- One or two sentences. What a reader of the page would notice. -->

---

## Lane declaration

**Required for every asset added to the site.** Lanes are defined in
[M3 §6](https://app.notion.com/p/3a9472a5fb6981e99789e799fd777da8) — *"(a) is the surface,
(b) is the spine"*:

- **Lane A — the onewheel.** The machine itself: clips, renders, the trail, performance
  numbers, hardware. Audience is PEV and robotics hobbyists.
- **Lane B — the making.** How it is being built: the design-doc process, adversarial
  review, sim-first gates, AI as collaborator, the failures. This is the differentiator
  and the only through-line connecting Overboard to the education thesis in
  [P0](https://app.notion.com/p/3a9472a5fb69815587c7ca82e22ac781).

> Declare a lane per asset, not per PR. A PR may carry both.

| Asset (file or section) | Lane | Why this lane |
| --- | --- | --- |
|  | A / B |  |

- [ ] No new asset in this PR — lane declaration not applicable

---

## Claims and their backing

⚠️ **The lock-step rule (`SR-WEB-4`): a capability claim may not appear on the site unless
a requirement backs it, and a claim that becomes false in engineering comes off the site in
the same pass.** This is the project's whole credibility premise — for this audience it is
the *only* thing that separates it from every other build-in-public page.

List every claim this PR places on the page next to an asset, and what backs it. "Backed"
means a requirement ID (`UR-11..13`, `SR-WEB-*`) plus something checkable — a passing test,
a metrics JSON, a design doc.

| Claim as it appears on the page | Requirement | Evidence |
| --- | --- | --- |
|  |  |  |

- [ ] This PR adds no capability claim

**Before ticking anything below, confirm the evidence is real:**

- [ ] Every number on the page matches the run that produced it, and I have opened that run's output
- [ ] No number comes from an **ideal-sensor** run being presented as a general result
      <!-- Truth-pitch and unfitted-constant results are optimistic. If a figure depends on
           one, either say so beside it or hold the figure. -->
- [ ] Nothing on the page implies an asset, phase or capability that does not exist
      <!-- The trail owns "not yet" via the dashed language. #now shows recorded reality only. -->
- [ ] Any claim this PR makes false elsewhere on the page is corrected **in this PR**

---

## Page rules — these are enforced in CI

`.github/scripts/check_page.py` will fail the build on all of these. Listed so the reasons
travel with the rule, since each encodes a decision that is easy to undo in good faith.

- [ ] Video: `controls` + `preload="none"`, **never** `autoplay` or `loop`
- [ ] **No CSS `filter` on video** — the grade is baked into the render
- [ ] Dark only — no theme system, no toggle, no `prefers-color-scheme`
- [ ] No third-party fetches, no CDN, no build step
- [ ] Contrast verified **numerically** if any colour changed
- [ ] `prefers-reduced-motion` respected by any new motion

Run locally before pushing: `python3 .github/scripts/check_page.py`

---

## Review

- [ ] I opened the **preview URL** and looked at the rendered page
- [ ] Checked at a narrow width, not just desktop
- [ ] The governing Notion doc was updated **in the same pass** if page structure changed
      (M2 for structure, M2b for copy, Web Implementation Log for the decision record)
