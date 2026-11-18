---
"@rtorcato/repo-tooling": minor
---

One release procedure for repos with no npm package. `setup --preset swift-library` now scaffolds Changesets for versioning only: a private root `package.json`, a `.changeset/config.json` that versions and tags it, and a Version Packages workflow. Merging the Version Packages PR creates the `vX.Y.Z` tag, and the tag-triggered release job runs in the `release` environment. `doctor` reports a tag-triggered Swift release with no such versioning as drift, and `fix swift-release` converts it, seeding the version from the latest semver tag.
