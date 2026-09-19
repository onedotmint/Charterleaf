# Charterleaf

A tiny specification layer for coding agents.

Given a concrete repository path, Charterleaf answers one question:

> Which durable constraints should I read before touching this code?

Durable project intent, deterministic routing, and structural linting —
without workflow orchestration.

## Two layers

Charterleaf sits beside a project's own navigation, not on top of it.

- **A project reference protocol** — a tracked `AGENTS.md` entry plus
  the project's own documents — tells an agent *where* authoritative
  information lives: current state, validation, resources, history,
  source roots.
- **Charterleaf** tells an agent *which durable constraints* matter when
  work lands on a specific repository path.

Charterleaf complements project navigation; it does not replace
project-owned sources of state, evidence, or workflow. It stores and
routes durable constraints; it never becomes the owner of a fact that
belongs to a project file.

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

Charterleaf exposes exactly two deterministic commands. Run them from a
repository root containing `specs/`:

```bash
charterleaf related <path>
charterleaf lint
```

There is no `map` command. Discovery is handled by a scoped miss (below)
and by the project's own reference protocol.

### related \<path\>

Routes the supplied repo-relative path (`/` or `\` separators) to durable
constraints:

- `specs/constitution.md` is **Global**: returned whenever it exists,
  regardless of frontmatter. It needs no `id` and no `applies_to`.
- `capabilities/` and `engineering/` specs are **Scoped**: returned when
  any `applies_to` glob matches.
- Active changes whose `affects` reference a matched spec id are appended
  under `Active changes`.

```text
Global
  specs/constitution.md

Scoped
  specs/capabilities/auth.md
```

`applies_to` is a deterministic routing hint, not a completeness proof.
"No match" only ever means "no living spec's `applies_to` glob matched
this path" — never "no constraints apply". When nothing matches, the
command states that explicitly and lists available living specs by `id`,
path, and `applies_to` only, so discovery stays possible without reading
every spec:

```text
Global
  specs/constitution.md

Scoped
  No applies_to glob matched this path.

Available living specs
  auth.session
    specs/capabilities/auth.md
    applies_to: src/auth/**

  engineering.backend
    specs/engineering/backend.md
    applies_to: src/**/*.ts
```

`related` never inspects the filesystem for the supplied path; it accepts
the caller's repo-relative string. A scoped miss is success (exit code
0), not an error.

### lint

```bash
charterleaf lint
```

`lint` performs mechanical structural checks only: frontmatter shape,
living Spec IDs, required `applies_to` on living specs, duplicate spec
and requirement IDs, change references, static `ADD` / `MODIFY` /
`REMOVE` references, changes whose `ADD` / `MODIFY` / `REMOVE` sections
are all empty (HTML comments do not count), and conflicting active
changes that touch the same requirement ID. Success prints
`0 structural errors`.

`lint` does **not** verify:

- semantic correctness;
- code/spec agreement;
- routing coverage;
- project compliance;
- whether a change is actually complete;
- whether an Agent read the specs.

## Project knowledge

```text
specs/
├── constitution.md
├── capabilities/
├── engineering/
├── decisions/
└── changes/
```

- `constitution.md` — rare project-wide durable boundaries. Global
  constraint; not routed by `applies_to`.
- `capabilities/` — durable observable behavior, contracts, invariants,
  non-goals.
- `engineering/` — durable implementation boundaries, long-lived
  constraints, recurring pitfalls, verification practice.
- `decisions/` — important architectural rationale and revisit
  conditions.
- `changes/` — optional staging for an accepted but not-yet-implemented
  contract. See below.

## Writing specs

A spec records a constraint whose absence would plausibly cause a future
developer or agent to make a wrong decision. It should be non-obvious,
durable, **already true**, and mistake-preventing. Good fits: contracts,
invariants, architecture boundaries, non-goals, recurring pitfalls,
accepted rationale, verification constraints.

Do not write specs for current state, future design, aspirations, todos,
implementation plans, session notes, progress, temporary debugging,
navigation, or history. What you hope to become is a plan, not a living
spec.

## changes/ is optional staging

Use `specs/changes/<name>.md` only when an accepted future contract must
temporarily coexist with current living reality — for example when
implementation happens in another session or by another agent, human
review comes first, or a multi-step migration is underway. A change must
contain at least one of `ADD`, `MODIFY`, `REMOVE`; `PRESERVE` alone is
not a change.

Otherwise, implement, verify, and update the living spec if durable truth
changed. After an accepted change is implemented, merge the durable
result into living specs and delete the change file. Git keeps history.

## Agent conventions

The complete Agent convention lives in
[`skills/charterleaf/SKILL.md`](skills/charterleaf/SKILL.md): adoption
gate, progressive retrieval, `related` and `lint` semantics, spec
writing discipline, and durable learning.

For agents that read project instructions, the minimal reference
bootstrap is [`AGENTS_SNIPPET.md`](AGENTS_SNIPPET.md).

Charterleaf core does not depend on Pi. Any coding agent that can read
Markdown and run shell commands can use it.

## Boundaries

Charterleaf has no:

- project state, tasks, planning, or workflow;
- memory, session lifecycle, evidence, or history management;
- scope registry, owner registry, or project bootstrap command;
- semantic search, embeddings, or code/spec semantic verification;
- repository coverage analysis or filesystem awareness in `related`;
- database, index, cache, daemon, or watcher;
- plugin/extension runtime;
- Git abstraction.

The two CLI commands are helpers, not workflow gates.

## Development

Requires Node.js 20 or newer. There are no runtime or development
dependencies and no build step.

```bash
npm test
npm pack --dry-run
```

## License

MIT
