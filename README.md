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
