---
title: Biome
description: Biome formatter and linter configuration.
---

**Use Biome.** It replaces both ESLint and Prettier in a single fast tool, and is what this repo dogfoods.

| Scenario | Recommendation |
|---|---|
| New project | Biome |
| Existing ESLint config | Keep ESLint, migrate gradually |
| Need a specific ESLint plugin | ESLint (or Biome + ESLint for that plugin only) |

## Usage

Copy the base config into your project:

```bash
npx @rtorcato/repo-tooling copy biome
```

This creates a `biome.json` with:
- Tab indentation, 100 character line width
- Single quotes, ES5 trailing commas
- Recommended linting rules with sensible overrides
- Smart file patterns excluding build directories

## Extending the preset

Or extend it, and keep your `biome.json` to just the deltas:

```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "extends": ["@rtorcato/repo-tooling/biome"],
  "files": { "includes": ["!**/.tanstack", "!src/routeTree.gen.ts"] }
}
```

`files.includes` in an extending config must be **negations only**. Mirroring the
preset and restating `"**"` first is the natural instinct, and it fails:

```
biome.json:6:7 lint/suspicious/noBiomeFirstException
  × Biome detected that at least one of your extended packages starts with **.
```

The negation-only list merges into the preset's `includes`, so its exclusions
(`node_modules`, `dist`, `coverage`, …) still apply — yours are added to them.

## Customisation

After copying, edit `biome.json` directly:

```json
{
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
```

## Import in scripts

```javascript
// biome.json path for lint-staged or other scripts
import config from '@rtorcato/repo-tooling/biome'
```
