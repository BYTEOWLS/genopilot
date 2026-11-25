# Make stale-lock recovery race-free

## Outcome

Concurrent catalog saves or tooling setup cannot both acquire a lock by racing to recover a stale one.

## Scope and contract

- Shared locking in `src/file-lock.ts` owns mutual exclusion for all callers, including catalogs and tooling setup.
- Today, two contenders can both remove a stale lock; the slower can delete the faster contender's replacement. Prevent recovery or cleanup from removing another owner's lock.
- Keep stale-revision checks and atomic saves; they do not replace mutual exclusion. Preserve actionable busy-lock errors and stale-owner recovery.

## Acceptance criteria

- [ ] Two contenders recovering the same stale lock never enter the protected operation together.
- [ ] Recovery and release cannot remove a replacement lock owned by another process.
- [ ] A live owner's lock stays intact; a genuinely stale lock remains recoverable.
- [ ] Failed or cancelled acquisition leaves another owner's lock intact and allows a later legitimate retry.
- [ ] Deterministic concurrency tests cover catalog and tooling callers without timing-based sleeps.
