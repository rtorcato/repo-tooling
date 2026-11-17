---
"@rtorcato/repo-tooling": patch
---

`fix <target>` and `fix --resync` now exit 1 with `<target> needs confirmation: re-run with --yes (no TTY to prompt)` when there is no TTY and no `--yes`, instead of printing `skipped` and exiting 0, which read as "nothing to do". A bare `fix` still skips fixers it cannot confirm.
