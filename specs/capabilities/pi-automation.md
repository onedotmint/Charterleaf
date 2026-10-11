---
id: charterleaf.pi-automation
applies_to:
  - extensions/**
  - lib/project.js
  - skills/**
  - tests/extension.test.js
---

# Pi automation boundaries

## Purpose

Connect ordinary development to durable constraints without a task system or
persistent code index. The standalone Core/CLI remains usable without Pi.

## Requirements

### PI-001 — Explicit project adoption
Automation MUST require an explicit saved project mode. Existing `specs/` alone
MUST NOT enable it. Disabled/unconfigured projects receive no automatic task
context, dialogs or document writes. `/charterleaf` uses native Pi selection,
saves immediately, and disabling preserves existing documents.

### PI-002 — Mode authority
Auto permits justified durable maintenance, Confirm requires approval for each
standard spec mutation, and Reference blocks standard spec mutations. Confirm
without UI MUST deny the mutation. Repeated identical refused proposals MUST NOT
reopen approval within the same user run. The Agent MUST NOT change activation config
or evade checks with a different writer. These guards are cooperative behavior,
not a filesystem security sandbox.

### PI-003 — Progressive constraints
Unknown work paths MUST NOT trigger whole-directory context loading. Known
standard read paths receive routed constraints; standard code mutations with
unseen constraints MUST be blocked until the model has had a chance to see them.
Parallel sibling results do not count as already seen. Context is bounded;
oversized specs require explicit reading, not silent truncation as full knowledge.
Same-version bodies MAY be reused across tasks only while their delivery remains
in retained branch context; compaction or branch changes invalidate that credit.
Full authoring/CLI guidance MUST remain on demand, not fixed task context.

### PI-004 — Single final judgment
After actual development the Extension MAY request at most one final semantic
review per user run, only at a successful actionable settlement boundary. A
review is not an obligation to write a spec. Only established, non-obvious,
mistake-preventing durable knowledge belongs in Specs, not code summaries,
tasks, progress, debugging or speculative plans.

### PI-005 — Conflicts preserve authority
Code/spec disagreement MUST NOT automatically redefine the spec. Distinguish
implementation error, authoritative obsolescence and intended contract change.
When uncertain, preserve the existing spec and report the conflict. Auto does
not authorize silently relaxing a contract.

### PI-006 — Conservative ownership
A dirty worktree is not proof of Agent ownership. Snapshot changes are candidates;
standard successful tool observations identify touched files, not every line.
Existing user work and parallel modifications MUST be preserved. Unattributed
changes alone MUST NOT justify spec maintenance. Failed writes MUST NOT be
credited as successful edits. Never automatically commit, push or revert.

## Invariants

- `applies_to` remains the primary route; existing spec files need no migration.
- Structural lint does not verify code/spec semantics or Agent compliance.
- No daemon, watcher, database, AST/code graph, orchestration or independent AI service.
- Bash and opaque writers cannot be fully intercepted; report detection limits
  instead of promising universal enforcement or silently rolling back changes.
