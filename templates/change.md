---
affects:
  - <existing.spec.id>
---

# <Change name>

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
