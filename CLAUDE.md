# overboard-web — project notes

The public landing page for Overboard. Control code and the sim live in `overboard`; renders live
in `overboard-viz`.

Earlier process rules (ownership, copy gate, lock-step, publication categories) were archived on
2026-10-03 (git tag `archive/pre-reset-2026-10-03`). They are historical and do not bind any work.

## Conventions
- Vanilla HTML/CSS/JS. No build step, no framework, no CDN. The page opens from `file://`.
- Dark is the only surface; there is no light theme and no theme toggle (Mike's preference).
- Accessibility: keyboard navigable, AA contrast, `prefers-reduced-motion` respected. Check
  contrast numerically before you change a colour. Tokens are in the `index.html` token block.
- Analytics: no cookies, no third-party scripts, DNT/GPC honoured. The event schema in
  `README.md` is versioned; add props, do not rename them.
- Keep the page calm: one meaningful accent (amber).
