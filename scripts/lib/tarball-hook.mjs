import fs from 'node:fs'
import path from 'node:path'

/**
 * A scaffold pins `@rtorcato/repo-tooling` to the running version, which in a
 * checkout is the stale package.json one (see src/cli/utils/version.ts), so a
 * real install would pull an old release from npm. This writes a pnpmfile whose
 * `readPackage` hook points that one dependency at `tarball` instead (#829).
 *
 * Pass the returned env to `setup` and its own install tests this branch, while
 * the scaffold on disk stays exactly what a user gets — no repointing by hand.
 * `pnpm_config_*` is how pnpm 11 reads it from the env; `npm_config_*` is the
 * older spelling.
 */
export function tarballHookEnv(dir, tarball) {
	const hook = path.join(dir, 'pnpmfile.cjs')
	fs.writeFileSync(
		hook,
		`const TARBALL = ${JSON.stringify(`file:${tarball}`)}
module.exports = {
	hooks: {
		readPackage(pkg) {
			for (const deps of [pkg.dependencies, pkg.devDependencies]) {
				if (deps && deps['@rtorcato/repo-tooling']) deps['@rtorcato/repo-tooling'] = TARBALL
			}
			return pkg
		},
	},
}
`
	)
	return { pnpm_config_global_pnpmfile: hook, npm_config_global_pnpmfile: hook }
}
