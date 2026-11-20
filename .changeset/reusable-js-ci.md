---
'@rtorcato/repo-tooling': minor
---

Add a reusable JS CI workflow (`.github/workflows/js-ci.yml`) and a thin-caller render in the CI generator (#1037). The caller keeps `on:`, `concurrency:`, the skip check and the final `ci` gate; `release.yml` stays copied.
