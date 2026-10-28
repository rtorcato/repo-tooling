# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for
versioning and publishing `@rtorcato/repo-tooling`.

When you make a change that should be released, add a changeset:

```bash
pnpm changeset
```

Pick the bump type (patch/minor/major) and write a short summary. The changeset
file is committed with your PR. On merge to `main`, the release workflow opens a
"Version Packages" PR; merging that publishes to npm (with provenance) after one
approval in the `release` environment.
