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

What stays here: the reusable `docs-deploy.yml` (GitHub Pages) and `docs-deploy-cloudflare.yml` (Cloudflare Workers) workflows and the `typedoc` fix target, which are
not tied to the scaffold.

## Where the site lives: `config.docs`

Record the site's URL and deploy target in `.repo-tooling.json`:

```json
"record": {
  "config": {
    "docs": { "url": "https://docs.example.com/my-lib/", "deploy": "cloudflare" }
  }
}
```

- `url`: the full site URL. The Docusaurus `url` is its origin and `baseUrl` is its path. It
  defaults to `https://<owner>.github.io/<repo>/`.
- `deploy`: `github`, `cloudflare` or `none`. It defaults to `github`.

The deprecated `docsSite: true` reads as `{ "deploy": "github" }`.

## Deploying to GitHub Pages

```yaml
jobs:
  docs:
    permissions: { contents: read, pages: write, id-token: write }
    uses: rtorcato/repo-tooling/.github/workflows/docs-deploy.yml@main
    with:
      build-filter: '@scope/my-lib-docs'
```

## Deploying to Cloudflare

`docs-deploy-cloudflare.yml` uploads the build to Workers static assets. It uses Workers rather
than Pages because a Pages project attaches to a whole hostname, whereas a Worker route can
serve a site mounted under a path. That lets several repos share one host:
`docs.example.com/lib-a/`, `docs.example.com/lib-b/`.

```yaml
jobs:
  docs:
    permissions: { contents: read }
    uses: rtorcato/repo-tooling/.github/workflows/docs-deploy-cloudflare.yml@main
    with:
      build-filter: '@scope/my-lib-docs'
      worker-name: my-lib-docs            # unique per repo
      base-path: /my-lib/                 # must match the Docusaurus baseUrl
      route: docs.example.com/my-lib/*    # omit to attach a domain in the dashboard
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

One-time setup:

1. Add the domain to Cloudflare. For a `route`, add a proxied DNS record for the hostname,
   for example `docs` → `AAAA 100::`. The address is a placeholder; the route answers the
   request before it reaches an origin.
2. Create an API token from the **Edit Cloudflare Workers** template, with your account and
   the domain's zone as its resources. One token serves every repo on the account.
3. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets on each repo that deploys.
   Personal accounts have no shared secrets, so set them per repo.

The workflow nests the build under `base-path` (Docusaurus writes `build/` flat even with a
non-root `baseUrl`), serves `404.html` for unknown paths, and runs a pinned wrangler, so the
caller needs no `wrangler.toml`.
