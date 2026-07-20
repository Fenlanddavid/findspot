# ADR 0001: Keep IndexedDB local-only and harden backup/restore

- Status: Accepted
- Date: 2026-07-20
- Decision owners: FindSpot maintainers

## Context

FindSpot presents IndexedDB as its source of truth and currently makes no promise of cross-device sync. Adding encrypted blob replication is not a transport-only feature. Several persisted records (`Media`, `SavedPoint`, `Setting`, and `ImportedPackage`) have no `updatedAt`; deletion has no tombstone model; media blobs are large; and restore must remain compatible across application schema versions.

A safe sync design would therefore need stable record identity, per-table conflict rules, tombstones, schema negotiation, encryption and key recovery, media transfer and quota handling, retry/idempotency rules, and a user-facing recovery model. Last-write-wins alone would silently resurrect deleted data or discard concurrent edits.

## Decision

FindSpot remains deliberately local-only. IndexedDB is authoritative. No background service or Cloudflare Worker may become a dependency for opening, recording, editing, or exporting the user's collection.

Engineering effort goes first to backup/restore hardening:

1. Escalate export reminders using the count of finds changed since the last externally saved backup, not elapsed time alone.
2. Provide a restore drill that validates and stages a backup without replacing live data, then reports whether records and media can be recovered.
3. Keep restores atomic and forward-compatible, validate raw backup input before it reaches table writes, and make damaged media visible before export.

Club Day packs remain explicit user-controlled transfers, not an implicit sync channel.

## Consequences

- Recording continues to work without an account or network connection.
- Users must move data between devices through explicit export/restore flows.
- Backup UX and recovery testing are product-critical, not secondary settings.
- Server-side features may cache public reference data, but must not receive private find records under this decision.

## Reopen triggers

Reconsider opt-in sync only when at least one of these is true:

- sustained user research shows cross-device continuity is more valuable than account-free local-only operation;
- backup loss or device migration is a material support burden despite reminders and restore drills;
- collaboration needs cannot be met safely by explicit Club Day packs; or
- a funded design covers identity, tombstones, conflicts, encryption/key recovery, media quotas, schema compatibility, and offline reconciliation end to end.

Any proposal to reopen this decision must include a migration path that preserves IndexedDB as an offline source of truth and makes sync an optional replica rather than a runtime dependency.
