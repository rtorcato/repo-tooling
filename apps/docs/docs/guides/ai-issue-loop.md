---
title: Using with repo-ai (optional)
sidebar_label: Using with repo-ai
description: repo-tooling works on its own. @rtorcato/repo-ai is an optional add-on that turns ai-ready GitHub issues into reviewed PRs, and builds on the repo standard repo-tooling sets up.
---

**repo-tooling doesn't need repo-ai.** Everything it does (`setup`, `doctor`,
`fix`, the presets and the agent-rule files) works the same with or without it.
Nothing in repo-tooling installs repo-ai, prompts for it, or fails a check
because it's missing.

**[`@rtorcato/repo-ai`](https://rtorcato.github.io/repo-ai/) is optional.** It
adds an **ai-issue-loop**: a label-driven pipeline that takes a GitHub issue
marked `ai-ready`, implements it in its own git worktree, opens a PR, has two
agents review it, and hands it to you to merge. Adopt it on a repo when you want
agents working your issue queue. Leave it out otherwise.

## Who does what

| | repo-tooling | repo-ai |
|---|---|---|
| **Purpose** | Scaffold and audit a repo's tooling: TypeScript, lint, tests, git hooks, CI, releases, GitHub settings | Run agents against `ai-ready` issues and carry their PRs to review |
| **Needed by the other?** | No | Builds on the repo standard below |
| **CLI** | `repo-tooling setup / doctor / fix` | `repo-ai loop … / doctor / fix` |
| **Claude Code skills** | `repo-tooling`, `npm-publish`, `dogfood` | `ai-workflow`, `ai-issue-loop`, `ai-issue`, `ai-loop-status` |
| **Config** | `.repo-tooling.json` | The same file, under `rules.aiLoop` and `rules.requiredSkills` |

## What repo-ai relies on from repo-tooling

repo-ai doesn't import repo-tooling. It assumes a repo already meets the
standard repo-tooling sets up, and each piece of that has its own `fix` target:

- **Squash merges, auto-merge, required status checks, and no required approving
  reviews** (`fix github-settings`). The loop's reviewers approve with labels,
  so a required human approval would deadlock every PR it opens.
- **A `release` environment with required reviewers** (`fix release-environment`),
  so a merge never reaches npm without a person approving it.
- **Worktree dependency links** in `.claude/settings.json` (`fix ai`), so each
  agent's worktree builds without a fresh install.
- **`.repo-tooling.json`**: repo-ai reads `rules.aiLoop.agentUser` and
  `rules.requiredSkills` from it. repo-tooling carries those keys forward and
  never reads them.

You can meet the same standard by hand. repo-tooling is just the quickest way.

## Adding repo-ai to a repo

```bash
npx @rtorcato/repo-tooling doctor   # the repo standard above: fix anything it flags
npx @rtorcato/repo-ai setup         # skills, labels, agent identity, statusline, then its own doctor
```

`repo-ai setup` asks before each step, and `--yes` runs them all.

After that, label an issue `ai-ready` and run `/ai-workflow` in Claude Code.
repo-ai's [guide to the loop](https://rtorcato.github.io/repo-ai/docs/ai-issue-loop/)
covers the label state machine, the safety gates and the limits. Its
[command reference](https://rtorcato.github.io/repo-ai/docs/commands/) covers
every `repo-ai` command.

## Moving over from repo-tooling 3.x

The loop shipped inside repo-tooling until 4.0.0.

| Was (repo-tooling 3.x) | Now (repo-ai) |
|---|---|
| `repo-tooling loop <guard\|env\|tick\|worktree add\|cleanup\|reap\|comment\|verdict>` | `repo-ai loop …`, same subcommands and flags |
| `repo-tooling fix claude-skills` | `repo-ai fix claude-skills` |
| `repo-tooling fix labels` | `repo-ai fix labels` |
| `repo-tooling fix ai-loop-identity` | `repo-ai fix ai-loop-identity` |
| The `AI loop labels`, `AI loop agent`, `Claude skills` and `Required skills` doctor checks | `repo-ai doctor` |
| The `ai-issue-loop`, `ai-workflow`, `ai-issue` and `ai-loop-status` skills | Shipped by repo-ai |

`repo-tooling loop …` now only prints a pointer to repo-ai and exits 1.

Reinstall the skills once with `--force-skills`:

```bash
npx @rtorcato/repo-ai fix claude-skills --force-skills
```

Skills installed by repo-tooling carry its version stamp, so repo-ai can't tell
them from a local edit and won't overwrite them without the flag.
