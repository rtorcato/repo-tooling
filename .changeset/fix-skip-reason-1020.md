---
'@rtorcato/repo-tooling': patch
---

`fix` now says why it skipped a fixer: every `skipped` action in `--json` carries a `reason`, and the text output prints it instead of a bare "skipped" (#1020).
