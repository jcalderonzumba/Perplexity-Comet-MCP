#!/usr/bin/env bash
# Shared check: exit 0 when preflight is not required or has passed on HEAD.
# `npm run preflight` adds each commit it passes on as one line of
# .git/preflight-ok, the same format as .git/review-ok (review-check.sh), so a
# preflight on one branch never invalidates another branch's.
# Usage: preflight-check.sh <repo-root>
root="${1:-.}"
pkg="$root/package.json"
if [ ! -f "$pkg" ] || ! grep -q '"preflight"' "$pkg"; then
  exit 0  # no preflight script yet (plan 1 phase 1): nothing to gate
fi
head=$(git -C "$root" rev-parse HEAD 2>/dev/null)
if [ -n "$head" ] && grep -qxF "$head" "$root/.git/preflight-ok" 2>/dev/null; then
  exit 0
fi
echo "preflight has not passed on HEAD ($head). Run 'npm run preflight' on the final commit, then retry (AGENTS.md workflow step 6)." >&2
exit 1
