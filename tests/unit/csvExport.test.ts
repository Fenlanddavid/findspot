import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db';
import { exportToCSV, importClubDayPack } from '../../src/services/data';
import { seedBackupFixture } from '../fixtures/backupFixtureFactories';
import { validClubDayPack } from '../security/fixtures/clubDayHostileCorpus';

function parseCSV(csv: string) {
  const lines = csv.replace(/^\uFEFF/, '').split('\n');
  const cells = (line: string) => Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), match => match[1].replace(/""/g, '"'));
  const headers = cells(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(cells(line).map((value, index) => [headers[index], value])));
}

beforeEach(async () => { await db.open(); await seedBackupFixture(db); });
afterEach(async () => { await db.delete(); });

describe('CSV export trust boundary', () => {
  it.each(['=', '+', '-', '@', '\t', '\r', '\n'])('neutralises leading %j in imported/user text before newline stripping', async prefix => {
    const value = `${prefix}1+2`;
    await db.permissions.update('permission-1', { name: value, landownerName: value });
    await db.finds.update('find-1', { notes: value });
    const [row] = parseCSV(await exportToCSV());
    const expected = `'${value.replace(/\r?\n|\r/g, ' ')}`;
    expect(row['Permission Name']).toBe(expected);
    expect(row['Landowner Name']).toBe(expected);
    expect(row['Find Notes']).toBe(expected);
    expect((await db.permissions.get('permission-1'))?.name).toBe(value);
  });

  it('guards other columns and preserves negative numeric-looking content', async () => {
    await db.finds.update('find-1', { findCode: '-0012', objectType: '=1+2', lon: -1.25, decoration: '@SUM(1,2)' });
    await db.permissions.update('permission-1', { notes: '+1+2', landownerAddress: '=1+2', collector: '=1+2' });
    await db.settings.put({ key: 'ncmdNumber', value: '=1+2' });
    const [row] = parseCSV(await exportToCSV());
    expect(row['Find Code']).toBe("'-0012");
    expect(row.Longitude).toBe("'-1.25");
    expect(row['Object Type']).toBe("'=1+2");
    expect(row.Decoration).toBe("'@SUM(1,2)");
    expect(row['Permission Notes']).toBe("'+1+2");
    expect(row['Landowner Address']).toBe("'=1+2");
    expect(row.Detectorist).toBe("'=1+2");
    expect(row['Membership No']).toBe("'=1+2");
  });

  it('retains BOM, commas, doubled quotes, blank values and flattened notes', async () => {
    await db.finds.update('find-1', { notes: 'First "coin", found\r\non a path\nnear gate\rend', coinType: undefined });
    const csv = await exportToCSV();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"First ""coin"", found on a path near gate end"');
    expect(csv.split('\n')).toHaveLength(2);
    const [row] = parseCSV(csv);
    expect(row['Find Notes']).toBe('First "coin", found on a path near gate end');
    expect(row['Coin Type']).toBe('');
    expect(row['Object Type']).toBe('Coin');
    expect(row['Weight (g)']).toBe('4.2');
  });

  it('neutralises a permission name imported from a Club Day pack only on export', async () => {
    const pack = { ...validClubDayPack(), eventName: '=1+2' };
    const result = await importClubDayPack(JSON.stringify(pack));
    expect(result.permissionId).toBeTruthy();
    expect((await db.permissions.get(result.permissionId!))?.name).toBe('=1+2');
    await db.finds.update('find-1', { permissionId: result.permissionId!, sessionId: null });
    expect(parseCSV(await exportToCSV())[0]['Permission Name']).toBe("'=1+2");
  });
});
