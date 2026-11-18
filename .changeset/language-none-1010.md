---
"@rtorcato/repo-tooling": minor
---

`language: "none"` for repos with no language stack, such as shell or Docker repos. `setup --preset none` writes `.repo-tooling.json` and nothing else, so the repo can declare `rules.*` (for example `rules.dependabot.onPr: label`). Doctor and `fix` then run the base suite only, and a declared `none` beats any marker file.
