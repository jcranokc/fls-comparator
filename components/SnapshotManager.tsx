import { h } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';
import type { FLSSnapshot } from '../lib/api/types';
import { loadSnapshots, deleteSnapshot, deleteAllSnapshots, downloadSnapshot, importSnapshot, updateSnapshotLabel, updateAllOrgLabels } from '../lib/store/snapshots';
import { SnapshotCard } from './SnapshotCard';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

interface SnapshotManagerProps {
  onCompare?: (snapshot: FLSSnapshot) => void;
  onBulkApply?: (snapshot: FLSSnapshot) => void;
}

type SortOption = 'date' | 'object' | 'org';

export function SnapshotManager({ onCompare, onBulkApply }: SnapshotManagerProps) {
  const [snapshots, setSnapshots] = useState<FLSSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date');
  const [importError, setImportError] = useState('');
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load snapshots on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snaps = await loadSnapshots();
        if (!cancelled) setSnapshots(snaps);
      } catch (err) {
        console.error('[SnapshotManager] Failed to load snapshots:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDelete = useCallback(async (snapshot: FLSSnapshot) => {
    try {
      await deleteSnapshot(snapshot.id);
      setSnapshots(prev => prev.filter(s => s.id !== snapshot.id));
    } catch (err) {
      console.error('[SnapshotManager] Failed to delete snapshot:', err);
    }
  }, []);

  const handleDeleteAll = useCallback(async () => {
    try {
      await deleteAllSnapshots();
      setSnapshots([]);
      setConfirmingDeleteAll(false);
    } catch (err) {
      console.error('[SnapshotManager] Failed to delete all snapshots:', err);
    }
  }, []);

  const handleRename = useCallback(async (id: string, newLabel: string) => {
    try {
      await updateSnapshotLabel(id, newLabel);
      setSnapshots(prev => prev.map(s => s.id === id ? { ...s, label: newLabel } : s));
    } catch (err) {
      console.error('[SnapshotManager] Failed to rename snapshot:', err);
    }
  }, []);

  const handleUpdateOrgLabel = useCallback(async (snapshot: FLSSnapshot, newOrgLabel: string) => {
    try {
      await updateAllOrgLabels(snapshot.org.orgId, newOrgLabel);
      setSnapshots(prev => prev.map(s =>
        s.org.orgId === snapshot.org.orgId
          ? { ...s, org: { ...s.org, orgLabel: newOrgLabel || undefined } }
          : s
      ));
    } catch (err) {
      console.error('[SnapshotManager] Failed to update org label:', err);
    }
  }, []);

  const handleExport = useCallback((snapshot: FLSSnapshot) => {
    downloadSnapshot(snapshot);
  }, []);

  const handleImport = useCallback(async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      setImportError('');
      const imported = await importSnapshot(file);
      setSnapshots(prev => [...prev, imported]);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import snapshot');
    } finally {
      // Reset file input so re-importing the same file works
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const filteredAndSorted = useMemo(() => {
    let result = [...snapshots];

    // Filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.label.toLowerCase().includes(q) ||
        s.objectApiName.toLowerCase().includes(q) ||
        s.fieldApiName.toLowerCase().includes(q) ||
        (s.org.orgLabel ?? '').toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
        case 'object':
          return `${a.objectApiName}.${a.fieldApiName}`.localeCompare(`${b.objectApiName}.${b.fieldApiName}`);
        case 'org': {
          const orgA = a.org.orgLabel || a.org.instanceUrl;
          const orgB = b.org.orgLabel || b.org.instanceUrl;
          return orgA.localeCompare(orgB);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [snapshots, search, sortBy]);

  if (loading) {
    return (
      <div class="space-y-4">
        <LoadingSkeleton type="card" lines={3} />
      </div>
    );
  }

  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar */}
      <div class="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div class="relative flex-1 min-w-[180px]">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search snapshots…"
            class="w-full pl-8 pr-3 py-2 text-sm rounded-md bg-slate-800 border border-slate-700
                   text-slate-200 placeholder-slate-500
                   focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                   transition-all duration-200"
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as SortOption)}
          class="px-3 py-2 text-xs rounded-md bg-slate-800 border border-slate-700
                 text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/40
                 transition-all duration-200 cursor-pointer"
        >
          <option value="date">Sort by Date</option>
          <option value="object">Sort by Object</option>
          <option value="org">Sort by Org</option>
        </select>

        {/* Import button */}
        <label class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md
                      bg-slate-700/50 text-slate-300 border border-slate-600/50
                      hover:bg-slate-700 hover:text-slate-100 hover:border-slate-600
                      cursor-pointer transition-all duration-200">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Import
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            class="hidden"
            onChange={handleImport}
          />
        </label>

        {/* Delete All */}
        {snapshots.length > 0 && (
          confirmingDeleteAll ? (
            <div class="flex items-center gap-1.5 animate-fade-in">
              <span class="text-xs text-rose-400">Delete all {snapshots.length}?</span>
              <button
                onClick={handleDeleteAll}
                class="px-2 py-1 text-xs font-medium rounded bg-rose-600/20 text-rose-400 border border-rose-600/30 hover:bg-rose-600/40 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmingDeleteAll(false)}
                class="px-2 py-1 text-xs font-medium rounded bg-slate-700/50 text-slate-400 border border-slate-600/30 hover:bg-slate-700 transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDeleteAll(true)}
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md
                     bg-rose-500/10 text-rose-400 border border-rose-500/20
                     hover:bg-rose-500/20 hover:border-rose-500/40
                     transition-all duration-200"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete All
            </button>
          )
        )}
      </div>

      {/* Import error */}
      {importError && (
        <div class="flex items-center gap-2 px-3 py-2 rounded-md bg-rose-400/10 border border-rose-400/20 text-rose-400 text-xs">
          <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          {importError}
          <button
            onClick={() => setImportError('')}
            class="ml-auto text-rose-400/60 hover:text-rose-400 transition-colors"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      {snapshots.length === 0 ? (
        <EmptyState
          type="no-snapshots"
          action={{
            label: 'Import Snapshot',
            onClick: () => fileInputRef.current?.click(),
          }}
        />
      ) : filteredAndSorted.length === 0 ? (
        <EmptyState type="no-results" />
      ) : (
        <div class="grid gap-3">
          {filteredAndSorted.map(snapshot => (
            <SnapshotCard
              key={snapshot.id}
              snapshot={snapshot}
              onCompare={onCompare}
              onBulkApply={onBulkApply}
              onExport={handleExport}
              onDelete={handleDelete}
              onRename={handleRename}
              onUpdateOrgLabel={handleUpdateOrgLabel}
            />
          ))}
        </div>
      )}

      {/* Footer count */}
      {snapshots.length > 0 && (
        <div class="text-center text-xs text-slate-500 pt-1">
          {filteredAndSorted.length} of {snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
