<picture>
  <source media="(max-width: 640px)" srcset="./banner-mobile.png">
  <img src="./banner.png" alt="repo-tooling banner" width="1600">
</picture>

<br>

[![CI](https://github.com/rtorcato/repo-tooling/actions/workflows/ci.yml/badge.svg)](https://github.com/rtorcato/repo-tooling/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@rtorcato%2Frepo-tooling.svg)](https://badge.fury.io/js/@rtorcato%2Frepo-tooling)
[![npm downloads](https://img.shields.io/npm/dm/@rtorcato%2Frepo-tooling)](https://www.npmjs.com/package/@rtorcato/repo-tooling)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@rtorcato/repo-tooling)](https://bundlephobia.com/package/@rtorcato/repo-tooling)
[![Coverage](https://codecov.io/gh/rtorcato/repo-tooling/branch/main/graph/badge.svg)](https://codecov.io/gh/rtorcato/repo-tooling)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


One CLI to scaffold, audit and fix your repo's whole toolchain — linting, tests, commits, releases & CI.


Most tooling libraries give you one piece — just TypeScript configs, or just an ESLint preset. **repo-tooling** covers the entire lifecycle: TypeScript, Biome/ESLint, Vitest/Jest, Commitlint, Husky, Semantic Release, GitHub Actions CI, and supply-chain security (Dependabot + CodeQL) — all wired together. The interactive `setup` wizard scaffolds everything in one shot; `doctor` checks an existing project for drift; `fix` applies the missing pieces incrementally.

**[Full documentation →](https://rtorcato.github.io/repo-tooling/)**

> **Package manager: pnpm, by design.** Every generator scaffolds pnpm
> workflows, workspace files, and scripts. repo-tooling targets pnpm only for
> now — npm, yarn, and Bun aren't generated.

## Start a new project

Interactive wizard — answers every prompt, scaffolds the whole project:

```bash
npx @rtorcato/repo-tooling setup
```

Non-interactive — scaffold from a named preset in one shot (CI-friendly):

```bash
npx @rtorcato/repo-tooling setup --preset library -d ./my-lib --skip-install
# presets: library | web-app | node-api | nextjs-app | react-app | swift-library
```

`swift-library` scaffolds a SwiftPM package (manifest, sources, tests, SwiftLint,
Periphery, macOS CI) instead of an npm one — see the
[Swift guide](https://rtorcato.github.io/repo-tooling/guides/swift).

Just one config file? Use `copy`:

```bash
npx @rtorcato/repo-tooling copy biome        # → biome.json
npx @rtorcato/repo-tooling copy tsconfig     # → tsconfig.json
npx @rtorcato/repo-tooling copy changesets   # → .changeset/config.json
npx @rtorcato/repo-tooling copy oxlint       # → .oxlintrc.json
npx @rtorcato/repo-tooling copy claude-skill # → .claude/skills/repo-tooling.md
```

The Biome preset honours your `.gitignore`, so build output stays unlinted. One
known gap: Biome cannot parse Tailwind CSS v4 stylesheets (`@theme`, `@source`,
`@custom-variant`, `@apply`) and reports a parse error on them. If you use
Tailwind v4, exclude your stylesheet in `biome.json`:

```jsonc
{
  "extends": ["@rtorcato/repo-tooling/biome"],
  // `includes` replaces the preset's list rather than extending it — restate
  // the exclusions you still want alongside the CSS one.
  "files": { "includes": ["**", "!**/node_modules", "!**/dist", "!**/*.css"] }
}
```

**Already have a project?** Don't rerun `setup` — use `doctor` + `fix`:

```bash
npx @rtorcato/repo-tooling doctor   # find what's missing or drifted
npx @rtorcato/repo-tooling fix      # apply scaffolders, prompting per item
```

See the [Getting Started guide](https://rtorcato.github.io/repo-tooling/guides/getting-started/) for the full walkthrough.

## Commands

| Command | What it does | Example |
| --- | --- | --- |
| `setup` | Interactive wizard that scaffolds a whole new project (add `--preset` to run non-interactively). | `npx @rtorcato/repo-tooling setup` |
| `list` | List every tooling configuration this package can scaffold (`--json` for machine output). | `npx @rtorcato/repo-tooling list` |
| `copy <config>` | Copy a single config file into the current project. | `npx @rtorcato/repo-tooling copy biome` |
| `doctor` | Diagnose an existing project for missing or drifted tooling. | `npx @rtorcato/repo-tooling doctor` |
| `fix [target]` | Apply scaffolders for what `doctor` flagged (`--yes`, `--dry-run`, `--diff`). | `npx @rtorcato/repo-tooling fix` |

Prefer to run the audit in CI? `doctor` also ships as a GitHub Action:

```yaml
- uses: rtorcato/repo-tooling@v3.2.5
```

See the [GitHub Actions reference](https://rtorcato.github.io/repo-tooling/reference/github-actions/#run-doctor-as-a-github-action) for its inputs and outputs.

Every command takes `-d, --directory <path>`; run any with `--help` for its full flags. Run `list` (or `list --json`) for the full set of `fix` targets — it's the source of truth. Notable ones include `fix docs-site` (scaffold a [Docusaurus docs site](https://rtorcato.github.io/repo-tooling/guides/docs-site/)) and `fix bun` (Bun runtime config).

## The `.repo-tooling.json` lockfile

An **optional** manifest that records the tooling choices you adopted. Nothing
reads it at build/lint/test time — it exists only so `doctor` can tell an
*intentional opt-out* from *drift*. repo-tooling works fine without it, which is
why `doctor` reports a missing one as `not configured`, not an error.

Generate or refresh it from what's currently on disk:

```bash
npx @rtorcato/repo-tooling fix lockfile
```

**It's the only config file you need.** Don't keep a separate hand-authored
`.repo-tooling.config.json` next to it — the lockfile already embeds the full
`ProjectConfig` under `config`, and `setup --config` accepts the lockfile
directly, so you can re-run a non-interactive setup from it:

```bash
npx @rtorcato/repo-tooling setup --config .repo-tooling.json
```

Each `config.*` key mirrors a setup answer — see the
[schema](https://rtorcato.github.io/repo-tooling/schemas/lockfile.json) for the
full field reference. The keys `doctor` acts on:

- `typescript.enabled` / `typescript.config` — `base` \| `react` \| `next` \| `node` \| `express`
- `linting.tool` — `biome` \| `eslint` \| `both` \| `none`
- `formatting.tool` — `biome` \| `prettier` \| `none`
- `testing.framework` — `vitest` \| `jest` \| `playwright` \| `none`
- `gitHooks`, `commitLint`, `semanticRelease` — booleans
- `securityAutomation` — boolean (Dependabot + CodeQL)
- `bundler` — `tsup` \| `esbuild` \| `vite` \| `none`
- `aiSetup` — boolean (AGENTS.md, CLAUDE.md, Cursor/Copilot rules)

**How opt-outs actually work.** When the lockfile records that you declined an
*optional* tool (e.g. `securityAutomation: false`), `doctor` demotes that check
from `not configured` to `ok — intentionally declined` instead of nagging you to
add it. This applies only to optional checks — it does **not** silence *drift*:
if a config you adopted diverges from the shared base (say your `tsconfig.json`
extends a different preset), `doctor` still flags it, because drift is a mismatch
in a tool you're using, not an opt-out. There's no field to suppress drift today.

**Adoption vs. standalone.** `fix lockfile` infers adoption from what's on disk,
so on a repo that deliberately runs standalone configs (no
`@rtorcato/repo-tooling` dependency) it can record `typescript.config: "base"` and
friends — asserting you extend the shared bases when you don't. If you're not
adopting repo-tooling's configs, skip the lockfile; it won't stop the `extends`
drift warnings.

## AI agent rules

The package ships rules that teach AI coding agents to drive the CLI
(`doctor` / `fix` / `setup`) non-interactively. Install for your agent — all
generated from one source, so guidance never drifts between them:

```bash
npx @rtorcato/repo-tooling fix claude-skill --yes           # → .claude/skills/repo-tooling.md
npx @rtorcato/repo-tooling fix cursor-rules --yes           # → .cursor/rules/repo-tooling.mdc
npx @rtorcato/repo-tooling fix copilot-instructions --yes   # → .github/copilot-instructions.md
npx @rtorcato/repo-tooling fix agents-md --yes              # → AGENTS.md
```

`copilot-instructions` and `agents-md` upsert a delimited block, so your own
content in those shared files is never clobbered. Re-running updates the block
in place on upgrade.

Prefer a symlink that auto-syncs the Claude skill on every upgrade?

```bash
mkdir -p .claude/skills
ln -sf ../../node_modules/@rtorcato/repo-tooling/tooling/claude/repo-tooling.md \
  .claude/skills/repo-tooling.md
```

### Use with Claude Code (plugin)

This repo is also a self-hosted Claude Code marketplace. Install the plugin to
get two skills — `repo-tooling` (adopt/audit the presets via the CLI) and
`npm-publish` (the family's release rules) — in any session:

```
/plugin marketplace add rtorcato/repo-tooling
/plugin install repo-tooling@repo-tooling
```

### Use with other AI tools (Cursor / Copilot / Codex)

[`AGENTS.md`](AGENTS.md) at the repo root carries the same guidance in the
cross-tool convention many agents read, and ships in the npm tarball so tools
scanning `node_modules/@rtorcato/repo-tooling` can find it.

## What's new

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Related packages

- [@rtorcato/js-common](https://github.com/rtorcato/js-common) — General TypeScript/JS utilities (strings, dates, numbers, async, errors)
- [@rtorcato/browser-common](https://github.com/rtorcato/browser-common) — Browser Web API wrappers (clipboard, observers, storage, etc.)

## Roadmap

Direction and progress are tracked entirely on GitHub — see the
[milestones](https://github.com/rtorcato/repo-tooling/milestones) and
[open issues](https://github.com/rtorcato/repo-tooling/issues).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

<!-- js-tooling:skills:start -->
## Install the skills (`npx skills`)

Any agent that supports the [`skills`](https://www.npmjs.com/package/skills) CLI can install this repo's skills straight from GitHub — no clone, no package install:

```bash
npx skills add https://github.com/rtorcato/repo-tooling --skill repo-tooling
npx skills add https://github.com/rtorcato/repo-tooling --skill npm-publish
```
<!-- js-tooling:skills:end -->
