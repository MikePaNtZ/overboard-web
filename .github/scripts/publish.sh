#!/usr/bin/env bash
#
# Publish the site to the gh-pages branch.
#
#   ./publish.sh              → replaces the site ROOT (production)
#   ./publish.sh pr-preview/pr-12 → writes into that subdirectory (a PR preview)
#   ./publish.sh --remove pr-preview/pr-12 → deletes that subdirectory
#
# Deliberately plain git rather than a third-party publishing action: this repo
# is public and has a no-dependencies ethos, and the whole operation is a copy
# and a commit. The only action used anywhere is actions/checkout (first-party).
#
set -euo pipefail

REMOVE=0
if [ "${1:-}" = "--remove" ]; then REMOVE=1; shift; fi
SUBDIR="${1:-}"

: "${GH_TOKEN:?GH_TOKEN must be set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

# Resolved ONCE, before anything cds. publish_once copies from here, and it used
# to say `_site` relative -- which resolved against whatever directory the last
# attempt had cd'd into, not the workspace. Absolute, so attempt 2 reads the same
# source as attempt 1.
SITE="$(pwd)/_site"

# One attempt: clone the branch fresh, apply the change, push. Everything below
# is inside this function so a rejected push can simply be retried -- a retry
# re-clones, so it always rebuilds on top of whatever landed meanwhile rather
# than trying to replay a stale tree.
#
# The body is a SUBSHELL -- `(` not `{` -- so the `cd "$WORK"` at the bottom
# cannot leak into the next attempt. It used to leak, and that is what made the
# retry path dangerous: attempt 2 resolved the relative `_site` against attempt
# 1's clone, the copy failed, and the wipe above it got published as an empty
# site. `$SITE` being absolute is the other half of that fix.
#
# ⚠️ `set -e` DOES NOT PROTECT THIS FUNCTION, and re-arming it here would not
# help. Bash ignores -e for every command inside a function used as an `if`
# condition or either side of `||`, and that exemption propagates INTO the
# subshell -- a `set -e` on the first line of this body still does not abort on
# a failing command (verified, not assumed). The retry loop has to test the exit
# status somehow, so there is no calling form that keeps -e alive.
#
# So every step whose failure could leave a *publishable but wrong* tree is
# checked explicitly below, and the invariant before the commit is the backstop.
publish_once() (

WORK="$(mktemp -d)" || return 2

git clone --depth 1 --branch gh-pages --single-branch "$REMOTE" "$WORK" 2>/dev/null || {
  echo "gh-pages branch does not exist yet — creating it"
  git clone --depth 1 "$REMOTE" "$WORK" || return 2
  git -C "$WORK" checkout --orphan gh-pages || return 2
  git -C "$WORK" rm -rf . >/dev/null 2>&1 || true
}

if [ "$REMOVE" = "1" ]; then
  rm -rf "${WORK:?}/${SUBDIR:?}"
  MSG="remove preview ${SUBDIR}"
elif [ -n "$SUBDIR" ]; then
  rm -rf "${WORK:?}/${SUBDIR}"
  mkdir -p "${WORK}/${SUBDIR}" || return 2
  cp -R "$SITE"/. "${WORK}/${SUBDIR}/" || return 2
  # Only the ROOT CNAME means anything to Pages; a copy under pr-preview/ is
  # dead weight that reads like a second custom domain to the next person here.
  rm -f "${WORK}/${SUBDIR}/CNAME"
  MSG="preview ${SUBDIR} @ ${GITHUB_SHA::7}"
else
  # Replace the root, but never touch live PR previews.
  find "$WORK" -mindepth 1 -maxdepth 1 \
       ! -name '.git' ! -name 'pr-preview' -exec rm -rf {} +
  cp -R "$SITE"/. "$WORK"/ || return 2
  MSG="deploy ${GITHUB_SHA::7}"
fi

# Stops GitHub Pages running the files through Jekyll, which would otherwise
# silently drop anything starting with an underscore.
touch "$WORK/.nojekyll"

# The backstop. Every path above except --remove has just replaced a directory
# with a fresh copy of the site, so index.html must be there and non-empty. If it
# is not, something failed in a way that left a tree which would commit and push
# perfectly happily -- publishing a blank site over a working one, green. Refuse.
if [ "$REMOVE" != "1" ]; then
  EXPECT="${WORK}/${SUBDIR:+${SUBDIR}/}index.html"
  if [ ! -s "$EXPECT" ]; then
    echo "FAILED: ${EXPECT} is missing or empty — refusing to publish this tree." >&2
    return 2
  fi
fi

cd "$WORK" || return 2
git add -A
if git diff --cached --quiet; then
  echo "No change to publish."
  return 0
fi
git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$MSG" || return 2
# The ONLY retryable failure: someone else's publish landed between our clone and
# our push. Everything else above returns 2 and fails the build on the spot.
git push -q origin gh-pages || return 1
echo "Published: $MSG"
return 0

)

# A rejected push means another publish landed between our clone and our push --
# a deploy and a preview cleanup running concurrently, which is now possible by
# design since the concurrency groups were split. Re-clone and reapply.
#
# Exit codes are load-bearing, because "retry everything" and "fail loudly" pull
# in opposite directions and only one of them is right per failure:
#
#   0 → published, or genuinely nothing to publish
#   1 → push rejected. Retryable, and the ONLY retryable case
#   2 → anything else (clone, copy, commit, or the empty-tree backstop). Fatal
#       on the first occurrence -- retrying a broken checkout three times just
#       prints the same error twice more and delays the red build
#
# A publish that cannot push must fail the build LOUDLY. A silently skipped
# deploy is the exact failure this whole change exists to remove.
for attempt in 1 2 3; do
  rc=0
  publish_once || rc=$?
  case "$rc" in
    0) exit 0 ;;
    1) : ;;   # retryable, fall through
    *) echo "FAILED: publish aborted (exit ${rc}); not retrying." >&2; exit "$rc" ;;
  esac
  if [ "$attempt" -lt 3 ]; then
    echo "push rejected (attempt ${attempt}/3) — another publish landed first; retrying"
    sleep $((attempt * 3))
  fi
done

echo "FAILED: could not publish after 3 attempts." >&2
exit 1
