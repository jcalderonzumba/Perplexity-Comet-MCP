#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash). Denies git commands that would
# write to main. Reads the tool input JSON on stdin.
#
# Git commands aimed at the private notebook with `-C .work` (or `-C` any path
# ending in /.work), with no other global option before the subcommand and no
# GIT_ variable named before them, are exempt: .work/ is a repository of its own
# whose main is its only branch (AGENTS.md, Where truth lives).
#
# It judges the command's text twice: as written, and read as the shell reads
# it (double, single and $'…' quotes, backslash escapes, newlines inside quotes,
# a backslash-newline removed even inside a word, and a `#` that starts a word
# commenting out the rest of its line). It refuses when either reading writes
# to main, so where the text could be read either way, it refuses.
#
# It never runs the text, so it has limits, and the git hooks still refuse
# what it passes: a word made at run time (a variable's value, a command
# substitution) is not expanded, nor is a brace expansion (`git {commit,-m,x}`);
# a heredoc's body is read as if it were commands, so a quote in it can hide
# what follows; a git alias (`git -c alias.ci=commit ci`) is not resolved; and
# `git push --all` or `--mirror` pushes main without naming it.
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
# A backslash-newline continues the shell line: read as written, it is a
# space; read as the shell reads it, it is removed.
continuation=$'\\\n'
# One word of a git argument: quoted, backslash-escaped, or plain characters.
quoted="\"[^\"]*\"|'[^']*'"
word_part="${quoted}|\\\\.|[^[:space:]\"'\\\\]"
separate_argument="(${quoted}|\\\\.|[^-[:space:]\"'\\\\])(${word_part})*"
# git's global options that may come before the subcommand: -C and -c with their
# argument, and any other long or short flag, a long one taking at most one
# argument, separate or after `=`. An argument may be quoted or escaped, spaces
# and all. No option names are listed, so an option git adds later cannot walk
# past the rules; the cost is over-denying, never under-denying.
global_opts="([[:space:]]+(-[Cc][[:space:]]+(${word_part})+|--[a-z][a-z-]*(=(${word_part})*|[[:space:]]+${separate_argument})?|-[a-zA-Z]))*"
# Git also takes its repository, work tree and configuration from GIT_
# variables (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*, and more), and a variable set
# earlier in the command (as a prefix, with env or with export) could point a
# notebook command back here. So from the first GIT_ variable the command names
# on, no git invocation is exempt.
git_variable='(^|[^[:alnum:]_])GIT_[A-Z0-9_]+'

# Denies the command when this reading of its text writes to main.
judge() {
  local text=$1 exemptable=$1 judged_as_is="" public_cmd push_segments
  if [[ $text =~ $git_variable ]]; then
    exemptable=${text%%"${BASH_REMATCH[0]}"*}
    judged_as_is=${text:${#exemptable}}
  fi
  # A git invocation aimed at .work/, `git -C <…/.work> <subcommand>` with no
  # other global option, is rewritten to a word that no rule below matches, so
  # only the commands aimed at this repository are judged. Anything more (a
  # second -C, --git-dir, --work-tree) could point git back here, so it is
  # judged too.
  public_cmd=$(printf '%s' "$exemptable" | sed -E 's#(^|[^[:alnum:]_-])git[[:space:]]+-C[[:space:]]+([^[:space:]]*/)?\.work/?[[:space:]]+([a-z][a-z-]*)#\1notebook-git \3#g')$judged_as_is
  if [ "$branch" = "main" ] && printf '%s' "$public_cmd" | grep -Eq "(^|[^[:alnum:]_-])git${global_opts}[[:space:]]+(commit|merge|rebase|cherry-pick|revert)([[:space:]]|\$)"; then
    deny "Direct writes to main are forbidden (AGENTS.md workflow). Create a branch: git switch -c feat/<plan>-p<phase>-<slug>"
  fi
  # Every push segment of the command is judged, one per line, and only its own
  # arguments, so the word "main" in a commit message or an echo elsewhere in a
  # compound command does not trigger. main counts as a ref wherever no
  # character of a ref name touches it: after a space, a `:`, a `/` or a forced
  # refspec's `+`, and beside a quote or a parenthesis.
  push_segments=$(printf '%s' "$public_cmd" | grep -oE "(^|[^[:alnum:]_-])git${global_opts}[[:space:]]+push([^&;|]*)")
  if [ -n "$push_segments" ]; then
    if [ "$branch" = "main" ] || printf '%s\n' "$push_segments" | grep -Eq '(^|[^[:alnum:]_.-])main([^[:alnum:]_./:-]|$)'; then
      deny "Pushing to main is forbidden (AGENTS.md workflow). Push a feature branch and open a PR."
    fi
  fi
}

# The command's words as the shell reads them. Each quoted span ("…" with its
# escapes, '…', $'…') and each backslash escape becomes the characters it
# stands for, and those that the rules above take as a boundary (a blank, a
# quote, a backslash, ; & |) become `_`. A quoted argument is then one plain
# word whatever it holds, while a quoted `main` still reads as main. A
# backslash-newline outside single quotes is removed, and a comment is dropped
# up to its newline, so a quote inside it opens nothing.
q="'"
line_continuation=$'^\\\\\n'
unquoted_run="^[^\"${q}\\\\\$#]+"
comment=$'^#[^\n]*'
blank_or_operator='[[:space:];&|()<>]'
double_quoted="^\"(([^\"\\\\]|\\\\.)*)\\\\?(\"|\$)"
single_quoted="^${q}([^${q}]*)(${q}|\$)"
ansi_c_quoted="^\\\$${q}(([^${q}\\\\]|\\\\.)*)\\\\?(${q}|\$)"
escaped_character='^\\(.|$)'
literal_boundary="[[:space:]\"${q}\\\\;&|]"

read_as_shell() {
  local rest=$1 words="" in_word="" inside decoded
  while [ -n "$rest" ]; do
    if [[ $rest =~ $line_continuation ]] || { [ -z "$in_word" ] && [[ $rest =~ $comment ]]; }; then
      # Neither is part of a word: the shell removes a backslash-newline, even
      # inside a word, and a `#` that starts a word comments out its line.
      rest=${rest:${#BASH_REMATCH[0]}}
      continue
    fi
    in_word=1
    if [[ $rest =~ $double_quoted ]]; then
      inside=${BASH_REMATCH[1]//"$continuation"/}
      words+=${inside//$literal_boundary/_}
    elif [[ $rest =~ $single_quoted ]] || [[ $rest =~ $escaped_character ]]; then
      words+=${BASH_REMATCH[1]//$literal_boundary/_}
    elif [[ $rest =~ $ansi_c_quoted ]]; then
      decoded=$(decode_ansi_c "${BASH_REMATCH[1]}")
      words+=${decoded//$literal_boundary/_}
    else
      # Plain characters, or a `$` or `#` that opens nothing, a character of
      # its own. After a blank or an operator, the next word starts.
      [[ $rest =~ $unquoted_run ]] || [[ $rest =~ ^. ]]
      words+=${BASH_REMATCH[0]}
      [[ ${BASH_REMATCH[0]} == *$blank_or_operator ]] && in_word=""
    fi
    rest=${rest:${#BASH_REMATCH[0]}}
  done
  printf '%s' "$words"
}

# The characters the inside of a $'…' span stands for. A numeric escape (\xHH,
# \nnn, \uHHHH, \UHHHHHHHH) is decoded when it names a printable ASCII
# character, so an escaped `main` still reads as main; any other character it
# names, and every control-character escape, becomes `_`.
ansi_c_escape='^([^\\]*)\\(x[[:xdigit:]]{1,2}|u[[:xdigit:]]{1,4}|U[[:xdigit:]]{1,8}|[0-7]{1,3}|c.|.)'
decode_ansi_c() {
  local rest=$1 decoded=""
  while [[ $rest =~ $ansi_c_escape ]]; do
    decoded+=${BASH_REMATCH[1]}$(ansi_c_character "${BASH_REMATCH[2]}")
    rest=${rest:${#BASH_REMATCH[0]}}
  done
  printf '%s' "$decoded$rest"
}

ansi_c_character() {
  local escape=$1 code octal
  case $escape in
    x* | u* | U*) code=$((16#${escape:1})) ;;
    [0-7]*) code=$((8#$escape)) ;;
    [abeEfnrtv] | c?) printf _; return ;;
    ["$q"\"\\?]) printf '%s' "$escape"; return ;;
    *) printf '\\%s' "$escape"; return ;;
  esac
  if [ "$code" -gt 32 ] && [ "$code" -lt 127 ]; then
    printf -v octal '%03o' "$code"
    printf '%b' "\\0$octal"
  else
    printf _
  fi
}

# Read as written first, so a command quoted for `bash -c` or `eval` is still
# judged, then read as the shell reads it, so no quoting hides an argument's
# end: either reading that writes to main is refused.
judge "${cmd//"$continuation"/ }"
judge "$(read_as_shell "$cmd")"
exit 0
