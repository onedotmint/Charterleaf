---
name: charterleaf
description: Discover and maintain durable project constraints when Charterleaf is explicitly enabled or requested.
disable-model-invocation: true
---

# Charterleaf authoring guide

The essential rules live in [runtime.md](runtime.md); read it only if not already supplied. The Pi Extension supplies those rules automatically only when the project is enabled via `/charterleaf`; it does not preload this guide. Outside Pi, use the CLI only when explicitly requested. Existing `specs/` alone does not enable automation; do not initialize documents or recommend adoption automatically.

Read this guide only for unfamiliar spec formats, staged changes or manual CLI use. Ordinary code edits need no Skill read or CLI call when applicable constraints have already been supplied.

## Ownership and durable writing

Source owns implementation; tests own executable verification; `AGENTS.md` owns project entry/navigation; specs own durable constraints. Never copy signatures, inventories, current state or existing documentation into specs. Link the authoritative owner instead. Charterleaf is not task management, planning, memory, evidence, history or a project workflow.

Place only established, non-obvious knowledge whose absence could cause a future mistake:

- `specs/constitution.md`: rare project-wide boundaries;
- `specs/capabilities/`: observable contracts, invariants and non-goals;
- `specs/engineering/`: long-lived implementation boundaries, recurring pitfalls and verification constraints;
- `specs/decisions/`: accepted rationale and revisit conditions.

Living capability/engineering specs need a unique `id` and non-empty `applies_to` list. Keep scope narrow, preserve existing formats and requirement IDs, and verify explicit local references normally. `anchors` and `verified_by` are not required. Do not create speculative standards or code summaries to satisfy a final review.

## Optional staged changes

Use `specs/changes/<name>.md` only when an accepted future contract must coexist with current truth: review, another session or an ongoing migration. Supply valid `affects` spec IDs and at least one non-empty `ADD`, `MODIFY` or `REMOVE` section; `PRESERVE` alone is not a change. Once implemented and verified, merge durable truth into living specs and remove obsolete staging. Git keeps history; never commit automatically.

## CLI details

Run from the project root:

- `charterleaf related <path>` returns constitution as Global, capability/engineering specs matching `applies_to`, and active changes affecting returned spec IDs. It returns paths/metadata, not bodies. Decisions and explicit references are followed manually when relevant. A scoped miss is not proof that no constraints apply.
- `charterleaf lint` checks frontmatter, IDs/globs, duplicate IDs, change references/deltas and conflicting active changes. `0 structural errors` does not prove semantic correctness, coverage or code/spec agreement. The Extension also lints standard spec writes.

If the CLI is not on PATH, use `node <skill-directory>/../../bin/charterleaf.js related <path>` or `lint`; the Extension supplies the absolute entry point. Report failed writing or validation accurately, and never relax a contract merely to remove an error.
