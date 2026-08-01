# FindSpot Companion release signing

The Android package is `uk.findspot.companion`. Public builds must be signed by
the same long-lived release key so Android can install future versions as
upgrades without deleting local recordings.

## Signing identity

- subject: `CN=FindSpot Companion, O=FindSpot, C=GB`
- algorithm: 3072-bit RSA
- certificate SHA-256: `8852a4c12f0921292416d2467df8de783c3ddf9b693744867cdaec3e5cdc3ce5`
- key alias: `findspot-companion`
- initial signed version: `1.0.0-beta.1` (`versionCode` 1)

The key and password are deliberately outside the repository:

- `/home/david/.config/findspot/companion-release.keystore`
- `/home/david/.config/findspot/companion-release.password`

Both files are mode `600`. Back them up together in a secure, encrypted
location. Losing either file prevents FindSpot from publishing installable
upgrades under this package identity. Never commit either file or print the
password in build logs.

## Build inputs

The Gradle release build refuses to run unless all four variables are present:

- `FINDSPOT_COMPANION_KEYSTORE`
- `FINDSPOT_COMPANION_STORE_PASSWORD`
- `FINDSPOT_COMPANION_KEY_ALIAS`
- `FINDSPOT_COMPANION_KEY_PASSWORD`

Every public build must pass release unit tests, release lint, R8, APK signature
verification and a short upgrade/record/export check. Increment `versionCode`
for every published update.

## Beta 1 artifact

- tag: `companion-v1.0.0-beta.1`
- asset: `findspot-companion-v1.0.0-beta.1.apk`
- APK SHA-256: `ac09a47adbeebde905769501adccac17d9581d6e7f2e23b42ba01c5a1e17c97c`
- size: 141,751 bytes

This is a GitHub pre-release. It remains subject to the six-hour battery,
Samsung power-management, installed-PWA sharesheet, network-capture and field
acceptance gates documented in the physical-validation record.

Direct APK distribution is no longer offered in FindSpot because Android
Advanced Protection can block unknown-source installations. The Google Play
internal-testing handoff and signed app bundle are documented in
[`google-play-internal-testing.md`](google-play-internal-testing.md).
