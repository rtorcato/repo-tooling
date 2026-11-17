---
'@rtorcato/repo-tooling': minor
---

`doctor` now names who it ran as and lists the checks that could not run (for example for lack of admin access), adds `ranAs` and `skipped[]` to `--json`, and gains `--strict` to exit non-zero when any check was skipped.
