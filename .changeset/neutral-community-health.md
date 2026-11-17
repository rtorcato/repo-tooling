---
'@rtorcato/repo-tooling': patch
---

Community-health files and `.editorconfig` no longer assume JavaScript. On a repo with no language marker, `CONTRIBUTING.md`, the PR template and the bug-report template say "the project's checks" instead of `pnpm` commands. `SECURITY.md` drops the `security-contact@example.com` placeholder and points at private vulnerability reporting only. `.editorconfig` gains a `[*.sh]` section indented with spaces.
