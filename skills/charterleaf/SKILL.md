---
name: charterleaf
description: A tiny specification layer for durable project intent and constraints.
---

# Charterleaf

Treat Charterleaf as a small knowledge layer, not a workflow system.

When a concrete code path is known, run:

```bash
charterleaf related <path>
```

Read only the returned living specs and active changes. If the location is unknown, use the host agent's normal search tools; Charterleaf does not provide semantic search.

Use authority in this order:

```text
Constitution > Active Change > Living Spec > Current Code
```

Keep specs compressed and evidence-based. Prefer contracts over commentary and durable pitfalls over patterns obvious from code. Never invent aspirational standards; record only demonstrated or explicitly accepted intent.

Do not touch specs for renames, lint cleanup, routine refactors, temporary debugging, Todo/status changes, or trivial fixes with no durable implication.

For a durable bug fix, use `Current` and `Expected` when useful and state what must `PRESERVE`. For other durable behavior/contract changes, keep one `specs/changes/<name>.md` delta with only needed `ADD`, `MODIFY`, `REMOVE`, and/or `PRESERVE` sections.

After editing specs, run:

```bash
charterleaf lint
```

`lint` checks structural conventions and deterministic active-change conflicts only. It does not judge writing, architecture quality, or semantic code/spec drift.

After an accepted change is implemented, merge the durable result into living specs and delete the change file. Git keeps history.

Do not plan, manage tasks, invoke agents, run implementation/review workflows, manage memory, or replace the host agent's code-navigation tools.
