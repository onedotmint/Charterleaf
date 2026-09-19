---
affects:
  - <existing.spec.id>
---

# <Change name>

<!-- Optional staging. Use only when an accepted future contract must
coexist with current living reality — implementation in another session or
by another agent, human review first, or a multi-step migration.

A change must contain at least one of ADD, MODIFY, or REMOVE.
PRESERVE alone is not a change.

After implementation, merge the durable result into living specs and
delete this file. Git keeps history. -->

## Intent

<What intentional behavior/contract change is being made, and why?>

<!-- For a durable bug fix, optionally make the gap explicit:
## Current
<Observed behavior.>

## Expected
<Intended behavior.>

Always use PRESERVE for important unchanged behavior.
-->

<!-- Keep only the delta sections that are actually needed. -->

## ADD

### <REQ-ID> — <Requirement name>

<New durable requirement.>

## MODIFY

### <REQ-ID> — <Requirement name>

<New form of an existing requirement.>

Previously: <old behavior, only when useful for clarity>.

## REMOVE

- <Durable requirement or behavior being removed.>

## PRESERVE

- <Behavior, API shape, invariant, or boundary that must remain unchanged.>

## Verification

- <Behavior that proves the intended change.>
- <Existing behavior that proves PRESERVE constraints did not drift.>
