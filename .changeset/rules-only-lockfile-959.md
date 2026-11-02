---
"@rtorcato/repo-tooling": patch
---

`doctor` no longer silently ignores a `.repo-tooling.json` that holds only `rules` (or isn't valid JSON): it reports `lockfile` drift saying the rules are ignored, and `fix lockfile` now writes the record around the existing `rules` instead of replacing them with the empty scaffold. A non-boolean `rules.github` merge toggle now reads `config error: …` in the `Merge settings` row. The `.repo-tooling.json` reference says `rules` must sit in a full lockfile.
