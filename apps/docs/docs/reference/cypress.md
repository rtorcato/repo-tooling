---
title: Cypress
description: Cypress end-to-end testing preset — a peer to the Playwright preset.
---

:::caution Unsupported
Cypress is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::


Cypress is offered as a peer to Playwright for end-to-end testing. Pick it in
the setup wizard (`🌲 Cypress (E2E)`) or scaffold it into an existing project
with `repo-tooling fix cypress`.

## Config

The generated `cypress.config.ts` re-exports the shipped preset:

```typescript
// cypress.config.ts
export { default } from '@rtorcato/repo-tooling/cypress'
```

The preset points Cypress at `tests/e2e/`, retries twice in CI, and reads its
base URL from `CYPRESS_BASE_URL` (default `http://localhost:3000`):

```javascript
import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://localhost:3000',
    specPattern: 'tests/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    retries: { runMode: process.env.CI ? 2 : 0, openMode: 0 },
  },
})
```

To override, spread the preset and extend it:

```typescript
// cypress.config.ts
import { defineConfig } from 'cypress'
import preset from '@rtorcato/repo-tooling/cypress'

export default defineConfig({
  ...preset,
  e2e: { ...preset.e2e, baseUrl: 'http://localhost:5173' },
})
```

## Scaffolded layout

`fix cypress` (and the setup wizard) create the config plus starter boilerplate,
never clobbering files that already exist:

```
cypress.config.ts
cypress/support/e2e.ts        # loads custom commands
cypress/support/commands.ts   # add Cypress.Commands.add(...) here
tests/e2e/example.cy.ts       # example spec
```

## Scripts

Choosing Cypress adds:

| Script | Command | Use case |
|---|---|---|
| `test:e2e` | `cypress run` | Headless run (CI) |
| `test:e2e:ui` | `cypress open` | Interactive runner |

`test:e2e` is what the generated `verify` chain and the GitLab CI job call, so
Cypress and Playwright are interchangeable there.

## Import path

| Export | Use case |
|---|---|
| `@rtorcato/repo-tooling/cypress` | Cypress `defineConfig` preset |
