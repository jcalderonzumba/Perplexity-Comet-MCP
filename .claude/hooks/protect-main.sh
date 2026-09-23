#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash). Denies git commands that would
# write to main. Reads the tool input JSON on stdin.
#
# Git commands aimed at the private notebook with `-C .work` (or `-C` any path
# ending in /.work) are exempt: .work/ is a repository of its own whose main is
# its only branch (AGENTS.md, Where truth lives).
#
# It fails closed: without jq, or with a tool input jq cannot read, it cannot
# tell a write to main from any other git command, so it refuses the command.
set -u
deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}
if ! command -v jq >/dev/null 2>&1; then
  deny "jq is not installed, so branch protection cannot read this command and refuses it. Install jq (README, Development)."
fi
if ! cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null); then
  deny "Branch protection could not read the tool input, so it refuses the command."
fi
[ -z "$cmd" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
# Every git invocation aimed at .work/ is rewritten to a word that no rule
# below matches, so only the commands aimed at this repository are judged.
public_cmd=$(printf '%s' "$cmd" | sed -E 's#(^|[^[:alnum:]_-])git[[:space:]]+-C[[:space:]]+([^[:space:]]*/)?\.work/?([[:space:]]|$)#\1notebook-git\3#g')
if [ "$branch" = "main" ] && printf '%s' "$public_cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(commit|merge|rebase|cherry-pick|revert)([[:space:]]|$)'; then
  deny "Direct writes to main are forbidden (AGENTS.md workflow). Create a branch: git switch -c feat/<plan>-p<phase>-<slug>"
fi
# Only the arguments of the push segment are inspected, so the word "main" in a
# commit message or an echo elsewhere in a compound command does not trigger.
push_args=$(printf '%s' "$public_cmd" | grep -oE '(^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([^&;|]*)' | head -1)
if [ -n "$push_args" ]; then
  if [ "$branch" = "main" ] || printf '%s' "$push_args" | grep -Eq '(^|[[:space:]:/])main([[:space:]]|$)'; then
    deny "Pushing to main is forbidden (AGENTS.md workflow). Push a feature branch and open a PR."
  fi
fi
exit 0
