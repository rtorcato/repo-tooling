# AGENTS.md

Orientation for coding agents working with `@rtorcato/repo-tooling`. Human-readable docs live at https://rtorcato.github.io/repo-tooling/.

## What this is

A one-package JavaScript / TypeScript tooling distribution. Ships every preset (TypeScript, Biome, ESLint, Prettier, Vitest, Jest, Commitlint, semantic-release, tsup, esbuild, Vite, Playwright) plus a CLI to scaffold and audit projects. Consumers get one install.

**Swift** repos (detected via `Package.swift`) are covered end to end: `setup --preset swift-library` scaffolds a SwiftPM package, and `doctor`/`fix` run the language-agnostic checks plus SwiftLint / Periphery / `.gitignore` / `Package.swift`. **Python** repos (detected via `pyproject.toml` / `setup.py`) get `doctor`/`fix` — Ruff / mypy / pytest / `.gitignore` / CI / git hooks — but no `setup` preset yet. **Perl** distributions (detected via `cpanfile` / `Makefile.PL` / `dist.ini`) get the same deal: Perl::Critic / perltidy / `.gitignore` / CI / git hooks, no `setup` preset. See `src/languages/` — one directory per language module, `src/base/` for what's shared.

## CLI surface (agent-friendly)

Every command supports `--json` and a non-interactive mode. Combine with `--yes` for fully autonomous use.

| Command | Non-interactive | JSON output | Use case |
|---|---|---|---|
| `setup --preset <name>` | ✅ | `--dry-run` only | Scaffold a new project. Presets: `library`, `web-app`, `node-api`, `nextjs-app`, `react-app`, `swift-library`. |
| `setup --config <path>` | ✅ | `--dry-run` only | Scaffold with a full `ProjectConfig` JSON file. See `setup --config-schema`. |
| `setup --config-schema` | ✅ | ✅ (JSON Schema) | Print the JSON Schema for `ProjectConfig`. Use to validate configs before scaffolding. |
| `setup --dry-run` | ✅ | ✅ | Print resolved config + file list without writing. Pair with `--preset` or `--config`. |
| `doctor --json` | ✅ | ✅ | Audit a project. Returns `{ directory, results: [{ check, status, detail, hint? }] }`. Status: `ok` / `drift` / `missing` / `optional-missing`. |
| `fix --json --yes` | ✅ | ✅ | Walk every doctor finding, apply fixers. Returns `FixActionRecord[]` with `status: applied | dry-run | skipped | already-ok | unsupported`. |
| `fix <target> --json --yes` | ✅ | ✅ | Apply one fixer. Targets from `list --json`. |
| `fix --dry-run` | ✅ | ✅ | Print what each fixer would write without writing. Combine with `--json`. |
| `list --json` | ✅ | ✅ | Enumerate the library's surface area. Each entry has `{ name, description, exports, fixTarget }`. |
| `copy <name>` | ✅ | text only | Copy a single preset (`biome`, `tsconfig`) into the current directory. |

## Recommended workflows

### Scaffolding a new project from scratch

```bash
npx @rtorcato/repo-tooling setup --preset library -d ./my-lib --skip-install
```

For full control:

```bash
# 1. Get the schema
npx @rtorcato/repo-tooling setup --config-schema > project-config.schema.json

# 2. Write a config matching it
cat > project.json <<EOF
{
  "projectName": "my-lib",
  "projectType": "library",
  "typescript": {"enabled": true, "config": "base"},
  "linting": {"tool": "biome"},
  "formatting": {"tool": "biome"},
  "testing": {"framework": "vitest", "environment": "node"},
  "gitHooks": true,
  "commitLint": true,
  "semanticRelease": true,
  "securityAutomation": true,
  "bundler": "tsup"
}
EOF

# 3. Preview, then scaffold
npx @rtorcato/repo-tooling setup --config project.json --dry-run
npx @rtorcato/repo-tooling setup --config project.json -d ./my-lib --skip-install
```

### Auditing an existing project

```bash
# Get findings
npx @rtorcato/repo-tooling doctor --json -d ./existing-repo > doctor.json

# Apply every fixable finding (no prompts, no surprises)
npx @rtorcato/repo-tooling fix --yes --json -d ./existing-repo > applied.json

# Re-audit to confirm clean
npx @rtorcato/repo-tooling doctor --json -d ./existing-repo
```

### Targeted fixes

```bash
# Apply one fixer from the list (run `list --json` for every target)
npx @rtorcato/repo-tooling fix dependabot --yes --json
npx @rtorcato/repo-tooling fix engines --yes --json
npx @rtorcato/repo-tooling fix docs-site --yes --json   # scaffold a Docusaurus docs site under apps/docs
npx @rtorcato/repo-tooling fix bun --yes --json         # Bun runtime/test config

# Opt-in only — writes user-global state, so a bare `fix` / `fix --yes` skips it.
# Installs the ai-issue-loop skill to ~/.claude/skills. Override with --skills-dir,
# which is required alongside --yes/--json when that directory doesn't exist.
npx @rtorcato/repo-tooling fix claude-skills --yes --json
```

## Drift policy (important)

`fix` defaults the confirm prompt to **No** for drift cases (existing file that doesn't extend our preset). The `--yes` flag is required to overwrite drift. Safe-merge fixers (`engines`, `husky`, `package-json`) never overwrite — they add/merge — and use friendlier prompt wording. `fix --json` implies `--yes` (prompts would corrupt JSON output).

Fixers marked `explicitOnly` are exempt from `fix` all *and* from `fix --yes` — they only run when named as the target. Today that is `claude-skills`, the one fixer whose blast radius is outside the repo.

A fixer may also **refuse** — the target file holds something the generator cannot reproduce, so overwriting would destroy it. Today that is `dependabot` against a config with repo-local `ignore:` rules (#422). A targeted `fix dependabot` then exits 1 with `error: dependabot-ignore-rules`; a bulk `fix --yes` records it `skipped` and carries on with the rest. Neither `--yes` nor `--json` overrides it — resolve the named rules by hand and re-run.

## Source-of-truth files in the repo

- `src/cli/commands/setup.ts` — `ProjectConfig` interface and the setup orchestrator
- `src/cli/commands/setup-presets.ts` — preset definitions, JSON Schema, config validator, `computeFileList`
- `src/cli/commands/doctor.ts` — all checks and the public `runDoctor(dir)` / `evaluateNodeVersion(version)` / `nextStepSuggestions(results)`
- `src/cli/commands/fix.ts` — `Fixer` interface, fixer registry, `fixCommand`
- `src/cli/commands/fix-targets.ts` — shared check → fix target map (used by both doctor's footer and fix's lookup)
- `src/cli/generators/` — one file per concern (linting, testing, build, git, github-actions, security, misc)
- `tooling/` — every shipped preset, mirrored 1:1 with `package.json` `exports`

## Conventions in this repo

- Conventional commits enforced via commitlint; header max 100 chars, body/footer line length unenforced
- Biome for lint + format (run via `pnpm run check`, i.e. `biome check .` over the whole repo — the same script this package emits to consumers)
- Tests live alongside source in `tests/`; vitest with no separate config
- semantic-release runs on push to `main`; `fix:` → patch, `feat:` → minor, `chore:` / `docs:` → no release

## Pointers

- Site index for LLMs: https://rtorcato.github.io/repo-tooling/llms.txt
- Full CLI guide: https://rtorcato.github.io/repo-tooling/guides/cli/
- For AI agents: https://rtorcato.github.io/repo-tooling/guides/for-ai-agents/
- Source: https://github.com/rtorcato/repo-tooling
