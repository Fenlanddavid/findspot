# FindSpot Companion Phase 1 implementation contract

## Boundary

The Companion persists native hardware callbacks. It does not filter accuracy,
smooth, interpolate, calculate coverage or write FindSpot records. FindSpot
validates the immutable recording and owns every derived track and
archaeological interpretation.

The Android app intentionally does not request `INTERNET`. Phase 1 file
transport is therefore complete without an application-level outbound network
capability. The optional localhost API remains deferred and is not a release
dependency.

## Acquisition policy v1

Android requests the GPS provider with:

- desired update interval: 10 seconds;
- minimum requested interval: 5 seconds on Android 12 and later;
- requested minimum displacement: 5 metres;
- maximum requested delivery delay: 10 seconds;
- high-accuracy quality.

These values configure native acquisition. Every callback delivered to the
application listener is committed in its own SQLite transaction. The
application performs no post-delivery distance, accuracy or duplicate filter.
The policy is versioned implementation configuration and must be evaluated in
the six-hour battery field test.

## Units and ordering

| Field | Contract |
|---|---|
| `sequence` | Non-negative integer, strictly increasing across the recording; authoritative ordering key. |
| `timestampUtc` | Unix epoch milliseconds supplied by the native location. |
| `monotonicTimestampNs` | Unsigned decimal nanoseconds from the native monotonic clock, represented as a string; nullable on platforms without it. |
| `receivedTimestampUtc` | Unix epoch milliseconds when the Companion received the callback. |
| latitude/longitude | WGS84 decimal degrees. |
| altitude | Metres using the datum supplied by the native provider; nullable. |
| accuracy | Metres, non-negative; nullable. |
| heading | Degrees in `[0, 360)` using native-provider bearing semantics; nullable. |
| speed | Metres per second, non-negative; nullable. |
| provider | Non-empty opaque native provider label. FindSpot must not branch on it. |

Device UTC may change during a session. Sequence, not UTC, determines point
order. Segment indexes are contiguous from zero.

## Content identity

`contentHash` is SHA-256 over RFC 8785-style canonical JSON containing only:

- `schemaVersion`;
- `startedAtUtc`;
- `stoppedAtUtc`;
- `state`;
- `interruptionReason`;
- `segments`.

Producer metadata, export creation time, recording UUID and the hash field are
excluded. Consequently a re-wrapped export with a different UUID still has the
same observation-content hash and is rejected as duplicate fieldwork.

The authoritative schema is [recording.schema.json](recording.schema.json).
Unknown fields and unknown observation discriminators are rejected. A future
observation type requires a new supported schema version, not a permissive
partial import.

## FindSpot import commit

1. Read the complete file within the 25 MB limit.
2. Strictly validate schema, coordinates, counts, sequences and content hash.
3. Ask the user to confirm an existing or new session.
4. In one Dexie transaction, write the new session when applicable, immutable
   source recording, unique import ledger and deterministic segment tracks.
5. Regenerate coverage and calibration evidence idempotently.
6. Mark the ledger `ready`; failures remain `failed` and retry at application
   startup.

The durable import is never rolled back because a secondary derived
calculation failed. Track IDs use
`companion:{recordingUuid}:segment:{segmentIndex}`. Trimming records inclusive
source-sequence rules in the ledger, so regenerated tracks retain user intent.

## Retention and recovery

Unexported native recordings are never automatically removed. A successful
share-sheet launch marks a recording `exported`; it does not claim FindSpot
successfully imported it. Stopped exported recordings are retained for 30 days
and may be deleted manually sooner.

Automatic recording restart after process death or reboot is prohibited.
Recovery always requires a user action. Resume creates a new segment. Android
reboot handling posts a recovery notification rather than launching a location
foreground service from the background.

## Verification still requiring devices

Automated code verification cannot substitute for:

- six-hour locked-screen recording;
- measured battery consumption;
- forced process termination and reboot exercises;
- Android foreground-notification review;
- OEM battery-management testing;
- Flag Fen detecting-session validation;
- packet capture confirming no non-loopback application traffic.
