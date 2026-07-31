#!/usr/bin/env python3
"""Policy gate for overboard-web — the public surface.

Ported from the sibling `overboard` repo under the countersign agreed
2026-07-28, with the CMO's one substantive amendment implemented rather than
softened. See "The feedstock rule" below.

    python3 .github/policy_check.py

Stdlib only, on purpose: a governance gate must not be able to fail because a
dependency moved. It never queries Notion — a token-dependent required check
produces red builds the author cannot fix, which poisons the one interrupt this
org has that works.

WHAT THIS ADDS THAT check_page.py DOES NOT
------------------------------------------
`check_page.py` enforces asset integrity, video behaviour, dark-only, no build
step, and the accessibility floor. It says nothing about what the page CLAIMS.
This file is the claims half: language the project committed to never using, and
traceability for capability claims and figures.

THE FEEDSTOCK RULE — HARD, BUT NARROW
-------------------------------------
The CMO countersigned the port with one change, and it is the whole design:

    "Do not ship it advisory -- an advisory gate on a public surface gets
     ignored permanently, which is worse than none. Ship it HARD but NARROW:
     it fires only on a PR that adds or changes a CAPABILITY CLAIM or a
     NUMERIC FIGURE, not on every PR touching public-facing paths."

That is right, and the reasoning is right: a copy rewrite to a new voice guide,
a UI/UX fit-and-finish pass, accessibility fixes and Concept assets have no
engineering feedstock and should not have any. A gate people must routinely
bypass with a token value teaches them that gates are decorative.

So this check reads the DIFF, not the file. If a change adds no capability
language and no figure, the feedstock rule does not fire at all.

WHAT IT CANNOT DO, STATED RATHER THAN IMPLIED
---------------------------------------------
The role registry (`docs/decisions/ROLES.md`) lives in the sibling `overboard`
repo. This gate does NOT fetch it — a network dependency in a required check is
the failure ADR-0003 refuses. So `KNOWN_ROLES` below is a VENDORED MIRROR with a
declared direction: registry -> here, never back. It can go stale, and nothing
detects that automatically. Stated so nobody mistakes it for the source.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CODEOWNERS = REPO / ".github" / "CODEOWNERS"

# Public copy. Only these are read for claim language.
PUBLIC = ["index.html", "README.md"]

# Absolutes this project committed to never saying. Same list as the sibling
# repo, deliberately: three divergent copies of a rule is worse than one.
BANNED = [
    (re.compile(r"production[- ]ready", re.I), "the project is explicitly not production-ready"),
    (re.compile(r"\bcertified\b", re.I), "nothing here is certified by anyone"),
    (re.compile(r"guarantee[sd]?\s+(?:to\s+be\s+)?safe", re.I), "safety is not guaranteed"),
    (re.compile(r"safe\s+to\s+ride", re.I), "no ridden operation has cleared the D5 review"),
    (re.compile(r"perfectly\s+safe", re.I), "no."),
    (re.compile(r"crash[- ]proof", re.I), "no."),
    (re.compile(r"fully\s+autonomous", re.I), "overclaims the control stack"),
    (re.compile(r"medical[- ]grade|\bFDA\b"), "not a regulated device; do not borrow the language"),
]

CAPABILITY = re.compile(
    r"self[- ]balanc\w*|balances?\s+itself|rides?\s+itself|riderless|driverless"
    r"|autonomous|\bproven\b",
    re.I,
)

# A figure with a unit. Deliberately NOT bare integers -- "2 clips", "1 of 3"
# and every CSS value would trip it, which is how a narrow gate becomes a wide
# one nobody trusts.
FIGURE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:m|mm|cm|km|s|ms|kg|g|A|V|W|Hz|kHz|N·m|Nm|deg|°|%|m/s)\b"
)

# A banned absolute preceded by a negation is a DISCLAIMER, not a claim -- and
# disclaimers are exactly the language this project wants. The live page says
# "none of it is certified", which the naive word-match failed on its first run.
# A gate that punishes an honest denial teaches people to delete the denial,
# which is the opposite of what it exists for.
NEGATION = re.compile(
    r"\b(?:not|no|none|never|nothing|nobody|cannot|can't|won't|isn't|aren't|"
    r"doesn't|does not|is not|are not|will not)\b",
    re.I,
)

REQ_ID = re.compile(r"\b(?:UR|SR|DR)-[A-Z0-9]*-?\d+\b")
CLAIM_ATTR = re.compile(r'data-claim\s*=\s*"[^"]+"')
FEEDSTOCK_OK = re.compile(r"^[ \t]*FEEDSTOCK-OK:\s*(\S.*)", re.MULTILINE)

# VENDORED MIRROR of overboard/docs/decisions/ROLES.md. Direction: registry ->
# here, never back. Can go stale; nothing detects that. See the module docstring.
KNOWN_ROLES = {
    "CEO", "COO", "CMO", "Senior Digital Marketer", "Content Designer",
    "Digital Content Production", "Sr. Mechanical & Systems", "Senior Controls",
    "Archivist",
}

failures: list[str] = []
IN_CI = bool(os.environ.get("GITHUB_ACTIONS"))


def fail(check: str, msg: str) -> None:
    failures.append(f"{check}: {msg}")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()


def added_lines() -> list[str] | None:
    """Lines this change ADDS, across the public copy. None if no base.

    Diff-based, because the feedstock rule is about what a PR introduces. A page
    that already carries a figure does not re-trigger it on every unrelated edit.
    """
    base = os.environ.get("POLICY_BASE_REF", "origin/main")
    merge_base = git("merge-base", base, "HEAD")
    if not merge_base:
        # In CI this means the workflow is misconfigured -- depth-1 checkout, no
        # merge-base. The sibling repo shipped exactly that bug and both its
        # diff-based checks silently skipped on every PR for their whole
        # existence while the gate printed "all checks pass". Fail loudly here
        # rather than repeat it.
        if IN_CI:
            fail("feedstock", "cannot resolve a diff base IN CI -- this check would "
                             "have silently skipped and the gate would have reported "
                             "green. Check fetch-depth and POLICY_BASE_REF.")
        else:
            print("feedstock: no diff base -- skipping (local run)")
        return None
    out = git("diff", "-U0", f"{merge_base}...HEAD", "--", *PUBLIC)
    return [ln[1:] for ln in out.splitlines()
            if ln.startswith("+") and not ln.startswith("+++")]


def check_banned() -> None:
    """Absolutes, checked against the whole file. Always on, never narrow.

    Unlike feedstock this is not diff-scoped: a banned absolute already live on
    the page is a problem whether or not this PR touched it.
    """
    for name in PUBLIC:
        p = REPO / name
        if not p.is_file():
            continue
        for lineno, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            for pattern, why in BANNED:
                m = pattern.search(line)
                if not m:
                    continue
                # Only text BEFORE the match counts: "none of it is certified"
                # is a denial; "certified, and not a toy" is not.
                if NEGATION.search(line[:m.start()]):
                    continue
                fail("banned-absolute", f"{name}:{lineno} {pattern.pattern!r} -- {why}")


def check_feedstock(added: list[str]) -> None:
    """HARD, but only when a change introduces a claim or a figure.

    Feedstock means one of: a requirement ID in scope, or a `data-claim`
    binding tying the number to the engineering claims manifest. `FEEDSTOCK-OK:`
    at the start of a line in a commit message is the escape hatch, so the
    reason lands in git history rather than an editable field.
    """
    blob = "\n".join(added)
    caps = CAPABILITY.search(blob)
    figs = FIGURE.search(blob)
    if not caps and not figs:
        print("feedstock: this change adds no capability claim and no figure -- rule not engaged")
        return

    if REQ_ID.search(blob) or CLAIM_ATTR.search(blob):
        print("feedstock: claim/figure added, and it cites a requirement or a data-claim binding")
        return

    base = os.environ.get("POLICY_BASE_REF", "origin/main")
    merge_base = git("merge-base", base, "HEAD")
    msgs = git("log", f"{merge_base}..HEAD", "--format=%B")
    om = FEEDSTOCK_OK.search(msgs)
    if om:
        print(f"feedstock: overridden -- {om.group(1).strip()}")
        return

    what = []
    if caps:
        what.append(f"capability language ({caps.group(0)!r})")
    if figs:
        what.append(f"a figure ({figs.group(0)!r})")
    fail("feedstock",
         f"this change adds {' and '.join(what)} to public copy with no requirement "
         f"ID and no data-claim binding. SR-WEB-4: a capability claim may not appear "
         f"unless a requirement backs it, and a figure the site states should be tied "
         f"to the engineering claims manifest so it cannot go stale silently. "
         f"Cite one, or put 'FEEDSTOCK-OK: <reason>' at the start of a line in a "
         f"COMMIT MESSAGE on this branch")


def check_codeowners() -> None:
    """Every rule carries a `# role:` tag, and the tag names a known role."""
    if not CODEOWNERS.is_file():
        fail("ownership", ".github/CODEOWNERS is missing")
        return
    pending = None
    for lineno, raw in enumerate(CODEOWNERS.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            m = re.match(r"#\s*role:\s*(.+?)\s*$", line)
            if m:
                pending = m.group(1)
            continue
        if pending is None:
            fail("ownership", f"CODEOWNERS:{lineno} rule {line.split()[0]!r} has no "
                              f"'# role:' tag above it")
            continue
        if pending not in KNOWN_ROLES:
            fail("ownership", f"CODEOWNERS:{lineno} role {pending!r} is not in the vendored "
                              f"role mirror. If the registry gained a role, update "
                              f"KNOWN_ROLES here -- direction is registry -> here, never back")
        pending = None


def main() -> int:
    check_banned()
    check_codeowners()
    added = added_lines()
    if added is not None:
        check_feedstock(added)

    if failures:
        print(f"POLICY FAILED -- {len(failures)} problem(s):\n")
        for f in failures:
            print(f"  x {f}")
        print("\nSee overboard/docs/decisions/ADR-0003. The feedstock rule is hard but "
              "narrow by design (CMO countersign, 2026-07-28): it fires only on a change "
              "that adds a capability claim or a figure.")
        return 1
    print("policy: all hard checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
