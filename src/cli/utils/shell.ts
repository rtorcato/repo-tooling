/**
 * Quote a value as one literal argument **for a POSIX `sh` command line, and
 * nothing else**. The result is wrong in `cmd.exe` and PowerShell, which do not
 * treat `'` as a quote, and wrong anywhere the value lands inside double quotes
 * or an existing quoted string — it is a whole argument, not a fragment.
 *
 * POSIX single-quote escaping — the only form correct for arbitrary bytes.
 * Inside single quotes every character is literal, so `'` is the sole one
 * needing care: end the quote, escape it, start a new one. Double quotes are
 * not a substitute; `$(...)`, backticks and `\` all still expand inside them.
 *
 * One escaper for every generator that emits a copy-pasteable command line
 * (#498) — two independently-built ones drift, which is the argument #492 made
 * for a single `skillDiffCommand`.
 */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}
