---
title: Brand assets — sizes and formats
description: Every image a polished repo needs — banner, social card, favicons, PWA icons — with the exact size, format and wiring each consumer expects.
---

# Brand assets — sizes and formats

A repo's images are consumed by six different things that each want something
different: the README on GitHub, the README on npm, link unfurls in Slack and X,
the GitHub repo card, the docs site favicon, and mobile home-screen icons. Get
one wrong and it fails in a way nobody reports — a grey box in Slack, a blurry
tab icon, a banner that doesn't load on npmjs.com.

This is the full set, what each consumer actually requires, and the traps.

## The minimum set

Nine files. Everything below is either one of these or a note about wiring them.

| File | Size | Format | Lives in |
|---|---|---|---|
| `banner.png` | 1280×320 | PNG | repo root |
| `banner-mobile.png` | 1280×786 | PNG | repo root |
| `social-card.png` | 1280×640 | PNG | `apps/docs/static/img/` |
| `favicon.svg` | 32×32 viewBox | SVG | `apps/docs/static/img/` |
| `favicon.ico` | 16+32+48 | ICO (multi-size) | `apps/docs/static/img/` |
| `favicon-180.png` | 180×180 | PNG | `apps/docs/static/img/` |
| `favicon-192.png` | 192×192 | PNG | `apps/docs/static/img/` |
| `favicon-512.png` | 512×512 | PNG | `apps/docs/static/img/` |
| `favicon-512-maskable.png` | 512×512 | PNG | `apps/docs/static/img/` |

If you ship only three, ship `banner.png`, `social-card.png` and `favicon.svg` —
they cover the README, every link unfurl, and every modern browser tab.

## Share images

### Open Graph — the one that matters most

`og:image` drives the preview in Slack, Discord, LinkedIn, iMessage, WhatsApp
and X. One image serves all of them.

- **1200×630** is the canonical Open Graph size (1.91:1).
- **1280×640** (2:1) is what this family uses, because it *also* satisfies
  GitHub's repo social preview. The 3% aspect difference is invisible in
  practice, and one file beats two.
- Keep everything important inside a **safe area inset ~8% from every edge.**
  Different platforms crop differently and several round the corners.
- Use **PNG**. JPEG artefacts show badly on flat brand colours and text.
- Stay under **1 MB**. Some scrapers give up on large files, and GitHub's
  social preview upload rejects over 1 MB outright.
- **Absolute URLs only.** `og:image` must be a fully qualified `https://` URL —
  relative paths are silently ignored by every scraper.

X reads `og:image` if no `twitter:image` is present, so a separate Twitter card
image is redundant. Set `twitter:card` to `summary_large_image` and let the OG
image do the work.

### GitHub repo social preview

This is **not** driven by any file in the repo. It is uploaded by hand at
**Settings → General → Social preview**, and there is no API for it.

- Recommended **1280×640**, under **1 MB**.
- Reuse `social-card.png` verbatim.
- This is the single most-missed asset: `themeConfig.image` covers the *docs
  site*, but a link to the *repo* renders GitHub's default grey box until you
  upload this.

## README banners

The README is rendered in at least three places with different rules.

- **GitHub** renders relative paths fine.
- **npmjs.com** does **not** — relative image paths break, so a package README
  needs absolute `https://raw.githubusercontent.com/...` URLs for its images.
  This is the most common cause of a broken banner on a published package.
- **Docs sites** may rewrite paths depending on the loader.

Two banners, swapped by viewport:

```html
<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="./banner-mobile.png">
    <img src="./banner.png" alt="<project> — <tagline>" width="100%">
  </picture>
</p>
```

`banner.png` at **1280×320** (4:1) suits a wide README column; the 8:5
`banner-mobile.png` stacks the same content vertically so it stays legible on a
phone.

Alt text is not optional — it is what screen readers and every text-only
renderer show, and GitHub displays it while the image loads.

### Light and dark

If a banner needs to differ between themes, `<picture>` handles that too, and it
composes with the viewport query:

```html
<source media="(prefers-color-scheme: dark)" srcset="./banner-dark.png">
```

A banner designed on a dark background with transparent padding usually works in
both, which is why this family ships one banner rather than two.

## Favicons and app icons

The modern set is smaller than the legacy advice suggests. Four files cover
everything current:

| File | Purpose |
|---|---|
| `favicon.svg` | Every modern browser tab. Scales to any density. |
| `favicon.ico` | Legacy fallback, and what some crawlers still probe at `/favicon.ico`. |
| `favicon-180.png` | `apple-touch-icon` — iOS home screen. |
| `favicon-512.png` | PWA manifest / Android home screen. |

Details that matter:

- **`favicon.svg` should use a 32×32 viewBox** and stay geometrically simple.
  It renders at 16px in a browser tab; fine strokes and small text disappear.
  Author it by hand — do not trace or generate it, or it will be blurry at the
  size that counts.
- **`favicon.ico` is a container**, not a single image. Generate it with 16, 32
  and 48px frames inside one file. A 16-only `.ico` looks rough on Windows.
- **`apple-touch-icon` is 180×180**, and iOS **ignores transparency** — it
  composites onto black. Give it an opaque background or it will look wrong on
  a home screen.
- **Maskable icons need ~20% padding.** Android crops icons to whatever shape
  the launcher uses (circle, squircle, rounded square). An icon that fills its
  canvas edge to edge gets its corners cut off. Ship a separate
  `favicon-512-maskable.png` with the mark inset, and declare
  `"purpose": "maskable"` for it in the web app manifest.

## Wiring it up (Docusaurus)

```ts
favicon: 'img/favicon.svg',

headTags: [
  {
    // Docusaurus emits only the `favicon` link on its own.
    tagName: 'link',
    attributes: {
      rel: 'apple-touch-icon',
      sizes: '180x180',
      // headTags are raw — the baseUrl prefix is NOT added for you.
      href: '/<repo>/img/favicon-180.png',
    },
  },
],

themeConfig: {
  // NOT top-level: a top-level `image` fails config validation with
  // "these field(s) are not recognized". Docusaurus resolves this against
  // url + baseUrl, which is what scrapers need.
  image: 'img/social-card.png',
  navbar: {
    logo: { alt: '<project>', src: 'img/favicon.svg' },
  },
},
```

Two Docusaurus-specific traps, both of which cost real time to diagnose:

1. **`image` belongs in `themeConfig`**, not at the top level of the config.
   Putting it top-level is a hard config-validation failure.
2. **`headTags` hrefs are emitted verbatim.** Unlike `favicon`, they get no
   `baseUrl` prefix, so a project served at `/<repo>/` needs that written into
   the href by hand. A missing prefix yields a 404 that only shows up on the
   deployed site, never locally at `/`.

## Verifying

Do not trust the source — check what scrapers actually see:

- **Facebook Sharing Debugger** and **X Card Validator** both re-fetch and show
  the resolved image. They also expose caching: after changing an OG image you
  usually need to force a re-scrape, or the old one persists for days.
- Paste the link into **Slack** — it unfurls immediately and honours OG.
- For favicons, hard-reload with the devtools network panel open. Browsers cache
  favicons aggressively and will keep showing a stale one long after you replace
  it.

## Common failure modes

| Symptom | Cause |
|---|---|
| Grey box when the repo link is pasted | Social preview never uploaded in repo Settings |
| Banner broken on npmjs.com but fine on GitHub | Relative image path in the README |
| OG image ignored by every scraper | Relative `og:image` URL instead of absolute |
| Docs build fails, "field(s) are not recognized" | `image` at config top level instead of in `themeConfig` |
| `apple-touch-icon` 404s only in production | `headTags` href missing the `baseUrl` prefix |
| Icon corners cut off on Android | Maskable icon without ~20% safe padding |
| Blurry tab icon | Favicon traced from a raster, or an SVG too detailed for 16px |
| Home-screen icon has a black box behind it | Transparent PNG used for `apple-touch-icon` |
