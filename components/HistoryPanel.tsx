import { useState, useEffect, useCallback } from 'preact/hooks';
import type { ApplyHistoryEntry, BulkApplyFieldEntry } from '../lib/api/types';
import type { ApplyChange } from '../lib/api/salesforce';
import { applyFLSChanges, computeApplyChanges } from '../lib/api/salesforce';
import { loadHistory, clearHistory, saveHistoryEntry, markEntryRolledBack } from '../lib/store/history';
import { loadSnapshots } from '../lib/store/snapshots';
import { getSession } from '../lib/api/session';
import { generateId } from '../lib/utils/format';
import { formatTimestamp, formatFullTimestamp } from '../lib/utils/format';

function permLabel(read: boolean, edit: boolean): string {
  if (read && edit) return 'R+E';
  if (read) return 'R';
  if (edit) return 'E';
  return 'none';
}

function ChangeTable({ changes }: { changes: { permissionSetId: string; permissionSetName: string; type: 'Profile' | 'PermissionSet'; wasRead: boolean; wasEdit: boolean; nowRead: boolean; nowEdit: boolean }[] }) {
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
        {changes.map(c => (
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

const STATUS_ICON: Record<BulkApplyFieldEntry['status'], string> = {
  applied: '✓',
  error: '✕',
  'no-changes': '—',
};

const STATUS_COLOR: Record<BulkApplyFieldEntry['status'], string> = {
  applied: 'text-emerald-400',
  error: 'text-rose-400',
  'no-changes': 'text-slate-500',
};

interface EntryCardProps {
  entry: ApplyHistoryEntry;
  onRolledBack: () => void;
}

function EntryCard({ entry, onRolledBack }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const isBulk = !!(entry.targetFields && entry.targetFields.length > 0);

  const handleRollback = useCallback(async () => {
    setRolling(true);
    setRollError(null);
    try {
      const session = await getSession();
      if (!session) throw new Error('Could not get Salesforce session.');

      if (isBulk && entry.targetFields) {
        // Rollback all applied fields in the bulk entry
        let rollbackId = generateId();
        const allReversedChanges: BulkApplyFieldEntry[] = [];

        for (const field of entry.targetFields) {
          if (field.status !== 'applied' || field.changes.length === 0) continue;

          const rollbackChanges: ApplyChange[] = field.changes.map(c => ({
            permissionSetId: c.permissionSetId,
            permissionSetName: c.permissionSetName,
            field: `${field.targetObjectApiName}.${field.targetFieldApiName}`,
            type: c.type,
            currentRead: c.nowRead,
            currentEdit: c.nowEdit,
            newRead: c.wasRead,
            newEdit: c.wasEdit,
          }));

          try {
            await applyFLSChanges(session, rollbackChanges);
          } catch (err) {
            // Continue rolling back other fields even if one fails
            console.error(`Rollback failed for ${field.targetObjectApiName}.${field.targetFieldApiName}:`, err);
          }

          allReversedChanges.push({
            targetObjectApiName: field.targetObjectApiName,
            targetFieldApiName: field.targetFieldApiName,
            status: 'applied',
            changes: field.changes.map(c => ({
              ...c,
              wasRead: c.nowRead,
              wasEdit: c.nowEdit,
              nowRead: c.wasRead,
              nowEdit: c.wasEdit,
            })),
          });
        }

        if (allReversedChanges.length > 0) {
          await saveHistoryEntry({
            id: rollbackId,
            appliedAt: new Date().toISOString(),
            sourceLabel: `Rollback of ${entry.sourceLabel}`,
            sourceObjectApiName: entry.sourceObjectApiName,
            sourceFieldApiName: entry.sourceFieldApiName,
            targetObjectApiName: entry.targetObjectApiName,
            targetFieldApiName: entry.targetFieldApiName,
            org: entry.org,
            changes: allReversedChanges[0]?.changes ?? [],
            targetFields: allReversedChanges,
          });

          await markEntryRolledBack(entry.id, rollbackId);
        }
      } else {
        // Single-field rollback (existing behavior)
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
      }

      onRolledBack();
    } catch (err) {
      setRollError(err instanceof Error ? err.message : 'Rollback failed');
      setRolling(false);
    }
  }, [entry, isBulk, onRolledBack]);

  const handleRetry = useCallback(async () => {
    if (!entry.targetFields) return;
    setRetrying(true);
    setRetryError(null);

    try {
      const session = await getSession();
      if (!session) throw new Error('Could not get Salesforce session.');

      // Try to find the source snapshot
      const snapshots = await loadSnapshots();
      const sourceSnapshot = snapshots.find(
        s => s.label === entry.sourceLabel &&
             s.objectApiName === entry.sourceObjectApiName &&
             s.fieldApiName === entry.sourceFieldApiName
      );

      if (!sourceSnapshot) {
        throw new Error('Source snapshot not found — it may have been deleted.');
      }

      const resultFields: BulkApplyFieldEntry[] = [];
      const errorIndices = entry.targetFields
        .map((f, i) => f.status === 'error' ? i : -1)
        .filter(i => i !== -1);

      for (const i of errorIndices) {
        const field = entry.targetFields[i];
        try {
          const changes = await computeApplyChanges(
            session, sourceSnapshot,
            field.targetObjectApiName, field.targetFieldApiName
          );
          if (changes.length === 0) {
            resultFields.push({
              ...field,
              status: 'no-changes' as const,
              error: undefined,
              changes: [],
            });
          } else {
            const applyResult = await applyFLSChanges(session, changes);
            const actuallyChanged = changes.filter(c => c.currentRead !== c.newRead || c.currentEdit !== c.newEdit);
            resultFields.push({
              ...field,
              status: 'applied' as const,
              error: undefined,
              changes: actuallyChanged.map(c => ({
                permissionSetId: c.permissionSetId,
                permissionSetName: c.permissionSetName,
                type: c.type,
                wasRead: c.currentRead,
                wasEdit: c.currentEdit,
                nowRead: c.newRead,
                nowEdit: c.newEdit,
              })),
            });
          }
        } catch (err) {
          resultFields.push({
            ...field,
            status: 'error' as const,
            error: err instanceof Error ? err.message : 'Retry failed',
          });
        }
      }

      // Build updated targetFields: non-error fields as-is, error fields replaced with retry result
      const updatedTargetFields = entry.targetFields.map(f => {
        const retried = resultFields.find(
          r => r.targetObjectApiName === f.targetObjectApiName &&
               r.targetFieldApiName === f.targetFieldApiName
        );
        return retried ?? f;
      });

      // Save a new history entry for the retry
      await saveHistoryEntry({
        id: generateId(),
        appliedAt: new Date().toISOString(),
        sourceLabel: `${entry.sourceLabel} (retry)`,
        sourceObjectApiName: entry.sourceObjectApiName,
        sourceFieldApiName: entry.sourceFieldApiName,
        targetObjectApiName: entry.targetObjectApiName,
        targetFieldApiName: entry.targetFieldApiName,
        org: entry.org,
        changes: resultFields.find(f => f.status === 'applied')?.changes ?? [],
        targetFields: updatedTargetFields,
      });

      onRolledBack();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
      setRetrying(false);
    }
  }, [entry, onRolledBack]);

  const isRollback = entry.sourceLabel.startsWith('Rollback of ');
  const retryLabel = entry.sourceLabel.endsWith('(retry)');
  const sameField = entry.sourceObjectApiName === entry.targetObjectApiName &&
                    entry.sourceFieldApiName === entry.targetFieldApiName;
  const errorCount = entry.targetFields?.filter(f => f.status === 'error').length ?? 0;
  const appliedCount = entry.targetFields?.filter(f => f.status === 'applied').length ?? 0;

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
            {retryLabel && (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium flex-shrink-0">
                RETRY
              </span>
            )}
            {isBulk && (
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium flex-shrink-0">
                BULK
              </span>
            )}
            <span class="text-xs font-mono text-slate-200 truncate">
              {isBulk
                ? `${entry.sourceLabel} → ${appliedCount + (entry.targetFields?.filter(f => f.status === 'error').length ?? 0)} fields`
                : sameField
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
            {isBulk ? (
              <>
                <span class="text-[11px] text-slate-500">
                  {entry.targetFields!.length} field{entry.targetFields!.length !== 1 ? 's' : ''}
                </span>
                {errorCount > 0 && (
                  <>
                    <span class="text-[11px] text-slate-600">·</span>
                    <span class="text-[11px] text-rose-400">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
                  </>
                )}
              </>
            ) : (
              <span class="text-[11px] text-slate-500">
                {entry.changes.length} change{entry.changes.length !== 1 ? 's' : ''}
              </span>
            )}
            <span class="text-[11px] text-slate-600">·</span>
            <span class="text-[11px] text-slate-500" title={entry.org.instanceUrl}>
              {entry.org.orgLabel || entry.org.instanceUrl.replace(/^https?:\/\//, '').replace(/\.lightning\.force\.com.*$/, '').replace(/\.my\.salesforce\.com.*$/, '')}
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

      {/* Persistent error — visible even when collapsed */}
      {(rollError || retryError) && !entry.rolledBack && (
        <div class="mx-3 mb-2 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/20
                    flex items-center justify-between gap-2">
          <p class="text-[11px] text-rose-400 flex-1">{rollError ?? retryError}</p>
          <button
            onClick={() => { setRollError(null); setRetryError(null); }}
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
          {isBulk && entry.targetFields ? (
            /* Bulk entry view */
            <div class="space-y-2 mt-2">
              {entry.targetFields.map((field, i) => (
                <div key={`${field.targetObjectApiName}.${field.targetFieldApiName}`}
                     class="rounded-md bg-slate-800 border border-slate-700/80">
                  <div class="flex items-center gap-2 px-2.5 py-2">
                    <span class={`text-sm w-4 text-center font-mono flex-shrink-0 ${STATUS_COLOR[field.status]}`}>
                      {STATUS_ICON[field.status]}
                    </span>
                    <span class="text-xs font-mono text-slate-300 truncate flex-1">
                      {field.targetObjectApiName}.{field.targetFieldApiName}
                    </span>
                    {field.status === 'applied' && (
                      <span class="text-[11px] text-emerald-400 flex-shrink-0">
                        {field.changes.length} change{field.changes.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {field.status === 'error' && field.error && (
                      <span class="text-[11px] text-rose-400 truncate max-w-[140px] flex-shrink-0" title={field.error}>
                        {field.error.slice(0, 50)}
                      </span>
                    )}
                    {field.status === 'no-changes' && (
                      <span class="text-[11px] text-slate-500 flex-shrink-0">Already matches</span>
                    )}
                  </div>
                  {field.changes.length > 0 && (
                    <div class="border-t border-slate-700/60 px-2.5 pb-2">
                      <ChangeTable changes={field.changes} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Single entry view */
            <ChangeTable changes={entry.changes} />
          )}

          {/* Controls */}
          {!entry.rolledBack && (
            <div class="mt-3 space-y-2">
              {rollError || retryError ? null : confirming ? (
                <div class="flex items-center gap-2">
                  <p class="text-[11px] text-slate-400 flex-1">
                    {isBulk ? 'Revert all fields to their pre-apply state?' : `Revert ${entry.targetObjectApiName}.${entry.targetFieldApiName} to its pre-apply state?`}
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
                <div class="flex items-center gap-2 flex-wrap">
                  {errorCount > 0 && (
                    <button
                      onClick={handleRetry}
                      disabled={retrying}
                      class="btn-secondary text-[11px] py-1 px-2.5 disabled:opacity-50"
                    >
                      {retrying ? (
                        <span class="flex items-center gap-1.5">
                          <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Retrying…
                        </span>
                      ) : `Retry ${errorCount} failed`}
                    </button>
                  )}
                  <button
                    onClick={() => setConfirming(true)}
                    class="btn-secondary text-[11px] py-1 px-2.5"
                  >
                    Rollback
                  </button>
                </div>
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
