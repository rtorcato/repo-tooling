// Its own module so safe-fs.ts can throw it without importing fixers.ts,
// whose import cycle with the generators breaks load order (#908).
/**
 * A fixer giving up on something the user has to resolve — a wrong flag, not a
 * crash. Thrown rather than printed-and-exited because a fixer runs underneath
 * `--json`: only the command layer knows whether the failure should surface as
 * an error payload on stdout or a red line on stderr. `code` joins the same
 * vocabulary as the command's own `no-lockfile` / `unknown-target` errors.
 */
export class FixerAbort extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly hint?: string
	) {
		super(message)
		this.name = 'FixerAbort'
	}
}
