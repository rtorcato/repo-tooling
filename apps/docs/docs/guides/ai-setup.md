---
title: AI Setup
description: Scaffold AI agent rules — AGENTS.md, CLAUDE.md, Cursor, Copilot, the Claude skill, and an MCP template — from one source of truth, in one command.
---

`repo-tooling` can scaffold the instruction files that AI coding tools read, so
every agent (Claude Code, Cursor, GitHub Copilot, or anything that reads
`AGENTS.md`) gets the same guidance for driving this project's tooling.

All of it derives from **one source of truth** — the shipped Claude skill
(`tooling/claude/repo-tooling.md`) — so the rules never drift between tools.

## What gets written

| File | For | How it's written |
| --- | --- | --- |
| `AGENTS.md` | The cross-tool standard | Merge-safe delimited block |
| `CLAUDE.md` | Claude Code | Pointer: `@AGENTS.md` (no duplication) |
| `.cursor/rules/repo-tooling.mdc` | Cursor | Generated rule file |
| `.github/copilot-instructions.md` | GitHub Copilot | Merge-safe delimited block |
| `.claude/skills/repo-tooling.md` | Claude Code skill | Copied verbatim |
| `.mcp.json.example` | Model Context Protocol | Commented template (see below) |
| `.claude/settings.json` | Claude Code worktrees | Merge-safe key upsert (see below), JS repos only |
| `README.md` | Your repo's own skills | Merge-safe block, only if this repo ships `skills/<name>/SKILL.md` |

Every file is either a merge-safe **delimited block** (`<!-- js-tooling:start -->`
… `<!-- js-tooling:end -->`) or a `.example`, so re-running never clobbers your
own content and is fully idempotent.

## Install it

During scaffolding, `setup` asks:

```
🤖 Add AI agent rules (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill)?
```

Or install / repair them any time on an existing repo:

```bash
npx @rtorcato/repo-tooling fix ai
```

`doctor` reports whether they're present (`AI setup` → `ok` /
`optional-missing`), and the choice is recorded in `.repo-tooling.json`, so
`doctor` won't nag if you intentionally opt out.

## Install a skill in one command

The skills ship in this repo under `skills/<name>/SKILL.md`, the standard layout
the [`skills`](https://www.npmjs.com/package/skills) CLI reads. So any agent that
supports it can install them straight from GitHub — no clone, no `repo-tooling`
install needed:

```bash
# The tooling skill (audit / fix / scaffold via the CLI)
npx skills add https://github.com/rtorcato/repo-tooling --skill repo-tooling

# The npm-publish skill
npx skills add https://github.com/rtorcato/repo-tooling --skill npm-publish
```

This drops the skill into your agent's skills directory (e.g.
`.claude/skills/`). Use this when you want the skill on its own; use
`fix ai` (above) when you want the full set of agent rule files scaffolded
together.

If **your own** repo ships skills under `skills/<name>/SKILL.md`, `fix ai`
auto-writes this same install section into your `README.md` — one
`npx skills add` command per skill, with the GitHub URL derived from
`package.json`'s `repository`. It's a merge-safe delimited block, so your own
README content is never touched, and repos without a `skills/` dir get nothing.

## `rules.aiLoop` and `rules.requiredSkills`: read by repo-ai

The ai-issue-loop pipeline lives in the optional package
[`@rtorcato/repo-ai`](https://rtorcato.github.io/repo-ai/) (see
[Using with repo-ai](./ai-issue-loop.md)). Its two settings
still live in `.repo-tooling.json`, and repo-tooling carries them forward
verbatim like everything else under `rules`:

```json
{
  "rules": {
    "aiLoop": { "agentUser": "your-bot-account" },
    "requiredSkills": ["ai-issue-loop", "ai-workflow", "ai-issue", "ai-loop-status"]
  }
}
```

- **`aiLoop.agentUser`** is the account in-flight loop work is assigned to.
- **`requiredSkills`** lists the loop skills the repo's workflows depend on.

`npx @rtorcato/repo-ai doctor` audits both: it checks that the agent account is
an assignable collaborator, and that each required skill is installed and
current. `repo-tooling doctor` no longer reports on either.

## `rules.mcp.recommended`: names and reasons, never an install directive

The same file can name the MCP servers a repo's workflow assumes — and only
name them:

```json
{
  "rules": {
    "mcp": {
      "recommended": [
        { "name": "some-server", "importance": "important", "why": "edits the design files under design/" }
      ]
    }
  }
}
```

`importance` is `nice-to-have`, `important` or `critical`; `why` is the one line
`.mcp.json` structurally cannot carry. `doctor` reports which of these names
`.mcp.json` doesn't declare, informationally, and stops there.

There's deliberately no `command`, `args` or `env`, and no fixer. MCP servers
execute code, so real config belongs in `.mcp.json` — the file below, which
carries Claude Code's own first-use consent prompt. The lockfile says *what and
why*, `.mcp.json` says *how*, and you say *whether*.

## Worktrees: symlink `node_modules` instead of reinstalling it

A Claude Code worktree starts empty, so an agent working one pays a full
`pnpm install` before it can typecheck, lint or test — every time. `fix ai`
upserts this into `.claude/settings.json` so Claude symlinks the directory from
the main checkout instead:

```json
{
  "worktree": {
    "symlinkDirectories": ["node_modules"]
  }
}
```

In a workspace repo the nested `node_modules` are added too, so
`pnpm --filter <pkg> build` works in a worktree instead of failing on a missing
binary. The list is derived from your own workspace globs — `pnpm-workspace.yaml`
`packages:` or `package.json` `workspaces` — and only workspaces that actually
have a `node_modules` in the main checkout are listed:

```json
{
  "worktree": {
    "symlinkDirectories": ["node_modules", "apps/docs/node_modules"]
  }
}
```

Only the `worktree.symlinkDirectories` key is touched — your `hooks`,
`permissions` and anything else in that file survive, and entries you added
yourself are kept. A file that doesn't parse is left alone rather than
clobbered; `doctor` reports it as drift for you to repair by hand.

### Two things honour that list

`worktree.symlinkDirectories` is a **Claude Code** setting, and Claude Code
honours it when *it* creates the worktree — i.e. via `EnterWorktree`. The `ai-*`
skills never call that (they create worktrees with a plain `git worktree add`, in
a sibling directory Claude Code would refuse), so the setting would otherwise be
inert for exactly the worktrees the issue loop creates. Instead the loop **reads
the same list and makes the symlinks itself**, which keeps one source of truth
for *what* to link across two mechanisms for *how*. A repo with no list gets a
real `pnpm install` per worktree — correct, just slower and a duplicate
`node_modules` each time.

:::warning Never run `pnpm install` inside a worktree
The worktree's `node_modules` is a symlink, so pnpm writes *through* it and
re-points the shared root `.bin` shims at that worktree's virtual store —
breaking every other worktree and the main checkout with a misleading
`tsc: MODULE_NOT_FOUND`. Recover with `pnpm install --frozen-lockfile` from the
main checkout.
:::

Skipped for Swift, Python and Perl repos — no `node_modules` to symlink, so the
key would be noise. `doctor` reports `Claude worktree settings`, and it honours
the same `aiSetup` opt-out in `.repo-tooling.json` as the rest of this feature.

## CLAUDE.md is a pointer, not a copy

`CLAUDE.md` contains a single `@AGENTS.md` import rather than a second copy of
the guidance. Claude Code reads both files, and the import keeps `AGENTS.md` as
the one place the rules live — no two files to keep in sync.

## MCP: a template, not an active config

`.mcp.json` (the file Claude Code actually loads) is **strict JSON** — it can't
hold comments, and an unconfigured server entry can fail `pnpm install` or add a
redundant server. So the feature ships a commented **`.mcp.json.example`**
instead. It's never loaded, so it's a safe place to document servers.

To activate MCP, copy it and remove the comments:

```bash
cp .mcp.json.example .mcp.json
```

Then add only the servers you actually need — most GitHub work is already
covered by the `gh` CLI, so a GitHub MCP server is usually redundant.
