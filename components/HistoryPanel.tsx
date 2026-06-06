import { useState, useEffect, useCallback } from 'preact/hooks';
import type { ApplyHistoryEntry } from '../lib/api/types';
import type { ApplyChange } from '../lib/api/salesforce';
import { applyFLSChanges } from '../lib/api/salesforce';
import { loadHistory, clearHistory, saveHistoryEntry, markEntryRolledBack } from '../lib/store/history';
import { getSession } from '../lib/api/session';
import { generateId } from '../lib/utils/format';
import { formatTimestamp, formatFullTimestamp } from '../lib/utils/format';

function permLabel(read: boolean, edit: boolean): string {
  if (read && edit) return 'R+E';
  if (read) return 'R';
  if (edit) return 'E';
  return 'none';
}

function ChangeTable({ entry }: { entry: ApplyHistoryEntry }) {
  return (
    <table class="w-full text-xs border-collapse mt-2">
      <thead>
        <tr class="text-slate-500 text-left">
          <th class="pb-1 pr-3 font-medium w-4/6">Permission Set / Profile</th>
          <th class="pb-1 pr-3 font-medium text-center">Was</th>
          <th class="pb-1 font-medium text-center">Now</th>
        </tr>
      </thead>
      <tbody>
        {entry.changes.map(c => (
          <tr key={c.permissionSetId} class="border-t border-slate-700/60">
            <td class="py-1 pr-3 text-slate-300 truncate max-w-0 w-4/6">
              <span class="block truncate" title={c.permissionSetName}>{c.permissionSetName}</span>
              <span class={`text-[10px] ${c.type === 'Profile' ? 'text-purple-400' : 'text-blue-400'}`}>
                {c.type === 'Profile' ? 'Profile' : 'PermSet'}
              </span>
            </td>
            <td class="py-1 pr-3 text-center font-mono">
              <span class="text-slate-400">{permLabel(c.wasRead, c.wasEdit)}</span>
            </td>
            <td class="py-1 text-center font-mono">
              <span class={
                (c.nowRead !== c.wasRead || c.nowEdit !== c.wasEdit)
                  ? 'text-cyan-400 font-semibold'
                  : 'text-slate-400'
              }>
                {permLabel(c.nowRead, c.nowEdit)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface EntryCardProps {
  entry: ApplyHistoryEntry;
  onRolledBack: () => void;
}

function EntryCard({ entry, onRolledBack }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);

  const handleRollback = useCallback(async () => {
    setRolling(true);
    setRollError(null);
    try {
      const session = await getSession();
      if (!session) throw new Error('Could not get Salesforce session.');

      const rollbackChanges: ApplyChange[] = entry.changes.map(c => ({
        permissionSetId: c.permissionSetId,
        permissionSetName: c.permissionSetName,
        field: `${entry.targetObjectApiName}.${entry.targetFieldApiName}`,
        type: c.type,
        currentRead: c.nowRead,
        currentEdit: c.nowEdit,
        newRead: c.wasRead,
        newEdit: c.wasEdit,
      }));

      await applyFLSChanges(session, rollbackChanges);

      const rollbackId = generateId();
      await saveHistoryEntry({
        id: rollbackId,
        appliedAt: new Date().toISOString(),
        sourceLabel: `Rollback of ${entry.targetObjectApiName}.${entry.targetFieldApiName}`,
        sourceObjectApiName: entry.targetObjectApiName,
        sourceFieldApiName: entry.targetFieldApiName,
        targetObjectApiName: entry.targetObjectApiName,
        targetFieldApiName: entry.targetFieldApiName,
        org: entry.org,
        changes: entry.changes.map(c => ({
          ...c,
          wasRead: c.nowRead,
          wasEdit: c.nowEdit,
          nowRead: c.wasRead,
          nowEdit: c.wasEdit,
        })),
      });
      await markEntryRolledBack(entry.id, rollbackId);
      onRolledBack();
    } catch (err) {
      setRollError(err instanceof Error ? err.message : 'Rollback failed');
      setRolling(false);
    }
  }, [entry, onRolledBack]);

  const isRollback = entry.sourceLabel.startsWith('Rollback of ');
  const sameField = entry.sourceObjectApiName === entry.targetObjectApiName &&
                    entry.sourceFieldApiName === entry.targetFieldApiName;

  return (
    <div class={`rounded-lg border ${entry.rolledBack ? 'border-slate-700/40 opacity-60' : 'border-slate-700'} bg-slate-800/60`}>
      {/* Card header */}
      <button
        class="w-full text-left px-3 py-2.5 flex items-start gap-2"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <svg
          class={`w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 flex-wrap">
            {isRollback && (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium flex-shrink-0">
                ROLLBACK
              </span>
            )}
            <span class="text-xs font-mono text-slate-200 truncate">
              {sameField
                ? `${entry.targetObjectApiName}.${entry.targetFieldApiName}`
                : `${entry.sourceObjectApiName}.${entry.sourceFieldApiName} → ${entry.targetObjectApiName}.${entry.targetFieldApiName}`}
            </span>
          </div>
          <div class="flex items-center gap-2 mt-0.5">
            <span
              class="text-[11px] text-slate-500"
              title={formatFullTimestamp(entry.appliedAt)}
            >
              {formatTimestamp(entry.appliedAt)}
            </span>
            <span class="text-[11px] text-slate-600">·</span>
            <span class="text-[11px] text-slate-500">
              {entry.changes.length} change{entry.changes.length !== 1 ? 's' : ''}
            </span>
            {entry.rolledBack && (
              <>
                <span class="text-[11px] text-slate-600">·</span>
                <span class="text-[11px] text-emerald-500">rolled back</span>
              </>
            )}
          </div>
        </div>
      </button>

      {/* Persistent rollback error — visible even when collapsed */}
      {rollError && !entry.rolledBack && (
        <div class="mx-3 mb-2 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/20
                    flex items-center justify-between gap-2">
          <p class="text-[11px] text-rose-400 flex-1">{rollError}</p>
          <button
            onClick={() => setRollError(null)}
            class="text-rose-400/60 hover:text-rose-400 transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div class="px-3 pb-3 border-t border-slate-700/60">
          <ChangeTable entry={entry} />

          {/* Rollback controls */}
          {!entry.rolledBack && (
            <div class="mt-3">
              {/* rollError is shown persistently above the card, not duplicated here */}
              {confirming ? (
                <div class="flex items-center gap-2">
                  <p class="text-[11px] text-slate-400 flex-1">
                    Revert {entry.targetObjectApiName}.{entry.targetFieldApiName} to its pre-apply state?
                  </p>
                  <button
                    onClick={handleRollback}
                    disabled={rolling}
                    class="btn-primary text-[11px] py-1 px-2.5 disabled:opacity-50"
                  >
                    {rolling ? (
                      <span class="flex items-center gap-1.5">
                        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Rolling back…
                      </span>
                    ) : 'Confirm'}
                  </button>
                  {!rolling && (
                    <button onClick={() => { setConfirming(false); setRollError(null); }} class="btn-secondary text-[11px] py-1 px-2.5">
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  class="btn-secondary text-[11px] py-1 px-2.5"
                >
                  Rollback
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HistoryPanel() {
  const [history, setHistory] = useState<ApplyHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    loadHistory().then(h => {
      setHistory([...h].reverse()); // newest first
      setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleClear = useCallback(async () => {
    if (!confirm('Clear all history? This cannot be undone.')) return;
    setClearing(true);
    await clearHistory();
    setHistory([]);
    setClearing(false);
  }, []);

  if (loading) {
    return (
      <div class="space-y-2 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} class="h-14 rounded-lg bg-slate-800/60 border border-slate-700" />
        ))}
      </div>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Apply History
        </h2>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            class="text-[11px] text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50"
          >
            Clear all
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div class="py-10 text-center">
          <p class="text-xs text-slate-500">No apply history yet.</p>
          <p class="text-[11px] text-slate-600 mt-1">
            History is recorded each time you apply FLS changes.
          </p>
        </div>
      ) : (
        <div class="space-y-2">
          {history.map(entry => (
            <EntryCard key={entry.id} entry={entry} onRolledBack={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
