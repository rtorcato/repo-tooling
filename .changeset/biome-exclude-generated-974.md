---
'@rtorcato/repo-tooling': patch
---

The shared Biome preset now leaves `pnpm-lock.yaml` and `CHANGELOG.md` out of `files.includes`, so `biome check --write` no longer reflows the lockfile or fails on the Changesets-generated changelog.
