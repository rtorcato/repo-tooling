---
title: The AI Issue Loop
description: The label-driven ai-ready issue → reviewed PR pipeline now lives in its own package, @rtorcato/repo-ai.
---

`ai-issue-loop` is a **label-driven pipeline** that takes a GitHub issue marked
`ai-ready`, implements it in a per-issue git worktree, opens a PR, has two agents
review it, and hands it to you to merge.

It moved out of repo-tooling into its own package,
**[`@rtorcato/repo-ai`](https://github.com/rtorcato/repo-ai)**, so repo-tooling
can be used without it. The full guide is
[`docs/ai-issue-loop.md`](https://github.com/rtorcato/repo-ai/blob/main/docs/ai-issue-loop.md)
in that repo.

## What moved

| Was (repo-tooling) | Now (repo-ai) |
|---|---|
| `repo-tooling loop <guard\|env\|tick\|worktree add\|cleanup\|reap\|comment\|verdict>` | `repo-ai loop …`, same subcommands and flags |
| `repo-tooling fix claude-skills` | `repo-ai fix claude-skills` |
| `repo-tooling fix labels` | `repo-ai fix labels` |
| `repo-tooling fix ai-loop-identity` | `repo-ai fix ai-loop-identity` |
| The `AI loop labels`, `AI loop agent`, `Claude skills` and `Required skills` doctor checks | `repo-ai doctor` |
| The `ai-issue-loop`, `ai-workflow`, `ai-issue` and `ai-loop-status` skills | Shipped by repo-ai |

`repo-tooling loop …` still exists, but only prints a pointer to repo-ai and
exits 1. `doctor --skills-dir`, `fix --skills-dir`, `--force-skills` and
`--gh-config-dir` are gone from repo-tooling. They're flags of `repo-ai`'s
commands now.

## What stays here

- The settings: `rules.aiLoop.agentUser` and `rules.requiredSkills` stay in
  [`.repo-tooling.json`](../reference/repo-tooling-json.mdx). repo-tooling
  carries them forward, and repo-ai reads them.
- The repo-side standard the loop relies on: branch protection, merge settings
  and the `release` environment gate (`fix github-settings`,
  `fix release-environment`), plus the `.claude/settings.json` worktree config
  (`fix ai`).

## Moving over

```bash
npx @rtorcato/repo-ai fix claude-skills --force-skills
```

`--force-skills` is needed once. Skills installed by repo-tooling carry its
version stamp, so repo-ai's installer can't tell them from a local edit and
refuses to overwrite them without it.
