---
"@rtorcato/repo-tooling": patch
---

`fix lockfile` no longer overwrites a `.repo-tooling.json` that isn't valid JSON, which used to replace its `rules` with the empty scaffold. It now refuses and names the parse error, and `doctor` tells you to fix the JSON by hand instead of promising to keep rules it cannot read.
