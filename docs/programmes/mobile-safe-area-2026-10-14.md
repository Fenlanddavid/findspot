# Mobile navigation safe area

## Checkpoint

2026-10-14. User reported a white strip below the live app's bottom navigation
on a Pixel 10 Pro, with screenshot `/home/david/Downloads/2453.png`.
Baseline: deployed v5.0.23, `d417aee1b1f146134c1c302141d57449213b51bc`;
deployment run 38480362527 succeeded.
Preserve the unrelated existing edits to
`docs/permission-decompose-stage0-checklist.md` and `scripts/README-datasets.md`.

## Diagnosis and changes

The screenshot shows the gesture-bar area outside the dark bottom navigation.
The existing viewport omitted `viewport-fit=cover`; the root declared
`color-scheme: light dark`, permitting light native UI even while the app's
explicit `dark` class paints dark content. This is a likely explanation,
not a physical-device reproduction of the OS drawing path.

- Opt into edge-to-edge rendering through the viewport meta tag.
- Match root canvas and native colour scheme to the actual app theme; keep the
  colour-scheme meta hint in sync during startup and theme changes.
- Extend the navigation background into the gesture area while keeping links
  above it. Use maximum safe-area padding with a dynamic bottom offset to avoid
  repeatedly resizing the bar during Chrome UI transitions.
- Respect top/side safe areas on the existing app shell so cutouts do not obscure
  header controls when the viewport covers the full display.
- Preserve the existing green theme colour and iOS focus-zoom policy.

Sources: [Chrome edge-to-edge migration guide](https://developer.chrome.com/docs/css-ui/edge-to-edge)
and [CSS colour scheme documentation](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme).

## Validation

Five browser checks passed with Chromium 155: dark app/light device, light
app/dark device, simulated 24 px bottom and 28 px top safe areas, stable navigation
height as the bottom inset retracts, clickable navigation, and existing
FieldGuide panel/layer controls including enlarged text. Root colours and meta
colour scheme follow the app theme. The bottom of the viewport is covered by
the navigation; links remain above the simulated gesture area. Screenshots:
`/tmp/findspot-safe-area-dark.png`, `/tmp/findspot-safe-area-light.png`.
The iOS viewport-policy suite passed all three tests, preserving edge-to-edge
while leaving Android's zoom policy untouched.

Browser emulation cannot prove the Pixel's native system-bar rendering; final
confirmation remains on the user's device after the patch is deployed.

Patch release **5.0.24** is prepared, with the update banner “Fix phone navigation
backgrounds and safe-area spacing.” Package, lockfile and release metadata agree.
The full repository checks pass: 163 test files, 1,348 passing tests and one
existing skip. Release guard and TypeScript pass; production/PWA build passes
with 120 precached assets. Both new theme/safe-area checks also pass against the
production preview. Logs: `/tmp/findspot-safe-area-{full-tests,browser,production,release,build}.log`.

`git diff v5.0.22..d417aee -- index.html src/index.css src/App.tsx` is empty:
the hillfort release did not introduce viewport/theme/layout changes in these
files. A browser update or opening mode could expose the longstanding gap, but
the screenshot does not establish the exact trigger. No native Pixel rendering
claim is made from the emulated tests. This follow-up patch has not been
committed, pushed or deployed in this step.

## Push authorization

The user explicitly requested pushing v5.0.24 on 2026-10-14. Publish the tested
safe-area patch and its release metadata to `main`; leave the two unrelated
documentation edits untouched. CI/deployment and the user's Pixel confirmation
remain pending at commit time.

## CI correction

The first v5.0.24 deployment attempt, run 38484097837, failed only the two
existing browser viewport-policy expectations. They still expected the pre-fix
meta string; actual iPhone/Android values correctly preserve `viewport-fit=cover`.
The viewport-policy unit expectations had been updated, but these two browser
assertions were missed. Update both exact expected values while retaining iOS's
`maximum-scale=1.0` and Android's unrestricted zoom policy. Do not revert the
safe-area implementation or weaken the assertions. CI passed 118 other browser
tests and the unit, worker and Android jobs; deployment was skipped. Keep version
5.0.24 because it has not yet deployed or received a release tag.

After correction, all four focused Chromium browser checks passed: both viewport
policies and both mobile theme/safe-area cases. All three viewport-policy unit
tests, release validation and diff whitespace checks also passed. The new CI run
must confirm deployment; physical Pixel verification remains with the user.

## Physical Pixel inspection — 2026-10-14 evening

Wireless ADB pairing and Chrome remote debugging succeeded after USB failed to
enumerate the phone. Device: Pixel 10 Pro, Android 17 / SDK 37, Chrome
155.0.8059.39. The affected window is Chrome's installed-app
`SameTaskWebApkActivity`, and the page reports `display-mode: standalone`.

The white strip is physically reproduced. It occupies Android's native
navigation-bar rectangle `[0,2315][1080,2410]`, 95 physical pixels high. The
web content ends exactly at that boundary: its visual viewport is about
411.43 × 816.38 CSS pixels at DPR 2.625, below a 172-pixel native status bar.

The deployed page already has the preceding safe-area changes:

- `viewport-fit=cover` is present.
- The root and meta colour scheme are `dark`; HTML/body background is
  `rgb(17,24,39)`.
- The bottom navigation background is `rgba(3,7,18,0.95)` and its bottom edge
  equals the visual viewport's bottom edge.
- Both `safe-area-inset-bottom` and `safe-area-max-inset-bottom` resolve to
  **0px** in this installed-app window. The page is not receiving the 95-pixel
  native gesture region as part of its viewport.

A reversible live test changed only the page's `theme-color` from green to
`#030712`. The native top bar changed to dark, while the native bottom strip
remained white. The original `#10b981` value was restored. No Chrome feature
flags, Android settings, stored FindSpot data or installations were changed.

The installed wrapper's embedded metadata was inspected without reinstalling:
its start URL and manifest URL match FindSpot; `themeColor` is green,
`backgroundColor` is `-1L` (opaque white), and both dark colour overrides are
empty. Its Android package was last updated on 2026-08-25. The current Vite
manifest also declares `background_color: #ffffff`. This identifies a separate
native background setting, but does **not** prove that changing that manifest
field alone will repaint this native bar in the current Chrome build.

Chromium's installed-web-app implementation has its own native inset consumer
and system-bar colouring path. Its documentation describes a separately gated
standalone edge-to-edge path; the exact installed Chrome build also gates
navigation-bar theme colouring. CSS on the page cannot paint a rectangle that
the native window has excluded from the page viewport. The earlier browser
emulation therefore verified the page's safe-area behaviour, but did not
reproduce or resolve this native-window path.

Primary references:

- [Chromium Android web-app architecture](https://chromium.googlesource.com/chromium/src/+/HEAD/components/webapps/docs/android_architecture.md#Display-Modes-and-Immersive-Mode)
- [Installed build: WebappInsetsConsumer](https://chromium.googlesource.com/chromium/src/+/3ff7ac5a9224be9156d7f8703a06e22890aafd34/chrome/android/java/src/org/chromium/chrome/browser/customtabs/features/WebappInsetsConsumer.java)
- [Installed build: WebappIntentDataProvider](https://chromium.googlesource.com/chromium/src/+/3ff7ac5a9224be9156d7f8703a06e22890aafd34/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappIntentDataProvider.java)
- [Installed build: WebappActivity background](https://chromium.googlesource.com/chromium/src/+/3ff7ac5a9224be9156d7f8703a06e22890aafd34/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappActivity.java)

Diagnostic evidence is retained privately under `/tmp`: the physical screen
before testing, the web-only screenshot, viewport/style measurements, the
temporary theme-colour test screenshot and decoded wrapper metadata. Screenshots
contain on-device user content and are not added to the repository. A regular
browser comparison was attempted, but phone navigation capturing handed the URL
back into the installed app; do not describe that as a successful browser-mode
comparison. The temporary blank tab was closed.

Confirmed: the remaining strip belongs to the native installed-app window, and
the preceding CSS fix is loaded. Still unverified: an app-side manifest change
or native/browser configuration that repaints it correctly in both themes.
Do not ship another padding-only patch or mark the physical-device fix complete
from this diagnosis. A controlled native/browser test is the next step; any
Chrome-wide restart or persistent feature-flag test should be agreed separately.

## Verified browser workaround and contrast follow-up

Following the user's request to implement a fix, tested Chrome's
`chrome://flags/#web-app-short-edges-cutout-mode` on the connected Pixel. Its
installed description explicitly covers standalone PWAs with `viewport-fit=cover`.
Changed this single flag from **Default** to **Enabled**, used Chrome's Relaunch
button, and reopened FindSpot. The setting is left enabled as the working phone
workaround. To undo it, return this flag to Default and relaunch Chrome.

Physical screenshots confirm the white strip is gone on Home and Field Guide.
The standalone visual viewport now spans approximately 411.43 × 918.10 CSS
pixels, including the system bars. Both bottom safe-area variables now resolve
to **37px**. The navigation ends at 918.10px and its links end at 874.70px,
above the gesture inset. Home → Field Guide → Home navigation succeeded without
running scans or modifying stored app records.

Enabling edge-to-edge also exposed a separate contrast problem: Chrome chooses
dark status-bar icons from the fixed green theme colour, while the page beneath
them is dark. A live `#111827` theme-colour test produces white status icons and
retains the dark bottom gesture area. Temporary page colour overrides were
restored to the deployed green value after testing; the improved status-icon
contrast requires the app patch to be released.

The local app follow-up changes `index.html` and `src/App.tsx` to match theme
colour to the actual page background (`#111827` dark / `#f9fafb` light), both
during initial startup and subsequent theme changes. The manifest's launch
branding remains unchanged. `tests/mobileSafeArea.spec.ts` now checks theme
colour during theme changes and after reload. Both focused browser checks pass
with Chromium 155, TypeScript checks pass, and the production/PWA build passes
(120 precached assets; log `/tmp/findspot-pixel-followup-build.log`). A whole-tree whitespace check
reported an existing trailing blank line in the unrelated permission checklist;
the scoped patch passes its own whitespace check.

This is a verified **browser setting workaround on this phone**, plus a local
app contrast correction. A website cannot enable a Chrome feature flag for
other users; do not describe the code change as a universal fix for the native
white-bar bug. No app data was cleared or installations changed. No new release
has been pushed or deployed. Physical screenshots remain private in `/tmp`.

## FieldGuide panel intercepting navigation

The user then reported that FieldGuide's panel covered the primary navigation.
Reproduced by pointer hit-testing on the connected Pixel: the sheet's `z-index:
91` painted above the navigation's `z-index: 50`. The workspace's fixed
`100dvh - 140px` height ignored the actual header, safe areas and navigation
height. Its bottom reached about 924.86 CSS pixels, beyond the 918.10-pixel
viewport, and the panel intercepted all five navigation-link centres. The prior
programmatic route-change check did not establish real tap access.

The local correction:

- Measure the rendered navigation using a ref and ResizeObserver, including
  safe-area padding and text scaling; release the measurement on unmount.
- Let the FieldGuide shell and route fill the remaining space with flex layout,
  replacing the workspace's fixed viewport subtractions. Desktop navigation
  hiding automatically removes its reserved height.
- Isolate normal map overlay stacking inside the workspace. Full-screen mode
  reserves the measured navigation height and respects top/side safe areas.
- Cap the mobile panel to the available map height as well as the viewport.
- Keep the existing embedded active-session shell sizing and navigation policy.

A temporary DOM/CSS preview on the physical Pixel puts the ordinary panel bottom
at approximately 787.17px, above the navigation's 811.93px top. Expanded and
full-screen panel previews also leave all five links unobstructed. An ADB touch
at the actual Home-link position navigated from the expanded FieldGuide to Home.
The phone is left on the normal FieldGuide panel with this temporary layout
preview; a reload or remount replaces the preview with the deployed layout.
No scan was triggered, and the panel's collapsed preference was restored.

Seven focused safe-area/layout browser checks pass, including actual pointer
access in collapsed, expanded and full-screen modes, Pixel insets, enlarged
text, landscape, zero insets and desktop/mobile resizing. Five existing browser
checks pass for FieldGuide keyboard/large-text usability, scroll locking,
iPhone search focus, active-session navigation and reaching Finish from the
session Guide shell. TypeScript, hooks-baseline and scoped whitespace checks
pass. The production/PWA build passes with 120 precached assets; logs are
`/tmp/findspot-panel-navigation-build.log` and `/tmp/findspot-panel-hooks.log`.
The changes have not been published.

## v5.0.25 release authorization

The user requested a version bump, release notes and push after committing all
changes as `bbda068`. Prepare v5.0.25 with the update message “Fix FieldGuide
historic context, panel navigation and phone theme colours.” This includes the
completed-scan evidence summary correction and the tested app layout/contrast
changes. The native white-strip workaround still depends on Chrome's installed
app feature setting; this release cannot enable that flag for other users.
The phone's temporary layout preview is separate from deployment verification.
Use the existing CI-gated Pages workflow and let it tag a successful deployment.

Release preparation, the version/notes guard against v5.0.24, TypeScript and
all three release-automation tests pass. The v5.0.25 production/PWA build passes
with 120 precached assets (`/tmp/findspot-v5.0.25-build.log`). The release patch
passes its whitespace check. Remote `main` was confirmed at `3201951` before
publication; CI/deployment confirmation follows the push.

## v5.0.25 CI camera-race correction

Run `38636152824` passed unit/static checks, worker checks and Android tests.
Its browser run passed 124 cases with one existing skip, but the completed
historic-sheet test expected the synthetic Roman road to intersect the scan
while the initial map flight was still in progress. The trace showed both
fixture routes correctly described as nearby and a scan centre around
53.3983, -1.4781 instead of the requested 53.3811, -1.4701. Canvas visibility and
the Ready to Scan label did not guarantee the camera had reached that position.

The regression now waits for the existing map ref to report the intended
coordinates and a stationary camera before scanning. The scheduled-boundary
regression uses the same state-based wait in place of its fixed 1.5-second
delay. The intersection assertion remains strict; production geometry, scores
and wording are unchanged. v5.0.25 remains the pending release because the
failed workflow did not deploy or tag it.

Both affected browser checks passed three consecutive runs each (six passes,
one worker, 1.7 minutes). The release guard and scoped whitespace checks also
pass. Push this correction through the existing deployment workflow.
