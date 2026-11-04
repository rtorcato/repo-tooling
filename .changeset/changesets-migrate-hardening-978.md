---
"@rtorcato/repo-tooling": patch
---

`fix changesets-migrate` is hardened. It validates the package name and passes `--` to `npm view`, and rejects a non-semver version from npm before writing it. It also drops `npx semantic-release` and `pnpm exec semantic-release` release scripts, not only the bare one, keeps a tab-indented `package.json`, and points to `fix release-environment` when the old release workflow had no `environment:`.
