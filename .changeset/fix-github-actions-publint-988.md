---
'@rtorcato/repo-tooling': patch
---

`fix github-actions` keeps the `publint --strict` CI step when `publint` is declared in `package.json`, instead of dropping it on repos without installed packages (#988).
