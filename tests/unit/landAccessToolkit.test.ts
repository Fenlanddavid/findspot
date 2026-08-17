import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  LAND_ACCESS_AGREEMENT_TEMPLATE,
  LAND_ACCESS_SECTIONS,
} from '../../src/content/landAccessGuidance';

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('land access approach toolkit', () => {
  it('covers the six approach and retention questions without treating ownership as consent', () => {
    expect(LAND_ACCESS_SECTIONS.map(section => section.id)).toEqual([
      'who-can-say-yes',
      'finding-who-to-ask',
      'the-approach',
      'what-to-offer',
      'the-agreement',
      'keeping-permission',
    ]);

    const copy = JSON.stringify(LAND_ACCESS_SECTIONS);
    expect(copy).toMatch(/owner and occupier/i);
    expect(copy).toMatch(/title result does not identify the occupier/i);
    expect(copy).toMatch(/ownership is unknown/i);
    expect(copy).toMatch(/“No” is a complete answer/i);
    expect(copy).toMatch(/landowner report after each visit/i);
  });

  it('makes the refusal and private-home safeguards explicit', () => {
    const copy = JSON.stringify(LAND_ACCESS_SECTIONS);
    expect(copy).toMatch(/Do not arrive unannounced at a private home/i);
    expect(copy).toMatch(/Do not pressure, bargain after a refusal or approach repeatedly/i);
    expect(copy).not.toMatch(/keep asking|try another channel|wear them down|do not take no/i);
  });

  it('provides a copyable agreement starting point with separate owner and occupier terms', () => {
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/Landowner \/ freeholder:/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/Occupier \/ tenant \(if different\):/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/LAND AND DURATION/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/ACCESS/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/CROPS AND LIVESTOCK/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/Non-Treasure finds/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/PAS \/ HER recording/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/within 14 days/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/INSURANCE/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/TERMINATION/);
    expect(LAND_ACCESS_AGREEMENT_TEMPLATE).toMatch(/does not provide legal advice/);
  });

  it('is reachable from every required surface and frames the existing report for the landowner', async () => {
    const [app, allPermissions, home, permission, discover] = await Promise.all([
      source('../../src/App.tsx'),
      source('../../src/pages/AllPermissions.tsx'),
      source('../../src/pages/Home.tsx'),
      source('../../src/pages/Permission.tsx'),
      source('../../src/pages/Discover.tsx'),
    ]);

    expect(app).toContain('path="/land-access"');
    for (const surface of [allPermissions, home, permission, discover]) {
      expect(surface).toContain('/land-access');
    }
    expect(permission).toContain('Report for the landowner');
    expect(permission).toContain('Promise it up front, then share it after visits');
    expect(permission).toContain('Landowner report');
  });

  it('remains static guidance with no engine or persistence dependency', async () => {
    const [page, content] = await Promise.all([
      source('../../src/pages/LandAccess.tsx'),
      source('../../src/content/landAccessGuidance.ts'),
    ]);
    const implementation = `${page}\n${content}`;

    expect(implementation).not.toMatch(/fieldGuideAnalysis|src\/engines|from ['"].*\/db['"]|pagePersistence|useLiveQuery/);
    expect(implementation).not.toMatch(/landownerName|landownerPhone|landownerEmail|landownerAddress/);
  });

  it('leaves the analysis engine snapshots byte-identical', async () => {
    const [engineSnapshot, fieldGuideSnapshot] = await Promise.all([
      source('./__snapshots__/engine.snapshot.test.ts.snap'),
      source('./__snapshots__/fieldGuideAnalysis.test.ts.snap'),
    ]);
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

    expect(sha256(engineSnapshot)).toBe('dda1c1b7e69947683bd67d3fa2c40e9ca09aa1f4d2c86de9f658d3004ee937fc');
    expect(sha256(fieldGuideSnapshot)).toBe('64dce733c7336a5dd922d843229f1581993abf3b537b64da5bae144300388904');
  });
});
