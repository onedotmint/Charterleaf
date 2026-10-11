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
not a filesystem security sandbox. Modes govern spec maintenance, not code:
normal implementation edits MUST remain allowed in Auto, Confirm and Reference,
unless the user explicitly limits the task to read-only.

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
The Extension MAY request at most one final semantic review per user run, only
at a successful actionable settlement boundary. Actual development remains a
fallback signal; an evidenced unresolved candidate identified by the existing
Agent MUST also be eligible without file changes or prior specs. Reads, file
counts, simple queries and chat MUST NOT alone manufacture semantic discovery.
Observed successful capture or explicit `covered`/`proposed` lifecycle conclusions
MUST suppress redundant review unless later candidates or actual changes rearm it;
never exceed the once-only limit. Natural-language conclusions without a recognized
signal do not guarantee suppression: the bounded fallback may repeat that judgment.
In an empty-spec project, a `no-value` conclusion after owned code edits MAY retain
the ordinary development fallback once, because the semantic conclusion itself may
have missed a documentation/discoverability gap.
A review is not an obligation to write a spec.

### PI-005 — Conflicts preserve authority
Code/spec disagreement MUST NOT automatically redefine the spec. Distinguish
implementation error, authoritative obsolescence and intended contract change.
When uncertain, preserve the existing spec and report the conflict. Auto does
not authorize silently relaxing a contract. Current implementation behavior
alone MUST NOT be treated as an accepted correct contract.

### PI-006 — Conservative ownership
A dirty worktree is not proof of Agent ownership. Snapshot changes are candidates;
standard successful tool observations identify touched files, not every line.
Existing user work and parallel modifications MUST be preserved. Unattributed
changes alone MUST NOT justify spec maintenance. Failed writes MUST NOT be
credited as successful edits. Never automatically commit, push or revert.

### PI-007 — Organic knowledge quality
The Agent MUST consider both newly established and newly discovered durable
knowledge during normal development, debugging, investigation and accepted
technical decisions, without requiring code changes, an existing spec or a
bootstrap scan. Maintenance requires reliable evidence, future mistake-prevention
value and a documentation/discoverability gap. Executable tests can establish
evidence but do not alone prove effective code-path discovery. A completion signal
MUST mean knowledge judgment is complete, not merely that code/tests are finished.
Prefer a brief routed reference to
an existing authoritative owner over duplicating it. New living specs MUST have
unique IDs and useful narrow scopes so later tasks can discover them.
Do not store progress, code summaries, temporary logs, plans/todos, unverified
behavior or rules invented to increase document count. Auto may maintain directly,
Confirm still requires exact-operation approval, Reference only proposes, and
explicit no-file-write/read-only restrictions MUST be respected in every mode.
Semantic selection belongs to the existing Agent; Core routes/lints structure
and the Extension observes lifecycle intent, authorization and bounded fallback.

## Invariants

- `applies_to` remains the primary route; existing spec files need no migration.
- Structural lint does not verify code/spec semantics or Agent compliance.
- No daemon, watcher, database, AST/code graph, orchestration or independent AI service.
- Bash and opaque writers cannot be fully intercepted; report detection limits
  instead of promising universal enforcement or silently rolling back changes.
