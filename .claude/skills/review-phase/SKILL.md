---
name: review-phase
description: Run the phase review gate on the current PR branch — after the phase is complete (code, tests, README, CHANGELOG, plan ticks, PR draft) and before npm run preflight, on every branch that will become a PR, docs-only included. Prepares the brief, dispatches the phase-reviewer subagent with fresh context, runs the fix loop for up to three rounds, records the Code-review verdict in the PR description draft, runs npm run preflight, opens the PR after one owner confirmation, and writes the plan's DONE marker once the PR exists. /run-phase invokes it when a phase's last unit is done; on a branch /run-phase built, a fresh phase-builder fixes each round's findings.

---

# Phase Review Gate

The sibling of `/review-plan`: that gate checks a plan before code exists, this one checks the code afterwards against the same contract. You are the **clerk**: you prepare the brief, dispatch the reviewer, get what it finds fixed and keep the record. The `phase-reviewer` subagent is the **judge**: it reviews with fresh context and is the only party that adds an approval to `.git/review-ok`.

The order of the gates on every PR: `/review-phase`, then `npm run preflight`, then `gh pr create --body-file`, then the DONE marker (§9). The hooks refuse `gh pr create`, `gh pr merge` and `git push` until HEAD is listed in both `.git/review-ok` and `.git/preflight-ok`. Each stamp lists every commit its gate passed in this clone, one sha per line, so reviewing one branch never costs a parallel branch its approval.

Throughout, `<branch>` is `git branch --show-current` with every `/` replaced by `-`, and the review state lives in `"$(git rev-parse --show-toplevel)/.git/review/<branch>/"`:

- `pr-body.md` — the PR description draft;
- `round-N.md` — each reviewer report, saved verbatim;
- `rulings.md` — the owner's rulings on disputed findings.

`/run-phase` invokes this skill when a phase's last unit is done ([§7 of that skill](../run-phase/SKILL.md#7-finishing-the-phase)), and the owner may invoke it directly on any branch. A branch that holds a **run state**, `.git/run/<branch>/work-list.md`, was built by `/run-phase`: its rounds are fixed by a builder (§5), whoever invoked this skill.

## 1. Preconditions

Check these in order. At the first one that fails, stop and tell the user which precondition failed and what fixes it; do not dispatch.

1. **Not on `main`.** `git branch --show-current` is not `main`.
2. **Clean trees.** `git status --porcelain` prints nothing, and, when `.work/` exists, neither does `git -C .work status --porcelain`.
3. **`npm run check` passes on HEAD.** Run it. A review round spent on a lint failure is a wasted round.
4. **On a phase branch, the plan phase's tasks are ticked.** A branch named `feat/<plan>-p<phase>-<slug>` is a phase branch. `<plan>` is everything between `feat/` and the first `-p<digits>-`, so `feat/working-model-p1-rules-and-gates` gives plan `working-model`, phase `1`:

   ```sh
   git branch --show-current | perl -ne 'print "plan=$1 phase=$2\n" if m{^feat/(.+?)-p(\d+)-.}'
   ```

   The plan is the one file under `.work/plans/` or `.work/plans/done/` whose name contains `<plan>`. When none or several match, ask the owner which plan the branch implements. Every task checkbox between the `## Phase <phase>` heading and the next `## ` heading is ticked (`- [x]`). The DONE marker is not expected yet: §9 writes it after the PR exists. Any other branch has **no plan phase** and skips this precondition.
5. **The PR draft exists.** `.git/review/<branch>/pr-body.md` exists. If it does not, create the directory, write the draft from the template in §2 with every section present, filling what the diff and the plan already tell you, and stop: the builder fills *What lands* and *Executor-level decisions* before the reviewer judges them. The draft is per branch, so parallel phase branches in one clone never overwrite each other's.

## 2. The PR description template

Sections in this order. On a branch with no plan phase every section stays, so the reviewer reads one shape: *Task coverage* says "no plan phase", and *Deviations from the phase* lists anything outside the purpose the first line states, or "none".

```markdown
Implements **phase N — <phase name>** of the `<plan>` plan.
<!-- on a branch with no plan phase: one sentence stating the branch's purpose -->

## Review-plan verdict
<the plan header's **Review-plan verdict:** line, copied; "no plan" on a branch without one>

## What lands
<what exists after this PR that did not before, by package or area>

## Task coverage
| Task | Where it lands | Tests |
|---|---|---|
<!-- phase branches only: one row per task in the phase -->

## Deviations from the phase
<every change outside the phase's scope or different from its text, each with its reason; "none" when there are none>

## Executor-level decisions
- **<decision>** — <why>. Revisit if <what would force revisiting it>.

## Verification
<the commands run and their results: npm run check, npm run preflight, the Pro battery when the phase touches ask, poll, mode or agentic behaviour, anything the phase's acceptance names>

## Code-review verdict
Pending: filled in by `/review-phase` on approval (§8).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<session link line from the current attribution reminder>
```

The draft becomes a public PR description. It says what changed in its own words: it never pastes spec, plan or research text, never links a `.work/` path, and names research notes by date and topic only.

## 3. The brief

Compute and print the brief before dispatching, so the user sees what the reviewer was given:

```sh
top=$(git rev-parse --show-toplevel)
dir="$top/.git/review/$(git branch --show-current | tr / -)"
base=$(git merge-base main HEAD)
head=$(git rev-parse HEAD)
round=$(( $(ls "$dir"/round-*.md 2>/dev/null | wc -l) + 1 ))
# the notebook's range for this phase (skip when .work/ does not exist)
work_head=$(git -C "$top/.work" rev-parse --short HEAD)
work_start=$(sed -n 's/^Start: public [0-9a-f]* · work \([0-9a-f]*\).*/\1/p' "$top/.git/run/$(git branch --show-current | tr / -)/work-list.md" 2>/dev/null)
first=$(git log --reverse --format=%cI "$base"..HEAD | head -1)
work_base=${work_start:-$(git -C "$top/.work" rev-list -1 --before="$first" HEAD)}
```

```markdown
## Review brief
- **Plan and phase:** `<plan path>`, `## Phase <n>: <name>` — or: no plan phase
- **base:** <base sha>
- **head:** <head sha>
- **work:** <work_base>..<work_head>   (omit when .work/ does not exist)
- **PR draft:** `.git/review/<branch>/pr-body.md`
- **Round:** <round>
- **Previous report:** `.git/review/<branch>/round-<round-1>.md`   (round > 1 only)
- **What changed since round <round-1>:**   (round > 1 only)
  - R<n>-M1: <what the builder changed, with the commit>
  - R<n>-S2: deferred — <reason, as written in the PR draft>
- **Rulings:** `.git/review/<branch>/rulings.md`   (only when the file exists)
```

Write one "what changed" line for every finding of the previous round, fixed, deferred or disputed. These lines are claims the reviewer verifies against the delta, not evidence.

## 4. Dispatch

First withdraw any earlier approval of HEAD, so that after this dispatch HEAD is listed only if this review approves it:

```sh
.githooks/review-withdraw.sh "$(git rev-parse --show-toplevel)"
```

It removes HEAD's line and keeps every other branch's. Without it, an approval of the same commit from an earlier dispatch would still read as approval after this one reports Not approved, stops early or comes back malformed.

When `.githooks/review-check.sh` (§7) already passes before the withdrawal, `phase-reviewer` approved this very HEAD with clean trees in an earlier dispatch: do not withdraw or dispatch, go to §8. This is how a re-invoked `/run-phase` picks up a finish that stopped after the review.

Then dispatch with the Agent tool: `subagent_type: phase-reviewer`, with the brief as the prompt, and do nothing else until its report arrives (in an interactive session it arrives as a task notification). Never a fork, never `general-purpose`. Save the returned report verbatim to `.git/review/<branch>/round-<round>.md`, then check the stamp (§7).

## 5. The loop

- **Must Fix:** fix every one. Test first when behaviour changes. Commit as usual, with `npm run check` before each commit; plan and spec changes are committed in `.work/`.
- **Should Fix:** fix in the same round the ones you intend to fix, because anything fixed after the approving round is a new commit and therefore a new round. Defer the rest in the PR draft under a `### Deferred` heading inside the pending *Code-review verdict* section: one line per finding id with the reason.
- **Consider:** fix, defer or leave; list them in the verdict section either way.
- **A deferral that leaves work for later**, whether from a Should Fix or a Consider, is also written as a follow-up in the same round, where AGENTS.md workflow step 10 places it. The PR draft says where it was filed.
- Then return to §1: the preconditions, a new brief with the next round number, and a new dispatch.
- **On a branch with a run state, a builder fixes the round**, not you: see *Fixing through a builder* below. The rules above are then the builder's, and you keep the record.
- **Three rounds.** If round three still reports Must Fix, stop. Bring the owner the open findings, what was tried for each, and any disagreement with the reviewer. Do not dispatch a fourth round without the owner's word.

### Fixing through a builder

On a branch with a run state, the session that runs this skill is `/run-phase`'s runner or stands in for it, and it never reads the diff. When this skill starts and the work list holds a round unit `r<N>` that is not `done`, that round is still being fixed: continue the unit as [§8 of `/run-phase`](../run-phase/SKILL.md#8-re-invocation) continues one of its status, before §1. For round `N` reported Not approved:

1. Add a unit `r<N>` to the work list, titled `Review round <N>`, depending on every other unit, `pending`.
2. Write its brief to `$run/r<N>.brief.md` as [§3 of `/run-phase`](../run-phase/SKILL.md#3-the-brief) sets out, with two fields changed. **Unit** reads `Review round <N>: the findings of .git/review/<branch>/round-<N>.md`, followed by `Rulings: .git/review/<branch>/rulings.md` when that file exists. In **Rules**, the first sentence becomes *Read the reviewer's report and the rulings, and work the findings as the "A review-round unit" section of `.claude/agents/phase-builder.md` says; do not run `executing-plans`.* The sentence about ticking becomes *Fix every Must Fix; fix each Should Fix or defer it with its reason; fix, defer or leave each Consider; file the follow-up for any deferral that leaves work for later. A finding you believe is wrong is a stop: report `blocked` with the finding, the reviewer's reasoning and yours. Tick nothing.* The hand-off notes are every `done` unit's, earlier rounds included.
3. Dispatch it and handle its report as [§4 to §6 of `/run-phase`](../run-phase/SKILL.md#4-dispatch) do, with these differences. Check 3 of §5 there becomes: the report's `### Findings` names every finding id of `round-<N>.md`. The report's *Task coverage* row is not written. Its *Findings* lines that defer go into this skill's `### Deferred`, one line per finding id with the reason.
4. A builder `blocked` on a disputed finding is a dispute: take it through §6 below, with the builder's reasoning as yours. Then resume the builder with the ruling as its answer, as [§6 of `/run-phase`](../run-phase/SKILL.md#6-a-blocked-builder) resumes one.
5. Once `r<N>` is `done`, write the next brief's *What changed since round N* lines from its `### Findings`, and return to §1.

## 6. Disputes

A finding you believe is wrong is never dropped and never quietly worked around.

1. Write your reasoning in the PR draft under a `### Disputed` heading, beside `### Deferred`: the finding id, the reviewer's rule and reason, and why you disagree.
2. Ask the owner with AskUserQuestion, showing the finding, the reviewer's reasoning and yours, with your recommendation first.
3. Append the ruling to `.git/review/<branch>/rulings.md` as `- <finding id>: <ruling> (<YYYY-MM-DD>)`. The next round's brief carries the file, and the reviewer treats it as a decision-log row.
4. A ruling that changes the spec gets a decision-log row in the spec's §13, in the same `.work` commit as the spec change.
5. A ruling that upholds the finding means it is fixed like any other Must Fix.

## 7. Approval is the stamp

After every dispatch run:

```sh
.githooks/review-check.sh "$(git rev-parse --show-toplevel)"
```

- **Exit 0 is approval.** The report's verdict line is documentation; the stamp is the fact. Go to §8.
- **The report says Approved and prints a `not stamped` line:** a precondition slipped between brief and stamp (HEAD moved or the tree is dirty). Restore it — the same HEAD and a clean tree — and dispatch again with a fresh brief.
- **The report has no verdict line** (it stopped early, refused the brief, or ran out of room): a malformed round. Rename its file to `malformed-<round>.md` so it does not count as a round, and dispatch again.
- **Otherwise the report is Not approved.** Go to §5 and §6.

## 8. On approval

1. Fill in the **Code-review verdict** section, the sibling of the *Review-plan verdict*, replacing its pending line and folding in `### Deferred` and `### Disputed`:
   - rounds run, and the round that approved;
   - each Must Fix, with its id and how it was resolved (the commit);
   - each Should Fix, resolved (the commit) or deferred with its reason;
   - Consider items;
   - plan issues the reviewer raised;
   - disputes and the owner's rulings;
   - skills invoked, skills skipped with reasons, Context7 docs fetched, research notes read (by date and topic), whether CodeGraph ran.
2. Run `npm run preflight`, unless `.githooks/preflight-check.sh "$(git rev-parse --show-toplevel)"` already passes for HEAD. It needs the same clean HEAD the reviewer stamped and drives the owner's local Comet for up to ten minutes, so run it in the background and wait for it to finish. Record its result in the draft's *Verification* section. **A failing preflight stops the finish.** Show the owner the failing step and its output, and fix nothing: a code failure there is a new commit, which needs a new review round, and the remaining failures are usually about the environment (Comet not running or not signed in).
3. **Ask the owner once** before anything is published, with AskUserQuestion. Show the PR title, a conventional commit title, and the draft's full text. The first option, recommended, pushes the branch and opens the PR; the second is *not yet*, which leaves both stamps in place for a later invocation.
4. On the owner's yes, push the branch with `git push -u origin <branch name>`, then open the PR: `gh pr create --title "<conventional commit title>" --body-file .git/review/<branch>/pr-body.md`.
5. On a phase branch, write the DONE marker (§9).

Merge with the `land-pr` skill.

## 9. The DONE marker

On a phase branch, after `gh pr create` prints the PR's URL, take its number N from the URL and append `— ✅ DONE (PR #N)` to the plan's `## Phase <n>` heading in `.work/`. When it is the plan's last phase, move the plan in the same commit, keeping the filename:

```sh
git -C .work mv plans/<file> plans/done/<file>   # last phase only
git -C .work commit -am "docs(plan): <plan> phase <n> done (PR #N)"
```

The marker lives in the private notebook, never in the public commit the reviewer stamped, so writing it needs no new review round and no new preflight. It carries no commit sha: the PR number leads to the merge commit.

## 10. The stamp is not yours

**This skill never adds an approval to `.git/review-ok`, and neither does anything else the builder runs. Only `phase-reviewer` adds one, and only on its own Approved verdict. The one change the builder makes to the file is `review-withdraw.sh` before a dispatch (§4), which only ever removes HEAD. Writing an approval by hand is the owner's deliberate bypass, never the builder's.**
