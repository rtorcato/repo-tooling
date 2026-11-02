---
"@rtorcato/repo-tooling": minor
---

`doctor` now reports a public package still on semantic-release as `Release tool` (`optional-missing`, so it never fails the exit code), and the new `fix changesets-migrate` moves it to Changesets. It deletes the semantic-release config, `release` field and deps, adds `.changeset/config.json` and `@changesets/cli`, sets `package.json` `version` to the latest on npm (left alone when the package is not published yet), lists the root in `pnpm-workspace.yaml`, and rewrites `release.yml` as the two-job Version Packages flow, keeping its `environment:` and dropping the `milestone: closed` trigger. It records `semanticRelease: false, changesets: true` in `.repo-tooling.json`. It runs only when named, never from a bare `fix`.
