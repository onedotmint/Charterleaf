---
name: charterleaf
description: A tiny specification layer for durable project intent and constraints.
---

# Charterleaf

## Adoption gate

Before using Charterleaf in a repository, check whether `specs/` exists.

If no `specs/` directory exists:

- do not run Charterleaf;
- do not create `specs/`;
- do not recommend adoption automatically;
- continue using the repository's normal instructions.

Charterleaf is opt-in.

## Boundary

Charterleaf answers one question:

> For this repository path, which durable constraints should I read?

A project's own reference protocol — its `AGENTS.md` entry and the
project-owned documents it points to — answers a different question:

> Where do this project's authoritative facts live?

Charterleaf owns only: spec taxonomy, durable constraint routing
(`related`), and structural lint (`lint`).

Charterleaf does not own: current project state, tasks, workflow,
planning, memory, evidence, history, session lifecycle, project-wide
consistency, semantic code/spec verification, or repository state
synchronization.

## Progressive retrieval

1. **Identify the need.** Orientation, current state, evidence,
   validation, resources, implementation detail, or durable constraint?
2. **Locate the owner.** If the owner is known, read it directly. If not,
   read the project `AGENTS.md` / project instructions. Do not scan the
   whole repository's Markdown first.
3. **Enough?** If the authoritative information you have is sufficient,
   stop reading. Do not keep reading for completeness.
4. **Expand progressively.** Only when information is insufficient, the
   owner is unclear, sources conflict, the work area is unknown, or
   verification is needed — and only one layer at a time.
5. **Concrete path.** Once work lands on a concrete repository path, run
   `charterleaf related <path>` and read the returned constraints.
6. **Work.** Normal implementation, learning, design, or debugging. The
   reference protocol does not manage workflow.
7. **Write back.** Changed current fact → its single owner. New evidence
   → the evidence owner. New or changed durable constraint → `specs/`.
   Historical event → project history or Git. Future plan → planning
   docs. Never copy one fact into several files: one owner per fact,
   other documents point to it.

## related semantics

`charterleaf related <path>`:

- always returns `specs/constitution.md` as Global when it exists;
- routes `capabilities/` and `engineering/` specs whose `applies_to`
  glob matches the path;
- appends active changes whose `affects` reference a returned spec id.

`applies_to` is a **routing hint**, not a completeness proof. The message
`No applies_to glob matched this path.` means exactly that — it never
means "no constraints apply". On a scoped miss the command lists
available living specs by `id`, path, and `applies_to` only. Use that
list to find the right area, then rerun with the concrete path. The
command never prints spec bodies, ranks relevance, or guesses.

## lint semantics

`charterleaf lint` reports mechanical structural problems only:
frontmatter shape, living-spec ids and `applies_to`, duplicate spec and
requirement ids, change references, changes whose `ADD` / `MODIFY` /
`REMOVE` sections are all empty (HTML comments do not count), and
conflicting active changes.

It does **not** verify semantic correctness, code/spec agreement,
routing coverage, project compliance, whether a change is complete, or
whether an Agent read the specs. Success prints `0 structural errors`.
Run it after editing specs.

## Spec writing discipline

A spec records a constraint whose absence would plausibly cause a future
developer or agent to make a wrong decision. It should be non-obvious,
durable, **already true**, and mistake-preventing.

Good fits: contracts, invariants, architecture boundaries, non-goals,
recurring pitfalls, accepted architectural rationale, verification
constraints.

Not specs: current state, future design, aspirations, todos,
implementation plans, session notes, progress, temporary debugging,
navigation, history. "Already true" matters — what you hope to become is
a plan, not a living spec.

Place a constraint where it belongs:

- rare project-wide durable boundary → `specs/constitution.md`;
- observable behavior, contract, invariant, or non-goal →
  `specs/capabilities/`;
- implementation boundary, long-lived constraint, recurring pitfall, or
  verification practice → `specs/engineering/`;
- important architectural rationale and revisit condition →
  `specs/decisions/`.

Keep specs compressed. Prefer durable contracts and pitfalls over
commentary, and never invent aspirational standards.

## changes/ is optional staging

Use `specs/changes/<name>.md` only when an accepted future contract must
temporarily coexist with current living reality — for example when
implementation happens in another session or by another agent, human
review comes first, or a multi-step migration is underway. A change must
contain at least one of `ADD`, `MODIFY`, `REMOVE`; `PRESERVE` alone is
not a change.

Otherwise: implement, verify, and update the living spec if durable truth
changed. After an accepted change is implemented, merge the durable
result into living specs and delete the change file. Git keeps history.

## Durable learning

After non-trivial implementation or debugging, ask once: did this work
reveal durable knowledge whose absence could cause a future mistake?

If not, change nothing. If yes, record only the durable constraint in
the matching category above.

Never record current progress, temporary debug notes, one-off commands,
session history, todos, or transient observations. Specs accumulate
durable constraints, not development activity.

## Non-goals

Do not use Charterleaf to manage tasks, planning, workflow, memory,
evidence, history, repository state, or scope registries. Do not ask it
to verify semantics, coverage, or project compliance. It finds
constraints; it does not manage the project.
