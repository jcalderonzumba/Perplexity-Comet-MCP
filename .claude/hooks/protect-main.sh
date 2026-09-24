#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash). Denies git commands that would
# write to main. Reads the tool input JSON on stdin.
#
# Git commands aimed at the private notebook with `-C .work` (or `-C` any path
# ending in /.work), with no other global option before the subcommand, are
# exempt: .work/ is a repository of its own whose main is its only branch
# (AGENTS.md, Where truth lives).
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
# git's global options that may come before the subcommand: -C and -c with their
# argument (quoted or not), and any other long or short flag, a long one taking
# at most one separate argument. No option names are listed, so an option git
# adds later cannot walk past the rules; the cost is over-denying, never
# under-denying.
global_opts="([[:space:]]+(-[Cc][[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:]]+)|--[a-z][a-z-]*(=[^[:space:]]*|[[:space:]]+[^-[:space:]][^[:space:]]*)?|-[a-zA-Z]))*"
# A git invocation aimed at .work/, `git -C <…/.work> <subcommand>` with no other
# global option, is rewritten to a word that no rule below matches, so only the
# commands aimed at this repository are judged. Anything more (a second -C,
# --git-dir, --work-tree) could point git back here, so it is judged too.
public_cmd=$(printf '%s' "$cmd" | sed -E 's#(^|[^[:alnum:]_-])git[[:space:]]+-C[[:space:]]+([^[:space:]]*/)?\.work/?[[:space:]]+([a-z][a-z-]*)#\1notebook-git \3#g')
if [ "$branch" = "main" ] && printf '%s' "$public_cmd" | grep -Eq "(^|[^[:alnum:]_-])git${global_opts}[[:space:]]+(commit|merge|rebase|cherry-pick|revert)([[:space:]]|\$)"; then
  deny "Direct writes to main are forbidden (AGENTS.md workflow). Create a branch: git switch -c feat/<plan>-p<phase>-<slug>"
fi
# Every push segment of the command is judged, one per line, and only its own
# arguments, so the word "main" in a commit message or an echo elsewhere in a
# compound command does not trigger. A leading + (a forced refspec) still names main.
push_segments=$(printf '%s' "$public_cmd" | grep -oE "(^|[^[:alnum:]_-])git${global_opts}[[:space:]]+push([^&;|]*)")
if [ -n "$push_segments" ]; then
  if [ "$branch" = "main" ] || printf '%s\n' "$push_segments" | grep -Eq '(^|[[:space:]:/+])main([[:space:]]|$)'; then
    deny "Pushing to main is forbidden (AGENTS.md workflow). Push a feature branch and open a PR."
  fi
fi
exit 0
