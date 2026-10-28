---
"@rtorcato/repo-tooling": patch
---

`fix github-settings` now coerces `rules.github.autoMerge`, `deleteOnMerge` and `actionsCanCreatePullRequests` to booleans before they reach `gh api -F`, so a non-boolean lockfile value can no longer make `gh` read a file (#949).
