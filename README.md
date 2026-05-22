# FindSpot UK — Offline Metal Detecting Find Logger

This is a PWA-style web app (Vite + React + TypeScript) for metal detectorists to record finds in the field, even without a data connection. It uses **Dexie (IndexedDB)** for local storage and **MapLibre GL** for mapping.

## Features
- **Offline First:** All data is stored locally on your device.
- **Permissions Management:** Record land permissions with land type, crop info, and GPS coordinates.
- **Find Recording:** Log finds with PAS-compatible fields (Object Type, Period, Material, Weight, etc.).
- **Photo Documentation:** Attach photos to finds with digital scale bar calibration.
- **Interactive Map:**
  - Cluster views for high-density areas.
  - Filters by Land Type, Object Type, and Date.
  - One-tap "Permission Here" to quickly start a session.
- **Professional Reports:** Generate PDF field reports for landowners or your own records.
- **Data Portability:** Export data as CSV or JSON (Backup/Restore).

## Copyright & IP
© 2026 FindSpot. All rights reserved.

FindSpot, FieldGuide, FindShare, Club/Rally Reports, Landowner Reports and
associated landscape analysis, reporting, agreement, event-sharing, club/rally
administration and field-recording workflows are proprietary to FindSpot.

FieldGuide is FindSpot's proprietary landscape intelligence engine. It combines
terrain, LiDAR, satellite imagery, historic mapping, environmental, hydrology
and archaeological context to highlight areas of likely past activity. FindSpot
does not claim ownership of third-party source datasets, but the selection,
combination, sequencing, transformation, weighting, scoring, classification and
generated interpretation of those datasets within FieldGuide remain the
intellectual property of FindSpot.

Users retain ownership of their own finds records, photographs, permission
information, field boundaries and locally stored data. FindSpot retains
ownership of the application, source code, interface design, branding,
FieldGuide engine, report templates, agreement templates, share-card formats,
Club/Rally Pack workflows, Club/Rally Reports, organiser merge flows, member
export flows, classification language, interpretation structure, scoring
systems and associated workflows.

FieldGuide outputs, report templates, scan results, generated interpretation
systems and branded workflows may not be copied, scraped, reverse engineered,
commercially reused, used to train or benchmark competing systems, or used to
recreate a competing product without written permission.

This product notice is not legal advice. Final wording should be reviewed by a
UK IP solicitor before commercial release, formal licensing, investment,
app-store publication or partnership use.

## Setup
1) Install dependencies:
```bash
npm install
```

2) Run:
```bash
npm run dev
```

## Credits
Sister app to FossilMap. Designed for UK detectorists.
