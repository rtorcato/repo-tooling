// 'declared': the finding is real but the repo's lockfile records it as a
// deliberate deviation with a reason (#558). Shown, never hidden — and never
// counted toward the failing exit code.
// 'skipped': the check was not run — today only `doctor --offline` skipping a
// check that reads live GitHub state (#755). Never a finding.
export type CheckStatus = 'ok' | 'drift' | 'missing' | 'optional-missing' | 'declared' | 'skipped'

export interface CheckResult {
	check: string
	status: CheckStatus
	detail: string
	hint?: string
}
