import path from 'node:path'
import fs from 'fs-extra'
import { getFixers } from './commands/fix.js'

export async function isSelfRepo(dir: string): Promise<boolean> {
	try {
		const pkg = await fs.readJson(path.join(dir, 'package.json'))
		return pkg.name === '@rtorcato/repo-tooling'
	} catch {
		return false
	}
}

/**
 * Why `setup` / `doctor` / `fix` must not run in `dir`, or null when it may.
 * Most fixers write configs that import `@rtorcato/repo-tooling/...`, which
 * this repo can't depend on, so inside it everything is refused unless
 * `REPO_TOOLING_ALLOW_SELF=1` is set. With the flag, read-only `doctor` (#273)
 * and `fix <target>` for a `selfSafe` target (#673) get through. A bare `fix`
 * stays refused even then: it walks every fixer, self-safe or not.
 */
export async function selfRepoRefusal(
	command: string,
	target: string | undefined,
	opts: { directory?: string; list?: boolean },
	env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
	if (command !== 'setup' && command !== 'doctor' && command !== 'fix') return null
	// `fix --list` is read-only and safe to run anywhere, including this repo.
	if (command === 'fix' && opts.list) return null
	if (!(await isSelfRepo(opts.directory ?? process.cwd()))) return null
	const allowSelf = env.REPO_TOOLING_ALLOW_SELF === '1'
	if (allowSelf && command === 'doctor') return null
	if (allowSelf && command === 'fix') {
		if (!target) {
			const safe = getFixers()
				.filter((f) => f.selfSafe)
				.map((f) => f.target)
			return `a bare \`fix\` runs every fixer, including ones whose output imports @rtorcato/repo-tooling — name a self-safe target instead: ${safe.join(', ')}.`
		}
		const fixer = getFixers().find((f) => f.target.toLowerCase() === target.toLowerCase())
		if (fixer?.selfSafe) return null
		return fixer
			? `\`fix ${target}\` is not self-safe: its output imports or depends on @rtorcato/repo-tooling, which this repo cannot depend on.`
			: `\`fix ${target}\` is not a known self-safe target.`
	}
	return 'setup and doctor are for consumer projects, not for the tooling repo.'
}
