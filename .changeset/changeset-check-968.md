---
"@rtorcato/repo-tooling": minor
---

The scaffolded `ci.yml` for a Changesets repo gets a `changeset` job: a PR that changes `src/` (or `packages/<name>/src/`) with no new `.changeset/*.md` fails. It skips the Version Packages PR and PRs titled `docs`, `chore`, `ci`, `test`, `build`, `style` or `refactor`; `pnpm changeset --empty` covers anything else that ships nothing. `doctor` reports `GitHub Actions` drift when a Changesets repo's `ci.yml` lacks the job, and `fix github-actions` scaffolds it. semantic-release repos get no new job.
