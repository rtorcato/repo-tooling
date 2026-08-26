// 'declared': the finding is real but the repo's lockfile records it as a
// deliberate deviation with a reason (#558). Shown, never hidden — and never
// counted toward the failing exit code.
export type CheckStatus = 'ok' | 'drift' | 'missing' | 'optional-missing' | 'declared'

export interface CheckResult {
	check: string
	status: CheckStatus
	detail: string
	hint?: string
}
