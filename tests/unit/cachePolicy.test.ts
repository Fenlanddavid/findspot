import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CACHE_POLICIES } from '../../src/shared/cachePolicy';
import { BACKUP_TABLE_REGISTRY } from '../../src/services/backup/tableRegistry';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe('cache policy registry', () => {
  it('classifies every IndexedDB cache in both registries with matching backup treatment', () => {
    const backupCacheTables = Object.entries(BACKUP_TABLE_REGISTRY)
      .filter(([, registration]) => registration.storageRole === 'cache')
      .map(([name]) => name);
    const policyCacheTables = Object.values(CACHE_POLICIES)
      .filter(policy => policy.storageLayer === 'indexeddb')
      .map(policy => policy.indexedDbTable);

    expect(sorted(new Set(policyCacheTables))).toEqual(sorted(backupCacheTables));

    for (const tableName of policyCacheTables) {
      expect(tableName).toBeDefined();
      const registration = BACKUP_TABLE_REGISTRY[tableName!];
      expect(registration.storageRole).toBe('cache');
      expect(registration.classification).toBe('excluded');
    }
  });

  it('requires complete ownership and invalidation metadata', () => {
    for (const [id, policy] of Object.entries(CACHE_POLICIES)) {
      expect(policy.owner.trim(), `${id} owner`).not.toBe('');
      expect(policy.invalidationOwner.trim(), `${id} invalidation owner`).not.toBe('');
      if (policy.expiry.strategy === 'ttl') {
        expect(policy.expiry.durationMs, `${id} TTL`).toBeGreaterThan(0);
      }
    }
  });

  it('makes every TTL consumer read its registered duration', async () => {
    for (const [id, policy] of Object.entries(CACHE_POLICIES)) {
      if (policy.expiry.strategy !== 'ttl') continue;
      const source = await readFile(new URL(`../../${policy.owner}`, import.meta.url), 'utf8');
      expect(source, `${id} must consume its registered TTL`)
        .toContain(`CACHE_POLICIES.${id}.expiry.durationMs`);
    }
  });
});
