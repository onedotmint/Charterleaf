# Charterleaf

A tiny specification layer for coding agents.

Durable project intent, deterministic routing, and structural linting —
without workflow orchestration.

> **Keep project intent in the repo, without turning specs into a workflow.**

Charterleaf keeps durable project knowledge in Markdown and provides exactly three deterministic helpers:

```bash
charterleaf map
charterleaf related <path>
charterleaf lint
```

It is a knowledge layer, not a workflow framework.

## Install

Install the public scoped npm package:

```bash
npm install -g @onedotmint/charterleaf
```

Pi can install the same package and discover its bundled Agent Skill:

```bash
pi install npm:@onedotmint/charterleaf
```

No Pi extension or Pi runtime dependency is used.

## CLI

Run from a repository root containing `specs/`:

```bash
charterleaf map
charterleaf related src/auth/session.ts
charterleaf lint
```

`map` shows a deterministic, lightweight index of the `specs/` layer when a relevant code path is not yet known. It lists specification scopes and metadata only; it does not summarize specs or recommend what to read. Use normal code navigation to find the smallest relevant area, then use `related <path>`.

`related <path>` performs deterministic path routing. It matches `applies_to` with `*` and `**`, normalizes repo-relative paths to POSIX form, then appends active changes whose `affects` reference a matched Spec ID. Output is stable; no match is success. It is not semantic search.

`lint` performs mechanical checks only: frontmatter shape, living Spec IDs, duplicate requirement IDs, change references, static `ADD` / `MODIFY` / `REMOVE` references, and conflicting active changes that touch the same requirement ID. It does not judge wording, architecture quality, or semantic code/spec drift.

The frontmatter convention intentionally supports only top-level scalar values and simple string lists. Runtime dependencies remain zero.

## Project knowledge

```text
specs/
├── constitution.md
├── capabilities/
├── engineering/
├── decisions/
└── changes/
```

- `constitution.md` — rare project-wide guardrails.
- `capabilities/` — durable behavior, contracts, invariants, non-goals.
- `engineering/` — durable implementation constraints and, when useful, concrete pitfalls.
- `decisions/` — why an important architectural choice exists.
- `changes/` — a lightweight active delta for an intentional durable change.

Authority is structural, not scored metadata:

```text
Constitution > Active Change > Living Spec > Current Code
```

Keep specs compressed and evidence-based. Prefer contracts over commentary and record durable pitfalls that code alone does not reveal. Do not invent aspirational standards merely to make a spec look complete.

For bug fixes with durable behavioral implications, clarify `Current`, `Expected`, and `PRESERVE` when that reduces accidental scope. Do not create a spec for trivial fixes with no durable implication.

After non-trivial implementation or debugging, record only genuinely durable knowledge: behavior, contracts, invariants, and non-goals in capabilities; long-lived constraints, boundaries, pitfalls, or verification practices in engineering; and important architectural choices in decisions. If nothing durable was learned, do not modify specs. Specs accumulate durable project knowledge, not development activity.

Load the smallest relevant set; do not read the whole tree by default. After an accepted change is implemented, merge the durable result into living specs and delete the change file. Git is the history.

## Other agents

Charterleaf core does not depend on Pi. Any coding agent capable of reading Markdown and executing shell commands can use it.

Use `AGENTS_SNIPPET.md` with agents that support project instructions. Agent Skills-compatible harnesses can use the bundled `skills/charterleaf/SKILL.md`.

## Boundaries

Charterleaf has no:

- planning
- task management
- agent orchestration
- implementation or review workflow
- session memory or context compression
- semantic search or embeddings
- code/spec semantic verification
- database, index, or cache
- daemon or background watcher
- plugin/extension runtime
- Git/history abstraction

The three CLI commands are helpers, not workflow gates.

## Development

Requires Node.js 20 or newer. There are no runtime or development dependencies and no build step.

```bash
npm test
npm pack --dry-run
```

## License

MIT
