/**
 * Tests for lib/store/history.ts
 * Uses fakeBrowser for in-memory storage; vi.resetModules() gives each test a fresh historyItem.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import type { ApplyHistoryEntry } from '../../lib/api/types';

type HistoryModule = typeof import('../../lib/store/history');

function makeEntry(id: string): ApplyHistoryEntry {
  return {
    id,
    appliedAt: new Date().toISOString(),
    sourceLabel: 'Test Snapshot',
    sourceObjectApiName: 'Contact',
    sourceFieldApiName: 'Email',
    targetObjectApiName: 'Contact',
    targetFieldApiName: 'Email',
    org: { instanceUrl: 'https://test.salesforce.com', orgId: '00D000000000001' },
    changes: [],
  };
}

describe('History Storage', () => {
  let mod: HistoryModule;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();
    mod = await import('../../lib/store/history');
  });

  it('loadHistory returns empty array when nothing is saved', async () => {
    const history = await mod.loadHistory();
    expect(history).toHaveLength(0);
  });

  it('saveHistoryEntry adds an entry', async () => {
    await mod.saveHistoryEntry(makeEntry('e1'));
    const history = await mod.loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('e1');
  });

  it('saveHistoryEntry preserves insertion order (oldest first)', async () => {
    await mod.saveHistoryEntry(makeEntry('first'));
    await mod.saveHistoryEntry(makeEntry('second'));
    const history = await mod.loadHistory();
    expect(history[0].id).toBe('first');
    expect(history[1].id).toBe('second');
  });

  it('trims oldest entry when HISTORY_CAP is exceeded', async () => {
    // Save HISTORY_CAP entries (200), then one more
    const HISTORY_CAP = 200;
    for (let i = 0; i < HISTORY_CAP; i++) {
      await mod.saveHistoryEntry(makeEntry(`entry-${i}`));
    }
    // This 201st entry should evict entry-0
    await mod.saveHistoryEntry(makeEntry('newest'));

    const history = await mod.loadHistory();
    expect(history).toHaveLength(HISTORY_CAP);
    expect(history[0].id).toBe('entry-1');
    expect(history[history.length - 1].id).toBe('newest');
  });

  it('clearHistory empties the store', async () => {
    await mod.saveHistoryEntry(makeEntry('e1'));
    await mod.saveHistoryEntry(makeEntry('e2'));
    await mod.clearHistory();
    const history = await mod.loadHistory();
    expect(history).toHaveLength(0);
  });

  it('markEntryRolledBack sets rolledBack and rollbackEntryId', async () => {
    await mod.saveHistoryEntry(makeEntry('original'));
    await mod.saveHistoryEntry(makeEntry('rollback'));
    await mod.markEntryRolledBack('original', 'rollback');

    const history = await mod.loadHistory();
    const orig = history.find(e => e.id === 'original');
    expect(orig?.rolledBack).toBe(true);
    expect(orig?.rollbackEntryId).toBe('rollback');
  });
});
