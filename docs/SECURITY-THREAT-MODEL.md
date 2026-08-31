# FindSpot V5 security threat model

## Security model

FindSpot has no accounts and no central private-record database. Private records are local-first in IndexedDB, are not automatically cloud-backed up, and are not used for behavioural/location analytics. Security effort therefore concentrates on the limited boundaries where external input can enter local state or initiate work.

## Non-goals and trust invariants

- FindSpot does not determine that detecting is clear, safe, permitted or otherwise lawful. Heritage and coverage data can describe recorded constraints and explicit limits; absence, partial coverage, stale data, an unavailable source or silence from an alert can never produce a positive legality state. Green must not encode one. This invariant applies to the map, session start, Field Guide and every other user-facing surface.
- FindSpot does not continuously monitor the user's live position against heritage geometry. The Companion has no geometry channel, continuous checking has not passed the recording battery posture, and silence would create reassurance that the available datasets cannot support.
- FindSpot does not replace landowner permission, statutory reporting duties, official registers or current legal guidance. It can help the user inspect and act on recorded information without claiming that the record is complete.

The detailed active-map ruling is recorded in [`features/scheduled-monuments-active-map.md`](features/scheduled-monuments-active-map.md).

## Primary assets

- exact find coordinates, GPS trails and Companion recordings;
- permissions, mapped fields and landowner/contact information;
- notes, significant-find narratives, surface observations and undug signals;
- photographs, documents and backup archives;
- Club/Rally event, member and organiser data;
- application integrity, offline availability and IndexedDB durability.

## Trust boundaries and controls

| Boundary | Threats | Current controls |
|---|---|---|
| Club/Rally URL or QR → decoder | Oversized/invalid base64, invalid UTF-8/JSON, misleading legacy parameters | Encoded and decoded byte limits before expensive work, strict UTF-8, base64url alphabet, duplicate legacy-parameter rejection, generic UI errors |
| Decoder → Club pack normaliser | Type confusion, object injection, malformed/full/compact schema differences, geometry DoS | One explicit trusted schema for full, compact and legacy formats; explicit construction; bounded strings, IDs, field/ring/point/coordinate counts; finite ranged coordinates; duplicate IDs rejected |
| Normaliser → IndexedDB | Local-ID collision, cross-permission authority, partial writes | External field IDs are provenance only and map to local UUIDs; existing relationships use local IDs; permission type is constrained; permission, fields and import ledger commit atomically |
| Member Club export → organiser merge | Hostile file, relationship smuggling, arbitrary URL fetch through media, record collision | Pre-read `File.size`; UTF-8 byte/record/media limits; strict versioned record schemas; finite coordinates; complete relationship checks; organiser-only permission target; data-URI-only local media decoding; global collision remapping; atomic commit |
| Backup → validator/staging → IndexedDB | Zip/JSON bombs, corrupt references, partial replacement | Unknown raw type, manifest/archive/expanded/media/record limits, duplicate-entry and reference checks, staging database, atomic replacement and rollback. These controls are preserved by characterization/property tests |
| Companion share/JSON → service worker/cache → validator → IndexedDB | Oversized multipart/file, cache exhaustion, hostile context/session, malformed recording | Streaming request byte cap before `formData`, file/type limits before cache/text, one pending versioned cache, bounded allowlisted context, strict Zod recording schema and hash verification, atomic record/track import |
| Browser → external geospatial service | Location disclosure, new unreviewed destination | Reviewed origin registry/ratchet, documented exact/bbox/grid/tile disclosure, bounded requests and local caching where applicable |
| Browser → FindSpot Worker | Proxy abuse, malformed parameters, false reliance on Origin | Fixed endpoint origins, full query allowlists/limits, runtime tests. Origin discourages browser hotlinking and is not identity/authentication |
| Worker → upstream | SSRF, cache poisoning, unbounded response | Fixed/tightly validated upstream URL construction, canonical cache keys, bounded geocoder response body, streamed BGS response, no user-selected protocol/host/port |
| Browser → service worker | Stale/bad application shell, overly broad caching | Revisioned Workbox precache, outdated-cache cleanup, navigation fallback, explicit update activation, production offline tests and recovery procedure that preserves IndexedDB |
| PWA → Companion custom scheme | Another application/site invokes controls | Custom scheme is not authenticated; exact action/scheme/host/path/parameter/length policy plus recording-state validation and user-visible outcomes |
| Android Intent → Companion | Duplicate/oversized/malformed parameters, encoded slash, replay, invalid start/stop state | Pure tested intent policy, exact `ACTION_VIEW`, bounded session ID alphabet, duplicate/unknown parameter rejection. Replayed starts reuse the active recording; stop while idle fails rather than creating state |
| Android boot broadcast → persisted recording | Unexpected broadcast creates/exposes recording | Exact `BOOT_COMPLETED` policy; receiver only interrupts an already-active persisted recording and posts recovery UI; it cannot start or export a recording |
| External/user string → React or URL navigation | Script/handler creation, executable URL scheme | React text escaping, hostile rendering corpus, five static HTML sinks pinned by content hash, `http`/`https` URL allowlist without credentials |
| Dependency/build input → browser/Worker runtime | Compromised or vulnerable dependency, changed network endpoint | Committed lockfile plus `npm ci`, high/critical production audit gate, monthly audit, Worker generated-type checks, configured-origin gate |

## Exported Android components

The launcher activity, control-link alias and boot receiver are the only exported components and their external visibility is documented in `companion/android/SECURITY.md`. The recording service and FileProvider are non-exported. The app has no `INTERNET` permission.

## Logging

Browser diagnostics are an on-device bounded ring and are never automatically transmitted. Non-fatal reports retain error class rather than raw error content; reviewed paths omit coordinates and private record IDs. Workers do not log request payloads. Platform request metadata may still exist in hosting/Worker operational telemetry.

## Residual risks and explicit decisions

- Club/Rally packs and custom-scheme Companion commands are not cryptographically authenticated. Shared IDs are merge/provenance anchors, not proof of organiser identity.
- Public geospatial services learn the geographic request described in `NETWORK-PRIVACY.md` and can observe ordinary HTTP metadata.
- Production remains on GitHub Pages, so arbitrary response security headers are not a release gate. A meta CSP is deferred until its inline-script, MapLibre, Worker and offline compatibility can be validated.
- Backup hashes are a future corruption-detection improvement and would not authenticate a backup without a signature/secret.
- User-initiated exports and external links intentionally disclose the selected data/destination after user action.

## Recovery and data-loss posture

Validation completes before database mutation, and rejected Club/Rally, backup and Companion inputs leave existing data unchanged. Service-worker recovery deletes only service-worker/Cache Storage state, never IndexedDB. Users should keep deliberate external backups because local browser storage can still be removed by browser/device actions.
