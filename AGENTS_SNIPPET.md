# Charterleaf instructions

Project specifications live under `specs/`. For non-trivial architectural, behavioral, or cross-cutting changes, find the smallest relevant set; never read the whole tree by default.

- `specs/capabilities/` — durable behavior, contracts, invariants, non-goals.
- `specs/engineering/` — durable implementation constraints and concrete recurring pitfalls.
- `specs/decisions/` — important architectural choices and revisit conditions.
- `specs/changes/` — lightweight active deltas.
- `specs/constitution.md` — project-wide guardrails only.

When a concrete code path is known, use `charterleaf related <path>` to locate matching living specs plus active changes that affect them. Otherwise use normal code/text search. Use `charterleaf lint` for structural validation and mechanical active-change conflicts. These commands are helpers, not workflow gates.

Authority is `Constitution > Active Change > Living Spec > Current Code`. Do not add authority scores or silently rewrite specs to match code.

Keep specs compressed and evidence-based. Prefer durable contracts and pitfalls over commentary. Do not invent aspirational standards that are not demonstrated by the repo or explicitly accepted.

Do not create specs for temporary implementation details, current tasks, debugging notes, routine refactors, or trivial fixes with no durable implication. For a durable bug fix, use `Current` / `Expected` when useful and explicitly state what must `PRESERVE`.

For meaningful durable behavior/contract changes, use one change file with only the needed `ADD`, `MODIFY`, `REMOVE`, and/or `PRESERVE` sections. After acceptance and implementation, merge durable results into living specs and delete the change file. Git is the history.

Charterleaf is a knowledge layer, not a workflow layer. It must not manage tasks, planning, agents, execution, review, memory, compression, semantic search, code/spec verification, release lifecycle, or Git history.
