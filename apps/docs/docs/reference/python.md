---
title: Python
description: Ruff, mypy and pytest configs, plus the Python checks doctor runs on a pyproject.toml repo.
---

`doctor` and `fix` detect a Python repo from `pyproject.toml` (or a legacy `setup.py`) and layer Python-specific checks on top of the language-agnostic ones (CI, CodeQL, Dependabot, GitHub repo settings).

The standard here is **Ruff for lint *and* format, mypy for types, pytest for tests** — four tools' worth of coverage from three configs.

:::note No `python-library` preset yet
`setup --preset` has no Python entry, so this is an audit-and-fix module: point it at an existing repo. Scaffolding a package from scratch is follow-up work, and it's why there's no `python-lockfile` fix target either.
:::

## Checks

| Check | Status when absent | Fix target |
|---|---|---|
| `pyproject.toml` | `missing` | — (package metadata you write) |
| Ruff | `missing` | `ruff` |
| mypy | `missing` | `mypy` |
| pytest | `missing` | `pytest` |
| Python `.gitignore` | `missing` | `python-gitignore` |
| Python tests | `missing` | — (write tests, or `python-ci`) |
| Git hooks | `optional-missing` | `python-git-hooks` |
| Pre-push hook | `optional-missing` | `python-git-hooks` |

`pyproject.toml` is checked for two things no tool infers for you: a `[project]` table (or Poetry's `[tool.poetry]`), and a `requires-python` floor. Without the floor, pip installs the package on an interpreter it cannot run on and the failure lands on the user at import time. There's no fixer — that content is the project's own metadata.

`Python tests` has two halves: a suite must exist (`tests/`, `test/`, or a root-level `test_*.py`), and some pipeline (`.github/workflows/*` or `.gitlab-ci.yml`) must actually run `pytest`. A `tests/` directory nothing executes reads as covered, which is worse than having none.

Each tool config is accepted in any of its standard homes — `ruff.toml`, `mypy.ini`, `pytest.ini`, `setup.cfg`, `tox.ini`, or the matching `[tool.*]` table in `pyproject.toml`. A repo that already configures them in `pyproject.toml` passes untouched.

## Configs

```bash
npx @rtorcato/repo-tooling fix ruff     # ruff.toml
npx @rtorcato/repo-tooling fix mypy     # mypy.ini
npx @rtorcato/repo-tooling fix pytest   # pytest.ini
npx @rtorcato/repo-tooling fix python-gitignore
```

All three are also available via `copy`:

```bash
npx @rtorcato/repo-tooling copy ruff
```

They're written as standalone files rather than merged into `pyproject.toml`: that file is the project's own metadata, and merging a table into it needs a TOML round-tripper this CLI doesn't carry.

### Ruff

Ruff is the linter **and** the formatter. **black is deliberately not part of the standard** — Ruff's formatter is black-compatible, and a second *rewriting* formatter fights the first. (Same reasoning as SwiftFormat on the [Swift](./swift.md) side.) `flake8`, `isort` and `pyupgrade` are likewise absent: the `select` list covers all three.

```toml
line-length = 100
target-version = "py310"

[lint]
select = ["E", "W", "F", "I", "UP", "B", "SIM", "RUF"]
ignore = ["E501"]

[format]
quote-style = "double"
indent-style = "space"
```

`E501` (line too long) is ignored on purpose: it's the formatter's job, and leaving it on makes every long string literal a lint error the formatter isn't allowed to fix.

### mypy

Strict on your own code, lenient on third-party packages that ship no types. Without the second half a single untyped dependency turns every import into an error and the whole run gets ignored.

```ini
[mypy]
python_version = 3.10
strict = True
warn_unused_configs = True
warn_unreachable = True
show_error_codes = True
```

### pytest

```ini
[pytest]
testpaths = tests
addopts = --strict-markers --strict-config
filterwarnings =
    error
```

`--strict-markers` and `--strict-config` turn a typo'd marker or config key into a failure instead of a silent skip. Warnings are errors for the same reason — a `DeprecationWarning` nobody sees is a bug waiting for the next major release.

### `.gitignore`

The `python-gitignore` fixer **appends** rather than replacing, so project-specific entries survive. It adds only what's absent:

```gitignore
__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/
.venv/
venv/
.env
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
```

## Git hooks

Husky is an npm package, so a Python repo can't use it without dragging node into a toolchain that otherwise has none. The node-free equivalent is a committed hooks directory:

```bash
npx @rtorcato/repo-tooling fix python-git-hooks
```

| Hook | Runs |
|---|---|
| `.githooks/pre-commit` | `ruff format` then `ruff check --fix` |
| `.githooks/pre-push` | `ruff check`, `mypy .`, `pytest` — the same gate as CI |

The `pre-commit` *framework* (the Python tool of that name) is deliberately not used: it's a second config file, a second pinned-tool source, and a second place to keep the CI commands in sync. The hooks run the tools directly, exactly as CI does.

`core.hooksPath` is per-clone local git config, not a committed file, so `doctor` never reports its absence as drift. Each clone needs it once:

```bash
git config core.hooksPath .githooks
```

## CI

```bash
npx @rtorcato/repo-tooling fix python-ci          # .github/workflows/ci.yml
npx @rtorcato/repo-tooling fix codeql             # .github/workflows/codeql.yml
npx @rtorcato/repo-tooling fix python-gitlab-ci   # .gitlab-ci.yml
```

| Job | What it does |
|---|---|
| `lint` | `ruff check --output-format=github` + `ruff format --check` |
| `typecheck` | installs the project, then `mypy .` |
| `test` | `pytest`, matrixed over the supported interpreters |

The typecheck job installs the project (`pip install -e .`) before running mypy — against bare source, mypy reports every third-party import as missing.

The test matrix is derived from `requires-python` in `pyproject.toml`: **two points, the declared floor and the newest release**, not every minor in between. Breaks show up at the ends of the range (a builtin removed in 3.10, a deprecation added in 3.13); the middle costs runner minutes to re-prove them absent. A repo declaring `requires-python = ">=3.13"` gets a single-entry matrix rather than a version that doesn't exist yet.

CodeQL uses `language: python`, and Dependabot uses `package-ecosystem: pip` — both come from the language registry, so the shared `fix codeql` / `fix dependabot` targets do the right thing on a Python repo.

### GitLab

`.gitlab-ci.yml` runs `ruff` and `pytest` in the official `python:` image, pinned to the newest interpreter the repo supports. No matrix: GitLab's `parallel:matrix` needs a per-job image override, and a mirrored repo is a secondary pipeline — the version sweep lives on the GitHub side.

## What isn't covered yet

- **Scaffolding.** No `setup --preset python-library`, so there's no `python-lockfile` fix target either — writing a fabricated set of JS tool choices into a Python repo's lockfile would be worse than `doctor` reporting it absent, which is true.
- **README badges.** The check runs, but `fix badges` derives every URL from a package.json `name` + `repository`, which a Python repo hasn't got. `doctor` reports; you add them by hand.
- **Release automation.** No PyPI publish workflow yet — unlike the Swift module, which checks for a tag-triggered release.
