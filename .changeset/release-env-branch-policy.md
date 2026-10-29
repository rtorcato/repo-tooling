---
'@rtorcato/repo-tooling': patch
---

`doctor` reports drift when the `release` environment has no deployment branch policy, or a custom one that leaves out the default branch, so any branch could request the release approval. `fix release-environment` sets a custom policy on the same PUT and adds the default branch, or the branches in the new `rules.github.releaseBranches` (#960). A protected-branches policy is left alone, and a custom one only gains branches.
