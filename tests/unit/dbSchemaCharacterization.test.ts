import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FindSpotDB } from '../../src/db';

const databaseNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  databaseNames.clear();
});

describe('current FindSpot persistence schema', () => {
  it('exposes the characterized live Dexie table set', async () => {
    const name = `findspot-schema-characterization-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const database = new FindSpotDB(name);
    await database.open();

    expect(database.tables.map(table => table.name).sort()).toMatchInlineSnapshot(`
      [
        "diagnosticLog",
        "fieldGuideCache",
        "fields",
        "findHotspotSignals",
        "finds",
        "geocodeCache",
        "geologyContext",
        "hotspotPredictionAggregates",
        "hotspotPredictions",
        "importedPackages",
        "landscapeInterpretations",
        "media",
        "outstandingQuestions",
        "permissionSections",
        "permissions",
        "projects",
        "questionNotes",
        "savedPoints",
        "sessionCoverage",
        "sessions",
        "settings",
        "significantFinds",
        "tracks",
        "undugSignals",
      ]
    `);

    database.close();
  });
});
