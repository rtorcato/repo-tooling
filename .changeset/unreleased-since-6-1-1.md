---
'@rtorcato/repo-tooling': minor
---

Merged after 6.1.1 under semantic-release and not shipped yet:

- `changesets`: the release workflow splits into an ungated `version` job and a gated `publish` job, so shipping is one Version Packages PR merge plus one approval (#941).
- `setup`: an opt-in Vite+ (vite-plus) preset (#900), offered in the interactive wizard (#926).
- `doctor`: `--snapshot` writes the live GitHub settings into `rules.github` (#931), and private vulnerability reporting is checked and fixed (#905).
- `deploy`: production deploys are gated on a `production` environment (#933), with the Vercel CLI pinned and the production env limited to `main` (#935).
- `github-settings`: Changesets repos expect "Actions can create PRs" on (#948), and only check names a job really reports count (#909).
- `tsup`: bundle when a consumer narrows `entry` (#943), and accept tsup 9 in the peer range (#937).
- `doctor`: read monorepo Changesets, lint-staged and release config from the workspace root (#932).
- `typescript`: drop `${configDir}` paths from the `next` preset (#924).
- Security: refuse `setup`/`fix` writes through symlinks that leave the repo (#910), and guard `chmod` the same way (#912).
- `setup`: merge vite-plus overrides into an existing `pnpm-workspace.yaml` (#907).
- `dependabot`: keep a SHA pin behind the preset and report it as drift (#906).
- `ci`: pass `head_commit.message` to check-skip via `env` (#898).
