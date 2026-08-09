/**
 * How this module enumerates a distribution's Perl source files.
 *
 * One definition, because the pre-commit hook and both CI lint jobs have to
 * cover the *same* set: if they drift, a commit passes the hook and then fails
 * CI over a file one of them never looked at.
 *
 * Rather than `lib t`, which assumes the standard CPAN layout — plenty of
 * distributions keep scripts in `bin/` or `script/`, and a repo with no `lib/`
 * would make perlcritic exit non-zero for a missing path rather than a real
 * violation.
 *
 * The caller appends the action, always as `-exec … +` and never a pipe into
 * xargs. With no matches `-exec … +` runs nothing at all, while *GNU* xargs —
 * which is what the Linux CI runners have — runs the command once with no
 * arguments unless given `-r`. perltidy with no file arguments reads stdin, so
 * that lands as a lint job hanging until the job timeout with no output.
 * (BSD/macOS xargs already declines to run on empty input, which is exactly
 * how the bug would survive local testing and only show up in CI.) `-exec … +`
 * is POSIX and behaves the same everywhere, with no flag to remember.
 */
export const FIND_PERL_SOURCES = `find . \\( -name blib -o -name local -o -name _build -o -name .git \\) -prune -o -type f \\( -name '*.pm' -o -name '*.pl' -o -name '*.t' \\)`
