---
"@rtorcato/repo-tooling": patch
---

`fix changesets-migrate` no longer prints terminal control characters from an untrusted `package.json` `name`, npm's `version` output or npm's error line in its abort messages. They become `?`, and each value is truncated.
