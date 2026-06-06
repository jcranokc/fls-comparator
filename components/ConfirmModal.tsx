import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface ChangeItem {
  name: string;
  field: string;
  type: 'Profile' | 'PermissionSet';
  currentRead: boolean;
  currentEdit: boolean;
  newRead: boolean;
  newEdit: boolean;
}

export interface ConfirmResult {
  index: number;
  effectiveRead: boolean;
  effectiveEdit: boolean;
}

interface RowState {
  effectiveRead: boolean;
  effectiveEdit: boolean;
}

type TypeFilter = 'all' | 'Profile' | 'PermissionSet';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  changes: ChangeItem[];
  onConfirm: (result: ConfirmResult[]) => void;
  onCancel: () => void;
  loading?: boolean;
}

function Spinner() {
  return (
    <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function initStates(changes: ChangeItem[]): RowState[] {
  return changes.map(c => ({ effectiveRead: c.newRead, effectiveEdit: c.newEdit }));
}

export function ConfirmModal({ open, title, changes, onConfirm, onCancel, loading = false }: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [states, setStates] = useState<RowState[]>(() => initStates(changes));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => { setStates(initStates(changes)); }, [changes]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const toggleVisible = (i: number) =>
    setStates(prev => prev.map((s, j) => {
      if (j !== i) return s;
      if (!s.effectiveRead) return { effectiveRead: true, effectiveEdit: true };
      return { effectiveRead: false, effectiveEdit: false };
    }));

  const toggleReadOnly = (i: number) =>
    setStates(prev => prev.map((s, j) => {
      if (j !== i) return s;
      if (!s.effectiveRead) return { effectiveRead: true, effectiveEdit: false };
      return { ...s, effectiveEdit: !s.effectiveEdit };
    }));

  // Filtered rows retain original indices for state lookup
  const needle = searchQuery.trim().toLowerCase();
  const displayedRows = changes
    .map((change, i) => ({ change, i }))
    .filter(({ change }) => typeFilter === 'all' || change.type === typeFilter)
    .filter(({ change }) => !needle || change.name.toLowerCase().includes(needle));

  // Select-all state scoped to the filtered view
  const allVisibleChecked = displayedRows.length > 0 && displayedRows.every(({ i }) => states[i].effectiveRead);
  const someVisibleChecked = displayedRows.some(({ i }) => states[i].effectiveRead);
  const allReadOnlyChecked = displayedRows.length > 0 && displayedRows.every(({ i }) => states[i].effectiveRead && !states[i].effectiveEdit);
  const someReadOnlyChecked = displayedRows.some(({ i }) => states[i].effectiveRead && !states[i].effectiveEdit);

  const toggleAllVisible = () => {
    setStates(prev => {
      const next = [...prev];
      if (allVisibleChecked) {
        displayedRows.forEach(({ i }) => { next[i] = { effectiveRead: false, effectiveEdit: false }; });
      } else {
        displayedRows.forEach(({ i }) => {
          next[i] = { effectiveRead: true, effectiveEdit: prev[i].effectiveRead ? prev[i].effectiveEdit : true };
        });
      }
      return next;
    });
  };

  const toggleAllReadOnly = () => {
    setStates(prev => {
      const next = [...prev];
      if (allReadOnlyChecked) {
        displayedRows.forEach(({ i }) => { next[i] = { ...prev[i], effectiveEdit: true }; });
      } else {
        displayedRows.forEach(({ i }) => { next[i] = { effectiveRead: true, effectiveEdit: false }; });
      }
      return next;
    });
  };

  const rowsAffected = states.filter((s, i) =>
    s.effectiveRead !== changes[i].currentRead || s.effectiveEdit !== changes[i].currentEdit
  ).length;

  const handleConfirm = () => {
    onConfirm(states.map((s, i) => ({ index: i, effectiveRead: s.effectiveRead, effectiveEdit: s.effectiveEdit })));
  };

  const profileCount = changes.filter(c => c.type === 'Profile').length;
  const permSetCount = changes.filter(c => c.type === 'PermissionSet').length;

  return (
    <div
      ref={overlayRef}
      class="fixed inset-0 z-50 flex items-center justify-center p-4
             bg-black/60 backdrop-blur-sm
             animate-[fadeIn_150ms_ease-out]"
      onClick={(e) => { if (e.target === overlayRef.current && !loading) onCancel(); }}
    >
      <div
        class="w-full max-w-lg bg-slate-800/95 backdrop-blur-md rounded-xl border border-slate-700
               shadow-2xl shadow-black/40
               animate-[scaleIn_150ms_ease-out]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <h2 class="text-base font-semibold text-slate-100">{title}</h2>
          <button
            onClick={onCancel}
            disabled={loading}
            class="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50
                   disabled:opacity-50 transition-all duration-200"
            aria-label="Close"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary + filter */}
        <div class="px-5 pt-3 pb-2 flex items-center justify-between gap-3">
          <p class="text-xs text-slate-400">
            {rowsAffected === 0
              ? <span class="text-slate-500">No changes from current — check boxes below to apply</span>
              : <><span class="text-cyan-400">{rowsAffected}</span> profile{rowsAffected !== 1 ? 's' : ''} will be modified</>
            }
          </p>
          <div class="flex rounded-md overflow-hidden border border-slate-700 text-xs font-medium flex-shrink-0">
            {([
              { id: 'all' as TypeFilter, label: 'All', count: changes.length },
              { id: 'Profile' as TypeFilter, label: 'Profiles', count: profileCount },
              { id: 'PermissionSet' as TypeFilter, label: 'Perm Sets', count: permSetCount },
            ]).map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTypeFilter(id)}
                class={`px-2.5 py-1 transition-colors duration-150 border-r border-slate-700 last:border-r-0
                        ${typeFilter === id
                          ? 'bg-slate-700 text-slate-200'
                          : 'bg-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'}`}
              >
                {label} <span class="opacity-60">({count})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div class="px-5 pb-2">
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filter by name…"
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              class="w-full pl-8 pr-3 py-1.5 text-xs rounded-md
                     bg-slate-700/50 border border-slate-600/50
                     text-slate-200 placeholder-slate-500
                     focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20
                     transition-colors duration-150"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label="Clear search"
              >
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Select-all toolbar */}
        <div class="px-5 py-1.5 flex items-center justify-end gap-4 border-b border-slate-700/30">
          <label class="inline-flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors">
            <input
              type="checkbox"
              checked={allVisibleChecked}
              ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = !allVisibleChecked && someVisibleChecked; }}
              onChange={toggleAllVisible}
              disabled={loading}
              class="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 accent-cyan-500 cursor-pointer disabled:opacity-50"
            />
            All Visible
          </label>
          <label class="inline-flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors">
            <input
              type="checkbox"
              checked={allReadOnlyChecked}
              ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = !allReadOnlyChecked && someReadOnlyChecked; }}
              onChange={toggleAllReadOnly}
              disabled={loading}
              class="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 accent-cyan-500 cursor-pointer disabled:opacity-50"
            />
            All Read Only
          </label>
        </div>

        {/* Table */}
        <div class="px-5 pb-3 max-h-72 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-slate-800/95 backdrop-blur-sm">
              <tr class="text-xs text-slate-400 uppercase tracking-wider border-b border-slate-700/40">
                <th class="text-left py-2 pr-3 font-medium">Permission Set / Profile</th>
                <th class="text-center py-2 px-3 font-medium w-20">Visible</th>
                <th class="text-center py-2 pl-3 font-medium w-20">Read Only</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-700/30">
              {displayedRows.map(({ change, i }) => {
                const visibleChecked = states[i].effectiveRead;
                const readOnlyChecked = states[i].effectiveRead && !states[i].effectiveEdit;
                const visibleOff = !states[i].effectiveRead;
                return (
                  <tr key={i} class="hover:bg-slate-700/10 transition-colors duration-100">
                    <td class="py-2.5 pr-3">
                      <div class="flex items-center gap-2">
                        <div class="text-slate-200 text-sm truncate max-w-[190px]" title={change.name}>
                          {change.name}
                        </div>
                        {typeFilter === 'all' && (
                          <span class={`text-[9px] px-1 py-0.5 rounded flex-shrink-0
                            ${change.type === 'Profile'
                              ? 'bg-purple-500/15 text-purple-400'
                              : 'bg-blue-500/15 text-blue-400'}`}>
                            {change.type === 'Profile' ? 'P' : 'PS'}
                          </span>
                        )}
                      </div>
                      <div class="text-xs text-slate-500 truncate">{change.field}</div>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={visibleChecked}
                        onChange={() => toggleVisible(i)}
                        disabled={loading}
                        class="w-4 h-4 rounded border-slate-500 bg-slate-700 accent-cyan-500
                               cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`${change.name} Visible`}
                      />
                    </td>
                    <td class="py-2.5 pl-3 text-center">
                      <input
                        type="checkbox"
                        checked={readOnlyChecked}
                        onChange={() => toggleReadOnly(i)}
                        disabled={loading}
                        title={visibleOff ? 'Checking this will also enable Visible' : undefined}
                        class={`w-4 h-4 rounded border-slate-500 bg-slate-700 accent-cyan-500
                               cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
                               ${visibleOff ? 'opacity-40 hover:opacity-80' : ''}`}
                        aria-label={`${change.name} Read Only`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700/50">
          <button
            onClick={onCancel}
            disabled={loading}
            class="px-4 py-2 text-sm font-medium rounded-md text-slate-300
                   hover:bg-slate-700/50 hover:text-slate-100
                   disabled:opacity-50 transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || rowsAffected === 0}
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md
                   bg-cyan-500 text-white hover:bg-cyan-400
                   disabled:opacity-70 disabled:cursor-not-allowed
                   focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:ring-offset-2 focus:ring-offset-slate-800
                   transition-all duration-200"
          >
            {loading && <Spinner />}
            {loading ? 'Applying…' : rowsAffected === 0 ? 'No changes' : `Apply to ${rowsAffected} row${rowsAffected !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
