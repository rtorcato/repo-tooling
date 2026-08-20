---
title: Docusaurus helpers
description: Shared assets for @rtorcato Docusaurus docs sites — sync-changelog and design tokens.
---

The `@rtorcato/*` family runs near-identical Docusaurus docs sites. Rather than a
full config factory (too project-specific to share), repo-tooling ships the pieces
that are genuinely shared, so siblings stop drifting. A full **site generator**
(`fix docs`) is planned separately — this page covers the shared-asset helpers.

## `copy docusaurus-sync-changelog`

Drops the canonical `scripts/sync-changelog.mjs` into your repo:

```bash
npx @rtorcato/repo-tooling copy docusaurus-sync-changelog
```

It copies the root `CHANGELOG.md` into `apps/docs/docs/changelog.md` with
Docusaurus frontmatter, so semantic-release keeps owning one canonical changelog
while the site renders it in-nav.

**Wire it explicitly** into the docs app's scripts — pnpm 8 doesn't run `pre*`
hooks reliably, so chain it in `build`/`start` rather than relying on `prebuild`:

```json
{
  "scripts": {
    "start": "pnpm run sync-changelog && docusaurus start",
    "build": "pnpm run sync-changelog && docusaurus build",
    "sync-changelog": "node ../../scripts/sync-changelog.mjs"
  }
}
```

## `copy docusaurus-theme-tokens`

Drops the shared design-token base into `apps/docs/src/css/_jt-tokens.css`:

```bash
npx @rtorcato/repo-tooling copy docusaurus-theme-tokens
```

It carries the Geist font and the navy-surface `--jt-*` / `--ifm-*` token
families. `@import` it from your `custom.css` and override just the accent:

```css
@import "./_jt-tokens.css";

:root                { --ifm-color-primary: #F38020; --jt-accent: #F38020; }
[data-theme="dark"]  { --ifm-color-primary: #ff9a4d; --jt-accent: #ff9a4d; }
```

The default accent is Docusaurus's neutral green — replace it with your brand.

## Doctor

When a Docusaurus site exists (`apps/docs/docusaurus.config.ts` or
`apps/doc/…`), `doctor` reports a **Docs site** check that verifies:

- `scripts/sync-changelog.mjs` exists and is chained into the docs app's
  `build`/`start` scripts. Skipped when `.changeset/config.json` is present —
  Changesets writes per-package changelogs, so there is no root `CHANGELOG.md`
  to sync.
- The Pages deploy workflow uploads `apps/doc*/build` (not `dist`).

Repos without a docs site don't see the check — it's opt-in.

## TypeDoc plugins

For an API-reference section, `@rtorcato/repo-tooling/docusaurus` also exports
`getTypedocPlugins(modules)` — one `docusaurus-plugin-typedoc` instance per
subpath module. Requires `docusaurus-plugin-typedoc`, `typedoc`, and
`typedoc-plugin-markdown` in the docs app.
