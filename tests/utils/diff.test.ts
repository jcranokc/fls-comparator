/**
 * Tests for lib/utils/diff.ts and lib/utils/format.ts (buildSetupUrl)
 */
import { describe, it, expect } from 'vitest';
import { computeDiff, filterDifferencesOnly } from '../../lib/utils/diff';
import { buildSetupUrl } from '../../lib/utils/format';
import type { FLSSnapshot, FieldPermissionRecord } from '../../lib/api/types';

function makeSnapshot(permissions: FieldPermissionRecord[], overrides?: Partial<FLSSnapshot>): FLSSnapshot {
  return {
    id: 'test-id',
    label: 'Test Snapshot',
    capturedAt: '2024-01-01T00:00:00Z',
    org: { instanceUrl: 'https://test.salesforce.com', orgId: '00D000000000001' },
    objectApiName: 'Contact',
    fieldApiName: 'Email',
    permissions,
    ...overrides,
  };
}

function makePerm(name: string, read: boolean, edit: boolean, type: 'Profile' | 'PermissionSet' = 'Profile'): FieldPermissionRecord {
  return {
    id: `perm-${name}`,
    name,
    label: name,
    type,
    permissionsRead: read,
    permissionsEdit: edit,
  };
}

describe('computeDiff', () => {
  it('should return MATCH for identical permissions', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', true, true)]);

    const result = computeDiff(source, target);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('MATCH');
    expect(result.summary.matching).toBe(1);
    expect(result.summary.differing).toBe(0);
  });

  it('should detect READ_DIFFERS', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', false, true)]);

    const result = computeDiff(source, target);

    expect(result.rows[0].status).toBe('READ_DIFFERS');
    expect(result.summary.differing).toBe(1);
  });

  it('should detect EDIT_DIFFERS', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', true, false)]);

    const result = computeDiff(source, target);

    expect(result.rows[0].status).toBe('EDIT_DIFFERS');
  });

  it('should detect BOTH_DIFFER', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', false, false)]);

    const result = computeDiff(source, target);

    expect(result.rows[0].status).toBe('BOTH_DIFFER');
  });

  it('should detect MISSING_IN_TARGET', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([]);

    const result = computeDiff(source, target);

    expect(result.rows[0].status).toBe('MISSING_IN_TARGET');
    expect(result.rows[0].target).toBeNull();
    expect(result.summary.missingInTarget).toBe(1);
  });

  it('should detect NEW_IN_TARGET', () => {
    const source = makeSnapshot([]);
    const target = makeSnapshot([makePerm('Admin', true, true)]);

    const result = computeDiff(source, target);

    expect(result.rows[0].status).toBe('NEW_IN_TARGET');
    expect(result.rows[0].source).toBeNull();
    expect(result.summary.newInTarget).toBe(1);
  });

  it('should match by name (not ID) for cross-org comparison', () => {
    const source = makeSnapshot([
      { id: 'org1-id', name: 'Admin', label: 'System Admin', type: 'Profile', permissionsRead: true, permissionsEdit: true },
    ]);
    const target = makeSnapshot([
      { id: 'org2-id', name: 'Admin', label: 'System Administrator', type: 'Profile', permissionsRead: true, permissionsEdit: false },
    ]);

    const result = computeDiff(source, target);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('EDIT_DIFFERS');
    expect(result.rows[0].name).toBe('Admin');
  });

  it('should sort profiles before permission sets', () => {
    const source = makeSnapshot([
      makePerm('ZetaPermSet', true, false, 'PermissionSet'),
      makePerm('AlphaProfile', true, true, 'Profile'),
      makePerm('BetaProfile', false, false, 'Profile'),
    ]);
    const target = makeSnapshot([
      makePerm('ZetaPermSet', true, false, 'PermissionSet'),
      makePerm('AlphaProfile', true, true, 'Profile'),
      makePerm('BetaProfile', false, false, 'Profile'),
    ]);

    const result = computeDiff(source, target);

    expect(result.rows[0].type).toBe('Profile');
    expect(result.rows[1].type).toBe('Profile');
    expect(result.rows[2].type).toBe('PermissionSet');
  });

  it('should handle complex multi-row diffs', () => {
    const source = makeSnapshot([
      makePerm('Admin', true, true, 'Profile'),
      makePerm('Standard', true, false, 'Profile'),
      makePerm('CustomPS', false, false, 'PermissionSet'),
      makePerm('OnlyInSource', true, true, 'PermissionSet'),
    ]);
    const target = makeSnapshot([
      makePerm('Admin', true, true, 'Profile'),      // MATCH
      makePerm('Standard', false, true, 'Profile'),   // BOTH_DIFFER
      makePerm('CustomPS', true, false, 'PermissionSet'), // READ_DIFFERS
      makePerm('OnlyInTarget', false, false, 'PermissionSet'), // NEW_IN_TARGET
    ]);

    const result = computeDiff(source, target);

    expect(result.summary.total).toBe(5);
    expect(result.summary.matching).toBe(1);
    expect(result.summary.differing).toBe(2);
    expect(result.summary.missingInTarget).toBe(1);
    expect(result.summary.newInTarget).toBe(1);
  });
});

describe('computeDiff — sourceId / targetId propagation', () => {
  it('populates sourceId and targetId when both sides exist', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', true, true)]);

    const { rows } = computeDiff(source, target);

    expect(rows[0].sourceId).toBe('perm-Admin');
    expect(rows[0].targetId).toBe('perm-Admin');
  });

  it('sets only sourceId for MISSING_IN_TARGET rows', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([]);

    const { rows } = computeDiff(source, target);

    expect(rows[0].sourceId).toBe('perm-Admin');
    expect(rows[0].targetId).toBeUndefined();
  });

  it('sets only targetId for NEW_IN_TARGET rows', () => {
    const source = makeSnapshot([]);
    const target = makeSnapshot([makePerm('Sales', false, false, 'PermissionSet')]);

    const { rows } = computeDiff(source, target);

    expect(rows[0].sourceId).toBeUndefined();
    expect(rows[0].targetId).toBe('perm-Sales');
  });

  it('preserves distinct IDs for cross-org rows (same name, different IDs)', () => {
    const source = makeSnapshot([
      { id: 'org1-abc', name: 'Admin', label: 'System Admin', type: 'Profile', permissionsRead: true, permissionsEdit: true },
    ]);
    const target = makeSnapshot([
      { id: 'org2-xyz', name: 'Admin', label: 'System Admin', type: 'Profile', permissionsRead: true, permissionsEdit: false },
    ]);

    const { rows } = computeDiff(source, target);

    expect(rows[0].sourceId).toBe('org1-abc');
    expect(rows[0].targetId).toBe('org2-xyz');
  });
});

describe('buildSetupUrl', () => {
  it('generates a PermSet setup URL', () => {
    const url = buildSetupUrl('https://myorg.lightning.force.com', '0PS000000000001', 'PermissionSet');
    expect(url).toBe('https://myorg.lightning.force.com/lightning/setup/PermSets/page?address=%2F0PS000000000001');
  });

  it('generates a Profile setup URL', () => {
    const url = buildSetupUrl('https://myorg.lightning.force.com', '00e000000000001', 'Profile');
    expect(url).toBe('https://myorg.lightning.force.com/lightning/setup/Profiles/page?address=%2F00e000000000001');
  });

  it('strips no trailing slash from instanceUrl', () => {
    const url = buildSetupUrl('https://myorg.lightning.force.com', 'abc123', 'PermissionSet');
    expect(url).toContain('force.com/lightning');
  });
});

describe('filterDifferencesOnly', () => {
  it('should filter out MATCH rows', () => {
    const source = makeSnapshot([
      makePerm('Admin', true, true),
      makePerm('Standard', true, false),
    ]);
    const target = makeSnapshot([
      makePerm('Admin', true, true),
      makePerm('Standard', false, false),
    ]);

    const fullDiff = computeDiff(source, target);
    const filtered = filterDifferencesOnly(fullDiff);

    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].name).toBe('Standard');
    expect(filtered.rows[0].status).toBe('READ_DIFFERS');
  });

  it('should return empty when all match', () => {
    const source = makeSnapshot([makePerm('Admin', true, true)]);
    const target = makeSnapshot([makePerm('Admin', true, true)]);

    const fullDiff = computeDiff(source, target);
    const filtered = filterDifferencesOnly(fullDiff);

    expect(filtered.rows).toHaveLength(0);
  });
});
