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

WORK="$(mktemp -d)"
REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

git clone --depth 1 --branch gh-pages --single-branch "$REMOTE" "$WORK" 2>/dev/null || {
  echo "gh-pages branch does not exist yet — creating it"
  git clone --depth 1 "$REMOTE" "$WORK"
  git -C "$WORK" checkout --orphan gh-pages
  git -C "$WORK" rm -rf . >/dev/null 2>&1 || true
}

if [ "$REMOVE" = "1" ]; then
  rm -rf "${WORK:?}/${SUBDIR:?}"
  MSG="remove preview ${SUBDIR}"
elif [ -n "$SUBDIR" ]; then
  rm -rf "${WORK:?}/${SUBDIR}"
  mkdir -p "${WORK}/${SUBDIR}"
  cp -R _site/. "${WORK}/${SUBDIR}/"
  # Only the ROOT CNAME means anything to Pages; a copy under pr-preview/ is
  # dead weight that reads like a second custom domain to the next person here.
  rm -f "${WORK}/${SUBDIR}/CNAME"
  MSG="preview ${SUBDIR} @ ${GITHUB_SHA::7}"
else
  # Replace the root, but never touch live PR previews.
  find "$WORK" -mindepth 1 -maxdepth 1 \
       ! -name '.git' ! -name 'pr-preview' -exec rm -rf {} +
  cp -R _site/. "$WORK"/
  MSG="deploy ${GITHUB_SHA::7}"
fi

# Stops GitHub Pages running the files through Jekyll, which would otherwise
# silently drop anything starting with an underscore.
touch "$WORK/.nojekyll"

cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "No change to publish."
  exit 0
fi
git -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$MSG"
git push -q origin gh-pages
echo "Published: $MSG"
