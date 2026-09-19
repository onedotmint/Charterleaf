---
id: charterleaf.cli
applies_to:
  - bin/**
  - lib/**
  - tests/**
  - skills/**
---

# Charterleaf CLI contract

## Purpose

Charterleaf exposes exactly two deterministic commands over a repository's
`specs/` layer: `related <path>` and `lint`. There is no `map` command and no
project state, workflow, memory, or scope-management capability.

## Requirements

### CLI-001 — Command surface
The CLI MUST expose only `related <path>` and `lint`, plus `--help`. Any
other command MUST fail as an unknown command with a usage error.

### CLI-002 — Global constraints
`related` MUST return `specs/constitution.md` as a Global constraint whenever
that file exists, regardless of frontmatter, `id`, or `applies_to`.

### CLI-003 — Scoped routing
`related` MUST route only living specs (`capabilities/`, `engineering/`) whose
`applies_to` glob matches the supplied path, and MUST append active changes
whose `affects` reference a matched spec id.

### CLI-004 — Honest scoped miss
When no living spec matches, `related` MUST state
`No applies_to glob matched this path.` and MUST list available living specs
by `id`, path, and `applies_to` only. It MUST NOT print spec bodies, rank
relevance, or imply that no constraints apply.

### CLI-005 — Structural lint output
`lint` MUST report mechanical structural errors only and MUST label its
summary line as `N structural errors`. A change file MUST contain at least
one non-empty `ADD`, `MODIFY`, or `REMOVE` section, where HTML comments do
not count as content; `PRESERVE` alone is a structural error.

## Invariants

- `applies_to` is a deterministic routing hint, not proof of coverage.
- `related` never inspects the filesystem for the supplied path.
- `lint` never verifies semantic correctness or code/spec agreement.

## Non-goals

- current project state, tasks, workflow, planning, memory, history
- scope registries, owner registries, or project bootstrap commands
- repository coverage analysis, semantic search, code/spec verification
