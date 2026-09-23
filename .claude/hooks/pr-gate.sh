#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash). Refuses `gh pr create` and
# `gh pr merge` unless HEAD is listed in both stamps: .git/review-ok, where the
# phase-reviewer subagent records each commit /review-phase approved, and
# .git/preflight-ok, where `npm run preflight` records each commit it passed on.
# One refusal names every missing or stale stamp.
#
# It fails closed: without jq, or with a tool input jq cannot read, it cannot
# tell a PR command from any other, so it refuses the command.
set -u
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is not installed, so the PR gate cannot read this command and refuses it. Install jq (README, Development)."}}'
  exit 0
fi
if ! cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null); then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"The PR gate could not read the tool input, so it refuses the command."}}'
  exit 0
fi
[ -z "$cmd" ] && exit 0
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]]|$)' || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
reasons=""
for check in review-check.sh preflight-check.sh; do
  if ! out=$("$root/.githooks/$check" "$root" 2>&1); then
    reasons="$reasons$out "
  fi
done
[ -z "$reasons" ] && exit 0
# jq escapes whatever the checks printed; hand-built JSON could turn a
# backslash or a control character into output that is no deny at all.
jq -cn --arg reason "$(printf '%s' "$reasons" | tr '\n' ' ')" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
exit 0
