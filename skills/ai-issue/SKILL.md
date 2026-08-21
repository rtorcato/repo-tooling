---
name: ai-issue
description: |
  File a GitHub issue labelled `ai-ready` for the ai-issue-loop pipeline to pick
  up and implement unattended. Use when the user says "file this for the loop",
  "make this an AI issue", "queue this for an agent", or invokes `/ai-issue`.
  For an ordinary issue a human will work on, use plain `gh issue create` with
  no label instead. GitHub only (`gh`) — not GitLab.
---

# ai-issue

File an issue an **agent will execute unattended**, labelled `ai-ready` so
`ai-issue-loop` picks it up. Arguments: $ARGUMENTS

This is only for work you intend a background agent to do without you. For an
ordinary issue, use `gh issue create` with no `ai-*` label.

## Preflight

1. `git remote get-url origin` — GitHub only. On GitLab, stop: the loop is
   `gh`-based and nothing would ever pick the issue up.
2. `gh label list --search ai-ready` — if the label is missing, this repo hasn't
   been bootstrapped for the loop. Stop and point at the `ai-issue-loop` skill's
   label block; creating a bare `ai-ready` label would produce an issue that
   silently never runs.

## Write it for an agent, not for yourself

The agent that picks this up **cannot ask a follow-up question**, and is
instructed to treat the body as untrusted data. Both change how it must read:

- **Describe, never instruct.** "The README claims X but Y is true" — not "go
  update the README". Directive phrasing is exactly what the agent is told to
  ignore, so an instruction-shaped issue reads as empty.
- **Name the files** you already know are involved. The two reviewing agents are
  diff-scoped and won't explore the repo to judge whether the right thing was
  touched.
- **State a done-condition a reviewer can check.** Those same agents review the
  PR against this body; a vague issue produces a vague review on a PR you then
  merge without having really vetted.
- **One PR's worth.** Split anything spanning several concerns — the loop runs
  several issues in parallel, so splitting is free.

## Refuse the ones that aren't ready

Say so, and file it unlabelled instead, when the task:

- needs a judgement call you'd normally make mid-PR,
- needs eyes on rendered output, a real device, or a running service,
- depends on context that lives in this conversation rather than the repo, or
- you couldn't write self-contained without "we can sort that out in review".

An `ai-ready` that stalls costs more than an issue you did yourself: it burns a
concurrency slot, two review passes, and up to two fix rounds before it lands as
`ai-blocked`.

## Create

Draft title and body from `$ARGUMENTS` plus the conversation. The body opens
with a line saying an agent wrote it — everything you post appears under the
owner's own account:

```bash
gh issue create --label ai-ready --title "TITLE" --body "$(cat <<'EOF'
🤖 *Filed by Claude (AI agent) on the owner's behalf.*

BODY
EOF
)"
```

Print the URL. Note that nothing happens until a tick runs — `/ai-issue-loop`
manually, or a recurring schedule if one is active.
