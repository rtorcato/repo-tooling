---
name: dogfood
description: |
  Run this repo's own tooling against throwaway greenfield fixtures in a temp
  directory and report what breaks. Use when the user asks to "dogfood",
  "test the tool on a fresh repo", "see what happens on a new project", or
  invokes `/dogfood`. Asks what to exercise before it starts. Writes only
  under a temp directory, never touches the repo's working tree, and never
  deletes anything — it hands the path back for the user to remove.
---

# dogfood

Point the repo's own tooling at repos it has never seen and find out what it
does wrong. Arguments: $ARGUMENTS

**The bugs live where the tool meets content it did not write.** An empty
directory finds nothing — every finding from the run this skill is based on came
from a fixture that already had a `package.json`, a manifest, or a source file
with an opinion in it. Scaffolding onto nothing is the one case the authors
already tested.

## What this never does

- **Never writes outside its temp directory.** Not the repo's working tree, not
  `~/.claude`, not a global git config (`git config --global` writes a stowed
  dotfile on this machine).
- **Never deletes.** `rm` is often permission-blocked for an agent, and a
  half-deleted fixture is worse than a kept one. Report the path and size at the
  end; the user removes it when they are done reading it.
- **Never files an issue without asking**, and never labels one `ai-ready` —
  that label is the human's gate into `ai-issue-loop`.

## Step 1 — ask what to exercise

Use `AskUserQuestion`. Look at the repo first so the options are real — read its
`package.json` `bin`, its CLI's `--help`, or its presets/templates directory —
then ask:

1. **What to exercise.** Offer the actual entry points found (multiSelect).
   For a scaffolding tool that is its presets; for a linter its rule sets; for a
   codemod its transforms.
2. **Fixture shape.** *Realistic pre-existing repos* (recommended — this is what
   finds bugs) vs *empty directories* (only worth it to check the happy path
   still works).
3. **What to do with findings.** *Report in the transcript only* (recommended
   for a first run) vs *also file GitHub issues*. If they choose issues, every
   one opens with `🤖 *Filed by an agent via dogfood.*` and carries no
   `ai-ready` label.

Skip a question the arguments already answer.

## Step 2 — pin the build and the version

**A finding with no version stamp is unreproducible and will be argued with.**
Build from source, and record the commit — not the version in `package.json`,
which under semantic-release without `@semantic-release/git` never moves:

```bash
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT" && pnpm build-cli          # or whatever CLAUDE.md says the build is
REF=$(git -C "$ROOT" rev-parse --short HEAD)
DIRTY=$(git -C "$ROOT" status --porcelain | head -1)
```

Say in every finding: *Reproduced with `dist/` built from `<REF>`*, and mention
it if the tree was dirty. Invoke the built artefact directly
(`node "$ROOT/dist/cli/index.js" …`) — never `npx <package>`, which silently
tests the *published* version instead of the working tree.

## Step 3 — make the temp root, once

```bash
BASE="${TMPDIR:-/tmp}/dogfood-$REF-$$"
mkdir -p "$BASE"
echo "$BASE"
```

**Pin `$BASE` as an absolute path and reuse that literal for the rest of the
run.** `$TMPDIR` resolves differently inside and outside the command sandbox, so
re-expanding it in a later command lands in a different directory and the run
silently splits in two. A unique suffix means a re-run never collides, which is
what makes never-deleting safe.

## Step 4 — build each fixture, and commit it

A fixture is a *plausible* repo, not a stub. Give it the things the tool will
read and be tempted to rewrite: a real name (scoped and unscoped both matter —
a scope is a code path), a source file, a manifest that already declares
something, an existing script.

Then **`git init` and commit it**. That baseline commit is the whole trick:

```bash
git -C "$BASE/$NAME" init -q
git -C "$BASE/$NAME" add -A
git -C "$BASE/$NAME" -c user.email=dogfood@local -c user.name=dogfood commit -qm baseline
```

`-c` on the command, never `git config --global`. Without the commit, "what did
the tool overwrite" is a question nobody can answer afterwards.

## Step 5 — before, run, after

```bash
node "$ROOT/dist/cli/index.js" doctor --json > "$BASE/$NAME.before.json" 2>&1 || true
node "$ROOT/dist/cli/index.js" setup --preset <p> --yes > "$BASE/$NAME.setup.log" 2>&1; echo "exit=$?"
node "$ROOT/dist/cli/index.js" doctor --json > "$BASE/$NAME.after.json" 2>&1 || true
```

`> file 2>&1`, in that order — `2>&1 > file` leaves stderr on the terminal, which
is where the interesting output usually is. `|| true` because a diagnostic
command exiting non-zero *is* data, not a reason to abort the run.

## Step 6 — the three checks that actually find things

Run all three on every fixture. Each one found a distinct real bug.

### a. What did it overwrite?

```bash
git -C "$BASE/$NAME" diff --stat
git -C "$BASE/$NAME" diff -- <every file the tool claims to merge rather than replace>
```

A tool that says it preserves your `name`, `version`, and scripts is making a
promise; the diff is where you check it. This is how a preset was caught
renaming a package after its directory and orphaning the sources — **and the
build still exited 0**, because the build system ignored the now-undeclared
directory. A green build is not evidence.

### b. Does it pass its own check?

```bash
node "$ROOT/dist/cli/index.js" doctor; echo "exit=$?"
```

Non-zero on a repo the tool itself just created is a bug every time, however
small the detail. "Run setup, you're aligned" either holds or the promise is
worthless — and a user's CI or pre-commit hook keys on exactly that exit code.
Diff `before.json` against `after.json` too: a check that *stopped* running is
invisible in the exit code.

### c. Does the contract it wrote actually hold?

The subtlest class, and the most damaging. The tool writes a *declaration* —
`exports`, `main`, entry points, a target list — and separately preserves a
*producer* — the build script. Nothing checks that the producer emits what the
declaration promises. So:

```bash
cd "$BASE/$NAME" && <the repo's own build> && ls -R dist 2>/dev/null
```

then read the manifest and confirm every path it names exists on disk. A package
whose `main` points at a file its own `build` cannot emit publishes green and
breaks every consumer.

## Step 7 — report

Per fixture, one short block: preset, exit codes, and each finding as
*what happened → why it matters → the evidence*. Paste the diff hunk or the JSON
line; a paraphrase is not a reproduction.

Rank by **silence, not severity**. A loud failure gets noticed by whoever hits
it. A wrong result that exits 0 does not, and that is the finding worth the
user's attention — lead with it.

If the user chose to file issues, one issue per finding, ≤30 lines each: what,
the minimal reproduction, the version stamp, and a `## What to change` section
that names the options rather than picking one. Attach no `ai-ready`.

**Say what you could not test.** A preset you skipped, a build you could not
run, an area still in flight — an unexamined corner reported as unexamined is
useful; one left silent reads as covered.

## Step 8 — hand back the temp directory

Last line of the run, always:

```bash
du -sh "$BASE"
```

Tell the user the path and the size, and give them the exact command:

```
! rm -rf <BASE>
```

The `!` prefix runs it in their session. Do not run it yourself, do not offer to
run it later, and do not delete it on a subsequent invocation — the fixtures are
the evidence behind every finding, and they are worth more than the disk.

## Gotchas that cost real time

- **Shell aliases corrupt captured output.** `ls` aliased to a colouriser emits
  escape codes into anything you parse. `unalias ls` / `unalias g` first, or use
  `command ls`.
- **Ambient `GIT_DIR` / `GIT_WORK_TREE` / `GIT_CONFIG*` outrank `-C`.** If any is
  exported, every fixture git command silently operates on the wrong repo.
  `env -u GIT_DIR -u GIT_WORK_TREE git …` when in doubt.
- **A function, not a variable, for a wrapped command.** `G="env -u X git"` does
  not word-split under zsh; define `g() { env -u X git "$@"; }`.
- **`pnpm install` may need the sandbox disabled** — it writes to a store outside
  the working directory. That is a legitimate escalation for this one command.
- **Never reuse a fixture between runs.** A second `setup` over an
  already-set-up repo tests idempotency, which is a different question; mixing
  the two makes both answers unreliable.
