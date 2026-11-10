---
"@rtorcato/repo-tooling": patch
---

`doctor`'s `Release tool` line now says `fix changesets-migrate` moves a semantic-release package to Changesets, instead of naming one owner's libraries. The docs' example package is now `acme-lib` (scoped `@your-scope/acme-lib` in config examples), since `my-lib` is a real npm package and `fix changesets-migrate` would pick up its published version.
