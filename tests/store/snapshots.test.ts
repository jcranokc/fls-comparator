/**
 * Tests for lib/store/snapshots.ts
 *
 * Uses fakeBrowser for in-memory storage and vi.resetModules() so each test
 * gets a fresh snapshotsItem/settingsItem backed by the just-cleared storage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { FLSSnapshot } from '../../lib/api/types';

type SnapshotsModule = typeof import('../../lib/store/snapshots');

function makeTestSnapshot(overrides?: Partial<FLSSnapshot>): FLSSnapshot {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    label: 'Test Snapshot',
    capturedAt: new Date().toISOString(),
    org: { instanceUrl: 'https://test.salesforce.com', orgId: '00D000000000001' },
    objectApiName: 'Contact',
    fieldApiName: 'Email',
    permissions: [
      {
        id: 'perm-1',
        name: 'Admin',
        label: 'System Administrator',
        type: 'Profile',
        permissionsRead: true,
        permissionsEdit: true,
      },
    ],
    ...overrides,
  };
}

describe('Snapshot Storage', () => {
  let mod: SnapshotsModule;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();
    mod = await import('../../lib/store/snapshots');
  });

  describe('saveSnapshot', () => {
    it('should save a snapshot', async () => {
      const snapshot = makeTestSnapshot({ id: 'save-test' });
      await mod.saveSnapshot(snapshot);

      const loaded = await mod.loadSnapshots();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('save-test');
    });

    it('should save multiple snapshots', async () => {
      await mod.saveSnapshot(makeTestSnapshot({ id: '1' }));
      await mod.saveSnapshot(makeTestSnapshot({ id: '2' }));
      await mod.saveSnapshot(makeTestSnapshot({ id: '3' }));

      const loaded = await mod.loadSnapshots();
      expect(loaded).toHaveLength(3);
    });
  });

  describe('loadSnapshot', () => {
    it('should load a specific snapshot by ID', async () => {
      await mod.saveSnapshot(makeTestSnapshot({ id: 'find-me', label: 'Target' }));
      await mod.saveSnapshot(makeTestSnapshot({ id: 'other', label: 'Other' }));

      const found = await mod.loadSnapshot('find-me');
      expect(found).not.toBeNull();
      expect(found!.label).toBe('Target');
    });

    it('should return null for non-existent ID', async () => {
      const found = await mod.loadSnapshot('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('deleteSnapshot', () => {
    it('should remove a snapshot by ID', async () => {
      await mod.saveSnapshot(makeTestSnapshot({ id: 'keep' }));
      await mod.saveSnapshot(makeTestSnapshot({ id: 'delete-me' }));

      await mod.deleteSnapshot('delete-me');

      const loaded = await mod.loadSnapshots();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('keep');
    });
  });

  describe('updateSnapshotLabel', () => {
    it('should update the label of a snapshot', async () => {
      await mod.saveSnapshot(makeTestSnapshot({ id: 'update-me', label: 'Old Label' }));

      await mod.updateSnapshotLabel('update-me', 'New Label');

      const found = await mod.loadSnapshot('update-me');
      expect(found!.label).toBe('New Label');
    });
  });

  describe('exportSnapshotAsJson', () => {
    it('should return a JSON blob', () => {
      const snapshot = makeTestSnapshot({ id: 'export-test' });
      const blob = mod.exportSnapshotAsJson(snapshot);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/json');
    });
  });
});
