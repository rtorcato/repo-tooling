---
'@rtorcato/repo-tooling': patch
---

The generated Changesets release workflow no longer queues a duplicate publish approval when a push lands while the previous publish awaits approval. A new ungated `gate` job queues in the `release` group and re-checks npm before the `release` environment is requested.
