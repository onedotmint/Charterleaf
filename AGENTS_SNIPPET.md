# Project References

Use this file as the project navigation entry.
Document where authoritative information lives — project state,
validation, resources, history, and other project-specific sources.

Source code owns implementation, tests own executable verification,
`AGENTS.md` owns navigation, and `specs/` owns durable constraints. Read
these authoritative owners progressively; stop when sufficient. Keep one
owner per fact and link to it rather than duplicating it.

Charterleaf automation is explicit opt-in, not implied by this entry or
by an existing `specs/` directory. In Pi, the user chooses Auto, Confirm,
Reference or Not Enable through `/charterleaf`; the saved project mode in
`specs/.charterleaf.json` controls automation. Missing config or `off`
means no automatic scan, adoption prompt or document creation. Do not
change activation config on the user's behalf.

For manual use on a concrete repository path, run from the project root:

    charterleaf related <path>

Read the returned constraints. A routing miss is not proof that none
apply. The manual CLI remains available independently of Pi and its mode
config; run `charterleaf lint` after spec edits (structural checks only).

With automation enabled, use supplied constraints or explicitly read the
named specs before retrying a gated write/edit. Use standard `write`/`edit`
for spec changes: Confirm requires each approval; Reference allows no
spec changes. Do not bypass these cooperative checks with Bash or another
writer. During normal development or investigation, capture newly established
or newly discovered knowledge only with reliable evidence, long-term value and a
documentation/discoverability gap; no code change or prior spec is required.
Prefer short scoped references to authoritative owners over copying documents.
Explicit no-file-write/read-only instructions override Auto. No justified durable
knowledge means no spec edit; never relax a spec merely
to accommodate conflicting code. Preserve user/parallel work and keep
state, plans, evidence and history in their existing authoritative owners,
not in a new Charterleaf workflow.
