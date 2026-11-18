---
"@rtorcato/repo-tooling": patch
---

The release gate now covers GitHub Releases and tag pushes, not only registry publishes. A job that runs `gh release create`, a release action, or pushes a tag must run in the `release` environment, in every language and in repos with no language marker. The Swift release template runs in `environment: release`, `fix swift-release` regenerates an ungated one, and `fix release-environment` lets tag-triggered runs into the environment.
