#!/usr/bin/env bash
# Shared check: exit 0 when the phase review approved HEAD. The phase-reviewer
# subagent records each commit it approves as one line of .git/review-ok, so
# the file holds every approved sha in this clone: an approval names exact
# code, and it stays valid on whichever branch has that commit while another
# branch in the same clone is reviewed. /review-phase withdraws HEAD's line
# before every dispatch (review-withdraw.sh), so a listed HEAD always means the
# latest review of it approved. Every PR needs a review, docs-only included,
# so there is no "not required yet" branch.
# Usage: review-check.sh <repo-root>
root="${1:-.}"
head=$(git -C "$root" rev-parse HEAD 2>/dev/null)
if [ -n "$head" ] && grep -qxF "$head" "$root/.git/review-ok" 2>/dev/null; then
  exit 0
fi
echo "the phase review has not approved HEAD ($head). Run /review-phase, fix until it stamps, then retry (AGENTS.md workflow step 5)." >&2
exit 1
