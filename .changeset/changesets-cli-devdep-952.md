---
"@rtorcato/repo-tooling": patch
---

`setup` with Changesets now adds `@changesets/cli` to devDependencies, and `doctor` reports drift when `.changeset/config.json` exists without it (#952).
