import { useState, useCallback } from 'preact/hooks';
import type { FLSSnapshot, BulkApplyFieldEntry } from '../lib/api/types';
import { getSession } from '../lib/api/session';
import { computeApplyChanges, applyFLSChanges } from '../lib/api/salesforce';
import { saveHistoryEntry } from '../lib/store/history';
import { generateId } from '../lib/utils/format';
import { FieldPicker } from './FieldPicker';

interface TargetField {
  objectName: string;
  fieldName: string;
  status: 'pending' | 'applying' | 'done' | 'no-changes' | 'error';
  changeCount?: number;
  skippedCount?: number;
  skippedReason?: string;
  error?: string;
}

interface BulkApplyModalProps {
  sourceSnapshot: FLSSnapshot;
  onClose: () => void;
}

const STATUS_ICON: Record<TargetField['status'], string> = {
  pending: '○',
  applying: '⟳',
  done: '✓',
  'no-changes': '—',
  error: '✕',
};

const STATUS_COLOR: Record<TargetField['status'], string> = {
  pending: 'text-slate-500',
  applying: 'text-cyan-400 animate-spin',
  done: 'text-emerald-400',
  'no-changes': 'text-slate-500',
  error: 'text-rose-400',
};

export function BulkApplyModal({ sourceSnapshot, onClose }: BulkApplyModalProps) {
  const [targetFields, setTargetFields] = useState<TargetField[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [lastObject, setLastObject] = useState(sourceSnapshot.objectApiName);
  const [pasteInput, setPasteInput] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'profiles' | 'permsets'>('all');
  const [applying, setApplying] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const handleAddField = useCallback((objectName: string, fieldName: string) => {
    // Skip source field and duplicates
    if (
      (objectName === sourceSnapshot.objectApiName && fieldName === sourceSnapshot.fieldApiName) ||
      targetFields.some(f => f.objectName === objectName && f.fieldName === fieldName)
    ) {
      setLastObject(objectName);
      setPickerKey(k => k + 1);
      return;
    }
    setTargetFields(prev => [...prev, { objectName, fieldName, status: 'pending' }]);
    setLastObject(objectName);
    setPickerKey(k => k + 1); // reset picker so user can add another field from same object
  }, [sourceSnapshot, targetFields]);

  const handleRemove = useCallback((index: number) => {
    setTargetFields(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleParsePaste = useCallback(() => {
    const raw = pasteInput.trim();
    if (!raw) return;

    // Split by comma or newline
    const entries = raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
    const validFormat = /^[A-Za-z]\w*\.[A-Za-z]\w*$/;
    let added = 0;
    let skipped = 0;

    setTargetFields(prev => {
      const next = [...prev];
      for (const entry of entries) {
        if (!validFormat.test(entry)) {
          skipped++;
          continue;
        }
        const dotIdx = entry.indexOf('.');
        const objectName = entry.slice(0, dotIdx);
        const fieldName = entry.slice(dotIdx + 1);

        // Skip source field and duplicates
        if (
          (objectName === sourceSnapshot.objectApiName && fieldName === sourceSnapshot.fieldApiName) ||
          next.some(f => f.objectName === objectName && f.fieldName === fieldName)
        ) {
          skipped++;
          continue;
        }
        next.push({ objectName, fieldName, status: 'pending' });
        added++;
      }
      return next;
    });

    if (added > 0 || skipped > 0) {
      setPasteFeedback(added > 0
        ? `Added ${added} field${added !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped (invalid or duplicate)` : ''}`
        : `${skipped} skipped — invalid format or duplicate`);
      setTimeout(() => setPasteFeedback(null), 3000);
    }
    setPasteInput('');
  }, [pasteInput, sourceSnapshot]);

  const runApplyForIndices = useCallback(async (indices: number[], fields: TargetField[]) => {
    setApplying(true);
    setSessionError(null);

    // Use the source snapshot's org URL — matches how individual apply works
    // in Panel.tsx (getSession(currentSnapshot.org.instanceUrl)).  Without this,
    // getSession() may pick a different Salesforce tab / org when the sidebar
    // is open as its own tab.
    const session = await getSession(sourceSnapshot.org.instanceUrl);
    if (!session) {
      setSessionError('Could not get Salesforce session.');
      setApplying(false);
      return;
    }

    const fieldResults: BulkApplyFieldEntry[] = [];

    for (const i of indices) {
      setTargetFields(prev =>
        prev.map((f, idx) => idx === i ? { ...f, status: 'applying' } : f)
      );

      try {
        let allChanges = await computeApplyChanges(
          session, sourceSnapshot,
          fields[i].objectName, fields[i].fieldName
        );

        // Diagnostic logging — helps trace bulk apply issues
        console.log(`[FLS Bulk Apply] ${fields[i].objectName}.${fields[i].fieldName}: ${allChanges.length} total rows from computeApplyChanges`);
        if (allChanges.length > 0) {
          const diffs = allChanges.filter(c => c.currentRead !== c.newRead || c.currentEdit !== c.newEdit);
          console.log(`[FLS Bulk Apply]   → ${diffs.length} rows differ, ${allChanges.length - diffs.length} already match`);
          if (diffs.length === 0 && allChanges.length > 0) {
            // Log a sample to help diagnose why everything looks the same
            const sample = allChanges.slice(0, 3).map(c => `${c.permissionSetName}: current(R=${c.currentRead},E=${c.currentEdit}) new(R=${c.newRead},E=${c.newEdit})`);
            console.log(`[FLS Bulk Apply]   Sample rows:`, sample);
          }
        }

        if (filterMode === 'profiles') {
          allChanges = allChanges.filter(c => c.type === 'Profile');
        } else if (filterMode === 'permsets') {
          allChanges = allChanges.filter(c => c.type === 'PermissionSet');
        }
        // Filter to only rows that actually differ — the individual apply flow
        // does this via the ConfirmModal; bulk apply must do it here.
        const actualChanges = allChanges.filter(
          c => c.currentRead !== c.newRead || c.currentEdit !== c.newEdit
        );
        if (actualChanges.length === 0) {
          fieldResults.push({
            targetObjectApiName: fields[i].objectName,
            targetFieldApiName: fields[i].fieldName,
            status: 'no-changes',
            changes: [],
          });
          setTargetFields(prev =>
            prev.map((f, idx) => idx === i ? { ...f, status: 'no-changes' } : f)
          );
        } else {
          const applyResult = await applyFLSChanges(session, actualChanges);
          fieldResults.push({
            targetObjectApiName: fields[i].objectName,
            targetFieldApiName: fields[i].fieldName,
            status: 'applied',
            changes: actualChanges.map(c => ({
              permissionSetId: c.permissionSetId,
              permissionSetName: c.permissionSetName,
              type: c.type,
              wasRead: c.currentRead,
              wasEdit: c.currentEdit,
              nowRead: c.newRead,
              nowEdit: c.newEdit,
            })),
          });
          setTargetFields(prev =>
            prev.map((f, idx) => idx === i ? {
              ...f,
              status: 'done',
              changeCount: actualChanges.length,
              skippedCount: applyResult.skipped.length || undefined,
              skippedReason: applyResult.skipped[0]?.reason,
            } : f)
          );
        }
      } catch (err) {
        fieldResults.push({
          targetObjectApiName: fields[i].objectName,
          targetFieldApiName: fields[i].fieldName,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed',
          changes: [],
        });
        setTargetFields(prev =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Failed' } : f
          )
        );
      }
    }

    setApplying(false);

    // Save a single grouped history entry for the bulk apply
    if (fieldResults.length > 0) {
      const first = fieldResults[0];
      saveHistoryEntry({
        id: generateId(),
        appliedAt: new Date().toISOString(),
        sourceLabel: sourceSnapshot.label,
        sourceObjectApiName: sourceSnapshot.objectApiName,
        sourceFieldApiName: sourceSnapshot.fieldApiName,
        targetObjectApiName: first.targetObjectApiName,
        targetFieldApiName: first.targetFieldApiName,
        org: sourceSnapshot.org,
        changes: first.status === 'applied' ? first.changes : [],
        targetFields: fieldResults,
      }).catch(() => {});
    }
  }, [sourceSnapshot, filterMode]);

  const handleApplyAll = useCallback(async () => {
    if (targetFields.length === 0) return;
    const pendingIndices = targetFields
      .map((f, i) => f.status === 'pending' ? i : -1)
      .filter(i => i !== -1);
    await runApplyForIndices(pendingIndices, targetFields);
  }, [targetFields, runApplyForIndices]);

  const handleRetryFailed = useCallback(async () => {
    const failedIndices = targetFields
      .map((f, i) => f.status === 'error' ? i : -1)
      .filter(i => i !== -1);
    if (failedIndices.length === 0) return;
    const resetFields = targetFields.map(f =>
      f.status === 'error' ? { ...f, status: 'pending' as const, error: undefined } : f
    );
    setTargetFields(resetFields);
    await runApplyForIndices(failedIndices, resetFields);
  }, [targetFields, runApplyForIndices]);

  const pendingCount = targetFields.filter(f => f.status === 'pending').length;
  const errorCount = targetFields.filter(f => f.status === 'error').length;
  const allDone = targetFields.length > 0 && targetFields.every(f => f.status !== 'pending' && f.status !== 'applying');
  const hasErrors = errorCount > 0;

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-slate-900 rounded-xl border border-slate-700 shadow-2xl shadow-black/60 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div class="flex items-start justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 class="text-base font-semibold text-slate-100">Bulk Apply</h2>
            <p class="text-xs text-slate-400 mt-0.5">
              Copy permissions from <span class="text-cyan-400 font-mono">{sourceSnapshot.objectApiName}.{sourceSnapshot.fieldApiName}</span> to multiple fields
            </p>
          </div>
          <button onClick={onClose} class="btn-icon text-slate-500 hover:text-slate-300 mt-0.5">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Field picker — hidden once applying */}
          {!applying && !allDone && (
            <>
              <div>
                <p class="text-xs text-slate-400 mb-2">Add target fields:</p>
                <FieldPicker key={pickerKey} onFieldSelect={handleAddField} initialObject={lastObject} />
              </div>

              {/* Paste field references */}
              <div class="border-t border-slate-700 pt-4">
                <p class="text-xs text-slate-400 mb-2">
                  — or paste field references —
                </p>
                <textarea
                  value={pasteInput}
                  onInput={(e) => setPasteInput((e.target as HTMLTextAreaElement).value)}
                  placeholder="Object.Field, Another.Field, …"
                  rows={3}
                  class="w-full px-3 py-2 text-xs rounded-md bg-slate-800 border border-slate-700
                         text-slate-200 placeholder-slate-500 resize-none
                         focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                />
                <div class="flex items-center justify-between mt-2">
                  <button
                    onClick={handleParsePaste}
                    disabled={!pasteInput.trim()}
                    class="btn-secondary text-[11px] py-1 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Parse & Add
                  </button>
                  {pasteFeedback && (
                    <span class={`text-[11px] ${pasteFeedback.includes('Added') ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {pasteFeedback}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Target fields list */}
          {targetFields.length > 0 && (
            <div class="space-y-2">
              <p class="text-xs text-slate-400">
                Target fields ({targetFields.length}):
              </p>
              <ul class="space-y-1.5">
                {targetFields.map((field, i) => (
                  <li
                    key={`${field.objectName}.${field.fieldName}`}
                    class="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"
                  >
                    {/* Status icon */}
                    <span class={`text-sm font-mono w-4 text-center flex-shrink-0 ${STATUS_COLOR[field.status]}`}>
                      {STATUS_ICON[field.status]}
                    </span>

                    {/* Field name */}
                    <span class="flex-1 text-sm font-mono text-slate-200 truncate">
                      {field.objectName}.{field.fieldName}
                    </span>

                    {/* Result detail */}
                    {field.status === 'done' && field.changeCount !== undefined && (
                      <span class="flex items-center gap-1.5 flex-shrink-0">
                        <span class="text-xs text-emerald-400">
                          {field.changeCount} change{field.changeCount !== 1 ? 's' : ''} applied
                        </span>
                        {field.skippedCount && (
                          <span
                            class="text-xs text-amber-400"
                            title={field.skippedReason}
                          >
                            · {field.skippedCount} skipped
                          </span>
                        )}
                      </span>
                    )}
                    {field.status === 'no-changes' && (
                      <span class="text-xs text-slate-500 flex-shrink-0">Already matches</span>
                    )}
                    {field.status === 'error' && field.error && (
                      <span class="text-xs text-rose-400 truncate max-w-[140px]" title={field.error}>
                        {field.error.slice(0, 50)}
                      </span>
                    )}

                    {/* Remove button — only before applying */}
                    {!applying && field.status === 'pending' && (
                      <button
                        onClick={() => handleRemove(i)}
                        class="btn-icon text-slate-600 hover:text-rose-400 flex-shrink-0"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty state */}
          {targetFields.length === 0 && (
            <p class="text-xs text-slate-500 text-center py-4">
              Use the picker above or paste field references to add target fields.
            </p>
          )}

          {/* Session error */}
          {sessionError && (
            <div class="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              {sessionError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div class="px-5 py-4 border-t border-slate-700 flex items-center justify-between gap-3">
          {allDone ? (
            <>
              <p class="text-xs text-slate-400">
                {hasErrors
                  ? 'Completed with errors — reload the Salesforce page to see changes.'
                  : 'All done — reload the Salesforce page to see changes.'}
              </p>
              <div class="flex items-center gap-2">
                {hasErrors && (
                  <button onClick={handleRetryFailed} class="btn-secondary">
                    Retry failed ({errorCount})
                  </button>
                )}
                <button onClick={onClose} class="btn-primary">Close</button>
              </div>
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={applying} class="btn-secondary">
                Cancel
              </button>
              <div class="flex items-center gap-2">
                <select
                  value={filterMode}
                  onChange={(e) => setFilterMode((e.target as HTMLSelectElement).value as typeof filterMode)}
                  disabled={applying}
                  class="text-[11px] rounded-md bg-slate-800 border border-slate-700 text-slate-300 px-2 py-1.5
                         focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
                >
                  <option value="all">All</option>
                  <option value="profiles">Profiles</option>
                  <option value="permsets">Perm Sets</option>
                </select>
                <button
                  onClick={handleApplyAll}
                  disabled={pendingCount === 0 || applying}
                  class="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                {applying ? (
                  <span class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Applying…
                  </span>
                ) : (
                  `Apply to ${pendingCount} field${pendingCount !== 1 ? 's' : ''}`
                )}
              </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
