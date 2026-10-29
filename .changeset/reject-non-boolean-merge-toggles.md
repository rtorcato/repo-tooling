---
'@rtorcato/repo-tooling': patch
---

`doctor` and `fix github-settings` reject a non-boolean `rules.github.autoMerge` or `deleteOnMerge` (`"false"`, `0`) with a config error. They used to read it as on, so a repo that meant `false` got auto-merge turned on and doctor never went clean (#956).
