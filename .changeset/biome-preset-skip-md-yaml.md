---
'@rtorcato/repo-tooling': patch
---

The shared Biome preset now keeps `.md`, `.mdx`, `.yaml` and `.yml` out of the formatter. Biome 2.6 started formatting them and turns changeset frontmatter into a heading.
