import { db } from '../db';

/**
 * Query-only page boundary. Pages consume live Dexie collections through this
 * service while all mutations remain in domain-specific mutation services.
 *
 * Keeping the table list explicit prevents pages from gaining ambient access
 * to new persistence surfaces when the database schema grows.
 */
export const pagePersistence = {
  projects: db.projects,
  permissions: db.permissions,
  fields: db.fields,
  sessions: db.sessions,
  finds: db.finds,
  significantFinds: db.significantFinds,
  media: db.media,
  tracks: db.tracks,
  settings: db.settings,
  importedPackages: db.importedPackages,
  savedPoints: db.savedPoints,
  undugSignals: db.undugSignals,
} as const;
