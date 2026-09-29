---
title: Docs site that stays in sync
description: The Docusaurus docs-site scaffold moved to @rtorcato/shared-docs.
---

# Docs site that stays in sync

The Docusaurus docs-site scaffold (`fix docs-site`), the `@rtorcato/repo-tooling/docusaurus`
export and the `copy docusaurus-*` presets moved to
[`@rtorcato/shared-docs`](https://github.com/rtorcato/shared-docs) (#718), which owns the
shared theme, navbar and footer. `repo-tooling fix docs-site` now exits 1 with a pointer there.

```bash
npx @rtorcato/shared-docs init     # scaffold apps/docs
npx @rtorcato/shared-docs doctor   # report drift from the scaffold
```

What stays here: the reusable `docs-deploy.yml` workflow and the `typedoc` fix target, which are
not tied to the scaffold.
