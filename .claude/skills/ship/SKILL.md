---
name: ship
description: Commit and push the current working tree after running all CI gates locally. Triggers on "ship it", "commit and push", "let's push", "/ship", or any explicit request to commit-then-push. Encodes this repo's conventions (pnpm + biome + commitlint + semantic-release on main). Does NOT trigger on commit-only or push-only requests — use those flows directly.
---

# Ship workflow

End-to-end commit + push for this repo. Husky already runs lint/typecheck on pre-commit and typecheck/test/build on pre-push, but this skill front-loads those checks so you catch failures before writing a commit message.

## 1. Survey state (parallel)

Run in a single message:
- `git status` — what's staged, unstaged, untracked
- `git diff` — full diff of unstaged changes
- `git diff --cached` — staged changes
- `git log -5 --oneline` — recent commit style
- `git status -sb` — branch + tracking info (ahead/behind origin)

If on `main` or `master`, note it — pushing there triggers semantic-release.

## 2. Run all CI gates locally (parallel)

```
pnpm check         # biome lint + format
pnpm typecheck     # tsc --noEmit
pnpm test --run    # vitest single-run
pnpm build-cli     # tsc CLI build
```

If any fail, **STOP**. Report the failure and ask the user how to proceed. Do not commit broken code.

## 3. Stage selectively

- **Never** `git add -A`, `git add .`, or `git add -u`.
- Add specific files by name.
- Explicitly exclude: `.claude/settings.local.json`, anything that looks like a secret (`.env*`, `*.key`, `credentials*`), and build artifacts (`dist/`, `coverage/`).
- If you see untracked files that don't belong, ask the user before deciding.

## 4. Write a conventional commit

Commitlint config (`tooling/commitlint/commitlint.mjs`) enforces:
- **header-max-length: 100** (subject line ≤100 chars including `type:` prefix — keep PR titles ≤93 so GitHub's ` (#N)` squash suffix still fits)
- body and footer line length: **unenforced**
- types allowed: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`
- type must be lowercase, scope must be lowercase
- no trailing period on subject

Format the message via HEREDOC to preserve newlines:

```bash
git commit -m "$(cat <<'EOF'
type: short subject (≤100 chars total)

Body explaining WHY. Wrap around 72 for readability in `git log`, but
it isn't enforced.

Optional footers:
Refs: #123
BREAKING CHANGE: description.
EOF
)"
```

### Breaking changes

If the change is a breaking API/behavior change:
- Use `feat!:`, `fix!:`, or any `<type>!:`
- Add `BREAKING CHANGE: <description>` footer
- **Confirm with the user before this commit** that they want a major version bump

### Release impact (semantic-release rules)

On push to `main`:
- `feat:` → **minor** bump + npm publish
- `fix:` → **patch** bump + npm publish
- `feat!:` / `BREAKING CHANGE:` → **major** bump + npm publish
- `chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`, `build:`, `perf:` → **no release**

Multiple commits in one push? Semantic-release picks the highest bump from the set.

## 5. Rebase, then push

```bash
git fetch origin
git pull --rebase origin <branch>   # avoid non-FF push
```

Resolve conflicts conservatively. If a conflict is in a generated file (lockfile, CHANGELOG), prefer regeneration over manual edit.

Then:
```bash
git push origin <branch>
```

If pushing to `main` triggers a release, **alert the user before pushing**:

> This will publish `@<scope>/<name>@<predicted-version>` to npm. Continue?

Wait for explicit confirmation. Use AskUserQuestion with three options:
1. Push and publish (default)
2. Append `[skip ci]` to skip release
3. Hold off

## 6. Report what's running

After push, give the user:
- The remote URL + branch
- Predicted next version (if release triggered)
- A note that pre-push already ran the CI gates locally, so failures should be infra-only (npm token, GitHub API, etc.)

## What NOT to do

- Don't `--no-verify` or `--no-gpg-sign` without explicit user permission. If a hook fails, fix the cause.
- Don't amend a pushed commit; create a new commit.
- Don't force-push `main` ever. Force-push other branches only with explicit user permission.
- Don't squash a multi-commit working set into one without asking — separate commits give better semantic-release changelog entries.
