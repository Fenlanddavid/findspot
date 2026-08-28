# Security operations

## Release enforcement

The GitHub Pages deployment requires:

- deterministic `npm ci` installation from the committed lockfile;
- `npm audit --omit=dev --audit-level=high` (high and critical production advisories fail);
- type, type-floor, casing, unsafe-`any`, hooks and architecture checks;
- the Club Day malicious-input corpus and all normal unit tests;
- DOM-content and configured-network-origin ratchets;
- Worker generated-type checks, Worker typechecks and runtime tests;
- normal Playwright smoke/regression tests;
- production PWA offline and Companion share-target/handoff tests;
- Android Companion JVM tests with Android SDK 35;
- a successful production build before deployment.

The monthly dependency workflow uses the same high/critical production audit threshold. `npm outdated` remains visible informational output and is allowed to continue because age alone is not a vulnerability. The old workflow only ran `npm outdated`; it did not perform or enforce a vulnerability audit.

## Dependency response

High or critical production advisories block a release. Moderate or low findings must be reviewed for application reachability and scheduled according to exposure; they remain visible in audit output. During this hardening pass the transitive DOMPurify resolution and Cloudflare build/test tooling were upgraded to patched releases. The complete dependency tree reported no known vulnerabilities when validated on 29 August 2026.

## Backup integrity

Current backup validation, entry/expanded/media limits, duplicate rejection, reference checks, staged restore and atomic replacement remain mandatory. A future backup format may add SHA-256 per media entry, a canonical-manifest digest and an overall file-set digest while retaining old-format compatibility.

Hashes detect corruption or modification. Without a secret or digital signature, they do not authenticate who created a backup.
