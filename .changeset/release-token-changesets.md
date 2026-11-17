---
'@rtorcato/repo-tooling': patch
---

The Release token check now covers Changesets workflows: Version Packages PRs opened with a bare `GITHUB_TOKEN` run no CI, so doctor flags them as drift. The generated Changesets release workflow also emits a `::warning::` when `RELEASE_TOKEN` is unset.
