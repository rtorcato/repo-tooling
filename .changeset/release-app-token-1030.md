---
"@rtorcato/repo-tooling": minor
---

The generated Changesets `release.yml` opens the Version Packages PR with a GitHub App token, so its CI runs without "Approve and run workflows". It mints the token with `actions/create-github-app-token` from the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets, falls back to `RELEASE_TOKEN`, then to `GITHUB_TOKEN` with a `No release credentials` warning. `doctor`'s Repository secrets check accepts the App secrets in place of `RELEASE_TOKEN` and flags a Changesets repo with neither. The Release secrets check no longer flags a secret an ungated job in the same workflow also needs. The releasing docs describe the one human gate: merge the Version Packages PR, then approve the `release` deployment.
