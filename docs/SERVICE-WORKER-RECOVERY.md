# Service-worker recovery

FindSpot uses revisioned Workbox precaching, removes outdated precaches, and asks the user before activating a waiting application version. Third-party map/data caching is managed by explicit FindSpot cache helpers rather than a broad service-worker runtime rule. Companion share-target files use a versioned, single-purpose cache; obsolete share caches are removed during activation.

If a deployment or cached application shell is broken:

1. Close every FindSpot tab.
2. Reopen FindSpot while online and reload once so the current service worker can install and activate.
3. If that fails, use the browser's site settings/developer tools to unregister the FindSpot service worker and delete **Cache Storage only**, then reload online.
4. Do not clear site data, IndexedDB or browser storage unless a verified external backup exists and data loss is intended.

Service-worker and Cache Storage recovery must never automatically delete IndexedDB. The production PWA test verifies an installed release reloads from its application-shell cache while offline; Companion handoff tests exercise the production share target.
