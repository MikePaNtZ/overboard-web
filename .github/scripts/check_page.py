#!/usr/bin/env python3
"""Guardrails for the Overboard landing page.

These are not style checks. Every rule here encodes a decision that was made
deliberately, written down in CLAUDE.md, and is easy to undo by accident — by a
future session, a well-meaning refactor, or an AI agent "improving" things.

A comment saying "do not autoplay" is advisory. This file makes it enforceable.

Run locally with:  python3 .github/scripts/check_page.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = ROOT / "index.html"

# Everything deploy.yml copies into _site and therefore serves. lab/ ships too —
# the design harnesses are public, so a claim parked in one is a published claim.
def published_html() -> list[Path]:
    return [PAGE] + sorted((ROOT / "lab").glob("*.html"))


failures: list[str] = []
notes: list[str] = []


def fail(rule: str, detail: str) -> None:
    failures.append(f"{rule}\n    {detail}")


def strip_comments(s: str) -> str:
    """Remove HTML comments and CSS/JS block comments.

    Every rule below runs against stripped markup — the source deliberately
    *discusses* autoplay, loop and filters in its comments, and those mentions
    must not trip the checks that forbid them.
    """
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return s


def main() -> int:
    if not PAGE.exists():
        print("index.html not found", file=sys.stderr)
        return 1

    raw = PAGE.read_text(encoding="utf-8")
    src = strip_comments(raw)

    # ── 1. Every local asset the page references must actually exist ─────────
    refs = set(re.findall(r'(?:src|href|poster)="((?!https?:|data:|mailto:|#)[^"]+)"', src))
    for ref in sorted(refs):
        if not (ROOT / ref).exists():
            fail("BROKEN LOCAL REFERENCE", f"{ref} is referenced by index.html but does not exist")

    # ── 1b. The share card must resolve to a file the deploy actually ships ──
    # og:image has to be an ABSOLUTE URL — scrapers do not resolve relative
    # paths — which put it outside rule 1 above. So the tag read
    # https://overboardproject.com/og.png while the file shipped at
    # assets/og.png, and every share on HN, Reddit, Slack and iMessage rendered
    # a broken card. Markup looked right, CI was green, the URL was a 404. That
    # card is seen by more people than the page, before anyone decides to click.
    #
    # This rule resolves the URL back to a repo path AND checks the deploy
    # copies it, so neither moving the file nor editing the tag can break the
    # card silently again.
    deploy_yml = ROOT / ".github" / "workflows" / "deploy.yml"
    shipped: set[str] = set()
    if deploy_yml.exists():
        for line in deploy_yml.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*cp\s+(?:-\S+\s+)*(.+?)\s+_site/\s*$", line)
            if m:
                shipped.update(Path(tok).parts[0] for tok in m.group(1).split())

    canonical = re.search(r'<link\b[^>]*\brel="canonical"[^>]*\bhref="(https?://[^"]+)"', src)
    origin = canonical.group(1).rstrip("/") if canonical else ""

    social = re.findall(
        r'<meta\b[^>]*\b(?:property|name)="(og:image|twitter:image)"[^>]*\bcontent="([^"]+)"', src)
    if not social:
        fail("MISSING SOCIAL CARD IMAGE",
             "og:image is what every share of this link renders. Without it the card is text only.")
    for prop, url in social:
        if not url.startswith(("http://", "https://")):
            fail("SOCIAL IMAGE NOT ABSOLUTE",
                 f"{prop} is {url!r}. Scrapers do not resolve relative paths — it must be absolute.")
            continue
        if not origin:
            continue
        if not url.startswith(origin + "/"):
            notes.append(f"{prop} is hosted off-origin ({url}) — cannot be verified from this repo.")
            continue
        path = url[len(origin) + 1:].split("?")[0].split("#")[0]
        if not (ROOT / path).exists():
            fail("SOCIAL IMAGE DOES NOT EXIST",
                 f"{prop} points at {url}, but this repo has no {path}. The share card will 404.")
        elif shipped and Path(path).parts[0] not in shipped:
            fail("SOCIAL IMAGE NOT DEPLOYED",
                 f"{path} exists here, but deploy.yml does not copy "
                 f"{Path(path).parts[0]!r} into _site — so {url} will 404 on the live site.")

    # ── 2. Video behaviour (M2 / handoff §4) ────────────────────────────────
    videos = re.findall(r"<video\b[^>]*>", src)
    if len(videos) < 2:
        fail("VIDEO COUNT",
             f"expected at least 2 <video> elements (the #now toggle pair), found {len(videos)}")

    for tag in videos:
        if re.search(r"\bautoplay\b", tag):
            fail("AUTOPLAY FORBIDDEN",
                 "click-to-play is what keeps the page zero-fetch and sidesteps "
                 "prefers-reduced-motion. Never autoplay.")
        if re.search(r"\bloop\b(?!-)", re.sub(r'"[^"]*"', "", tag)):
            fail("LOOP FORBIDDEN",
                 "looping a crash turns a measurement into slapstick.")
        if 'preload="none"' not in tag:
            fail("PRELOAD MUST BE none",
                 f'every <video> needs preload="none" so nothing is fetched until a click: {tag[:70]}')
        if "controls" not in tag:
            fail("CONTROLS REQUIRED", f"video is missing the controls attribute: {tag[:70]}")

    ids = re.findall(r'data-ob-video="([^"]+)"', src)
    if len(set(ids)) != len(ids):
        fail("DUPLICATE VIDEO ID", f"data-ob-video ids must be unique, got {ids}")
    if len(ids) != len(videos):
        fail("VIDEO INSTRUMENTATION",
             f"{len(videos)} <video> elements but {len(ids)} data-ob-video ids. Every clip must be "
             "in the DOM at load and instrumented — analytics.js binds once, so a video injected "
             "later by JS is never measured.")

    # ── 3. No CSS filter on video — the grade is baked into the render ──────
    for rule in re.findall(r"\.media\s+video\s*\{[^}]*\}", src):
        if "filter" in rule:
            fail("CSS FILTER ON VIDEO",
                 "the colour grade is baked into the render; a filter costs GPU on scroll "
                 "and desyncs from the untinted poster.")

    # ── 4. Dark-only (CLAUDE.md, owner call 2026-07-26) ─────────────────────
    if "data-theme" in src:
        fail("THEME SYSTEM REINTRODUCED",
             "the light theme and the toggle were deleted, not hidden. One palette.")
    if re.search(r"prefers-color-scheme", src):
        fail("OS COLOUR-SCHEME FOLLOWING",
             "the page deliberately does not follow the OS colour scheme.")

    # ── 5. No build step, no CDN, no dependencies ───────────────────────────
    # Only resources the browser actually FETCHES count. rel="canonical" and the
    # Open Graph tags are metadata pointing at our own future URL — not requests.
    FETCHING_REL = ("stylesheet", "preload", "prefetch", "preconnect",
                    "dns-prefetch", "modulepreload", "icon")
    for tag in re.findall(r"<script\b[^>]*>", src):
        m = re.search(r'src="(https?://[^"]+)"', tag)
        if m:
            fail("EXTERNAL SCRIPT",
                 f"the page must fetch nothing from a third party: {m.group(1)}")
    for tag in re.findall(r"<link\b[^>]*>", src):
        rel = re.search(r'rel="([^"]+)"', tag)
        href = re.search(r'href="(https?://[^"]+)"', tag)
        if rel and href and any(r in rel.group(1).lower() for r in FETCHING_REL):
            fail("EXTERNAL STYLESHEET/RESOURCE",
                 f"the page must fetch nothing from a third party: {href.group(1)}")

    # ── 6. Accessibility floor ──────────────────────────────────────────────
    if not re.search(r'class="skip"', src):
        fail("MISSING SKIP LINK", "the skip-to-content link is a keyboard-navigation requirement.")
    if "prefers-reduced-motion" not in src:
        fail("REDUCED MOTION UNHANDLED",
             "the page animates; prefers-reduced-motion must be respected.")

    # ── 6b. The log intro states a count; it must match reality ────────────
    # The intro used to say "Most of these are things that went wrong", which was
    # not true of the entries underneath it. It now states a number, and a number
    # on a page whose whole asset is credibility has to be checkable — including
    # by the next person who adds an entry and does not think to look up here.
    WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
             "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
             "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
             "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
             "twenty": 20}
    log_section = re.search(r'<section id="log".*?</section>', src, flags=re.S)
    if log_section:
        body = log_section.group(0)
        actual = len(re.findall(r"<h3>", body))
        # The sentence wraps across source lines, so match on collapsed whitespace.
        flat = re.sub(r"\s+", " ", body)
        claim = re.search(r"(\w+) of the (\w+) entries here", flat, flags=re.I)
        if not claim:
            fail("LOG COUNT SENTENCE MISSING",
                 'the log intro must state "<n> of the <total> entries here are things that went '
                 'wrong" — a specific number, not "most" (Voice & Style Guide rule 8).')
        else:
            failures_claimed = WORDS.get(claim.group(1).lower())
            total_claimed = WORDS.get(claim.group(2).lower())
            if total_claimed is None:
                fail("LOG COUNT UNPARSEABLE", f'could not read "{claim.group(2)}" as a number.')
            elif total_claimed != actual:
                fail("LOG COUNT DRIFTED",
                     f'the log intro claims {total_claimed} entries, but there are {actual}. '
                     f"Update the sentence — and re-count the failures honestly while you are there.")
            if failures_claimed is not None and total_claimed is not None \
                    and failures_claimed > total_claimed:
                fail("LOG COUNT IMPOSSIBLE",
                     f"claims {failures_claimed} failures out of {total_claimed} entries.")

    # ── 6c. The withdrawn stability claim, and the dead launch date ─────────
    # ADR-0011 (overboard repo) holds the 2026-08-03 launch and withdraws the
    # claim "the board never became unstable at any aggression level tested".
    # The claim is FALSE: holding full forward stick from rest saturates the
    # motor at 6.53 m/s and the board is inverted 1.55 s later. It measured as
    # stable for two days only because the input harness delivered stick at
    # 7-13 Hz instead of 50 Hz and silently zeroed a fraction of every run — so
    # the measurements behind the claim support nothing and may not be cited.
    #
    # The `policy` gate in the controls repo has this claim registered, but it
    # does not gate THIS repo. This is the only thing standing between a
    # withdrawn claim and the public page, so it fails the build rather than
    # filing a note. ADR-0011 forbids reinstating it "in any softened form",
    # which is why these match the SHAPE of the claim, not one exact string.
    #
    # Checked against RAW source, not stripped: HTML comments are served to
    # anyone who views source, so a claim parked in one is still published.
    #
    # If the hold lifts, this does not get deleted — it gets narrowed, in the
    # same pass as the ADR that supersedes 0011 and with a measured number in
    # place of the word "stable" (ADR-0011 exit criterion 2).
    withdrawn_claim = [
        (r"never\s+(became|went|got|was|turns?|turned)\s+unstable", "denies instability outright"),
        (r"(did\s*n[o']t|does\s*n[o']t|never)\s+(become|go|turn)\s+unstable", "denies instability outright"),
        (r"\bno\s+instability\b", "denies instability outright"),
        (r"aggressi(on|veness)\s+level", "the aggression sweep is withdrawn; its numbers may not be cited"),
        (r"at\s+(all|any|every)\s+(aggression|input|stick|lean|speed)\s+levels?", "claims stability over an input range"),
        (r"(any|every|all)\s+aggressi(on|veness)", "claims stability over an input range"),
        (r"never\s+(fell|flipped|toppled|inverted|crashed|went\s+over)", "softened form of the withdrawn claim"),
        (r"never\s+lost\s+(its\s+)?(balance|control)", "softened form of the withdrawn claim"),
        (r"(always|every\s+time)\s+(recovered|caught\s+itself|stayed\s+up|stayed\s+upright)",
         "softened form of the withdrawn claim"),
        (r"stable\s+(at|across|through|under|in)\s+(all|any|every|the\s+full)",
         "claims stability over an input range"),
        (r"(handles?|survives?|holds?|stable\s+at)\s+full\s+(stick|lean|throttle|forward)",
         "full stick is exactly the input that inverts the board"),
    ]

    # There is NO new launch date — the hold is gated on engineering, open-ended.
    # So any dated launch announcement on this page is wrong by construction
    # today, not merely unverified. Whoever sets a real date edits this list in
    # the same pass, deliberately, which is the point.
    dead_date = [
        (r"2026[-/]0?8[-/]0?3\b", "the 2026-08-03 launch is held (ADR-0011)"),
        (r"\b0?8[-/]0?3[-/]2026\b", "the 2026-08-03 launch is held (ADR-0011)"),
        (r"august\s+3(rd)?\b", "the 2026-08-03 launch is held (ADR-0011)"),
        (r"\baug\.?\s+3(rd)?\b", "the 2026-08-03 launch is held (ADR-0011)"),
        (r"\b3(rd)?\s+august\b", "the 2026-08-03 launch is held (ADR-0011)"),
        (r"launch(es|ing)?\s+(on\s+)?(monday|august|aug\b)", "announces a launch that is not happening"),
        (r"\blaunch(es|ing)?\s+(this|next)\s+(monday|week)", "announces a launch that is not happening"),
        (r"go(es|ing)?\s+live\s+(on\s+)?(monday|august|aug\b)", "announces a launch that is not happening"),
        (r"ships?\s+(on\s+)?monday", "announces a launch that is not happening"),
    ]

    for path in published_html():
        raw_text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        for pattern, why in withdrawn_claim:
            m = re.search(pattern, raw_text, flags=re.I)
            if m:
                line = raw_text[:m.start()].count("\n") + 1
                fail("WITHDRAWN STABILITY CLAIM (ADR-0011)",
                     f'{rel}:{line} matched "{m.group(0)}" — {why}. '
                     f"The claim is withdrawn and may not be reinstated in any softened form; "
                     f"the measurements behind it may not be cited.")
        for pattern, why in dead_date:
            m = re.search(pattern, raw_text, flags=re.I)
            if m:
                line = raw_text[:m.start()].count("\n") + 1
                fail("DEAD LAUNCH DATE (ADR-0011)",
                     f'{rel}:{line} matched "{m.group(0)}" — {why}. '
                     f"There is no new date; the hold is gated on engineering.")

    # ── 7. Pre-launch placeholders — a note, not a failure, until L0 ────────
    for placeholder in ("overboard.example", "OWNER/overboard"):
        if placeholder in src:
            notes.append(f"{placeholder} is still in the page — must be replaced before the site is publicised (L0).")

    # ── Report ──────────────────────────────────────────────────────────────
    for n in notes:
        print(f"::notice::{n}")

    if failures:
        print("\nPage guardrails FAILED:\n", file=sys.stderr)
        for f in failures:
            print(f"  ✗ {f}\n", file=sys.stderr)
        print(f"{len(failures)} rule(s) violated. Each one encodes a deliberate decision — "
              f"if the decision has genuinely changed, update CLAUDE.md and this file together.",
              file=sys.stderr)
        return 1

    print(f"✓ All page guardrails passed ({len(refs)} local references resolved).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
