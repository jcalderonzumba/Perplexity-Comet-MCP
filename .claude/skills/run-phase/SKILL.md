---
name: run-phase
description: Build one plan phase of Perplexity Comet MCP on its phase branch, one fresh-context phase-builder subagent per task, then hand it to /review-phase, which reviews it, runs the preflight and opens the PR after one owner confirmation — the owner confirms the work list once, each builder's hand-off notes reach the next, a blocked builder's question comes to the owner and the same builder resumes with the answer. Arguments — <plan> the plan-name fragment the branch convention uses (core-extraction), <phase> the phase number.

arguments: [plan, phase]
argument-hint: <plan> <phase>
disable-model-invocation: true
---

# Phase Runner

`/run-phase <plan> <phase>` builds one phase of an implementation plan. You are the **runner**: you resolve the phase, agree the work list with the owner once, and hand every unit of it to a fresh `phase-builder`, one builder per unit, each running `executing-plans` on its unit alone. You read the plan and the builders' reports, never the diff, so your context stays small across the whole phase. The builder does the building; `/review-phase` does the reviewing, once, when the phase is complete. When the last unit is done, you invoke it and follow it through: it reviews the phase, gets its findings fixed by fresh builders, runs the preflight and, after one confirmation from the owner, opens the PR (§7).

The arguments are bound by name: `$plan` is the plan-name fragment the branch convention uses (`core-extraction` for `.work/plans/2026-10-01-core-extraction.md`), `$phase` the phase number, and both are substituted into this text and its shell before you read it. `/run-phase core-extraction 1` builds phase 1 of that plan. Only the owner invokes this skill; it is never started because a plan looks ready.

Throughout, the paths are computed with this shell, and `<branch>` is the branch name with every `/` replaced by `-`, as `/review-phase` computes it. `doc` is computed first, for §1; `branch`, `run` and `review` are computed **after §1 has put the clone on the phase branch** (§1.2 switches to it or creates it) and before §2 writes the work list, so the run state and the PR draft live under the phase branch's name, where `/review-phase` and a re-invocation look for them, never under `main`'s:

```sh
top=$(git rev-parse --show-toplevel)
gitdir="$top/.git"
work="$top/.work"   # the private notebook: its own git repository (AGENTS.md, Where truth lives)
doc=$(ls "$work"/plans/*"$plan"*.md)   # the plan file, one match (§1); a match under plans/done/ only is a finished plan
# after §1.2, on the phase branch:
branch=$(git branch --show-current | tr / -)
run="$gitdir/run/$branch"
review="$gitdir/review/$branch"
```

No other variable in this file starts with `plan` or `phase`, so the argument substitution touches nothing but the two arguments.

The **run state** lives in `$run/`, beside the review state in `$review/`; it is per clone, never committed, and it outlives the session:

- `work-list.md` — the agreed units in order, each with its status: `pending`, `running`, `done`, `blocked`;
- `<unit>.md` — the builder's report, verbatim, one per unit; a resumed builder's second report is appended under a `---` rule;
- `<unit>.brief.md` — the brief that builder received, so a fresh builder can inherit it (§6).

`<unit>` is the task id (`1.1`), the task id and a slice letter (`1.2a`), or `f<k>` for a follow-up that runs as its own unit (§2).

## 1. Preconditions

Check these in order. At the first one that fails, stop and tell the owner which precondition failed and what fixes it; do not build the work list. The fifth resolves what it finds instead of failing on it, and says when it stops.

1. **The plan and the phase resolve.** The plan is the one file under `.work/plans/` whose name contains `$plan`, the `doc` of the shell above. None or several: ask the owner which plan is meant, after checking `.work/plans/done/`: when `$plan` matches only there, the plan is finished and is refused, and the owner is told so rather than asked. In the plan, the `## Phase <phase>` heading exists and carries no `✅ DONE` marker; a phase with the marker is finished and is refused. The phase's section is everything from that heading to the next `## ` heading.
2. **The branch.** Read `git branch --show-current` and `git status --porcelain`:
   - On `main` with a clean tree: the phase branch is the one match of `git branch --list "feat/$plan-p$phase-*"`. One match: `git switch` to it. Several: ask which. None: propose `feat/<plan>-p<phase>-<slug>`, the slug two to four lower-case words from the phase name (`## Phase 1: Tool core and thin adapters` gives `feat/core-extraction-p1-tool-core`), and create it with `git switch -c` after the confirmation of §2, so the owner sees the name before the branch exists.
   - On the phase branch already (`feat/<plan>-p<phase>-<anything>`): continue.
   - On any other branch, or on `main` with a dirty tree: stop. The owner's tree is never touched without asking. Name the remedy: a tagged stash the owner agrees to (`git stash push -m "before run-phase"`), or finishing the other branch first.
3. **The notebook is there and clean.** `git -C .work rev-parse --git-dir` succeeds and `git -C .work status --porcelain` prints nothing. The one exception is a re-invocation (§8) with a `blocked` unit whose research note and index row, left for its builder by §6, are the only uncommitted paths: they belong to that unit, and its builder commits them. If not, stop: the owner commits or restores the notebook; the runner never touches it.
4. **The git hooks are active.** `git config core.hooksPath` prints a path ending in `.githooks`, so a builder's commit meets the same refusals a human's does. If not: `git config core.hooksPath .githooks`, once per clone.
5. **The phase's outside facts are researched.** Read the phase's unticked tasks and unticked follow-ups for a claim that passes the test of [Check 3, *Outside facts*](../review-plan/spec-and-safety.md#check-3-outside-facts) and that neither a note under `.work/research/` nor a primary source the plan cites backs, as that check defines backing. Check 3 makes `/review-plan` refuse such a claim, but a plan whose phase was approved before a fact changed never met it again, which is why the runner looks. For each claim it finds, in turn:

   1. research it by the procedure of the owner's global rule, `~/.claude/rules/docs-and-research.md`: Comet, or WebSearch and WebFetch when Comet is unavailable;
   2. write the note and its index row as `.work/research/README.md` says;
   3. bring the owner the finding, the note's path and a recommendation ending with a **Rests on** line, and ask with AskUserQuestion, the recommendation as the first option: research settles what the world says, the owner decides what the project wants;
   4. once the owner has answered, amend the plan task to link the note;
   5. commit the note, the index and the plan together in the notebook: `git -C .work add … && git -C .work commit -m "docs(research): …"`.

   The notes are committed in the notebook, so they need no phase branch: in precondition 2's create arm the branch is still created after the confirmation of §2. Name it beside the first finding, so the owner sees the name early.

   Only then does §2 build the work list. This is a precondition and not a step of the run for two reasons. The runner asks one question at the start and nothing more until a builder blocks (§2), so the owner's answers to research come before that question. And a commit made here lands before the work list's *Start*, so before any unit's range begins, and §5's check of a unit's commits against its report still holds.

   Unlike the other four, this precondition does not stop at what it finds: it resolves each claim and goes on. It stops, saying why, in two cases: when it can reach no source at all, as any precondition stops at a failure; and when the owner's answer means the plan must change beyond a link, where the remedy is a plan revision: before stopping it commits the notes and their index rows in `.work/` (a note records a fact, whatever the plan becomes), so the revision links committed notes and the next invocation finds the notebook clean (precondition 3). On a re-invocation (§8) it runs again and finds the notes it wrote. It commits only while the branch has no work list: once one exists, a commit here would land inside a unit's range in the notebook (§5), so a claim found then without a note stops the runner, and the owner decides where its note is committed.

## 2. The work list and its confirmation

Read the phase's section. Build the work list from it with three rules:

1. **One unit per unticked task**, in plan order. The unit's id is the task id; a ticked task is `done` and gets no builder, whether or not the run state holds a report for it (a ticked task without a report was built by hand before the runner existed).
2. **A follow-up under *Follow-ups carried in* that names a task** (`task 1.2`, `for task 1.2`, `tasks 2.1–2.2`, in its text or its trailing parenthesis) is folded into that task's unit and listed in the unit's brief by its bold title, because the plan folds it into the task's acceptance. Ticked follow-ups are skipped.
3. **A follow-up that names no task, or names a task already ticked, is its own unit**, `f<k>` with `k` counting from 1 in plan order, placed before the first unit whose task depends on it, or first when none does.

Then read the phase's text for which unit depends on which: a task that consumes another's core function or adapter, a follow-up "for task 1.2", a test fake a later task reuses. This reading is shown, not silently applied: in this phase units run one at a time in list order, and the dependencies exist so the owner can check the order and so the runner of phase 2 can form waves from them.

When the run state already holds a `work-list.md` for this branch (`$gitdir/run/<phase branch with slashes as dashes>/`, the branch §1.2 switched to; in the create arm the branch does not exist yet, so neither does its run state, and `main`'s directory is never consulted), this is a re-invocation: go to §8.

Show the owner, in one message:

- the plan path and the phase heading;
- the branch: existing, or the name to create;
- the work list as a table, one row per unit: id, the task's title (the bold text after `Task <id> —`, or the follow-up's bold title), the follow-ups folded into it, the units it depends on, and its status;
- when the session's permission mode will prompt for the builders' tool calls, one sentence saying the prompts will land here and the runner answers nothing else in between (§3).

Then ask **one question**, with AskUserQuestion, whose first option is to run the list as shown, and whose second is to change it. The owner may, in the answer:

- **reorder** units;
- **drop** a unit for this run: it stays `pending` in the work list with a `dropped` note, is not dispatched, and the phase's PR waits until a later run builds it, because a phase is not finished while the plan shows a task open;
- **slice** a unit into sub-units, each with a one-line description, in the form `<task id><letter> — <what the slice builds>`:

  ```
  1.2a — the tool core and its unit tests
  1.2b — the stdio adapter over the core
  1.2c — the HTTP adapter over the core
  ```

  A slice is a unit with the task's id and the slice's text. The plan file is never edited to record it; the last slice's brief carries *last slice of the task: tick it*, and that builder ticks the task.

Apply the answer, create the branch when §1 said to, write the agreed list to `$run/work-list.md`:

```markdown
# Run: <plan path> — Phase <n>: <name>

Branch: <branch name>
Start: public <`git rev-parse --short HEAD`> · work <`git -C .work rev-parse --short HEAD`>, both when this list was written

| Unit | Title | Folded follow-ups | Depends on | Status | Last commits |
|---|---|---|---|---|---|
| 1.1 | <task title> | <bold titles, or —> | — | pending | — |
| 1.2a | <task title> — <slice text> | … | 1.1 | pending | — |
```

After this one question you ask nothing more until a builder blocks, a finding is disputed, a third review round still reports Must Fix, the preflight fails, or `/review-phase` asks before publishing (§7).

## 3. The brief

Write each builder's brief to `$run/<unit>.brief.md` before dispatching, and pass the file's content as the prompt. Fields, in this order, every one present:

```markdown
## Brief: <unit>
- **Plan and phase:** `<plan path>`, `## Phase <n>: <name>`
- **Unit:** Task <id>   — or: Task <id>, slice <letter>: <slice text>; on the last slice add the line: last slice of the task: tick it
  - Follow-ups carried in that this task folds in: **<bold title>**, **<bold title>**   — or: none
- **Branch and directory:** `<branch name>`, in `<top>`. You never switch branch, never create a branch or a worktree, never run `using-git-worktrees`.
- **Hand-off notes:**   — or: none, this is the phase's first unit
  ### From <unit>
  <that report's *For later tasks* section, verbatim>
  Commits: <sha> <subject>, one per line
  ### From <unit> …
- **Rules:** Invoke the `superpowers:executing-plans` skill with the Skill tool before you change anything, and run it on this unit alone; read the plan phase and the spec sections it cites first. Test first; follow AGENTS.md's *Writing code*; fetch current docs with Context7 before using a specific library API; run `npm run check` before every commit; conventional commits ending with the attribution lines the session's reminder gives you. Tick the task's checkbox in the plan when the task is complete and commit the tick in `.work/` (a slice ticks nothing unless this brief says it is the last slice). File follow-ups where AGENTS.md workflow step 10 places them. Never write `.git/review-ok`, the plan's DONE marker or a pull request. Stop and report `blocked` rather than guess (an outside fact that neither the plan nor a `current` note under `.work/research/` settles is such a stop, never settled from memory or a web search), with nothing half-committed. Your final message is the report of `.claude/agents/phase-builder.md`, headings verbatim.
- **Answer:** <the owner's answer, verbatim; after a research question, with the note's path and the instruction to commit it (§6)>   — only on a fresh dispatch after a block (§6)
```

The brief names the task; it never pastes the task's text or paraphrases it. The plan is the contract, and a paraphrase of it would be a second contract. The hand-off notes are copied verbatim from every finished unit's report, in unit order, so the names, files and decisions the earlier builders chose reach this one exactly as they were written.

## 4. Dispatch

For each unit in order: set its status to `running` in the work list, write its brief, then dispatch with the Agent tool: `subagent_type: phase-builder`, the brief as the prompt, `description` naming the unit (`build 1.1`). Never a fork, never `general-purpose`, never `isolation: "worktree"` in this phase. In an interactive session the Agent tool runs the builder in the background and delivers its final message as a task notification; keep the agent id the dispatch result gives, because §6 resumes the builder with it.

Then **wait**. Do nothing else in the session until the completion notification arrives: no other work, no reading the tree, no reading the builder's transcript. The owner may watch the builder in the agent panel meanwhile. When the notification says the builder ended without a report, treat the result as malformed (§5).

The builder's permission prompts, if the session's permission mode raises any, surface in this session naming the builder, for the owner to approve or deny. You are hands-off to the degree the mode allows, and you said so once in the confirmation of §2.

## 5. Bookkeeping after a report

Save the report verbatim to `$run/<unit>.md` (a resumed builder's report is appended after a `---` line). Then read its *Status* line and check the report against the tree, because a report is a claim and the tree is the truth. Four checks, in this order, each a command:

1. **Both trees match the *Tree* line.**

   ```sh
   git status --porcelain
   git -C .work status --porcelain
   ```

   Empty output from both is `clean`; any line from either, tracked or untracked, is `dirty`, and the report's parenthesis must name what the lines show.
2. **The commits match the *Commits* list, in both repositories.** `<last public>` and `<last work>` are the two shas of the *Last commits* cell of the nearest earlier unit in the work list that has one (a dropped unit has none), or the work list's *Start* shas when no earlier unit has one (never the merge base with `main`: a phase branch may already carry commits built by hand before the runner took over):

   ```sh
   git log --reverse --format='%h %s' "$last_public"..HEAD
   git -C .work log --reverse --format='%h %s' "$last_work"..HEAD
   ```

   Every `public:` commit the report lists is in the first output and every `work:` commit in the second, and no other commit is in either. `none` in the report means both outputs are empty. For a unit finished by a fresh builder after a block (§6), each output holds the blocked report's commits followed by the new report's.
3. **A `done` unit's checkbox is ticked** in the plan, for a whole task or for the last slice of a sliced task (an earlier slice ticks nothing); for a follow-up unit, its own item, found by its bold title:

   ```sh
   grep -n "^- \[x\] \*\*Task $id " "$doc"        # a task, or the last slice of one
   grep -n "^- \[x\] \*\*<bold title>" "$doc"      # a follow-up unit
   ```

4. **A `done` unit's trees are clean**: check 1 printed nothing for either.

A mismatch is a block: tell the owner what the report says and what the tree shows, and ask how to proceed with AskUserQuestion. Never repair the tree yourself: no commit, no revert, no tick, no stash.

A report without the *Status* line, or missing a heading the agent file requires for its status (every `###` heading of the report; `### Findings` only for a round unit, `### Blocked on` only when blocked), is **malformed**, as `/review-phase` §7 treats a round without a verdict. Save it as `$run/<unit>.malformed.md` instead of `<unit>.md`, and resume the same builder once with `SendMessage`:

> Your final message must be the report of `.claude/agents/phase-builder.md`, headings verbatim, with a Status line. Send it now.

A second malformed report is a block: bring the owner both files.

On `done`, update the PR description draft `$review/pr-body.md`. When it does not exist, create the directory and write it from the template in `/review-phase` §2 with every section present: the first line naming the phase, the *Review-plan verdict* copied from the plan header's `**Review-plan verdict:**` line, or `pending` when the plan has none, and the other sections empty except their headings. Then append, at the end of the named section, before the next `## ` heading:

- to *Task coverage*: one row, `| Task <id> — <title> | <where it lands, from *For later tasks* and the commits> | <the test files, from *Tests*> |`; a slice adds its own row with the slice text in the first cell;
- to *Executor-level decisions*: the report's bullets, unchanged;
- to *Deviations from the phase*: the report's *Deviations from the task* lines, unchanged, each prefixed with the unit (`1.1: `), and, when the report's *Follow-ups filed* is not `none`, one line `Follow-ups filed (1.1): <the list>`.

Set the unit `done` in the work list with `public <sha> · work <sha>` in *Last commits*, the last commit of each repository (the earlier unit's sha when this unit made none there), and go to the next unit (§4).

## 6. A blocked builder

On `blocked`: set the unit `blocked` in the work list, run checks 1 and 2 of §5 (a blocked builder's claims are checked too; commits it lists are on the branch and pass `npm run check`), and show the owner the *Blocked on* section with the builder's recommendation first. Ask with AskUserQuestion: the recommendation is the first option, marked recommended; the other readings the builder named follow; the owner may answer in their own words.

When the *Blocked on* is a research question, an outside fact the builder stopped on as `phase-builder`'s *When you stop* tells it to, research it before you ask, by the first two steps of precondition 5 (§1), so the owner answers with the finding in front of them rather than the builder's belief. Write the note and its index row **into `.work/` and commit nothing**: §5 holds a unit's commits to those its report lists, so the resumed builder commits them with its work, in a commit its report lists. Then ask as above, showing the question with the finding, the note's path and the builder's recommendation re-judged against the finding: the option the finding supports comes first, with a **Rests on** line naming the note. When no source can be reached, say so and ask as above, with no note.

Then resume **the same builder**: `SendMessage` with `to` the builder's agent id from the dispatch result (or its name, as `ListAgents` shows it), and the message:

> Answer to your blocked question: <the owner's answer, verbatim>. Continue the unit from the tree as you left it and end with the report.

After a research question, the message goes on:

> The research note is `<path>`, with its row in `.work/research/README.md`; both are uncommitted in `.work/`. Commit them there with your work, and name the note in your report's *For later tasks*.

A resumed subagent keeps its full history, so the code it read and the tests it wrote are still in its context, and it picks up where it stopped. Set the unit `running` and wait as in §4. The second report is appended to `$run/<unit>.md` under a `---` line and goes through §5 again.

When the builder can no longer be reached (the send fails, the session that dispatched it ended, the runner was re-invoked), dispatch a **fresh builder** with the saved brief `$run/<unit>.brief.md` plus an **Answer** field carrying the owner's answer verbatim (after a research question, followed by the note's path and the instruction to commit it, in the words of the message above), and this line after *Branch and directory*: *the tree holds the earlier builder's uncommitted work: <the blocked report's Tree line>; continue from it, do not discard it.* Save the new brief over the old one and dispatch as in §4.

A builder blocked **twice on the same unit** is stopped: bring the owner the unit, both questions and both reports, and do not dispatch it again without the owner's word. The remedy is usually the owner's: a plan fix, a decision-log row, or a slice.

## 7. Finishing the phase

When every unit is `done`:

1. **Units dropped in §2 stop the finish.** A phase is not finished while the plan shows a task open, so print the summary of step 4 and stop; the owner builds them in a later run.
2. **Complete the PR draft** `$review/pr-body.md` from the saved reports, never from the diff, writing only a section that is still empty: on a re-invocation, what an earlier finish or `/review-phase` wrote there stays. Write *What lands*: what exists after the PR that did not before, by area, from each report's *For later tasks* and the *Task coverage* rows. Write *Verification*: the `npm run check` result each report quotes for its last commit, and the checks the phase's acceptance names as the reports record them. When the phase touches ask, poll, mode or agentic behaviour, add `Pro battery: pending, the owner runs it`: it spends Pro queries, so it stays the owner's, and the owner sees the line when asked to publish.
3. **Invoke `/review-phase`** with the Skill tool and follow it through: the rounds, each fixed by a fresh builder as its *Fixing through a builder* says ([§5 of that skill](../review-phase/SKILL.md#5-the-loop)), the preflight, the one question before publishing, the PR and the DONE marker. Its stops are the finish's stops: a third round that still reports Must Fix, a dispute, a failing preflight, and the owner answering *not yet*.
4. **Print the summary and stop:**
   - the units, round units included, each with its commits;
   - the executor-level decisions gathered in the PR draft;
   - the follow-ups filed, and where;
   - the units dropped in §2, if any;
   - the review verdict and the rounds it took, the preflight result, and the PR's URL. Otherwise, the step that stopped the finish, why, and what the owner does next;
   - with a PR open, what remains for the owner: merging with the `land-pr` skill.

The runner never adds an approval to `.git/review-ok` and never writes the DONE marker itself: the reviewer writes the one, and `/review-phase` §9 the other.

## 8. Re-invocation

`/run-phase` invoked again on the same plan and phase, once §1 passes, reads `$run/work-list.md` instead of building a new list. For task and follow-up units:

- a `done` unit is skipped;
- a `blocked` unit is resumed as in §6, with the last question's answer asked again if it was never given; the builder is unreachable from a new session, so the fresh-builder fallback applies;
- a `pending` unit is dispatched as in §4, its hand-off notes taken from the `done` units' saved reports;
- a `running` unit whose builder is gone is treated as `blocked` with its last report when `$run/<unit>.md` exists, and as `pending` when it does not.

Before the first dispatch of the re-invocation, show the work list with its statuses and ask the one question of §2 over it; the owner may reorder, drop or slice what is still pending.

When every task and follow-up unit is `done`, ask nothing and go to §7: `/review-phase` picks up where the finish stopped. It continues a round unit `r<N>` that is not `done` through its *Fixing through a builder*, which handles each status as the bullets above do but with its own round brief. It does not review an approved HEAD again, and it does not rerun a preflight that already passed. When the branch already has an open PR (`gh pr view` succeeds), print its URL and stop; if the plan lacks the DONE marker, write it first as `/review-phase` §9 does.
