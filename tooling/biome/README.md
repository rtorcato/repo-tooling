# Biome Configuration

This package provides a standardized Biome configuration for consistent code formatting and linting across projects.

## Installation

```bash
npm install -D @rtorcato/repo-tooling @biomejs/biome
```

## Usage

### Option 1: CLI Copy Command (Recommended)

```bash
npx @rtorcato/repo-tooling copy biome
```

This will copy the base configuration to your project root as `biome.json`.

### Option 2: Manual Copy

```bash
cp node_modules/@rtorcato/repo-tooling/tooling/biome/preset.json ./biome.json
```

The shipped file is `preset.json`, not `biome.json`, so Biome's config discovery
never picks it up out of `node_modules` as a config of its own (#486). The copy
you land in your repo must still be named `biome.json`.

### Option 3: Reference in package.json

```json
{
  "scripts": {
    "lint": "biome lint .",
    "format": "biome format .",
    "check": "biome check .",
    "check:fix": "biome check --fix ."
  }
}
```

## Configuration Features

- **Formatter**: Tab indentation, 100 character line width, single quotes
- **Linter**: Recommended rules with sensible overrides
- **JavaScript**: ES5 trailing commas, semicolons as needed
- **CSS**: `css.parser.tailwindDirectives` on (with `cssModules` restated, since naming `parser` resets what it omits), so Tailwind v4's `@theme` / `@custom-variant` / `@utility` parse instead of erroring (#589). Harmless without Tailwind — it only widens what the parser accepts.
- **Import organization**: Disabled to prevent conflicts
- **File patterns**: Excludes common build/config directories

## Customization

After copying the configuration, you can customize it for your project:

```json
{
  // Add project-specific rules
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  },
  // Add project-specific file patterns
  "files": {
    "includes": [
      "src/**/*",
      "!src/generated/**"
    ]
  }
}
```

## Extending the preset

Instead of copying, you can extend it and keep only your deltas:

```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "extends": ["@rtorcato/repo-tooling/biome"],
  "files": { "includes": ["!**/.tanstack", "!src/routeTree.gen.ts"] }
}
```

**`files.includes` must be negations only.** The instinct is to mirror the preset
and restate `"**"` first — that fails:

```
biome.json:6:7 lint/suspicious/noBiomeFirstException
  × Biome detected that at least one of your extended packages starts with **.
```

An extending config's negation-only list merges into the preset's `includes`, so
the preset's exclusions (`node_modules`, `dist`, `coverage`, …) still apply —
you only add to them.

## VS Code Integration

Add to your `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  }
}
```

## Copy or extend?

Both work. `copy` gives you a self-contained `biome.json` you own outright; `extends` keeps your file to just the deltas and picks up preset updates on `npm update`. Extending is the smaller file — mind the `files.includes` rule above.