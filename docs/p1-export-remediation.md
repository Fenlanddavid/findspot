# P1 export remediation — 12 September 2026

Both changes are implemented locally on the existing v5.0.16 working tree. No version bump, deployment, schema migration or backup-format change is included.

## Download lifetime

`src/utils/download.ts` owns Blob download activation. It attaches an anchor with the filename and `rel="noopener"`, clicks it, removes the temporary element and retains the object URL for 60 seconds. Cleanup is also scheduled if activation throws, and the error remains available to the caller.

Ten modules now use it: Settings, AgreementModal, ClubDayModals, FieldReportModal, PermissionReportModal, LandAccess, PASReportModal, the share service, FieldGuideMap and FieldGuideWorkspace. The last two were additional one-second cleanup implementations found during the audit. PNG extension handling and native sharing are preserved.

`npm run check:downloads` parses application source and rejects object-URL creation combined with programmatic `.click()` activation outside the helper. The rule deliberately checks the whole module, including activation of an existing anchor and creation/activation split between callbacks. Ordinary image previews remain allowed. The check runs in both `npm test` and `npm run test:security`; its tests cover direct, computed-property and existing-anchor calls, plus comments and string literals.

Backup preparation history and explicit external-copy confirmation are unchanged. A 60-second lifetime is a mitigation, not a download-completion signal; prepared does not mean received or externally saved. The browser URL API releases the reference when revoked ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)).

## CSV boundary

Every header and data cell passes through the same writer. Cells beginning with `=`, `+`, `-`, `@`, TAB, CR or LF receive a leading apostrophe. Inspection happens before newline flattening, so a leading CR/LF cannot disappear before the guard sees it. Double quotes are doubled, each cell is quoted, the UTF-8 BOM remains, and CR/LF sequences become spaces. Newline flattening now applies consistently to all columns, including addresses, as well as notes.

Negative-looking values retain their minus signs and original digits behind the literal-text prefix. Imported permission names and all database records remain unchanged. The existing CSV does not export field names; this change does not add columns.

This implements the requested apostrophe strategy. Spreadsheet save/reopen behaviour still varies; it is not a guarantee for every subsequent spreadsheet transformation. [OWASP's CSV guidance](https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/CSV_Injection.md) describes that limitation.

## Verification

- `npm test`: passed all project checks and 155 unit-test files (1,281 tests passed, one skipped). After strengthening the download ratchet to cover existing anchors, its nine tests and the source check passed again.
- Unit coverage includes deferred revocation, independent consecutive downloads, cleanup on activation failure, share filenames and native sharing, every guarded prefix in permission names/landowner names/find notes, negative values, quote/newline/BOM compatibility and actual Club Day import followed by CSV export.
- `npm run build`: passed.
- Chromium browser checks: the full ZIP downloaded with a 1 MiB+ photo, confirmation remained unset until explicitly checked, and restoring that exact downloaded ZIP recovered the original record and photo bytes. A PDF downloaded after both signatures were drawn, had a valid PDF header and matched the stored agreement bytes. Existing records-backup/CSV and staged ZIP restoration tests also passed (four checks total).
- The new backup test initially compared the confirmation time to the ZIP manifest time; it now checks the deliberately retained preparation timestamp. The agreement test now opens the existing More menu. An existing 30-second backup workflow passed with a 60-second test allowance. No application behaviour was changed for those test corrections.
- Logs: `/tmp/findspot-p1-checks.log`, `/tmp/findspot-p1-build.log`, `/tmp/findspot-p1-browser.log`, `/tmp/findspot-p1-browser-final.log`.

Physical iOS Safari/Android Chrome download-and-restore checks and an actual Excel import remain unverified; no connected phones or Excel environment were available. Browser automation ran Linux Chromium, including a 390 × 844 viewport for the new workflows.
