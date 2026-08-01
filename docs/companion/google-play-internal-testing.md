# Google Play internal testing handoff

Prepared on 1 August 2026 for package `uk.findspot.companion`.

## Upload artifact

- file: `companion/android/app/build/outputs/bundle/release/app-release.aab`
- version name: `1.0.0-beta.1`
- version code: `1`
- size: 163,740 bytes
- SHA-256: `08cf57325e6d3aeb1ed14856d1e5999bd7c9dca1a2d7f7f5412cc9513c7d7250`
- signing certificate SHA-256: `8852a4c12f0921292416d2467df8de783c3ddf9b693744867cdaec3e5cdc3ce5`

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

## Preserve the signing identity

A release APK has already been published outside Google Play, so do not accept
a different Google-generated app-signing identity. In **App integrity** or the
first release's **App signing** step, choose **Change app signing key** and the
option to export and upload an existing key from a Java keystore. Play Console
will provide the PEPK tool and an encryption public key. Download the tool and
stop there; the encrypted key export can then be generated locally without
revealing the keystore password or uploading the raw keystore.

The raw files below must never be uploaded, emailed or committed:

- `/home/david/.config/findspot/companion-release.keystore`
- `/home/david/.config/findspot/companion-release.password`

After Play App Signing is enrolled, create a separate upload key for later
releases. The current key remains the app-signing identity so an installation
from the existing signed beta can still upgrade to the Play build.

## Internal test

1. Open **Test and release → Testing → Internal testing**.
2. Open **Testers**, create an email list named `FindSpot internal`, and add the
   Google Account used on the test phone.
3. Select **Create new release** and upload `app-release.aab` from the path
   above.
4. Use release name `1.0.0-beta.1` and release notes:

   ```text
   First private beta of FindSpot Companion. Records segmented GPS trails while
   the phone is locked and shares them into FindSpot. Complete a short test
   before relying on it for fieldwork.
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

> FindSpot Companion is the native field recorder for FindSpot. Start a track,
> lock your phone and keep walking while Android records the route through a
> visible foreground service. Pause and resume create separate trail segments,
> and completed recordings can be shared back into FindSpot as validated JSON
> or exported as GPX.
>
> Recordings stay on your device until you explicitly share, export or delete
> them. Companion has no advertising, analytics, account system or internet
> permission.
>
> This is beta software. Complete a short test on your phone before relying on
> it during fieldwork.

Suggested category: **Maps & Navigation**.
