// vitest 4 re-exports vite's UserConfig under the name ViteUserConfig; there is
// no `UserConfig` export on 'vitest/config'. Generated configs import this
// preset now, so a wrong name here surfaces in every consumer's `tsc --noEmit`.
import type { ViteUserConfig } from 'vitest/config'

declare const config: ViteUserConfig
export default config
