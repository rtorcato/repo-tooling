---
title: Perl
description: Perl::Critic and perltidy configs, plus the Perl checks doctor runs on a cpanfile distribution.
---

`doctor` and `fix` detect a Perl distribution from `cpanfile`, `Makefile.PL` or `dist.ini` and layer Perl-specific checks on top of the language-agnostic ones (CI, Dependabot, GitHub repo settings).

The standard here is **Perl::Critic for lint, perltidy for format, prove for tests**. Unlike the Swift and Python modules there's no overlap to arbitrate: Perl::Critic only reports, it never rewrites, so the linter and the formatter can both run without fighting.

:::note No `perl-library` preset yet
`setup --preset` has no Perl entry, so this is an audit-and-fix module: point it at an existing distribution. Scaffolding one from scratch is follow-up work, and it's why there's no `perl-lockfile` fix target either.
:::

## Checks

| Check | Status when absent | Fix target |
|---|---|---|
| Perl distribution | `missing` | — (dependency metadata you write) |
| Perl::Critic | `missing` | `perlcritic` |
| perltidy | `missing` | `perltidy` |
| Perl `.gitignore` | `missing` | `perl-gitignore` |
| Perl tests | `missing` | — (write tests, or `perl-ci`) |
| Git hooks | `optional-missing` | `perl-git-hooks` |
| Pre-push hook | `optional-missing` | `perl-git-hooks` |

`Perl distribution` is checked for two things no tool infers for you: that metadata exists at all, and that it declares a **minimum perl**. Without the floor, `cpanm` installs the distribution on an interpreter that cannot compile it, and the user meets a syntax error rather than a version complaint. Any of the four metadata files can carry it:

```perl
requires 'perl', '5.036';        # cpanfile
MIN_PERL_VERSION => '5.036',     # Makefile.PL
requires => { perl => '5.036' }, # Build.PL
perl = 5.036                     # dist.ini, under [Prereqs]
```

All three spellings of a perl version are understood, including the packed decimal `5.036000` — read naively that's minor 36000, which would put a nonexistent interpreter in the CI matrix.

`Perl tests` has two halves: a suite must exist (`t/`, or `xt/` for author tests), and some pipeline must actually run it — `prove`, `make test` or `dzil test` all count. A `t/` tree nothing executes reads as covered, which is worse than having none.

Nothing here parses your metadata as Perl. `cpanfile`, `Makefile.PL` and `Build.PL` are all *executable Perl*, and reading them properly would mean running code out of the audited repo — which `doctor` never does. It reads one key with a regex instead.

## Configs

```bash
npx @rtorcato/repo-tooling fix perlcritic   # .perlcriticrc
npx @rtorcato/repo-tooling fix perltidy     # .perltidyrc
npx @rtorcato/repo-tooling fix perl-gitignore
```

Both configs are also available via `copy`:

```bash
npx @rtorcato/repo-tooling copy perlcritic
```

The undotted spellings (`perlcriticrc`, `perltidyrc`) are accepted by the checks too — perlcritic and perltidy read either.

### Perl::Critic

Severity **3** ("harsh") and above. Severity 1 turns on the whole *Perl Best Practices* book, including rules modern code deliberately breaks; 4–5 catch so little they stop functioning as a gate.

Two policies are switched off, and both are exclusions rather than laziness:

- `Modules::RequireVersionVar` wants a `$VERSION` in every `.pm`. A distribution that carries its version in the metadata (Dist::Zilla) or in the main module alone would have to repeat it everywhere to satisfy it.
- `Documentation::RequirePodSections` enforces a fixed POD skeleton in every file, including private modules with no public interface. The POD that matters is on the entry points, which the policy can't tell apart.

`RequireUseStrict` / `RequireUseWarnings` list `Moose`, `Moo`, `Mojo::Base` and `Test2::V0` as equivalents — those enable both pragmas for you, so demanding the explicit `use strict` alongside them is a false positive.

### perltidy

`-pbp` (Perl Best Practices layout) as the base, then 100 columns instead of PBP's 78 — the same width the JavaScript and Swift presets use, so a polyglot repo wraps consistently. Order matters in a `.perltidyrc`: `-pbp` is a bundle, so every deviation has to come after it.

The shipped config deliberately does **not** set `-b` (in-place edit). That flag would change what `perltidy lib/Foo.pm` does for someone running it by hand — silently overwriting the file instead of producing `Foo.pm.tdy`. The pre-commit hook and the CI job pass `-b -bext='/'` explicitly, where rewriting is the point.

### `.gitignore`

`fix perl-gitignore` **appends** what's missing rather than replacing the file, so a distribution's own entries survive. It covers build output (`/blib/`, `pm_to_blib`, `MYMETA.*`, `Makefile.old`), distribution tarballs, Carton's `/local/`, coverage and profiling output (`/cover_db/`, `nytprof.out`), and compiled XS artefacts.

Only `blib`, `MYMETA` and `pm_to_blib` are required for the check to pass — any `Makefile.PL` build produces those three. `local/` is in the emitted block but isn't demanded, since only Carton users have one.

## Git hooks

Husky is an npm package, so a Perl distribution can't use it without dragging node into a toolchain that otherwise has none. The node-free equivalent is a committed hooks directory:

```bash
npx @rtorcato/repo-tooling fix perl-git-hooks
```

| Hook | Runs |
|---|---|
| `.githooks/pre-commit` | `perltidy` in place, then `perlcritic` |
| `.githooks/pre-push` | `perlcritic`, then `prove -lr t` — the same gate as CI |

perltidy runs first so the lint pass sees the final layout.

Both hooks enumerate sources with `find … -exec … +` rather than piping into `xargs`. With no matches, `-exec … +` runs nothing — whereas **GNU** `xargs`, which is what the Linux CI runners have, runs the command once with no arguments unless given `-r`. `perltidy` with no file arguments reads stdin, so that lands as a lint job hanging until the timeout with no output. BSD/macOS `xargs` already declines to run on empty input, which is precisely how that bug would pass local testing and only appear in CI. `-exec … +` is POSIX and behaves the same everywhere.

The same expression drives the CI lint job, so a commit that passes the hook can't fail CI over a file one of them never saw.

`core.hooksPath` is per-clone local git config, not a committed file, so `doctor` never reports its absence as drift. Each clone needs it once:

```bash
git config core.hooksPath .githooks
```

## CI

```bash
npx @rtorcato/repo-tooling fix perl-ci          # .github/workflows/ci.yml
npx @rtorcato/repo-tooling fix perl-gitlab-ci   # .gitlab-ci.yml
```

| Job | What it does |
|---|---|
| `lint` | `perlcritic`, then `perltidy` in place + `git diff --exit-code` |
| `test` | `prove -lr t`, matrixed over the supported interpreters |

perltidy has no non-rewriting check mode that reports *which* files are untidy, so the lint job tidies in place and lets git report the delta. The diff in the log is the fix, ready to apply.

The lint job does **not** install the distribution's dependencies. Perl::Critic is static, so pulling them in would only make lint fail on a CPAN mirror hiccup that has nothing to do with the code.

The test matrix is derived from the declared minimum perl: **two points, the floor and the newest release**, not every minor in between. A distribution declaring `requires 'perl', '5.042';` gets a single-entry matrix rather than a version that doesn't exist yet.

### CodeQL and Dependabot

Neither applies to Perl, and both say so rather than nagging:

- **CodeQL** ships no Perl analyzer. `doctor` reports the check as `ok — not applicable`, and `fix codeql` prints `skipped` instead of reporting a successful fix that wrote no file.
- **Dependabot** has no CPAN ecosystem. A Perl repo still gets the `github-actions` update block, which applies to any repo with workflows.

### GitLab

`.gitlab-ci.yml` runs `perlcritic` and `prove` in the official `perl:` image, pinned to the newest interpreter the distribution supports. No matrix: GitLab's `parallel:matrix` needs a per-job image override, and a mirrored repo is a secondary pipeline — the version sweep lives on the GitHub side.

## What isn't covered yet

- **Scaffolding.** No `setup --preset perl-library`, so there's no `perl-lockfile` fix target either — writing a fabricated set of JS tool choices into a distribution's lockfile would be worse than `doctor` reporting it absent, which is true.
- **README badges.** The check runs, but `fix badges` derives every URL from a package.json `name` + `repository`, which a Perl repo hasn't got. `doctor` reports; you add them by hand.
- **Release automation.** No CPAN upload workflow yet — unlike the Swift module, which checks for a tag-triggered release.
