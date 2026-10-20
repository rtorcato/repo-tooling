/**
 * The Swift .gitignore block, shared by the `swift-gitignore` fixer and the
 * scaffolder. Its own module so `scaffold.ts` doesn't have to import from
 * `fixers.ts` — that edge closed an import cycle once `fixers.ts` started
 * reading the lockfile (lockfile → setup-presets → scaffold → fixers → lockfile).
 */
import path from 'node:path'
import fs from '../../base/safe-fs.js'

/**
 * The Swift build artefacts that must stay out of git. Appended to an existing
 * .gitignore rather than replacing it — a Swift repo's ignore file usually
 * carries project-specific entries worth keeping.
 */
const SWIFT_GITIGNORE_BLOCK = `# Swift / SwiftPM
.DS_Store
/.build
/Packages
/*.xcodeproj
xcuserdata/
DerivedData/
.swiftpm/config/registries.json
.swiftpm/xcode/package.xcworkspace/contents.xcworkspacedata
.netrc
`

/** Entries whose presence means the block (or an equivalent) is already there. */
const SENTINELS = ['.build', 'DerivedData', 'xcuserdata']

export async function ensureSwiftGitignore(targetDir: string): Promise<string[]> {
	const filepath = path.join(targetDir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		await fs.writeFile(filepath, SWIFT_GITIGNORE_BLOCK)
		return ['.gitignore']
	}

	const existing = await fs.readFile(filepath, 'utf-8')
	const missing = SENTINELS.filter((entry) => !existing.includes(entry))
	if (missing.length === 0) return []

	// Append only what's absent, so a repo that already ignores .build doesn't
	// get a duplicate entry for it.
	const additions = SWIFT_GITIGNORE_BLOCK.split('\n').filter(
		(line) => line.length > 0 && !existing.includes(line)
	)
	const separator = existing.endsWith('\n') ? '' : '\n'
	await fs.writeFile(filepath, `${existing}${separator}\n${additions.join('\n')}\n`)
	return ['.gitignore']
}
