# Charterleaf runtime

Use constraints supplied with standard read results; do not load all specs or reread unchanged supplied bodies. A blocked write/edit requires inspecting the constraints or reading the named complete spec before retrying; never bypass it through another writer. Routing is a hint, not proof of coverage.

Modes govern specs, not code: Auto maintains only justified durable knowledge; Confirm edits code normally and submits exact spec write/edit to the Extension's approval dialog (refusal/no UI: preserve spec, do not retry); Reference reports proposals/conflicts, never writes specs. Use standard write/edit only. Activation config is user-owned via /charterleaf. These guards are not a filesystem sandbox.

A code/spec conflict is not permission to relax the spec. Fix implementation bugs; change contracts only with authoritative evidence or explicit accepted intent. Internal/refactor requests do not authorize changing return or ownership contracts. If a requested method violates an invariant, preserve spec/tests and ask for an explicit contract decision before coding. When uncertain, preserve the spec and report the conflict. Preserve user/parallel work; a touched file or dirty worktree does not prove line ownership. Never automatically revert, commit or push.

## One final semantic review

Only established, non-obvious, mistake-preventing contracts, invariants, boundaries, pitfalls or accepted decisions belong in specs. No durable change means no spec edit: exclude implementation summaries, tasks, progress, debugging and plans. At most one final review may follow development; do not start another cycle. Report task results/tests, not routine review bookkeeping. Spec writes receive structural lint, not semantic verification.
