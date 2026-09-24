#!/usr/bin/env bash
# Withdraws any approval of HEAD from .git/review-ok, leaving every other
# approved sha in place. /review-phase runs it before every dispatch, so HEAD
# is listed only when the latest review of it approved: a later Not approved
# verdict, a crashed round or a malformed report leaves no earlier approval
# behind. It only ever removes a line; adding one is the reviewer's alone.
# Usage: review-withdraw.sh <repo-root>
set -u
root="${1:-.}"
head=$(git -C "$root" rev-parse HEAD 2>/dev/null)
if [ -z "$head" ]; then
  echo "review-withdraw: $root has no HEAD commit" >&2
  exit 1
fi
stamp="$root/.git/review-ok"
[ -f "$stamp" ] || exit 0
grep -vxF "$head" "$stamp" > "$stamp.withdrawing"
mv "$stamp.withdrawing" "$stamp"
exit 0
