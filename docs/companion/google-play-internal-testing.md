# Google Play internal testing handoff

Prepared on 1 August 2026 for package `uk.findspot.companion`.

## Upload artifact

- file: `companion/android/app/build/outputs/bundle/release/app-release.aab`
- version name: `1.0.0-beta.2`
- version code: `2`
- size: 166,820 bytes
- SHA-256: `1c0e57d488daf87712061ed7337500bca4ed16574261e0d2d9aec7e446ea5ce9`
- upload certificate SHA-256: `8852a4c12f0921292416d2467df8de783c3ddf9b693744867cdaec3e5cdc3ce5`

The release unit tests, release lint, R8, bundle signing, PWA unit suite and
production PWA build passed before this artifact was prepared.

## Create the Play app

1. Open <https://play.google.com/console/> and complete developer-account and
   identity verification if Google requests it.
2. Select **Create app**.
3. Enter:
   - app name: `FindSpot Companion`
   - default language: `English – United Kingdom (en-GB)`
   - app or game: `App`
   - free or paid: `Free`
4. Accept the declarations and create the app.

## App and upload signing

Google Play App Signing owns the app-signing key used on tester devices. The
local FindSpot Companion key is the registered upload key and signs each AAB
before it is sent to Play. Play verifies that upload signature, then signs the
distributed APKs with its app-signing key.

The raw files below must never be uploaded, emailed or committed:

- `/home/david/.config/findspot/companion-release.keystore`
- `/home/david/.config/findspot/companion-release.password`

Keep the Play app-signing certificate and upload-certificate fingerprints
recorded separately in the release log. A locally installed build signed with
the upload key cannot update a Play-installed build because their device-side
signatures differ.

## Internal test

1. Open **Test and release → Testing → Internal testing**.
2. Open **Testers**, create an email list named `FindSpot internal`, and add the
   Google Account used on the test phone.
3. Select **Create new release** and upload `app-release.aab` from the path
   above.
4. Use release name `1.0.0-beta.2` and release notes:

   ```text
   Companion is now controlled from FindSpot and records quietly in the
   background. This update adds a distinct icon, stop-and-finish import, and a
   12-hour recording safety limit.
   ```

5. Save, review and start the internal-test rollout.
6. Copy the tester opt-in URL. FindSpot's
   `COMPANION_DOWNLOAD_URL` should be set to that URL before the PWA change is
   committed and deployed.

## Play Console declarations

Use these answers for the current native app:

- ads: **No**
- app access: **All functionality is available without special access**
- target audience: **18 and over**
- account creation: **No accounts**
- government, financial or health app: **No**
- data safety — data collected by the developer: **No**
- data safety — data shared with third parties by the developer: **No**
- precise and approximate location: processed only on the device for the core
  recording function; it leaves the app only through a user-initiated Android
  share/export action
- privacy policy: `https://fenlanddavid.github.io/findspot/companion-privacy.html`

## Store listing copy

Short description:

> Record reliable GPS trails while your Android phone is locked.

Full description:

> FindSpot Companion is the native background field recorder for FindSpot.
> Start and stop a trail from an active FindSpot session, lock your phone and
> keep walking while Android records the route through a visible foreground
> service. Completed recordings can be shared back into FindSpot as validated
> JSON or exported as GPX.
>
> Recordings stay on your device until you explicitly share, export or delete
> them. Companion has no advertising, analytics, account system or internet
> permission.
>
> This is beta software. Complete a short test on your phone before relying on
> it during fieldwork.

Suggested category: **Maps & Navigation**.
