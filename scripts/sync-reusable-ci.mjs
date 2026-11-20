// Writes .github/workflows/js-ci.yml from its generator (#1037), so the reusable
// workflow and the inline pipeline share one set of steps. Run via `pnpm sync:ci`;
// a test fails when the committed file differs from this output.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REUSABLE_JS_CI_WORKFLOW, renderReusableJsCiWorkflow } from '../dist/languages/js/ci.js'

const target = fileURLToPath(new URL(`../${REUSABLE_JS_CI_WORKFLOW}`, import.meta.url))
writeFileSync(target, renderReusableJsCiWorkflow())
console.log(`wrote ${REUSABLE_JS_CI_WORKFLOW}`)
