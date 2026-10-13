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
