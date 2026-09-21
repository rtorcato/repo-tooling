/**
 * JSONC → object, or null when it genuinely won't parse. Biome and friends
 * accept comments and trailing commas, so a bare `JSON.parse` would reject
 * configs the tools themselves read fine.
 *
 * The first alternative consumes whole string literals, so a `//` or a comment
 * opener inside one (a `$schema` URL, most obviously) is never mistaken for a
 * comment.
 */
export function parseJsonc(text: string): Record<string, any> | null {
	const withoutComments = text.replace(
		/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		(_, str: string | undefined) => str ?? ''
	)
	try {
		return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1')) as Record<string, any>
	} catch {
		return null
	}
}
