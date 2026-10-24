---
name: charterleaf
description: Discover and maintain durable project constraints when Charterleaf is explicitly enabled or requested.
disable-model-invocation: true
---

# Charterleaf authoring guide

The essential rules live in [runtime.md](runtime.md); read it only if not already supplied. The Pi Extension supplies those rules automatically only when the project is enabled via `/charterleaf`; it does not preload this guide. Outside Pi, use the CLI only when explicitly requested. Existing `specs/` alone does not enable automation; do not initialize documents or recommend adoption automatically.

Read this guide only for unfamiliar spec formats, staged changes or manual CLI use. Ordinary code edits need no Skill read or CLI call when applicable constraints have already been supplied.

## Mode scope

The user chooses the mode only through `/charterleaf`. In Git, it is saved in `charterleaf.json` under `git rev-parse --path-format=absolute --git-common-dir` (usually `.git/charterleaf.json`), shared across the repository's branches and linked worktrees, not independent clones. Outside Git, keep using `specs/.charterleaf.json`. No saved choice means off, never a global Auto default.

An existing local config is authoritative, including saved `off`; branch-local legacy config cannot override it. Only if local config is absent, first load imports the saved mode from a valid current-branch legacy `specs/.charterleaf.json` without overwriting local config or changing/removing the legacy file or tracked worktree. Invalid config must report an error and disable automation, not fall back. Never recover lost authorization from Git history or sessions. Enabling a Git project creates neither `specs/` nor spec documents; spec content and routing remain in the current worktree. The two CLI commands are unchanged and independent of mode storage.

## Ownership and durable writing

Source owns implementation; tests own executable verification; `AGENTS.md` owns project entry/navigation; specs own durable constraints. Never copy signatures, inventories, current state or existing documentation into specs. Link the authoritative owner instead. Charterleaf is not task management, planning, memory, evidence, history or a project workflow.

Capture during ordinary development, debugging, code/test/architecture investigation or technical decisions; do not wait for settlement or require existing specs. An enabled project with no spec documents (or no `specs/` directory in Git) is a valid starting state, not a bootstrap request; normal code reads/edits and later justified spec creation remain allowed under the selected mode.

Distinguish **newly established knowledge** (an accepted new contract/decision) from **newly discovered knowledge** (an existing but ineffectively documented constraint). Either can qualify without code changes; neither obliges every task to produce a document. Apply all three checks:

1. Reliable evidence: accepted user intent, authoritative documentation, tests or sufficiently verified implementation behavior. Current code alone does not establish an accepted correct contract.
2. Long-term value: ignoring it could plausibly cause a future developer/Agent to make a wrong decision.
3. A documentation or discoverability gap: inspect relevant existing owners/specs before writing. If an authoritative document already covers it, add only a short scoped reference when routing is genuinely missing; otherwise do nothing. Never duplicate a captured rule. Executable tests provide evidence, not automatically effective code-path discovery: accepted non-obvious invariants scattered among tests may warrant a short scoped constraint/reference even when no new contract was established. Do not copy test cases or document trivial assertions; judge whether a future code change could miss the boundary.

Honor explicit no-file-write/read-only restrictions in every mode. Otherwise **code edits are allowed normally in all three modes**, including Reference and Confirm. Auto can create or update specs immediately when justified; Confirm uses the existing exact-spec-write approval; Reference only proposes spec changes, never restricts implementation edits. **In Confirm, invoke standard `write`/`edit` with the exact spec proposal to open the Extension's approval dialog; do not merely ask for prose permission and stop.** The call is an approval request, not an unauthorized mutation: the Extension pauses it before execution, denies it without UI, and only executes the exact operation if approved. If evidence conflicts, verify authority and distinguish a bug from an accepted change, never rewrite truth to match suspect code.

Place qualifying non-obvious knowledge in:

- `specs/constitution.md`: rare project-wide boundaries;
- `specs/capabilities/`: observable contracts, invariants and non-goals;
- `specs/engineering/`: long-lived implementation boundaries, recurring pitfalls and verification constraints;
- `specs/decisions/`: accepted rationale and revisit conditions.

Living capability/engineering specs need a unique `id` and non-empty `applies_to` list, including the first organically created spec. For example:

```markdown
---
id: engineering.amounts
applies_to:
  - src/amounts.js
  - tests/amounts.test.js
---
# Amount boundary

Preserve the accepted rounding contract; see [accounting policy](../../docs/accounting.md#rounding) and its executable cases in `tests/amounts.test.js`.
```

Use this shape, not this example's rule, for the actual project evidence. Route rationale in `decisions/` through a relevant capability/engineering reference when automatic code-path discovery is needed. Keep scope narrow, preserve existing formats and requirement IDs, and verify explicit local references normally. `anchors` and `verified_by` are not required. Do not create speculative standards or code summaries to satisfy a final review. Task progress, implementation inventories, one-off debugging, temporary plans/todos and unverified behavior never belong in Specs.

The runtime's standalone assistant comments (outside code fences; exact terminal completion comments also work inline) `<!-- charterleaf: review -->`, `<!-- charterleaf: covered -->`, `<!-- charterleaf: no-value -->` and `<!-- charterleaf: proposed -->` are task-local lifecycle signals, not spec contents, evidence or permissions. `review` means a concrete evidenced candidate still needs knowledge judgment; `covered` means relevant authority is already effectively discoverable; `no-value` means the evidence/value/gap checks found no qualifying knowledge; `proposed` means a Reference/read-only proposal was reported or a Confirm proposal passed through the gate and was refused/no UI. Use these exact comments; put explanation outside, never inside them. If an explicit no-write task surfaced a qualified constraint, report the finding/proposal in the normal answer and finish the knowledge judgment there rather than requesting a continuation just to repeat it. Ordinary code/test completion is not any of those conclusions: a generic `done` comment is deliberately ignored. Never use `covered` merely because tests exercise a boundary without effective code-path discovery. In an enabled empty-spec project, do not reject a non-obvious accepted invariant merely because the tests already exercise it. Waiting for human approval is not unresolved knowledge judgment: do not request a semantic continuation just to ask the same permission again. After submitting an exact proposal to the approval gate, handle approval/refusal/no UI and finish normally. New distinct findings may rearm, but the Extension continues at most once. Successful structurally valid standard spec writes also mark capture complete; later code edits rearm the development fallback. In an empty-spec project, owned development after `no-value` still permits the single fallback to check for missed discovery gaps. Omitting a recognized conclusion can cause a redundant fallback even when the normal answer already states that nothing needs documenting. Plain reads, file counts, search results and task wording are not semantic discovery signals.

## Optional staged changes

Use `specs/changes/<name>.md` only when an accepted future contract must coexist with current truth: review, another session or an ongoing migration. Supply valid `affects` spec IDs and at least one non-empty `ADD`, `MODIFY` or `REMOVE` section; `PRESERVE` alone is not a change. Once implemented and verified, merge durable truth into living specs and remove obsolete staging. Git keeps history; never commit automatically.

## CLI details

Run from the project root:

- `charterleaf related <path>` returns constitution as Global, capability/engineering specs matching `applies_to`, and active changes affecting returned spec IDs. It returns paths/metadata, not bodies. Decisions and explicit references are followed manually when relevant. A scoped miss is not proof that no constraints apply.
- `charterleaf lint` checks frontmatter, IDs/globs, duplicate IDs, change references/deltas and conflicting active changes. `0 structural errors` does not prove semantic correctness, coverage or code/spec agreement. The Extension also lints standard spec writes.

If the CLI is not on PATH, use `node <skill-directory>/../../bin/charterleaf.js related <path>` or `lint`; the Extension supplies the absolute entry point. Report failed writing or validation accurately, and never relax a contract merely to remove an error.
