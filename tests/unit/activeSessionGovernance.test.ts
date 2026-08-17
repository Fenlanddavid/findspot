import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ADR_PATH = 'docs/adr/0002-retire-classic-active-session.md';

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Classic active-session governance', () => {
  it('records the accepted retirement and rollback ruling verbatim', () => {
    const adr = read(ADR_PATH).replaceAll('\n', ' ');

    expect(adr).toContain('Classic active Session is retired.');
    expect(adr).toContain(
      'The automated parity gate replaced the planned reversible-preview gate by explicit product decision on 16 August 2026.',
    );
    expect(adr).toContain(
      'Rollback of the workspace now means code rollback to the prior release, not a user-facing runtime switch.',
    );
  });

  it('makes the ADR authoritative from every current V5 decision record', () => {
    const governedRecords = [
      'docs/programmes/v5-product-engineering-brief.md',
      'docs/programmes/v5-handoff-2026-08-15.md',
      'docs/programmes/v5-session-parity-audit.md',
      'docs/programmes/v5-shipped-state-inventory.md',
      'docs/programmes/v5-ux-safety-gates.md',
    ];

    for (const path of governedRecords) {
      expect(read(path), path).toContain(ADR_PATH);
    }
  });

  it('does not retain the superseded runtime rollback requirements as live gates', () => {
    const currentProgrammeText = [
      read('docs/programmes/v5-product-engineering-brief.md'),
      read('docs/programmes/v5-handoff-2026-08-15.md'),
    ].join('\n');

    for (const supersededRequirement of [
      'restores the classic Session screen',
      'classic-navigation escape',
      'classic workflow reachability',
      'switch off mid-session',
      'switch-off mid-session',
      'classic navigation remains reachable',
      'escape to classic navigation',
      'Run workspace and continuity previews independently',
      'v5ActiveSessionPreview',
    ]) {
      expect(currentProgrammeText).not.toContain(supersededRequirement);
    }
  });
});
