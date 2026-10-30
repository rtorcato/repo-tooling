---
'@rtorcato/repo-tooling': patch
---

`fix release-environment` now resends the `release` environment's `prevent_self_review` and `wait_timer` on every PUT (#962). GitHub's PUT replaces the environment, so a reviewers or branch-policy write could reset either setting to its default.
