---
"@rtorcato/repo-tooling": minor
---

`.repo-tooling.json` takes an optional `extends`: a relative path, an npm package path or `github:<owner>/<repo>/<path>[#<ref>]` pointing at a shared base of `rules`. The base comes first and the repo's own `rules` are deep-merged on top, so the repo always wins. `doctor` adds an `Extends` row and reports an unreadable base as drift; `fix` and `doctor --snapshot` never write into the base, and `--snapshot` lists the rules still inherited from it. Without `extends`, nothing changes.
