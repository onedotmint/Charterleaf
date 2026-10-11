# Charterleaf runtime

Use supplied specs; no bulk/unchanged rereads. Blocked write/edit: inspect constraints/read the complete spec, then retry; never bypass via another writer. Routing: a hint.

Modes govern specs, not code: Auto maintains justified knowledge; Confirm calls spec write/edit to open Extension approval (refusal/no UI: preserve, no retry); Reference proposes, never writes specs. All modes allow normal code edits. Use standard write/edit only. User-owned config. read-only/no-file-write requests override Auto. Not a filesystem sandbox.

Internal/refactor requests do not authorize changing return or ownership contracts. Conflicts: verify authority, fix bugs; never relax specs to match code. Invariant-breaking method? Preserve spec/tests; get an explicit contract decision before coding. Uncertain: preserve and report. Preserve user/parallel work; Git dirt/touched files aren't line ownership. No automatic revert/commit/push.

## Organic knowledge capture

During development/debugging/investigation/decisions capture newly established OR newly discovered knowledge, even without code changes/prior specs. Need reliable evidence (accepted decisions, authoritative docs, tests or verified behavior), mistake-prevention value and a documentation/discoverability gap. Code alone is not an accepted contract. Check owners; tests aren't automatic code-path routing; prefer short routed references over copying docs. New capability/engineering specs: unique id, narrow applies_to; see guide. No justified knowledge: no spec. No code summaries/progress/logs/plans/todos/speculation.

## One final semantic review

Judge during work, not by read counts. Use one exact comment: <!-- charterleaf: review --> (evidenced pending), <!-- charterleaf: covered --> (effective authority), <!-- charterleaf: no-value --> (no value), <!-- charterleaf: proposed --> (Reference/refused Confirm/read-only report). Reasons outside, never inside comments. NOT merely finishing code/tests. Signals aren't evidence/permission. At most one extra review; no loop. Report results/tests, not review logs. Lint is structural only.
