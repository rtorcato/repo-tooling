## [3.9.1](https://github.com/rtorcato/repo-tooling/compare/v3.9.0...v3.9.1) (2026-08-12)


### Bug Fixes

* **commitlint:** stop enforcing body/footer line length ([#402](https://github.com/rtorcato/repo-tooling/issues/402)) ([a272bcd](https://github.com/rtorcato/repo-tooling/commit/a272bcdbdf7dc0a271e3ec80ab5183690d460e12))

# [3.9.0](https://github.com/rtorcato/repo-tooling/compare/v3.8.7...v3.9.0) (2026-08-11)


### Features

* **ai:** scaffold .claude/settings.json worktree symlinks ([#399](https://github.com/rtorcato/repo-tooling/issues/399)) ([62459a8](https://github.com/rtorcato/repo-tooling/commit/62459a8874b4958a473504b32deb66e746ac5d38)), closes [#396](https://github.com/rtorcato/repo-tooling/issues/396) [rtorcato/js-common#171](https://github.com/rtorcato/js-common/issues/171)
* **brand:** scaffold brand/ sources and audit them in doctor ([#400](https://github.com/rtorcato/repo-tooling/issues/400)) ([461b0b0](https://github.com/rtorcato/repo-tooling/commit/461b0b045d0f320c2d957ddfc90a9cd5ad51517c)), closes [#395](https://github.com/rtorcato/repo-tooling/issues/395)
* **doctor:** audit milestone hygiene, close completed milestones ([#398](https://github.com/rtorcato/repo-tooling/issues/398)) ([e4b34c2](https://github.com/rtorcato/repo-tooling/commit/e4b34c2062a6310c3f17acd36f5cb70ae174bd2f)), closes [#397](https://github.com/rtorcato/repo-tooling/issues/397)

## [3.8.7](https://github.com/rtorcato/repo-tooling/compare/v3.8.6...v3.8.7) (2026-08-11)


### Bug Fixes

* **doctor:** flag agent docs that name the dead js-tooling bin ([#394](https://github.com/rtorcato/repo-tooling/issues/394)) ([7e6f957](https://github.com/rtorcato/repo-tooling/commit/7e6f957642a7ec40e25d588acb23bbd74a2c18f1)), closes [#393](https://github.com/rtorcato/repo-tooling/issues/393)

## [3.8.6](https://github.com/rtorcato/repo-tooling/compare/v3.8.5...v3.8.6) (2026-08-10)


### Bug Fixes

* **doctor:** accept an inlined TypeScript preset ([#388](https://github.com/rtorcato/repo-tooling/issues/388)) ([c7300f7](https://github.com/rtorcato/repo-tooling/commit/c7300f77fee81e7badbb245620de9abf9ded4220)), closes [#379](https://github.com/rtorcato/repo-tooling/issues/379) [#379](https://github.com/rtorcato/repo-tooling/issues/379) [#383](https://github.com/rtorcato/repo-tooling/issues/383) [#385](https://github.com/rtorcato/repo-tooling/issues/385)
* **gitlab-ci:** only emit jobs whose scripts the repo has ([#389](https://github.com/rtorcato/repo-tooling/issues/389)) ([40a9e6d](https://github.com/rtorcato/repo-tooling/commit/40a9e6d2dbadc951c77bffa55dc14302daeedcc7)), closes [#364](https://github.com/rtorcato/repo-tooling/issues/364) [#386](https://github.com/rtorcato/repo-tooling/issues/386)
* **vitest:** emit a config that imports the shipped preset ([#390](https://github.com/rtorcato/repo-tooling/issues/390)) ([a7f3ef9](https://github.com/rtorcato/repo-tooling/commit/a7f3ef982199999cb249b0a330a60dcfcc4b913f)), closes [#387](https://github.com/rtorcato/repo-tooling/issues/387)

## [3.8.5](https://github.com/rtorcato/repo-tooling/compare/v3.8.4...v3.8.5) (2026-08-10)


### Bug Fixes

* **js:** give the size-limit budget a script and a CLI to run it ([#384](https://github.com/rtorcato/repo-tooling/issues/384)) ([b6293bd](https://github.com/rtorcato/repo-tooling/commit/b6293bd8e9ee19f12ff4a37cb7b92ce5a1855857)), closes [#371](https://github.com/rtorcato/repo-tooling/issues/371) [#377](https://github.com/rtorcato/repo-tooling/issues/377) [#382](https://github.com/rtorcato/repo-tooling/issues/382)

## [3.8.4](https://github.com/rtorcato/repo-tooling/compare/v3.8.3...v3.8.4) (2026-08-10)


### Bug Fixes

* **cli:** route fix tsconfig through generateTSConfig ([#383](https://github.com/rtorcato/repo-tooling/issues/383)) ([58c5c0a](https://github.com/rtorcato/repo-tooling/commit/58c5c0ab74b1f8ed4104645efa700ef7064bc7d5)), closes [#366](https://github.com/rtorcato/repo-tooling/issues/366) [#378](https://github.com/rtorcato/repo-tooling/issues/378) [#366](https://github.com/rtorcato/repo-tooling/issues/366) [#381](https://github.com/rtorcato/repo-tooling/issues/381)

## [3.8.3](https://github.com/rtorcato/repo-tooling/compare/v3.8.2...v3.8.3) (2026-08-10)


### Bug Fixes

* **doctor:** accept an inlined biome preset, not just an extends pointer ([#379](https://github.com/rtorcato/repo-tooling/issues/379)) ([2c75d80](https://github.com/rtorcato/repo-tooling/commit/2c75d8087ed1b012968ca1d561db7f2dbc063b6a)), closes [#378](https://github.com/rtorcato/repo-tooling/issues/378)

## [3.8.2](https://github.com/rtorcato/repo-tooling/compare/v3.8.1...v3.8.2) (2026-08-10)


### Bug Fixes

* **js:** add the scripts that run knip, vitest and tsc ([#380](https://github.com/rtorcato/repo-tooling/issues/380)) ([3b8e978](https://github.com/rtorcato/repo-tooling/commit/3b8e9786b3d206562cc6c9e675bcbdb96a1218da)), closes [#364](https://github.com/rtorcato/repo-tooling/issues/364) [#374](https://github.com/rtorcato/repo-tooling/issues/374) [#377](https://github.com/rtorcato/repo-tooling/issues/377)

## [3.8.1](https://github.com/rtorcato/repo-tooling/compare/v3.8.0...v3.8.1) (2026-08-10)


### Bug Fixes

* **doctor:** flag transitive pnpm build approvals ([#375](https://github.com/rtorcato/repo-tooling/issues/375)) ([da20a6a](https://github.com/rtorcato/repo-tooling/commit/da20a6ac20c1f4bc60ed9d2d75e8859700bd0c0a)), closes [#373](https://github.com/rtorcato/repo-tooling/issues/373)

# [3.8.0](https://github.com/rtorcato/repo-tooling/compare/v3.7.4...v3.8.0) (2026-08-10)


### Bug Fixes

* **js:** add the scripts that run eslint and prettier ([#374](https://github.com/rtorcato/repo-tooling/issues/374)) ([c6fef2f](https://github.com/rtorcato/repo-tooling/commit/c6fef2f85ed5dd2a8b8587a6d1c03b25faac399a)), closes [#364](https://github.com/rtorcato/repo-tooling/issues/364) [#371](https://github.com/rtorcato/repo-tooling/issues/371)


### Features

* **doctor:** report and fix a missing packageManager pin ([#376](https://github.com/rtorcato/repo-tooling/issues/376)) ([345a3df](https://github.com/rtorcato/repo-tooling/commit/345a3df125f1736da9fa12f4b2d2aabf652b6ce1)), closes [#372](https://github.com/rtorcato/repo-tooling/issues/372)

## [3.7.4](https://github.com/rtorcato/repo-tooling/compare/v3.7.3...v3.7.4) (2026-08-10)


### Bug Fixes

* **biome:** honour .gitignore and track the installed schema version ([#367](https://github.com/rtorcato/repo-tooling/issues/367)) ([04135a6](https://github.com/rtorcato/repo-tooling/commit/04135a68b3a139a705f24910eec00ada9ea3d0e6)), closes [#365](https://github.com/rtorcato/repo-tooling/issues/365) [#366](https://github.com/rtorcato/repo-tooling/issues/366)

## [3.7.3](https://github.com/rtorcato/repo-tooling/compare/v3.7.2...v3.7.3) (2026-08-10)


### Bug Fixes

* **biome:** scaffold one biome.json from one code path ([#366](https://github.com/rtorcato/repo-tooling/issues/366)) ([ca19aea](https://github.com/rtorcato/repo-tooling/commit/ca19aea2e93a11311e5789d4e7bfac4ba47848ab)), closes [#365](https://github.com/rtorcato/repo-tooling/issues/365) [#363](https://github.com/rtorcato/repo-tooling/issues/363) [#363](https://github.com/rtorcato/repo-tooling/issues/363)

## [3.7.2](https://github.com/rtorcato/repo-tooling/compare/v3.7.1...v3.7.2) (2026-08-10)


### Bug Fixes

* **ci:** make the generated workflow pass on the repo that generated it ([#370](https://github.com/rtorcato/repo-tooling/issues/370)) ([7f86128](https://github.com/rtorcato/repo-tooling/commit/7f86128388200ca2c8acaea250d8cddca517d7fb))
* **husky:** give commit-msg to the target that installs commitlint ([#368](https://github.com/rtorcato/repo-tooling/issues/368)) ([6473ce7](https://github.com/rtorcato/repo-tooling/commit/6473ce7e6acaa5ade5d8d5929f93d1f159bd644e))

## [3.7.1](https://github.com/rtorcato/repo-tooling/compare/v3.7.0...v3.7.1) (2026-08-09)


### Bug Fixes

* **cli:** finish routing fixer advisories off stdout ([#361](https://github.com/rtorcato/repo-tooling/issues/361)) ([457e28f](https://github.com/rtorcato/repo-tooling/commit/457e28f60d9a51152c4c7b581a8b661d67d65415)), closes [#357](https://github.com/rtorcato/repo-tooling/issues/357) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#290](https://github.com/rtorcato/repo-tooling/issues/290) [#290](https://github.com/rtorcato/repo-tooling/issues/290) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#358](https://github.com/rtorcato/repo-tooling/issues/358)

# [3.7.0](https://github.com/rtorcato/repo-tooling/compare/v3.6.0...v3.7.0) (2026-08-09)


### Bug Fixes

* **python:** send the git-hooks advisory to stderr, and guard the rule ([#360](https://github.com/rtorcato/repo-tooling/issues/360)) ([570a3cb](https://github.com/rtorcato/repo-tooling/commit/570a3cb020187670822978a7d87bb0909d4a3323)), closes [#356](https://github.com/rtorcato/repo-tooling/issues/356) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#356](https://github.com/rtorcato/repo-tooling/issues/356) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#358](https://github.com/rtorcato/repo-tooling/issues/358) [#359](https://github.com/rtorcato/repo-tooling/issues/359)


### Features

* **perl:** add src/languages/perl module ([#359](https://github.com/rtorcato/repo-tooling/issues/359)) ([665c76f](https://github.com/rtorcato/repo-tooling/commit/665c76f079e4f2fc3978157173e5cb74b97d849d)), closes [#289](https://github.com/rtorcato/repo-tooling/issues/289) [#356](https://github.com/rtorcato/repo-tooling/issues/356) [#356](https://github.com/rtorcato/repo-tooling/issues/356) [#286](https://github.com/rtorcato/repo-tooling/issues/286) [#290](https://github.com/rtorcato/repo-tooling/issues/290)

# [3.6.0](https://github.com/rtorcato/repo-tooling/compare/v3.5.0...v3.6.0) (2026-08-09)


### Bug Fixes

* **cli:** send fixer advisories to stderr so --json stays parseable ([#358](https://github.com/rtorcato/repo-tooling/issues/358)) ([99789c1](https://github.com/rtorcato/repo-tooling/commit/99789c17ba2247563b5f44edf016634abe747376)), closes [#356](https://github.com/rtorcato/repo-tooling/issues/356)


### Features

* **python:** add src/languages/python module ([#356](https://github.com/rtorcato/repo-tooling/issues/356)) ([294a09b](https://github.com/rtorcato/repo-tooling/commit/294a09bc5576f563e9ae855e814d1b7f9b2ffab2)), closes [#286](https://github.com/rtorcato/repo-tooling/issues/286) [#288](https://github.com/rtorcato/repo-tooling/issues/288)

# [3.5.0](https://github.com/rtorcato/repo-tooling/compare/v3.4.0...v3.5.0) (2026-08-09)


### Features

* **doctor:** report the languages a monorepo audit skips ([#355](https://github.com/rtorcato/repo-tooling/issues/355)) ([aa5b4b9](https://github.com/rtorcato/repo-tooling/commit/aa5b4b941196f574519c7e12a21935b63d6ee7c9)), closes [#317](https://github.com/rtorcato/repo-tooling/issues/317) [#317](https://github.com/rtorcato/repo-tooling/issues/317) [#317](https://github.com/rtorcato/repo-tooling/issues/317)

# [3.4.0](https://github.com/rtorcato/repo-tooling/compare/v3.3.0...v3.4.0) (2026-08-08)


### Features

* **swift:** add DocC, swift-format and test-configuration checks ([#353](https://github.com/rtorcato/repo-tooling/issues/353)) ([57b29f7](https://github.com/rtorcato/repo-tooling/commit/57b29f741e2a5112ad0e8621aed549417870a6c4)), closes [#311](https://github.com/rtorcato/repo-tooling/issues/311) [#351](https://github.com/rtorcato/repo-tooling/issues/351) [#310](https://github.com/rtorcato/repo-tooling/issues/310)

# [3.3.0](https://github.com/rtorcato/repo-tooling/compare/v3.2.5...v3.3.0) (2026-08-08)


### Bug Fixes

* **ci:** stop silently overwriting a consumer's ci.yml, and let doctor see the drift ([#352](https://github.com/rtorcato/repo-tooling/issues/352)) ([e89e879](https://github.com/rtorcato/repo-tooling/commit/e89e87968ec23a56b5a48951d9d7cc353818f0da)), closes [#340](https://github.com/rtorcato/repo-tooling/issues/340) [#340](https://github.com/rtorcato/repo-tooling/issues/340) [#342](https://github.com/rtorcato/repo-tooling/issues/342) [#348](https://github.com/rtorcato/repo-tooling/issues/348) [#309](https://github.com/rtorcato/repo-tooling/issues/309) [#340](https://github.com/rtorcato/repo-tooling/issues/340) [#349](https://github.com/rtorcato/repo-tooling/issues/349) [#340](https://github.com/rtorcato/repo-tooling/issues/340)


### Features

* **ci:** ship doctor as a composite GitHub Action ([#350](https://github.com/rtorcato/repo-tooling/issues/350)) ([7164db4](https://github.com/rtorcato/repo-tooling/commit/7164db439df0395b13b208286f4ab157e57a37e0)), closes [#315](https://github.com/rtorcato/repo-tooling/issues/315) [#342](https://github.com/rtorcato/repo-tooling/issues/342) [#316](https://github.com/rtorcato/repo-tooling/issues/316)
* **swift:** check and scaffold tag-based SwiftPM releases ([#351](https://github.com/rtorcato/repo-tooling/issues/351)) ([5f2f70e](https://github.com/rtorcato/repo-tooling/commit/5f2f70ea028455d09eaad2dfe7faebfc1dc312a4)), closes [#310](https://github.com/rtorcato/repo-tooling/issues/310)

## [3.2.5](https://github.com/rtorcato/repo-tooling/compare/v3.2.4...v3.2.5) (2026-08-08)


### Bug Fixes

* **ci:** widen the action-pin guard past the actions/ org ([#348](https://github.com/rtorcato/repo-tooling/issues/348)) ([a2adbbe](https://github.com/rtorcato/repo-tooling/commit/a2adbbe64161cd91d8d12ea5a4c2ca47be69c5a2)), closes [#316](https://github.com/rtorcato/repo-tooling/issues/316)
* **pack:** ship dist/base so the published CLI can start ([#346](https://github.com/rtorcato/repo-tooling/issues/346)) ([10d4c72](https://github.com/rtorcato/repo-tooling/commit/10d4c723aa6a1cc13f016ce867a6ed4032cbe0f8)), closes [#345](https://github.com/rtorcato/repo-tooling/issues/345) [rtorcato/shared-docs#13](https://github.com/rtorcato/shared-docs/issues/13)

## [3.2.4](https://github.com/rtorcato/repo-tooling/compare/v3.2.3...v3.2.4) (2026-08-08)


### Bug Fixes

* **presets:** make every JS preset survive a real install and verify ([#343](https://github.com/rtorcato/repo-tooling/issues/343)) ([f2af0af](https://github.com/rtorcato/repo-tooling/commit/f2af0af70b85b4e52a525d97f353edd562b16bb0)), closes [#313](https://github.com/rtorcato/repo-tooling/issues/313)

## [3.2.3](https://github.com/rtorcato/repo-tooling/compare/v3.2.2...v3.2.3) (2026-08-08)


### Bug Fixes

* **ci:** bump emitted action pins to the majors this repo runs ([#342](https://github.com/rtorcato/repo-tooling/issues/342)) ([ab3ade3](https://github.com/rtorcato/repo-tooling/commit/ab3ade34bae1c64ed4826e265c2512b45a514fb5)), closes [#340](https://github.com/rtorcato/repo-tooling/issues/340)
* **commitlint:** ignore bot commits so dependabot PRs stop failing ([#341](https://github.com/rtorcato/repo-tooling/issues/341)) ([75ccba8](https://github.com/rtorcato/repo-tooling/commit/75ccba850b5c2eafd58fa7beffaa12bc41697155)), closes [#339](https://github.com/rtorcato/repo-tooling/issues/339)

## [3.2.2](https://github.com/rtorcato/repo-tooling/compare/v3.2.1...v3.2.2) (2026-08-07)


### Bug Fixes

* **deps:** narrow the biome peer range to ^2.5.0 ([#338](https://github.com/rtorcato/repo-tooling/issues/338)) ([81d5582](https://github.com/rtorcato/repo-tooling/commit/81d5582e824683d97c4776f0c74143bd5001f34a)), closes [#333](https://github.com/rtorcato/repo-tooling/issues/333)
* **docs-site:** derive the self-pin from the running version ([#336](https://github.com/rtorcato/repo-tooling/issues/336)) ([51debe0](https://github.com/rtorcato/repo-tooling/commit/51debe026f8f06d543c0269e126ee2fac35777bc)), closes [#335](https://github.com/rtorcato/repo-tooling/issues/335) [#330](https://github.com/rtorcato/repo-tooling/issues/330)
* **docs-theme:** let code blocks follow the theme in light mode ([#337](https://github.com/rtorcato/repo-tooling/issues/337)) ([fb151bd](https://github.com/rtorcato/repo-tooling/commit/fb151bd8bce2f4e28bef79e128a2f3d2bc7bcaea))

## [3.2.1](https://github.com/rtorcato/repo-tooling/compare/v3.2.0...v3.2.1) (2026-08-07)


### Bug Fixes

* **docs:** depend on shared-docs from the registry, not github: ([#334](https://github.com/rtorcato/repo-tooling/issues/334)) ([e9f65b5](https://github.com/rtorcato/repo-tooling/commit/e9f65b53e56a1ea83ee028cb7e820696a792d6de)), closes [#332](https://github.com/rtorcato/repo-tooling/issues/332) [#333](https://github.com/rtorcato/repo-tooling/issues/333)
* **pnpm-workspace:** derive the release-age scope, don't hardcode it ([#335](https://github.com/rtorcato/repo-tooling/issues/335)) ([7aced1e](https://github.com/rtorcato/repo-tooling/commit/7aced1e6cfcdb8c51faaa58fd2edbb25bdbd4644))

# [3.2.0](https://github.com/rtorcato/repo-tooling/compare/v3.1.0...v3.2.0) (2026-08-07)


### Bug Fixes

* **docs:** refresh the shared-docs pin so siblings drop js-tooling ([#331](https://github.com/rtorcato/repo-tooling/issues/331)) ([e992b3b](https://github.com/rtorcato/repo-tooling/commit/e992b3b1c3249d1df3ed3f95e3a76d5bf42d1c3e))


### Features

* **doctor:** config schema versions + refless git dependency checks ([#333](https://github.com/rtorcato/repo-tooling/issues/333)) ([986fa6f](https://github.com/rtorcato/repo-tooling/commit/986fa6f07411ba5ba3c4fbc8b8b0cfda3a3d9b2c)), closes [#330](https://github.com/rtorcato/repo-tooling/issues/330) [#332](https://github.com/rtorcato/repo-tooling/issues/332) [#330](https://github.com/rtorcato/repo-tooling/issues/330)

# [3.1.0](https://github.com/rtorcato/repo-tooling/compare/v3.0.0...v3.1.0) (2026-08-07)


### Features

* **doctor:** warn on a git identity that mis-attributes commits ([#329](https://github.com/rtorcato/repo-tooling/issues/329)) ([8dde1ef](https://github.com/rtorcato/repo-tooling/commit/8dde1ef89b0049e8175493530825c2eac3952da1)), closes [#327](https://github.com/rtorcato/repo-tooling/issues/327)

# [3.0.0](https://github.com/rtorcato/repo-tooling/compare/v2.60.0...v3.0.0) (2026-08-07)


### Features

* **core:** language-module interface + registry, split checks/fixers into base vs js ([#280](https://github.com/rtorcato/repo-tooling/issues/280), [#281](https://github.com/rtorcato/repo-tooling/issues/281)) ([#296](https://github.com/rtorcato/repo-tooling/issues/296)) ([08f4ccd](https://github.com/rtorcato/repo-tooling/commit/08f4ccd667c1a0fcabc440fcbf4b3018e857e751)), closes [#139](https://github.com/rtorcato/repo-tooling/issues/139) [#282](https://github.com/rtorcato/repo-tooling/issues/282)
* **doctor:** dogfood doctor against this repo in CI ([#273](https://github.com/rtorcato/repo-tooling/issues/273)) ([#293](https://github.com/rtorcato/repo-tooling/issues/293)) ([298703b](https://github.com/rtorcato/repo-tooling/commit/298703b8e5bd74d96e4fb16b09b1072981a0fbb1)), closes [#292](https://github.com/rtorcato/repo-tooling/issues/292)
* **doctor:** per-module dispatch — run base checks for every language ([#285](https://github.com/rtorcato/repo-tooling/issues/285)) ([#299](https://github.com/rtorcato/repo-tooling/issues/299)) ([9f17a45](https://github.com/rtorcato/repo-tooling/commit/9f17a45a88415bc6c0ac452e269aa4c8616039c9)), closes [#284](https://github.com/rtorcato/repo-tooling/issues/284)
* **fix:** pnpm-workspace target — managed pnpm settings ([#314](https://github.com/rtorcato/repo-tooling/issues/314)) ([#325](https://github.com/rtorcato/repo-tooling/issues/325)) ([c72f233](https://github.com/rtorcato/repo-tooling/commit/c72f233695b4b6afb8ede16332598a5b58dd4fee))
* **setup:** prompt for the repo language ([#284](https://github.com/rtorcato/repo-tooling/issues/284)) ([#301](https://github.com/rtorcato/repo-tooling/issues/301)) ([94b4074](https://github.com/rtorcato/repo-tooling/commit/94b407414b7dfca0044f604cc29593a76321faa7)), closes [#286](https://github.com/rtorcato/repo-tooling/issues/286) [#288](https://github.com/rtorcato/repo-tooling/issues/288) [#288](https://github.com/rtorcato/repo-tooling/issues/288)
* **swift:** CI generation (GHA + GitLab) + CodeQL language: swift ([#287](https://github.com/rtorcato/repo-tooling/issues/287)) ([#305](https://github.com/rtorcato/repo-tooling/issues/305)) ([987f863](https://github.com/rtorcato/repo-tooling/commit/987f8636fd10bba937a84e8c2db14919ef04efff)), closes [#283](https://github.com/rtorcato/repo-tooling/issues/283) [#283](https://github.com/rtorcato/repo-tooling/issues/283) [#303](https://github.com/rtorcato/repo-tooling/issues/303)
* **swift:** src/languages/swift module — checks + fixers ([#286](https://github.com/rtorcato/repo-tooling/issues/286)) ([#304](https://github.com/rtorcato/repo-tooling/issues/304)) ([95c67ab](https://github.com/rtorcato/repo-tooling/commit/95c67ab4bf159a3ab79ce9e9ce939e737f815ea3)), closes [#285](https://github.com/rtorcato/repo-tooling/issues/285) [#285](https://github.com/rtorcato/repo-tooling/issues/285) [#284](https://github.com/rtorcato/repo-tooling/issues/284) [#303](https://github.com/rtorcato/repo-tooling/issues/303) [#282](https://github.com/rtorcato/repo-tooling/issues/282)
* **swift:** swift-library preset + docs ([#288](https://github.com/rtorcato/repo-tooling/issues/288)) ([#306](https://github.com/rtorcato/repo-tooling/issues/306)) ([9af069e](https://github.com/rtorcato/repo-tooling/commit/9af069ec347ce8cda36ef9b0844e2ef8de5b84d0)), closes [#287](https://github.com/rtorcato/repo-tooling/issues/287) [#305](https://github.com/rtorcato/repo-tooling/issues/305) [#286](https://github.com/rtorcato/repo-tooling/issues/286) [#287](https://github.com/rtorcato/repo-tooling/issues/287) [#287](https://github.com/rtorcato/repo-tooling/issues/287) [#303](https://github.com/rtorcato/repo-tooling/issues/303)

# [2.60.0](https://github.com/rtorcato/js-tooling/compare/v2.59.0...v2.60.0) (2026-07-27)


### Features

* **setup:** single config file — accept lockfile as --config ([#271](https://github.com/rtorcato/js-tooling/issues/271)) ([#275](https://github.com/rtorcato/js-tooling/issues/275)) ([dd7eb0f](https://github.com/rtorcato/js-tooling/commit/dd7eb0feb9e39d19eacd1be5d09626c1707a49cc)), closes [#272](https://github.com/rtorcato/js-tooling/issues/272)

# [2.59.0](https://github.com/rtorcato/js-tooling/compare/v2.58.1...v2.59.0) (2026-07-24)


### Features

* **doctor:** require code-scanning results before merge (branch ruleset) ([#270](https://github.com/rtorcato/js-tooling/issues/270)) ([d439858](https://github.com/rtorcato/js-tooling/commit/d439858669342d424dadde0cfa27af1e2e0ef0ff)), closes [#269](https://github.com/rtorcato/js-tooling/issues/269)

## [2.58.1](https://github.com/rtorcato/js-tooling/compare/v2.58.0...v2.58.1) (2026-07-23)


### Bug Fixes

* **release:** upgrade npm for OIDC trusted publishing ([#268](https://github.com/rtorcato/js-tooling/issues/268)) ([da0b694](https://github.com/rtorcato/js-tooling/commit/da0b69400809bdd6ac609c1c9eb7a29ce618331e)), closes [#264](https://github.com/rtorcato/js-tooling/issues/264)

# [2.58.0](https://github.com/rtorcato/js-tooling/compare/v2.57.0...v2.58.0) (2026-07-22)


### Features

* **doctor:** flag release workflows still using NPM_TOKEN as drift ([#265](https://github.com/rtorcato/js-tooling/issues/265)) ([5ffc390](https://github.com/rtorcato/js-tooling/commit/5ffc3903ad2731b327a98681d694445432f2e323)), closes [#264](https://github.com/rtorcato/js-tooling/issues/264)

# [2.57.0](https://github.com/rtorcato/js-tooling/compare/v2.56.0...v2.57.0) (2026-07-22)


### Features

* **release:** publish to npm via OIDC trusted publishing ([#264](https://github.com/rtorcato/js-tooling/issues/264)) ([99a5837](https://github.com/rtorcato/js-tooling/commit/99a5837f99af977a49d9dc2da7755f7fa44c927d)), closes [#201](https://github.com/rtorcato/js-tooling/issues/201) [#201](https://github.com/rtorcato/js-tooling/issues/201)

# [2.56.0](https://github.com/rtorcato/js-tooling/compare/v2.55.0...v2.56.0) (2026-07-22)


### Features

* **cli:** fix ai documents npx skills install in README ([#262](https://github.com/rtorcato/js-tooling/issues/262)) ([5c44a36](https://github.com/rtorcato/js-tooling/commit/5c44a3612ca7b4c4b2be6098095e6883ad98df59))
* **docs:** make sync-changelog target configurable (Fumadocs-ready) ([#263](https://github.com/rtorcato/js-tooling/issues/263)) ([4c75aac](https://github.com/rtorcato/js-tooling/commit/4c75aac0f2a99f2a0cf72869984565d0ebaddc94)), closes [#261](https://github.com/rtorcato/js-tooling/issues/261)

# [2.55.0](https://github.com/rtorcato/js-tooling/compare/v2.54.1...v2.55.0) (2026-07-20)


### Features

* **cli:** ship shared Docusaurus component theme copy-preset ([#141](https://github.com/rtorcato/js-tooling/issues/141)) ([#260](https://github.com/rtorcato/js-tooling/issues/260)) ([b982b30](https://github.com/rtorcato/js-tooling/commit/b982b3071195f13d491b9a09281bc6bb7f72a5fc)), closes [#54](https://github.com/rtorcato/js-tooling/issues/54) [#54](https://github.com/rtorcato/js-tooling/issues/54) [#178](https://github.com/rtorcato/js-tooling/issues/178)

## [2.54.1](https://github.com/rtorcato/js-tooling/compare/v2.54.0...v2.54.1) (2026-07-20)


### Bug Fixes

* **cli:** Dependabot cooldown to avoid min-release-age CI failures ([#258](https://github.com/rtorcato/js-tooling/issues/258)) ([6947925](https://github.com/rtorcato/js-tooling/commit/69479258ed7ee8d7fc597aeb2545141210dc8a83)), closes [#111](https://github.com/rtorcato/js-tooling/issues/111) [#256](https://github.com/rtorcato/js-tooling/issues/256) [#257](https://github.com/rtorcato/js-tooling/issues/257) [#256](https://github.com/rtorcato/js-tooling/issues/256) [#257](https://github.com/rtorcato/js-tooling/issues/257)

# [2.54.0](https://github.com/rtorcato/js-tooling/compare/v2.53.0...v2.54.0) (2026-07-20)


### Features

* **cli:** canonical Dependabot config + auto-merge workflow ([#111](https://github.com/rtorcato/js-tooling/issues/111)) ([#255](https://github.com/rtorcato/js-tooling/issues/255)) ([6785702](https://github.com/rtorcato/js-tooling/commit/6785702033b53355ef43e34c75495379909a9fb9)), closes [#109](https://github.com/rtorcato/js-tooling/issues/109) [#109](https://github.com/rtorcato/js-tooling/issues/109)

# [2.53.0](https://github.com/rtorcato/js-tooling/compare/v2.52.0...v2.53.0) (2026-07-19)


### Features

* **cli:** wire Bun into the setup wizard as a runtime flag ([#225](https://github.com/rtorcato/js-tooling/issues/225)) ([#238](https://github.com/rtorcato/js-tooling/issues/238)) ([8b7e242](https://github.com/rtorcato/js-tooling/commit/8b7e242379c48cbc11d93fa485731794f0acd89f)), closes [#60](https://github.com/rtorcato/js-tooling/issues/60) [#60](https://github.com/rtorcato/js-tooling/issues/60)

# [2.52.0](https://github.com/rtorcato/js-tooling/compare/v2.51.0...v2.52.0) (2026-07-19)


### Features

* self-hosted Claude Code plugin + ship AGENTS.md ([#162](https://github.com/rtorcato/js-tooling/issues/162)) ([#234](https://github.com/rtorcato/js-tooling/issues/234)) ([f31240b](https://github.com/rtorcato/js-tooling/commit/f31240b7f2c8df9d433a89b055e58097c56d83d1))

# [2.51.0](https://github.com/rtorcato/js-tooling/compare/v2.50.0...v2.51.0) (2026-07-19)


### Features

* **cli:** emit the shared badge row into the generated docs homepage ([#169](https://github.com/rtorcato/js-tooling/issues/169)) ([#239](https://github.com/rtorcato/js-tooling/issues/239)) ([c2a41b9](https://github.com/rtorcato/js-tooling/commit/c2a41b9d1d7f6588ce6e684ed4cb21bcf1893375)), closes [#142](https://github.com/rtorcato/js-tooling/issues/142) [100/#232](https://github.com/rtorcato/js-tooling/issues/232) [#235](https://github.com/rtorcato/js-tooling/issues/235) [#236](https://github.com/rtorcato/js-tooling/issues/236)

# [2.50.0](https://github.com/rtorcato/js-tooling/compare/v2.49.0...v2.50.0) (2026-07-19)


### Features

* **cli:** opt-in TypeDoc API section in the docs-site generator ([#229](https://github.com/rtorcato/js-tooling/issues/229)) ([#236](https://github.com/rtorcato/js-tooling/issues/236)) ([d8f99e6](https://github.com/rtorcato/js-tooling/commit/d8f99e66dad54deaa4fe745c7f6a871723458b0c)), closes [100/#232](https://github.com/rtorcato/js-tooling/issues/232)

# [2.49.0](https://github.com/rtorcato/js-tooling/compare/v2.48.0...v2.49.0) (2026-07-19)


### Features

* **cli:** scaffold a Playwright smoke test in the docs-site generator ([#230](https://github.com/rtorcato/js-tooling/issues/230)) ([#235](https://github.com/rtorcato/js-tooling/issues/235)) ([2353af5](https://github.com/rtorcato/js-tooling/commit/2353af5428ff6825a400bdaea69852b3b51f0c98)), closes [#100](https://github.com/rtorcato/js-tooling/issues/100) [#232](https://github.com/rtorcato/js-tooling/issues/232)

# [2.48.0](https://github.com/rtorcato/js-tooling/compare/v2.47.0...v2.48.0) (2026-07-19)


### Features

* **cli:** docs-site generator (fix docs-site) ([#100](https://github.com/rtorcato/js-tooling/issues/100)) ([#232](https://github.com/rtorcato/js-tooling/issues/232)) ([6794f46](https://github.com/rtorcato/js-tooling/commit/6794f4673ce1a0a65ac949e579d88bb22d9bb38b)), closes [#54](https://github.com/rtorcato/js-tooling/issues/54) [#54](https://github.com/rtorcato/js-tooling/issues/54) [100/#106](https://github.com/rtorcato/js-tooling/issues/106) [#54](https://github.com/rtorcato/js-tooling/issues/54) [#229](https://github.com/rtorcato/js-tooling/issues/229) [#230](https://github.com/rtorcato/js-tooling/issues/230) [#231](https://github.com/rtorcato/js-tooling/issues/231)

# [2.47.0](https://github.com/rtorcato/js-tooling/compare/v2.46.0...v2.47.0) (2026-07-17)


### Features

* **cli:** add Docusaurus shared helpers ([#54](https://github.com/rtorcato/js-tooling/issues/54)) ([#228](https://github.com/rtorcato/js-tooling/issues/228)) ([2bb3bda](https://github.com/rtorcato/js-tooling/commit/2bb3bda2776f9f6d7fea01d6f83d17dedfeba15c)), closes [106/#100](https://github.com/rtorcato/js-tooling/issues/100) [#100](https://github.com/rtorcato/js-tooling/issues/100) [100/#106](https://github.com/rtorcato/js-tooling/issues/106)

# [2.46.0](https://github.com/rtorcato/js-tooling/compare/v2.45.0...v2.46.0) (2026-07-17)


### Features

* **cli:** add Rolldown preset (bundler option) ([#227](https://github.com/rtorcato/js-tooling/issues/227)) ([86b7550](https://github.com/rtorcato/js-tooling/commit/86b75502a91e4c9d4d41e88f4695f76785673a75))

# [2.45.0](https://github.com/rtorcato/js-tooling/compare/v2.44.0...v2.45.0) (2026-07-17)


### Features

* **cli:** add Bun support (tsconfig preset, bunfig, fix bun) ([#226](https://github.com/rtorcato/js-tooling/issues/226)) ([5a667cd](https://github.com/rtorcato/js-tooling/commit/5a667cd3f727146fc9c5818ff69be472ede4198e)), closes [#60](https://github.com/rtorcato/js-tooling/issues/60) [#225](https://github.com/rtorcato/js-tooling/issues/225)

# [2.44.0](https://github.com/rtorcato/js-tooling/compare/v2.43.0...v2.44.0) (2026-07-17)


### Features

* **cli:** add Nx preset (alternative to Turborepo) ([#224](https://github.com/rtorcato/js-tooling/issues/224)) ([60e4c5c](https://github.com/rtorcato/js-tooling/commit/60e4c5c44305760379620c98b9a661374a930519))

# [2.43.0](https://github.com/rtorcato/js-tooling/compare/v2.42.0...v2.43.0) (2026-07-17)


### Features

* **cli:** add Release Please preset (alternative release tool) ([#223](https://github.com/rtorcato/js-tooling/issues/223)) ([c42bd98](https://github.com/rtorcato/js-tooling/commit/c42bd98f6ff936237e69570561839a6378944410))

# [2.42.0](https://github.com/rtorcato/js-tooling/compare/v2.41.2...v2.42.0) (2026-07-17)


### Features

* **cli:** add Cypress preset (peer to Playwright) ([#222](https://github.com/rtorcato/js-tooling/issues/222)) ([fdfc58d](https://github.com/rtorcato/js-tooling/commit/fdfc58d51dbb90223ab5dea9b3f02b662c47834b))

## [2.41.2](https://github.com/rtorcato/js-tooling/compare/v2.41.1...v2.41.2) (2026-07-17)


### Bug Fixes

* **doctor:** scope gh repo resolution to the -d target dir ([#219](https://github.com/rtorcato/js-tooling/issues/219)) ([afb3249](https://github.com/rtorcato/js-tooling/commit/afb3249e747f549f6ba4216ee33fa7da94503f07)), closes [#218](https://github.com/rtorcato/js-tooling/issues/218) [#137](https://github.com/rtorcato/js-tooling/issues/137) [#138](https://github.com/rtorcato/js-tooling/issues/138) [#backed](https://github.com/rtorcato/js-tooling/issues/backed) [#218](https://github.com/rtorcato/js-tooling/issues/218)

## [2.41.1](https://github.com/rtorcato/js-tooling/compare/v2.41.0...v2.41.1) (2026-07-17)


### Bug Fixes

* **doctor:** read GitHub merge settings via REST, not gh repo view ([#217](https://github.com/rtorcato/js-tooling/issues/217)) ([9dc6b16](https://github.com/rtorcato/js-tooling/commit/9dc6b1683a355fd3561ffa3465bb3eab874c62e2)), closes [#137](https://github.com/rtorcato/js-tooling/issues/137) [#138](https://github.com/rtorcato/js-tooling/issues/138) [#138](https://github.com/rtorcato/js-tooling/issues/138) [#137](https://github.com/rtorcato/js-tooling/issues/137)

# [2.41.0](https://github.com/rtorcato/js-tooling/compare/v2.40.0...v2.41.0) (2026-07-17)


### Features

* **fix:** github-settings target — apply branch protection + merge + workflow permissions via gh api ([#216](https://github.com/rtorcato/js-tooling/issues/216)) ([8b70233](https://github.com/rtorcato/js-tooling/commit/8b70233a4f75077159b3b10c59b8b4647c09738a)), closes [#137](https://github.com/rtorcato/js-tooling/issues/137) [#137](https://github.com/rtorcato/js-tooling/issues/137) [#138](https://github.com/rtorcato/js-tooling/issues/138)

# [2.40.0](https://github.com/rtorcato/js-tooling/compare/v2.39.0...v2.40.0) (2026-07-16)


### Features

* **cli:** add PostCSS preset ([#65](https://github.com/rtorcato/js-tooling/issues/65)) ([#209](https://github.com/rtorcato/js-tooling/issues/209)) ([efc9f41](https://github.com/rtorcato/js-tooling/commit/efc9f41d64a277fdc8f5ba1fc3eabdbf94fa7a0c))

# [2.39.0](https://github.com/rtorcato/js-tooling/compare/v2.38.0...v2.39.0) (2026-07-16)


### Features

* **cli:** add Tailwind CSS v4 preset ([#63](https://github.com/rtorcato/js-tooling/issues/63)) ([#207](https://github.com/rtorcato/js-tooling/issues/207)) ([ac9249a](https://github.com/rtorcato/js-tooling/commit/ac9249ae82a78c9690be42164ad426f0f6a0c98e)), closes [#68](https://github.com/rtorcato/js-tooling/issues/68)

# [2.38.0](https://github.com/rtorcato/js-tooling/compare/v2.37.0...v2.38.0) (2026-07-15)


### Features

* **doctor:** GitHub repo-settings drift checks via gh ([#137](https://github.com/rtorcato/js-tooling/issues/137)) ([#206](https://github.com/rtorcato/js-tooling/issues/206)) ([c177ba5](https://github.com/rtorcato/js-tooling/commit/c177ba5d782249c7741530cd9c653b7a198a53d2)), closes [#138](https://github.com/rtorcato/js-tooling/issues/138) [#109](https://github.com/rtorcato/js-tooling/issues/109) [#138](https://github.com/rtorcato/js-tooling/issues/138) [#missing](https://github.com/rtorcato/js-tooling/issues/missing)

# [2.37.0](https://github.com/rtorcato/js-tooling/compare/v2.36.0...v2.37.0) (2026-07-15)


### Features

* **cli:** add optional deploy workflow templates via fix ([#66](https://github.com/rtorcato/js-tooling/issues/66)) ([#204](https://github.com/rtorcato/js-tooling/issues/204)) ([a12646b](https://github.com/rtorcato/js-tooling/commit/a12646bceada39545042d59d66a0efac302d1c7e)), closes [#workflow](https://github.com/rtorcato/js-tooling/issues/workflow)
* **doctor:** language field + detectLanguage() detector ([#140](https://github.com/rtorcato/js-tooling/issues/140)) ([#202](https://github.com/rtorcato/js-tooling/issues/202)) ([008aeb0](https://github.com/rtorcato/js-tooling/commit/008aeb0d585dd03655c97fda01549e2ec934588e)), closes [#139](https://github.com/rtorcato/js-tooling/issues/139) [#139](https://github.com/rtorcato/js-tooling/issues/139)

# [2.36.0](https://github.com/rtorcato/js-tooling/compare/v2.35.0...v2.36.0) (2026-07-15)


### Features

* **cli:** add Turborepo preset for pnpm workspaces ([#68](https://github.com/rtorcato/js-tooling/issues/68)) ([#203](https://github.com/rtorcato/js-tooling/issues/203)) ([253740c](https://github.com/rtorcato/js-tooling/commit/253740cc2a8b7eb4c9fccb5bf1336c471e9392d8))

# [2.35.0](https://github.com/rtorcato/js-tooling/compare/v2.34.0...v2.35.0) (2026-07-14)


### Features

* **size-limit:** exports-driven budgets for multi-subpath libraries ([#199](https://github.com/rtorcato/js-tooling/issues/199)) ([7f543de](https://github.com/rtorcato/js-tooling/commit/7f543deebc5a456eb39821e5f40387d309ab14f4))

# [2.34.0](https://github.com/rtorcato/js-tooling/compare/v2.33.0...v2.34.0) (2026-07-14)


### Features

* **scaffold:** add commitizen alongside commitlint ([#198](https://github.com/rtorcato/js-tooling/issues/198)) ([5c902f5](https://github.com/rtorcato/js-tooling/commit/5c902f506a27eb554431b49f32ba13955381ad38))

# [2.33.0](https://github.com/rtorcato/js-tooling/compare/v2.32.0...v2.33.0) (2026-07-14)


### Features

* **ci:** upload coverage to Codecov so the coverage badge works ([#197](https://github.com/rtorcato/js-tooling/issues/197)) ([26dfcc3](https://github.com/rtorcato/js-tooling/commit/26dfcc34bba72fa282af1377f4c7dc01038ebea2))

# [2.32.0](https://github.com/rtorcato/js-tooling/compare/v2.31.0...v2.32.0) (2026-07-14)


### Features

* **scaffold:** ship are-the-types-wrong in library verify + release ([#200](https://github.com/rtorcato/js-tooling/issues/200)) ([568a2d6](https://github.com/rtorcato/js-tooling/commit/568a2d6590bf2da51ef723f401bab57e480b50e3)), closes [#27](https://github.com/rtorcato/js-tooling/issues/27)

# [2.31.0](https://github.com/rtorcato/js-tooling/compare/v2.30.0...v2.31.0) (2026-07-14)


### Bug Fixes

* **tsconfig:** anchor preset paths with ${configDir} to drop deprecated baseUrl ([#195](https://github.com/rtorcato/js-tooling/issues/195)) ([bfad079](https://github.com/rtorcato/js-tooling/commit/bfad0796a6dc144ac7def31f360e427ec0c7234e))


### Features

* **generator:** recommend VS Code extensions matching enabled tools ([#196](https://github.com/rtorcato/js-tooling/issues/196)) ([bcf608e](https://github.com/rtorcato/js-tooling/commit/bcf608e922f33cb5599bdb9e2480e4ef61be2bcb))

# [2.30.0](https://github.com/rtorcato/js-tooling/compare/v2.29.2...v2.30.0) (2026-07-13)


### Features

* **cli:** grouped dependabot defaults + drift detection ([#194](https://github.com/rtorcato/js-tooling/issues/194)) ([2b45f08](https://github.com/rtorcato/js-tooling/commit/2b45f08deb46385326ad62551fbc86f0a0279b22))

## [2.29.2](https://github.com/rtorcato/js-tooling/compare/v2.29.1...v2.29.2) (2026-07-10)


### Bug Fixes

* **setup:** close 4 CI scaffold gaps in generated workflows ([#180](https://github.com/rtorcato/js-tooling/issues/180)) ([#181](https://github.com/rtorcato/js-tooling/issues/181)) ([4ad9c1d](https://github.com/rtorcato/js-tooling/commit/4ad9c1d12f93826c89d642bd23850ca2ff440ea0))

## [2.29.1](https://github.com/rtorcato/js-tooling/compare/v2.29.0...v2.29.1) (2026-07-06)


### Bug Fixes

* **peers:** allow @commitlint/cli 21 to match config-conventional peer ([#174](https://github.com/rtorcato/js-tooling/issues/174)) ([ebb2d65](https://github.com/rtorcato/js-tooling/commit/ebb2d652158e867a64b45e8251d7d99301d702a2))

# [2.29.0](https://github.com/rtorcato/js-tooling/compare/v2.28.0...v2.29.0) (2026-07-06)


### Features

* **badges:** generate README status badges (opt-in, visibility-aware) ([#171](https://github.com/rtorcato/js-tooling/issues/171)) ([09d2f28](https://github.com/rtorcato/js-tooling/commit/09d2f28200b0d478bb53dcc385cc64e53acd81e7)), closes [#142](https://github.com/rtorcato/js-tooling/issues/142) [#169](https://github.com/rtorcato/js-tooling/issues/169)

# [2.28.0](https://github.com/rtorcato/js-tooling/compare/v2.27.0...v2.28.0) (2026-07-06)


### Features

* **publint:** add publint preset, doctor check, and fix scaffolder ([#170](https://github.com/rtorcato/js-tooling/issues/170)) ([e4a9e41](https://github.com/rtorcato/js-tooling/commit/e4a9e412573c4351fc119a14da0b48fdab8e1762)), closes [#70](https://github.com/rtorcato/js-tooling/issues/70)

# [2.27.0](https://github.com/rtorcato/js-tooling/compare/v2.26.1...v2.27.0) (2026-07-06)


### Features

* **bundler:** add Rollup preset as a peer to tsup/esbuild ([#168](https://github.com/rtorcato/js-tooling/issues/168)) ([aa3763c](https://github.com/rtorcato/js-tooling/commit/aa3763c82c76ec6eef230c906d32125d333a170d))

## [2.26.1](https://github.com/rtorcato/js-tooling/compare/v2.26.0...v2.26.1) (2026-07-06)


### Bug Fixes

* **deps:** drop duplicated fdir entry from pnpm-lock.yaml (unblocks CI) ([#167](https://github.com/rtorcato/js-tooling/issues/167)) ([22fbd15](https://github.com/rtorcato/js-tooling/commit/22fbd156e922a1dbd4f6dfb18be88ec3ab8ed8d7)), closes [#166](https://github.com/rtorcato/js-tooling/issues/166) [#123](https://github.com/rtorcato/js-tooling/issues/123) [#127](https://github.com/rtorcato/js-tooling/issues/127) [#166](https://github.com/rtorcato/js-tooling/issues/166)

# [2.26.0](https://github.com/rtorcato/js-tooling/compare/v2.25.2...v2.26.0) (2026-07-04)


### Features

* unified AI setup (fix ai + setup prompt: AGENTS.md, CLAUDE.md, MCP, doctor) ([#160](https://github.com/rtorcato/js-tooling/issues/160)) ([0e08c14](https://github.com/rtorcato/js-tooling/commit/0e08c1431b6b793059de4be7a9b5f27c3d80c1d6)), closes [#93](https://github.com/rtorcato/js-tooling/issues/93)

## [2.25.2](https://github.com/rtorcato/js-tooling/compare/v2.25.1...v2.25.2) (2026-07-04)


### Bug Fixes

* **husky:** scaffold v10 hook format, drop deprecated v9 bootstrap ([#156](https://github.com/rtorcato/js-tooling/issues/156)) ([4d79999](https://github.com/rtorcato/js-tooling/commit/4d79999a21e34c78002e469b92475743e7d9d8b5)), closes [#135](https://github.com/rtorcato/js-tooling/issues/135) [db-common#16](https://github.com/db-common/issues/16) [#135](https://github.com/rtorcato/js-tooling/issues/135)

## [2.25.1](https://github.com/rtorcato/js-tooling/compare/v2.25.0...v2.25.1) (2026-07-04)


### Bug Fixes

* **tsconfig:** pin tsBuildInfoFile in the v1 base preset (TS5074) ([#155](https://github.com/rtorcato/js-tooling/issues/155)) ([4f3ee40](https://github.com/rtorcato/js-tooling/commit/4f3ee405659f098068f4d213d2096046b6647868)), closes [#98](https://github.com/rtorcato/js-tooling/issues/98) [#97](https://github.com/rtorcato/js-tooling/issues/97) [#98](https://github.com/rtorcato/js-tooling/issues/98)

# [2.25.0](https://github.com/rtorcato/js-tooling/compare/v2.24.1...v2.25.0) (2026-07-04)


### Features

* **doctor,fix:** Node version consistency check + node-version fix target ([#154](https://github.com/rtorcato/js-tooling/issues/154)) ([3a3c7bb](https://github.com/rtorcato/js-tooling/commit/3a3c7bb671b2d5e073fa1f1fdc6394c0a8e87daa)), closes [#143](https://github.com/rtorcato/js-tooling/issues/143) [#94](https://github.com/rtorcato/js-tooling/issues/94) [#143](https://github.com/rtorcato/js-tooling/issues/143)

## [2.24.1](https://github.com/rtorcato/js-tooling/compare/v2.24.0...v2.24.1) (2026-07-04)


### Bug Fixes

* **doctor,fix:** validate husky/lint-staged wiring, not just config presence ([#152](https://github.com/rtorcato/js-tooling/issues/152)) ([a09b3df](https://github.com/rtorcato/js-tooling/commit/a09b3df3b9f4f87ac403a3eae062f91a499de857)), closes [#149](https://github.com/rtorcato/js-tooling/issues/149) [#150](https://github.com/rtorcato/js-tooling/issues/150) [#149](https://github.com/rtorcato/js-tooling/issues/149) [#150](https://github.com/rtorcato/js-tooling/issues/150) [#149](https://github.com/rtorcato/js-tooling/issues/149) [#150](https://github.com/rtorcato/js-tooling/issues/150)

# [2.24.0](https://github.com/rtorcato/js-tooling/compare/v2.23.0...v2.24.0) (2026-07-04)


### Features

* **knip:** match knip.json entry globs to the build model ([#151](https://github.com/rtorcato/js-tooling/issues/151)) ([ed7304d](https://github.com/rtorcato/js-tooling/commit/ed7304db72e9f4192185ec6b90dc3eaa6f56b976)), closes [#145](https://github.com/rtorcato/js-tooling/issues/145) [#145](https://github.com/rtorcato/js-tooling/issues/145)

# [2.23.0](https://github.com/rtorcato/js-tooling/compare/v2.22.0...v2.23.0) (2026-07-03)


### Features

* **docs:** add logo, restructure nav, custom mobile sidebar theming ([928d7b9](https://github.com/rtorcato/js-tooling/commit/928d7b982ca3e3f22cea6d6d935bf26e500a0cc7))

# [2.22.0](https://github.com/rtorcato/js-tooling/compare/v2.21.0...v2.22.0) (2026-06-29)


### Features

* **docusaurus:** shared TypeDoc helper + reusable docs deploy ([#134](https://github.com/rtorcato/js-tooling/issues/134)) ([f5e73eb](https://github.com/rtorcato/js-tooling/commit/f5e73eb68229be312585942c80752878c303ba81))

# [2.21.0](https://github.com/rtorcato/js-tooling/compare/v2.20.0...v2.21.0) (2026-06-29)


### Bug Fixes

* **commitlint:** raise header-max to 100, ungate release ([#132](https://github.com/rtorcato/js-tooling/issues/132)) ([dc02107](https://github.com/rtorcato/js-tooling/commit/dc02107b5044da9878ace9059c14248aa720f287)), closes [#NN](https://github.com/rtorcato/js-tooling/issues/NN)


### Features

* **cli:** scaffold RELEASE_TOKEN-aware release workflow + doctor check ([#131](https://github.com/rtorcato/js-tooling/issues/131)) ([537f3cf](https://github.com/rtorcato/js-tooling/commit/537f3cfd8d199328c19ff2003c60caf0af914dfd))

# [2.20.0](https://github.com/rtorcato/js-tooling/compare/v2.19.2...v2.20.0) (2026-06-28)


### Features

* **cli:** scaffold community-health files via fix/doctor ([#112](https://github.com/rtorcato/js-tooling/issues/112)) ([799b908](https://github.com/rtorcato/js-tooling/commit/799b908c509a04eebd6b38a0d637b033c382f7f2))

## [2.19.2](https://github.com/rtorcato/js-tooling/compare/v2.19.1...v2.19.2) (2026-06-28)


### Bug Fixes

* **cli:** bump stale version pins in scaffolded output ([#107](https://github.com/rtorcato/js-tooling/issues/107)) ([7cc2e1b](https://github.com/rtorcato/js-tooling/commit/7cc2e1b2e2fd04e2a1dbf155a0e8f15acdc43c9a)), closes [#105](https://github.com/rtorcato/js-tooling/issues/105)
* **release:** make npm publish opt-in and install preset plugins ([#108](https://github.com/rtorcato/js-tooling/issues/108)) ([ea95afc](https://github.com/rtorcato/js-tooling/commit/ea95afc63fc3ed7c867cb93eb5d3e03486727b9f))

## [2.19.1](https://github.com/rtorcato/js-tooling/compare/v2.19.0...v2.19.1) (2026-06-27)


### Bug Fixes

* **cli:** repair library preset scaffold defects ([#101](https://github.com/rtorcato/js-tooling/issues/101)) ([925fd98](https://github.com/rtorcato/js-tooling/commit/925fd981cd65f2d908bcede955c61d32fc090337)), closes [#98](https://github.com/rtorcato/js-tooling/issues/98) [#91](https://github.com/rtorcato/js-tooling/issues/91) [#92](https://github.com/rtorcato/js-tooling/issues/92) [#93](https://github.com/rtorcato/js-tooling/issues/93) [#94](https://github.com/rtorcato/js-tooling/issues/94) [#95](https://github.com/rtorcato/js-tooling/issues/95) [#96](https://github.com/rtorcato/js-tooling/issues/96) [#97](https://github.com/rtorcato/js-tooling/issues/97) [#98](https://github.com/rtorcato/js-tooling/issues/98) [#91](https://github.com/rtorcato/js-tooling/issues/91) [#92](https://github.com/rtorcato/js-tooling/issues/92) [#93](https://github.com/rtorcato/js-tooling/issues/93) [#94](https://github.com/rtorcato/js-tooling/issues/94) [#95](https://github.com/rtorcato/js-tooling/issues/95) [#96](https://github.com/rtorcato/js-tooling/issues/96) [#97](https://github.com/rtorcato/js-tooling/issues/97) [#98](https://github.com/rtorcato/js-tooling/issues/98)

# [2.19.0](https://github.com/rtorcato/js-tooling/compare/v2.18.0...v2.19.0) (2026-06-27)


### Bug Fixes

* **ci:** revert release to GITHUB_TOKEN, drop broken app-token step ([cfa8f1f](https://github.com/rtorcato/js-tooling/commit/cfa8f1fa9eee80ff8e6c119c9215f287dd43bdc6))


### Features

* **cli:** add `fix claude-skill` to auto-install the skill ([935b13a](https://github.com/rtorcato/js-tooling/commit/935b13aee4a474beb2c6230a1b08ad987e9119f8))
* **cli:** add attw fixer + ship a Claude Code skill for consumers ([61bffc6](https://github.com/rtorcato/js-tooling/commit/61bffc602e95da75ca6709c51e67321d74c8af86))
* **cli:** support Cursor, Copilot, and AGENTS.md agent rules ([673707b](https://github.com/rtorcato/js-tooling/commit/673707bf41ed8d8c5632b387255664ed6a1a96ae))

# [2.18.0](https://github.com/rtorcato/js-tooling/compare/v2.17.1...v2.18.0) (2026-06-14)


### Bug Fixes

* **ci:** remove conflicting pnpm version pin in workflow ([c1cf346](https://github.com/rtorcato/js-tooling/commit/c1cf3464cf12451bbe5f3516a748638d0446a979))
* **test:** bump vitest to 4.1.8 and adapt helper tests ([8f4a700](https://github.com/rtorcato/js-tooling/commit/8f4a7003e8dc120fb8906cc1e326b5447c63369a))


### Features

* add Oxlint and Changesets presets ([#71](https://github.com/rtorcato/js-tooling/issues/71)) ([bf1445f](https://github.com/rtorcato/js-tooling/commit/bf1445f6eaac9ebc59629d7fed3c307ec89d86b6)), closes [#55](https://github.com/rtorcato/js-tooling/issues/55) [#57](https://github.com/rtorcato/js-tooling/issues/57) [#57](https://github.com/rtorcato/js-tooling/issues/57) [#55](https://github.com/rtorcato/js-tooling/issues/55) [60-#70](https://github.com/60-/issues/70) [#59](https://github.com/rtorcato/js-tooling/issues/59)
* **docs:** browser-common-styled landing page ([#53](https://github.com/rtorcato/js-tooling/issues/53)) ([7e38336](https://github.com/rtorcato/js-tooling/commit/7e383360ce5739e3cb5ba1036919a4bb4ace0267))
* **docs:** migrate apps/docs from Astro Starlight to Docusaurus 3 ([#51](https://github.com/rtorcato/js-tooling/issues/51)) ([e6435af](https://github.com/rtorcato/js-tooling/commit/e6435af11d966a615f620feb91bd83502499b8b5)), closes [10b981/#34d399](https://github.com/rtorcato/js-tooling/issues/34d399) [#50](https://github.com/rtorcato/js-tooling/issues/50)
* **fix:** add --diff flag for unified-diff preview before confirm ([#72](https://github.com/rtorcato/js-tooling/issues/72)) ([ace0ccf](https://github.com/rtorcato/js-tooling/commit/ace0ccf11961fed5cd9d990c943dc7736b01b0fe))

## [2.17.1](https://github.com/rtorcato/js-tooling/compare/v2.17.0...v2.17.1) (2026-06-09)


### Bug Fixes

* **docs:** upgrade to Astro 6 and fix Starlight 0.39 sidebar syntax ([78c31b5](https://github.com/rtorcato/js-tooling/commit/78c31b5ba95b86e2a8a65f782d1fe9b3e3cafd16))

# [2.17.0](https://github.com/rtorcato/js-tooling/compare/v2.16.0...v2.17.0) (2026-06-08)


### Features

* add TypeDoc preset, doctor check, and fixer ([40db809](https://github.com/rtorcato/js-tooling/commit/40db809af1cef08b0bfa9aca43101132ec7ab0f4))

# [2.16.0](https://github.com/rtorcato/js-tooling/compare/v2.15.0...v2.16.0) (2026-06-08)


### Features

* are-the-types-wrong doctor check + preset versioning ([1e72bbb](https://github.com/rtorcato/js-tooling/commit/1e72bbb4bdd3f6d12d18a3c9ff3f3c9745fb889f))

# [2.15.0](https://github.com/rtorcato/js-tooling/compare/v2.14.0...v2.15.0) (2026-06-08)


### Features

* add Renovate preset as alternative to Dependabot ([3ed09ea](https://github.com/rtorcato/js-tooling/commit/3ed09eaff169b9228ecff4384625339b6d4c7633))

# [2.14.0](https://github.com/rtorcato/js-tooling/compare/v2.13.0...v2.14.0) (2026-06-08)


### Features

* fix gitlab-ci scaffolds .gitlab-ci.yml ([82e1f3f](https://github.com/rtorcato/js-tooling/commit/82e1f3f35b83a1c2471900e9c3567be0aafa8965))

# [2.13.0](https://github.com/rtorcato/js-tooling/compare/v2.12.0...v2.13.0) (2026-06-08)


### Features

* fix --resync re-scaffolds from .js-tooling.json ([d4b97a5](https://github.com/rtorcato/js-tooling/commit/d4b97a5473dbcd66b3b83b5b29dfbe531eea4b63))

# [2.12.0](https://github.com/rtorcato/js-tooling/compare/v2.11.0...v2.12.0) (2026-06-08)


### Features

* fix --list + CODEOWNERS scaffolder ([e239c58](https://github.com/rtorcato/js-tooling/commit/e239c584ee81d8870d92680fd6a2ee82ff6ed907))

# [2.11.0](https://github.com/rtorcato/js-tooling/compare/v2.10.0...v2.11.0) (2026-06-08)


### Features

* .js-tooling.json lockfile records setup choices ([0d8c6b9](https://github.com/rtorcato/js-tooling/commit/0d8c6b906741bd7a1383516ca73f75772a32bce5))

# [2.10.0](https://github.com/rtorcato/js-tooling/compare/v2.9.0...v2.10.0) (2026-06-08)


### Features

* unified verify script + tree-shake check scaffold ([0ac91a2](https://github.com/rtorcato/js-tooling/commit/0ac91a25ba98302017b995f11a61ac83a951300e)), closes [#42](https://github.com/rtorcato/js-tooling/issues/42) [#42](https://github.com/rtorcato/js-tooling/issues/42) [#43](https://github.com/rtorcato/js-tooling/issues/43)

# [2.9.0](https://github.com/rtorcato/js-tooling/compare/v2.8.1...v2.9.0) (2026-06-06)


### Features

* **tests:** exports-resolution + ssr-safety helpers + style guide ([791da5f](https://github.com/rtorcato/js-tooling/commit/791da5f94f56f3fa1c704ba1ce056f946d252531)), closes [#40](https://github.com/rtorcato/js-tooling/issues/40) [#41](https://github.com/rtorcato/js-tooling/issues/41) [#44](https://github.com/rtorcato/js-tooling/issues/44)

## [2.8.1](https://github.com/rtorcato/js-tooling/compare/v2.8.0...v2.8.1) (2026-06-06)


### Bug Fixes

* **vitest:** drop js-tooling-specific paths from shared preset ([491eb40](https://github.com/rtorcato/js-tooling/commit/491eb40d524fd11ac1dc538ec8c485e259aedfe0))

# [2.8.0](https://github.com/rtorcato/js-tooling/compare/v2.7.0...v2.8.0) (2026-06-03)


### Features

* **size-limit:** add bundle-size budget preset + doctor/fix support ([edb4f8c](https://github.com/rtorcato/js-tooling/commit/edb4f8c9199151069f1f8004797f0be4b08b9af2))

# [2.7.0](https://github.com/rtorcato/js-tooling/compare/v2.6.0...v2.7.0) (2026-05-31)


### Features

* **vitest:** add jsdom-shims preset for Radix/cmdk/embla/Day Picker ([#13](https://github.com/rtorcato/js-tooling/issues/13)) ([af3d94c](https://github.com/rtorcato/js-tooling/commit/af3d94cad8e0ec72a182ada615058900f0506a06))

# [2.6.0](https://github.com/rtorcato/js-tooling/compare/v2.5.1...v2.6.0) (2026-05-28)


### Features

* **cli:** add list --json with exports and fixTarget ([bc27a19](https://github.com/rtorcato/js-tooling/commit/bc27a191a20409f129f2b41daed7a3c994668735))
* **setup:** support non-interactive scaffolding via flags ([78b1738](https://github.com/rtorcato/js-tooling/commit/78b17387331dc801b29c669de9e3520ec030a3e2))

## [2.5.1](https://github.com/rtorcato/js-tooling/compare/v2.5.0...v2.5.1) (2026-05-28)


### Bug Fixes

* **fix:** safe-merge wording for safe fixers ([5cb2fdc](https://github.com/rtorcato/js-tooling/commit/5cb2fdcff9d8cd65b339fc6c55c70e18859a745d))
* **playwright:** ship preset, stop inlining config ([1c09050](https://github.com/rtorcato/js-tooling/commit/1c090507f8e806d7909b0db005a211c1c26b74c0))
* **vite:** ship preset, stop inlining config ([7da4e77](https://github.com/rtorcato/js-tooling/commit/7da4e774a4431177bce0a0210890f46311cb5a96))

# [2.5.0](https://github.com/rtorcato/js-tooling/compare/v2.4.0...v2.5.0) (2026-05-28)


### Features

* **cli:** expand list output + wire fix --json ([9481c3a](https://github.com/rtorcato/js-tooling/commit/9481c3aaea5b712f20b7c4d0526420cea3bcc2c4))
* **fix:** add --json flag for CI / scripting ([a653305](https://github.com/rtorcato/js-tooling/commit/a65330574ad79c2a4b4adad2d2080041df904df4))
* **setup:** suggest fix for skipped tooling ([ddf3b9a](https://github.com/rtorcato/js-tooling/commit/ddf3b9a88bb513da9a93b2949f77330dae2adcd0))

# [2.4.0](https://github.com/rtorcato/js-tooling/compare/v2.3.0...v2.4.0) (2026-05-28)


### Features

* **cli:** add fix command ([35f4b2d](https://github.com/rtorcato/js-tooling/commit/35f4b2d8863306b01659fb959f48de3703d12e0c))
* **doctor:** add Dependabot and CodeQL checks ([6905fea](https://github.com/rtorcato/js-tooling/commit/6905feac48eb847b444fc566bacdbb136d090e31))
* **doctor:** add fix-suggestion footer ([ec6321a](https://github.com/rtorcato/js-tooling/commit/ec6321a1156ef260ed53198e8806d7b9e61a78d1))
* **generators:** add security + misc scaffolders ([3e8f299](https://github.com/rtorcato/js-tooling/commit/3e8f29977e1369ab63bd0e732a5668b5bec40748))

# [2.3.0](https://github.com/rtorcato/js-tooling/compare/v2.2.0...v2.3.0) (2026-05-28)


### Features

* **doctor:** add 9 new project checks ([e6d46c5](https://github.com/rtorcato/js-tooling/commit/e6d46c56e72c0336fe2ba2acad37b33627087503))

# [2.2.0](https://github.com/rtorcato/js-tooling/compare/v2.1.2...v2.2.0) (2026-05-27)


### Features

* **doctor:** add Node version check ([731be36](https://github.com/rtorcato/js-tooling/commit/731be36d8c10e8cde734b58f69fb6ce4a0d25a80))

## [2.1.2](https://github.com/rtorcato/js-tooling/compare/v2.1.1...v2.1.2) (2026-05-27)


### Bug Fixes

* **deps:** trim unused peer dependencies ([c8b3bc8](https://github.com/rtorcato/js-tooling/commit/c8b3bc8eabe4c46896fa94c3a7008354964544de))

## [2.1.1](https://github.com/rtorcato/js-tooling/compare/v2.1.0...v2.1.1) (2026-05-27)


### Bug Fixes

* **deps:** widen esbuild peer range for vite 8 ([f87c88b](https://github.com/rtorcato/js-tooling/commit/f87c88bae2852092aecf65f869e448b386cb276d))
* export vitest/react and vitest/setup, drop phantom biome.jsonc, add missing doc pages ([f7ae710](https://github.com/rtorcato/js-tooling/commit/f7ae71041fd1aaa5715cf99866ba1fa8768eb8ab))

# [2.1.0](https://github.com/rtorcato/js-tooling/compare/v2.0.0...v2.1.0) (2026-05-27)


### Features

* add types condition to preset exports ([1d3c4dd](https://github.com/rtorcato/js-tooling/commit/1d3c4dd8e2929e61dc2e3f9f10a786570f807559))
* **cli:** add doctor subcommand ([a71c63e](https://github.com/rtorcato/js-tooling/commit/a71c63ec1ec668cb85390477ffdb604b7209cb8d))

# [2.0.0](https://github.com/rtorcato/js-tooling/compare/v1.1.0...v2.0.0) (2026-05-27)


* feat!: rewrite deps to peer-deps, fix CI + scripts ([c330ded](https://github.com/rtorcato/js-tooling/commit/c330dedc857da700d7e0b154cbde24e713fb59e6))


### Bug Fixes

* **ci:** pass commit msg via env, rename TODO ([5bc6b96](https://github.com/rtorcato/js-tooling/commit/5bc6b96c1233d21e5c63d26aef808a5c9c109757))


### BREAKING CHANGES

* 39 packages moved from dependencies to
peerDependencies (optional). Consumers relying on transitive
installs of e.g. vitest or @biomejs/biome via this package must
add them to their own devDependencies.

# [1.1.0](https://github.com/rtorcato/js-tooling/compare/v1.0.9...v1.1.0) (2025-10-24)


### Bug Fixes

* correct CLI path resolution for config copying ([08bc2d3](https://github.com/rtorcato/js-tooling/commit/08bc2d36d5e7ed81730562f859a0690b2904f8b3))


### Features

* enforce stricter commit message limits ([f048600](https://github.com/rtorcato/js-tooling/commit/f04860048a9449de86d3684a6ab729e3728377ef))

## [1.0.9](https://github.com/rtorcato/js-tooling/compare/v1.0.8...v1.0.9) (2025-10-24)


### Bug Fixes

* improve skip CI detection regex pattern ([f29294b](https://github.com/rtorcato/js-tooling/commit/f29294bfa7f56d047923c4cecde09746ed4593ad))

## [1.0.8](https://github.com/rtorcato/js-tooling/compare/v1.0.7...v1.0.8) (2025-10-24)


### Bug Fixes

* improve commitlint validation in CI environment ([727fe98](https://github.com/rtorcato/js-tooling/commit/727fe98ccefb1eaba188515ee7de0fabe1530a2b))

## [1.0.7](https://github.com/rtorcato/js-tooling/compare/v1.0.6...v1.0.7) (2025-10-24)


### Bug Fixes

* add npm provenance and optimize workflow structure ([86f0bc4](https://github.com/rtorcato/js-tooling/commit/86f0bc408f472e437049cd1da7b0b8ccce5f8fc9))
* enhance config management and add CLI copy command ([36f973e](https://github.com/rtorcato/js-tooling/commit/36f973e3ef223bf19dcdc447227b0ed24d010b96))

## [1.0.6](https://github.com/rtorcato/js-tooling/compare/v1.0.5...v1.0.6) (2025-10-24)


### Bug Fixes

* prevent Husky setup failure in CI environment ([d40caf0](https://github.com/rtorcato/js-tooling/commit/d40caf01d453349843653b8f50579138131c3e55))

## [1.0.5](https://github.com/rtorcato/js-tooling/compare/v1.0.4...v1.0.5) (2025-10-24)


### Bug Fixes

* republish package after unpublished version conflict ([15b3ad4](https://github.com/rtorcato/js-tooling/commit/15b3ad460db9c49848fbc0c0dd564404f7e1b694))

## [1.0.4](https://github.com/rtorcato/js-tooling/compare/v1.0.3...v1.0.4) (2025-10-24)


### Bug Fixes

* trigger release with updated NPM automation token ([5f99afe](https://github.com/rtorcato/js-tooling/commit/5f99afe0b7b2a52bab947184521063278617c4cd))

## [1.0.3](https://github.com/rtorcato/js-tooling/compare/v1.0.2...v1.0.3) (2025-10-24)


### Bug Fixes

* ensure package publishing works after GitLab migration ([c53937d](https://github.com/rtorcato/js-tooling/commit/c53937d10697e090fd605819a0c74792c9836a60))

## [1.0.2](https://github.com/rtorcato/js-tooling/compare/v1.0.1...v1.0.2) (2025-10-24)


### Bug Fixes

* handle ignored files in fix-bins.sh script ([41b43c9](https://github.com/rtorcato/js-tooling/commit/41b43c90d76d35f8f9c3da71f0ad81a3ab03ecc6))
* remove non-existent dist assets from GitHub release ([d94a16f](https://github.com/rtorcato/js-tooling/commit/d94a16f720157c23c35cc83cc63e2bcf2bba2182))

## [1.0.1](https://github.com/rtorcato/js-tooling/compare/v1.0.0...v1.0.1) (2025-10-24)


### Bug Fixes

* add CLI build step to release workflow ([e10078a](https://github.com/rtorcato/js-tooling/commit/e10078aa9312e36c495ef1b8f6d433400b01576c))

# 1.0.0 (2025-10-24)


### Bug Fixes

* add docker semantic release ([61238ac](https://github.com/rtorcato/js-tooling/commit/61238ac79d99497200f183b1cc1b54714c7d4f7d))
* apply Biome formatting and disable problematic linting rules ([7d6914c](https://github.com/rtorcato/js-tooling/commit/7d6914cde952ae2fbe8e66680e1023bf234c5c74))
* for changelog release ([efb176d](https://github.com/rtorcato/js-tooling/commit/efb176dc2e2a2c94cf25b6ddcdff95f4bd97b274))
* initial release ([22fa31f](https://github.com/rtorcato/js-tooling/commit/22fa31fcff83bb0b5e33b1bb1e57e72a8d295932))
* initial release ([20588c9](https://github.com/rtorcato/js-tooling/commit/20588c91e9a94bac14c40d1c8b7b80b3e56d0875))
* initial release ([2fe80a7](https://github.com/rtorcato/js-tooling/commit/2fe80a745942f6e1d3043cfca1e960a97bf1cf8a))
* initial release ([6937aef](https://github.com/rtorcato/js-tooling/commit/6937aefa0a958ce01a47a609f250e45b2ebd339b))
* initial release ([3e00412](https://github.com/rtorcato/js-tooling/commit/3e00412c6b3524dafae96ab142d3941a43e23697))
* initial release ([61b61c1](https://github.com/rtorcato/js-tooling/commit/61b61c173d224ba096dff0616caa8826d79b537c))
* new release ([16aa21d](https://github.com/rtorcato/js-tooling/commit/16aa21d56ea97a09876dcb2cb60c6cac0229e578))
* new release ([767cb65](https://github.com/rtorcato/js-tooling/commit/767cb65cd15c0aa39bd395d4d17e4cd6b5aef8bb))
* new release ([ca8ac5a](https://github.com/rtorcato/js-tooling/commit/ca8ac5a35cd9f39791544cbd0ec23639f51907ad))
* ts base update ([c309126](https://github.com/rtorcato/js-tooling/commit/c30912693e017c57e0f000b8f7e9542d356d3010))
* update Node.js version to 22 for semantic-release compatibility ([b5ab497](https://github.com/rtorcato/js-tooling/commit/b5ab497f988d369e7ed0adb015c08cd41f36fe51))
* update ts ([728e386](https://github.com/rtorcato/js-tooling/commit/728e386479d9ba43298f333ce631dcfe6db02497))
* update ts base config ([2943996](https://github.com/rtorcato/js-tooling/commit/2943996fc322cd903ccfd8912550cbed8c880edf))
* vitest resolve ([78cd367](https://github.com/rtorcato/js-tooling/commit/78cd36779cbc74b024adc0738036ce99795ebf5a))


### Features

* add CLI with project setup wizard and migrate to GitHub ([73b81bc](https://github.com/rtorcato/js-tooling/commit/73b81bc44e435ace0e35b4732124d00e082fd20b))

---

*Changelog entries prior to v1.0.0 have been removed as part of the migration from GitLab to GitHub.*
