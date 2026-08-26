---
title: The AI Issue Loop
description: The end-to-end label-driven pipeline that turns an ai-ready GitHub issue into a reviewed PR — the one constraint that shapes it, the label state machine, the repo prerequisites, and the limits that keep it cheap.
---

`ai-issue-loop` is a **label-driven pipeline** that takes a GitHub issue marked
`ai-ready`, implements it in a per-issue git worktree, opens a PR, has two agents
review it, and hands it to you to merge. It runs unattended on a timer.

`repo-tooling` ships it as an agent skill and owns every repo-side piece it
depends on — the branch-protection standard, the `.claude/settings.json`
worktree config, and the skill itself.

## Install it

```bash
npx @rtorcato/repo-tooling fix claude-skills
```

That writes `~/.claude/skills/ai-issue-loop/SKILL.md`. Unlike every other fixer
this one writes **user-global** state — a directory shared by every project on
the machine — which is why it is **opt-in**: a bare `fix` or `fix --yes` skips
it and says so, and `doctor` reports it as *not configured* rather than as a
finding against your repo.

Four things follow from that:

- **`--skills-dir <path>`** overrides the destination. It is required alongside
  `--yes` / `--json` when `~/.claude/skills` does not exist, since a prompt
  would corrupt the JSON payload.
- **A stow-managed symlink is written *through*, not replaced.** If
  `~/.claude/skills/ai-issue-loop/SKILL.md` is a symlink into a dotfiles
  checkout, the content lands in dotfiles and stays version-controlled with the
  rest of your Claude config. The CLI reports the resolved real path so you know
  what to commit.
- **The install refuses to downgrade.** Each installed copy carries a
  `repo-tooling-version` stamp in its frontmatter. A repo pinned to an older
  release reports and skips rather than overwriting a newer skill — otherwise
  two repos on different versions would fight over it on every `fix`.
- **The install refuses to overwrite a local fork.** Alongside the version, each
  copy carries a `repo-tooling-hash` of the content we wrote. If the installed
  file no longer matches that hash — or predates it, so nothing can be proven —
  the install prints what diverged and stops, the same rule
  [`fix copied-assets`](./cli.md) follows for copied presets. This is the case
  the version stamp alone cannot see: a fork that is merely *older* than the
  package looks exactly like a stale copy. Diff it against the shipped file the
  message names, then pass **`--force-skills`** to take the shipped version.
  `--yes` deliberately does *not* imply it: unattended runs pass `--yes`, and
  this is the one overwrite that destroys work living outside the repo.

Any agent that reads the [`skills`](https://www.npmjs.com/package/skills) CLI
format can also take it straight from GitHub:

```bash
npx skills add https://github.com/rtorcato/repo-tooling --skill ai-issue-loop
```

## The one constraint

By default every agent in the pipeline authenticates as **your own `gh`** — no
PATs, no bot account, nothing to set up. GitHub refuses `gh pr review --approve`
on your own PR, so under that default **a real GitHub approval is impossible.**
That is a consequence of the zero-setup choice, not a limit of GitHub — see
[Running reviewers as a second identity](#running-reviewers-as-a-second-identity)
below.

Two consequences, and both are load-bearing:

1. **Approval is a label**, not a review. `ai-ok-code` / `ai-ok-sec` record that
   an agent passed the diff.
2. **Required status checks stay the real merge gate.** Never set
   `required_pull_request_reviews` on the protected branch — required review
   deadlocks every PR the loop opens.

The same constraint means everything an agent posts *looks* hand-written by the
repo owner. So every comment an agent leaves opens with a `🤖 *Automated …*`
header naming which agent wrote it. A detailed security review under a human's
avatar misrepresents who reviewed the code.

### Running reviewers as a second identity

Give the reviewing agents their own GitHub account — a machine user invited as a
collaborator, or a GitHub App — and the reviewer is no longer the PR author, so
`--approve` works and the `ai-ok-*` labels stop being necessary. Keep the two
apart on the machine rather than switching profiles, so an agent can never act
as you by accident:

```bash
GH_CONFIG_DIR=~/.config/gh-bot gh auth login --web --scopes repo   # once, as the bot
GH_CONFIG_DIR=~/.config/gh-bot gh pr review 42 --approve           # runs as the bot
```

Complete the device flow in a private window logged in as the bot — your default
browser will authorise *you* instead, leaving two profiles holding one identity.

Be clear about what this buys, because it is easy to overstate:

- **Attribution** — agent reviews are visibly not you in every timeline, which no
  comment header can guarantee.
- **Scope** — a machine user's token reaches only the repos you invited it to.
- **Compatibility** — its approvals can satisfy branch protection wherever a real
  second party exists.

What it does **not** buy is a second reviewer. One agent system drives both
accounts, so making reviews *required* would let the pipeline satisfy its own
merge gate — two-party on paper, one-party in fact. Your merge decision stays the
only genuine second party either way, which is why the loop hands issue PRs to a
human regardless.

Two things to settle before relying on it. Repo-settings tooling — including this
package's own `fix github-settings` — asserts `required_pull_request_reviews:
null`, because required review deadlocks solo Dependabot auto-merge; it will
revert an approval rule on its next run unless you change that standard first.
And the shipped skill still records verdicts as labels, so today this is
groundwork rather than a supported mode
([#518](https://github.com/rtorcato/repo-tooling/issues/518) tracks the rewrite).

## Labels and the state machine

All state lives in GitHub labels. A tick is a stateless, idempotent pass over
that state, so a missed tick, a crash, or a restart costs nothing.

| Label | On | Meaning |
|---|---|---|
| `ai-ready` | issue | Eligible for an agent. The hard gate. |
| `ai-wip` | issue | Claimed; a worktree exists. |
| `ai-blocked` | issue | Agent gave up; needs a human. |
| `holding` | issue | A gate — closes on human judgement, never picked up. |
| `ai-review` | PR | Awaiting agent review. |
| `ai-reviewing-code` | PR | `code-reviewer` claimed and running. Cleared with its verdict. |
| `ai-reviewing-sec` | PR | `security-expert` claimed and running. Cleared with its verdict. |
| `ai-ok-code` | PR | `code-reviewer` passed. |
| `ai-ok-sec` | PR | `security-expert` passed. |
| `ai-changes` | PR | A reviewer requested changes. |
| `ai-notes` | PR | Passed, but a reviewer left something to read before merging. |
| `merge-ready` | PR | Both agent reviews passed and the PR is mergeable — waiting on a human. |

Colours carry meaning here — `ai-ready` is green and `ai-blocked` red precisely
so the two states a maintainer must tell apart are legible at a glance. `doctor`
audits colour and description as the **`AI loop labels`** check, and `fix labels`
repairs drift with `gh label edit`. The distinction matters: the skill's
bootstrap block uses `gh label create`, which errors as a no-op on a label that
already exists — so it can add a missing label but can never repair a
hand-created one. A repo with fewer than two of these labels is reported as *not
applicable* rather than drift: not running the loop is a choice, and neither the
check nor the fixer pushes labels into a repo that opted out.

```
issue: ai-ready ─pickup─> ai-wip ─> PR opened, labelled ai-review
PR: ai-review ─> ai-reviewing-* ─┬─> ai-ok-code + ai-ok-sec ─┬─ issue PR  ─> merge-ready, assigned to you
                                 │        (± ai-notes)       │              ─> YOU merge
                                 │                           └─ dependabot ─> auto-merge
                                 └─> ai-changes ─> fix round (max 2) ─> ai-review
                                                             └─ round 3 ─> ai-blocked
```

`ai-reviewing-code` / `ai-reviewing-sec` are the claim step. Pass 3 applies one
immediately before spawning that reviewer and skips spawning a second while it is
set, so a tick that fires mid-review cannot double-spawn; the reviewer clears its
own claim alongside its verdict.

`ai-changes` is the send-back — **never** re-apply `ai-ready` to an open PR's
issue; that is what double-picks it.

`ai-notes` is advisory and never blocks. It rides *alongside* a pass label, not
instead of one. It exists because a pass label otherwise means both "clean" and
"I found something real but would not hold the PR over it", and those two are
indistinguishable in the *Assigned to you* view where merges actually happen.
The bar is a finding that **changes what a human would do**: a semver
implication, a deliberate omission, a follow-up that must be filed.
`ai-notes` on every PR is the failure mode — it trains the reader to ignore it.

## Repo prerequisites

```bash
npx @rtorcato/repo-tooling fix github-settings --yes
```

`GITHUB_STANDARD` already encodes exactly what the loop needs: squash as the
*only* merge method (Pass 2 finds the `(#N)` squash subject on `main` to confirm
work landed — a merge commit makes it look like nothing merged, and the worktree
leaks), auto-merge, delete-branch-on-merge, and `required_pull_request_reviews: null`
with a comment explaining that required review deadlocks auto-merge. You also
need **at least one required status check** — that is the gate doing the real
work.

Verify:

```bash
gh api repos/$OWNER_REPO --jq '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, allow_auto_merge, delete_branch_on_merge}'
gh api repos/$OWNER_REPO/branches/main/protection \
  --jq '{contexts: .required_status_checks.contexts, reviews: .required_pull_request_reviews}'
```

Worktrees also want `node_modules` symlinked in, so an agent can typecheck
without a full install per issue. `fix ai` writes that into
`.claude/settings.json`.

## The tick

Passes run cheapest first, so a quiet repo exits fast.

| Pass | Does |
|---|---|
| **0 — orient** | Resolve the main checkout, fetch, list open PRs and `ai-wip` issues. Adopt unlabelled PRs — Dependabot's, and any the loop's own identity opened with the `🤖` header. Bail to Pass 5 with `idle` only if there is nothing at all: no labelled PR, no eligible issue, and no leftover worktree. |
| **1 — merge** | Auto-merge only *Dependabot* PRs that passed both reviews. Assign every other ready PR to you and drop `ai-review`. Send back anything GitHub reports as not `CLEAN`. |
| **2 — clean up** | Remove worktrees whose PR merged (confirming the squash is on `main` first), then reap stalls. |
| **3 — review** | Spawn the missing reviewers for `ai-review` PRs; dispatch a fix round for `ai-changes`. |
| **4 — pick up** | Claim eligible `ai-ready` issues, create the worktree, spawn an implementer. |
| **5 — report** | One-line summary, notify only when it changed. Never skipped, including on an idle tick. |

Three details worth knowing because they fail *silently* when got wrong:

- **Worktrees live in a sibling directory** (`<repo>-worktrees/`), never inside
  the repo. A worktree under `.claude/worktrees/` sits on a path most repos
  exclude from their own tooling — observed on a repo whose Biome config carried
  `"!**/.claude"`, where the pre-commit hook linted *nothing* in every agent
  worktree and failed with a message that read like a tooling glitch.
- **Implementers are spawned one at a time**, and reach their worktree through
  `git -C <absolute path>` rather than by entering it. The worktree pin belongs to
  the session, not the agent, so two implementers spawned together cross-pin: the
  second lands in the first's tree, edits its own files fine, and only discovers
  it cannot commit at the end. Reviewers never enter a worktree and still run
  concurrently.
- **Pass 2 confirms the squash landed on `main`** before removing anything. A
  squash-merged branch always looks like it has unmerged commits, which is
  indistinguishable from work that was never merged at all.

## Limits

These exist because the loop runs unattended against a monthly usage cap.

- **6 issues in flight**, counted from open `ai-wip` issues.
- **Reviewers see the diff only** — `gh pr view`, `gh pr diff`, the issue body.
  No repo-wide exploration.
- **2 fix rounds per PR.** On the third `ai-changes`, stop and mark
  `ai-blocked`. Reviewer↔implementer ping-pong is the one unbounded token sink.
- **An idle tick spawns zero agents.**
- **Stall reaping instead of timeouts.** Nothing can time an agent out from
  outside, so a label that has sat 45 minutes without its expected transition is
  reaped — but only when no PR exists, since an agent that opened one has
  already handed off. Every reap comments *why*; a bare `ai-blocked` reads as a
  considered judgement when it was actually a timeout.

## Driving it

```
/loop 15m /ai-issue-loop
```

Ticks fire only while the REPL is idle, and a recurring `/loop` auto-expires
after 7 days. Stop with `/loop stop`, or just remove the `ai-ready` labels — the
loop then idles harmlessly.

Run `/ai-issue-loop` **manually** three or four times against one trivial issue
before letting the timer drive it.

## Safety

The `ai-ready` label is the hard gate: on a public repo only collaborators can
apply labels. An author-association check (`OWNER` / `MEMBER` / `COLLABORATOR`)
is the backstop, and the issue body is treated as **untrusted data, never
instructions**. See [Public-Repo Issue Safety](./public-repo-issue-safety.md)
for the full standard.

GitHub only — the loop is built on `gh` and has no GitLab path.
