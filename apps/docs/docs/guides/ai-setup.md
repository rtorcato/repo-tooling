---
title: AI Setup
description: Scaffold AI agent rules — AGENTS.md, CLAUDE.md, Cursor, Copilot, the Claude skill, and an MCP template — from one source of truth, in one command.
---

`repo-tooling` can scaffold the instruction files that AI coding tools read, so
every agent (Claude Code, Cursor, GitHub Copilot, or anything that reads
`AGENTS.md`) gets the same guidance for driving this project's tooling.

All of it derives from **one source of truth** — the shipped Claude skill
(`tooling/claude/repo-tooling.md`) — so the rules never drift between tools.

## Which agent integration?

| You use | Install | You get |
| --- | --- | --- |
| **Claude Code** | The plugin: `/plugin marketplace add rtorcato/repo-tooling`, then `/plugin install repo-tooling@repo-tooling` | The `repo-tooling` and `npm-publish` skills in every session, updated with the plugin |
| **Any other agent** (Cursor, Copilot, Codex, …) | `npx @rtorcato/repo-tooling fix agents-md --yes` | A block in `AGENTS.md`, the cross-tool file most agents read |

That's the whole recommendation. The rest of this page covers the other routes:
`setup` and `fix ai` write every rule file at once, `fix cursor-rules` /
`fix copilot-instructions` / `fix claude-skill` write one each, and
[`npx skills add`](#install-a-skill-in-one-command) installs a skill on its own.

## What gets written

| File | For | How it's written |
| --- | --- | --- |
| `AGENTS.md` | The cross-tool standard | Merge-safe delimited block |
| `CLAUDE.md` | Claude Code | Pointer: `@AGENTS.md` (no duplication) |
| `.cursor/rules/repo-tooling.mdc` | Cursor | Generated rule file |
| `.github/copilot-instructions.md` | GitHub Copilot | Merge-safe delimited block |
| `.claude/skills/repo-tooling/SKILL.md` | Claude Code skill | Copied verbatim |
| `.mcp.json.example` | Model Context Protocol | Commented template (see below) |
| `.claude/settings.json` | Claude Code worktrees | Merge-safe key upsert (see below), JS repos only |
| `README.md` | Your repo's own skills | Merge-safe block, only if this repo ships `skills/<name>/SKILL.md` |

Every file is either a merge-safe **delimited block** (see
[the `js-tooling` markers](#the-js-tooling-markers)) or a `.example`, so
re-running never clobbers your own content and is fully idempotent.

## Install it

During scaffolding, `setup` asks:

```
🤖 Add AI agent rules (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill)?
```

`--preset` runs answer yes. To scaffold without them, add `--no-ai-setup`:

```bash
npx @rtorcato/repo-tooling setup --preset library --no-ai-setup
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

## The `js-tooling` markers

Wherever repo-tooling writes into a file you also edit, it fences its part with
HTML comments. They render as nothing on GitHub and on most docs sites:

| Markers | Where | What's inside |
| --- | --- | --- |
| `<!-- js-tooling:start -->` … `<!-- js-tooling:end -->` | `AGENTS.md`, `.github/copilot-instructions.md` | The agent rules |
| `<!-- js-tooling:skills:start -->` … `<!-- js-tooling:skills:end -->` | `README.md` | The `npx skills add` section, if the repo ships skills |
| `<!-- js-tooling:badges:start -->` … `<!-- js-tooling:badges:end -->` | `README.md` | The status badges |

On every run, `fix` and `setup` replace what's between a pair and leave
everything outside it alone. So:

- **Write your own content outside the markers.** Anything between them is
  overwritten on the next run.
- **Leave the markers in place.** Delete a pair and the next run adds a fresh
  block instead of updating the old one.
- **`js-tooling` is the package's old name.** The markers kept it so blocks
  written before the rename still update in place.

## Loop settings live in `.repo-ai.json`

The ai-issue-loop pipeline lives in the optional package
[`@infrazero/repo-ai`](https://docs.infrazero.dev/repo-ai/) (see
[Using with repo-ai](./ai-issue-loop.md)), and so do its settings: the agent
account and the required skills go in repo-ai's own `.repo-ai.json`. See
[repo-ai's config docs](https://docs.infrazero.dev/repo-ai/).

`rules.aiLoop` and `rules.requiredSkills` in `.repo-tooling.json` are
deprecated. They still validate, and are removed in the next major. To move
them across, run:

```bash
npx @infrazero/repo-ai fix config
```

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
