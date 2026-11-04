---
"@rtorcato/repo-tooling": patch
---

The workflows `setup` and `fix` generate now pin every GitHub Action to a commit SHA with a `# vX.Y.Z` comment, instead of a mutable tag such as `actions/checkout@v7`. The shipped workflow templates and `action.yml` are pinned the same way. `doctor` reads the major from either form, so an older pin that disagrees with the preset is still reported. A workflow that already pins a SHA keeps it.
