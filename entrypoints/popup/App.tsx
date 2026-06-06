/**
 * Main popup application component.
 * Provides tab navigation between FLS View, Snapshots, and Settings.
 * Optimized for popup dimensions (~420×560px).
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import type { FLSSnapshot, DiffResult } from '../../lib/api/types';
import { getSession, isOnSalesforcePage } from '../../lib/api/session';
import { fetchFLS } from '../../lib/api/salesforce';
import { saveSnapshot, findLastSnapshot } from '../../lib/store/snapshots';
import { computeDiff, isDeadField } from '../../lib/utils/diff';
import { formatFieldLabel, formatTimestamp, buildFieldSetupUrl, generateId } from '../../lib/utils/format';
import type { ApplyChange } from '../../lib/api/salesforce';
import { computeApplyChanges, applyFLSChanges } from '../../lib/api/salesforce';
import { saveHistoryEntry } from '../../lib/store/history';
import { FieldPicker } from '../../components/FieldPicker';
import { FlsTable } from '../../components/FlsTable';
import type { TypeFilter } from '../../components/FlsTable';
import { SnapshotManager } from '../../components/SnapshotManager';
import { SettingsPanel } from '../../components/SettingsPanel';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { ObjectAuditCapture } from '../../components/ObjectAuditCapture';
import { HistoryPanel } from '../../components/HistoryPanel';
import { ConfirmModal, type ConfirmResult } from '../../components/ConfirmModal';
import { BulkApplyModal } from '../../components/BulkApplyModal';

type Tab = 'fls' | 'audit' | 'snapshots' | 'history' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('fls');
  const [isSalesforcePage, setIsSalesforcePage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FLS state
  const [currentSnapshot, setCurrentSnapshot] = useState<FLSSnapshot | null>(null);
  const [compareSnapshot, setCompareSnapshot] = useState<FLSSnapshot | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [lastSnapshot, setLastSnapshot] = useState<FLSSnapshot | null>(null);
  const [lastSnapshotDismissed, setLastSnapshotDismissed] = useState(false);

  // Apply state
  const [applyChanges, setApplyChanges] = useState<ApplyChange[] | null>(null);
  const [applySourceSnapshot, setApplySourceSnapshot] = useState<FLSSnapshot | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [bulkApplySnapshot, setBulkApplySnapshot] = useState<FLSSnapshot | null>(null);

  // Check if on Salesforce page
  useEffect(() => {
    isOnSalesforcePage().then(setIsSalesforcePage);
  }, []);

  // Compute diff when comparing two snapshots
  useEffect(() => {
    if (currentSnapshot && compareSnapshot) {
      const result = computeDiff(compareSnapshot, currentSnapshot);
      setDiffResult(result);
    } else {
      setDiffResult(null);
    }
  }, [currentSnapshot, compareSnapshot]);

  const handleFieldSelect = useCallback(async (objectName: string, fieldName: string) => {
    setLoading(true);
    setError(null);
    setTypeFilter('all');
    setLastSnapshot(null);
    setLastSnapshotDismissed(false);
    try {
      const session = await getSession();
      if (!session) {
        setError('Could not get Salesforce session. Make sure you are logged into Salesforce.');
        return;
      }
      const snapshot = await fetchFLS(session, objectName, fieldName);
      setCurrentSnapshot(snapshot);
      const prior = await findLastSnapshot();
      setLastSnapshot(prior);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch FLS data');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCopyFLS = useCallback(async () => {
    if (!currentSnapshot) return;
    try {
      const toSave = typeFilter === 'all' ? currentSnapshot : {
        ...currentSnapshot,
        permissions: currentSnapshot.permissions.filter(p => p.type === typeFilter),
      };
      await saveSnapshot(toSave);
      setError(null);
    } catch (err) {
      setError('Failed to save snapshot');
    }
  }, [currentSnapshot, typeFilter]);

  const handleCompare = useCallback((snapshot: FLSSnapshot) => {
    setCompareSnapshot(snapshot);
    setActiveTab('fls');
  }, []);

  const handleClearCompare = useCallback(() => {
    setCompareSnapshot(null);
    setDiffResult(null);
  }, []);

  const handleApply = useCallback(async (snapshot: FLSSnapshot) => {
    if (!currentSnapshot) {
      setError('Select a target field on the FLS tab first, then click Apply.');
      return;
    }
    try {
      const session = await getSession();
      if (!session) { setError('Could not get Salesforce session.'); return; }
      const changes = await computeApplyChanges(
        session, snapshot,
        currentSnapshot.objectApiName, currentSnapshot.fieldApiName
      );
      if (changes.length === 0) {
        setError('No profiles or permission sets found for this field in the target org.');
        return;
      }
      setApplySourceSnapshot(snapshot);
      setApplyChanges(changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute changes');
    }
  }, [currentSnapshot]);

  const handleConfirmApply = useCallback(async (result: ConfirmResult[]) => {
    if (!applyChanges) return;
    const selectedChanges = result
      .filter(r => {
        const orig = applyChanges[r.index];
        return r.effectiveRead !== orig.currentRead || r.effectiveEdit !== orig.currentEdit;
      })
      .map(r => ({ ...applyChanges[r.index], newRead: r.effectiveRead, newEdit: r.effectiveEdit }));
    setApplyLoading(true);
    try {
      const session = await getSession();
      if (!session) throw new Error('Session expired');
      await applyFLSChanges(session, selectedChanges);
      if (selectedChanges.length > 0 && applySourceSnapshot && currentSnapshot) {
        saveHistoryEntry({
          id: generateId(),
          appliedAt: new Date().toISOString(),
          sourceLabel: applySourceSnapshot.label,
          sourceObjectApiName: applySourceSnapshot.objectApiName,
          sourceFieldApiName: applySourceSnapshot.fieldApiName,
          targetObjectApiName: currentSnapshot.objectApiName,
          targetFieldApiName: currentSnapshot.fieldApiName,
          org: currentSnapshot.org,
          changes: selectedChanges.map(c => ({
            permissionSetId: c.permissionSetId,
            permissionSetName: c.permissionSetName,
            type: c.type,
            wasRead: c.currentRead,
            wasEdit: c.currentEdit,
            nowRead: c.newRead,
            nowEdit: c.newEdit,
          })),
        }).catch(() => {});
      }
      setApplyChanges(null);
      setApplySourceSnapshot(null);
      if (currentSnapshot) {
        handleFieldSelect(currentSnapshot.objectApiName, currentSnapshot.fieldApiName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setApplyLoading(false);
    }
  }, [applyChanges, applySourceSnapshot, currentSnapshot, handleFieldSelect]);

  return (
    <div class="w-[420px] min-h-[400px] max-h-[560px] flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
      {/* Header */}
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-900/95 backdrop-blur-sm">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 class="text-sm font-semibold tracking-tight">FLS Comparator</h1>
        </div>
        {compareSnapshot && (
          <button
            onClick={handleClearCompare}
            class="text-xs text-rose-400 hover:text-rose-300 transition-colors"
          >
            ✕ Clear comparison
          </button>
        )}
      </header>

      {/* Tab Navigation */}
      <nav class="flex border-b border-slate-700 px-2" role="tablist">
        {([
          { id: 'fls' as Tab, label: 'FLS', icon: '⚡' },
          { id: 'audit' as Tab, label: 'Audit', icon: '🔍' },
          { id: 'snapshots' as Tab, label: 'Snapshots', icon: '📸' },
          { id: 'history' as Tab, label: 'History', icon: '📋' },
          { id: 'settings' as Tab, label: 'Settings', icon: '⚙️' },
        ]).map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            class={activeTab === tab.id ? 'tab-active' : 'tab'}
            onClick={() => setActiveTab(tab.id)}
          >
            <span class="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Error Banner */}
      {error && (
        <div class="mx-3 mt-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between animate-fade-in">
          <span>{error}</span>
          <button onClick={() => setError(null)} class="text-rose-400 hover:text-rose-200 ml-2">✕</button>
        </div>
      )}

      {/* Tab Content */}
      <main class="flex-1 overflow-y-auto">
        {activeTab === 'fls' && (
          <div class="flex flex-col h-full">
            {isSalesforcePage === false ? (
              <div class="flex-1 flex items-center justify-center p-6">
                <EmptyState type="no-salesforce" />
              </div>
            ) : (
              <>
                {/* Field Picker */}
                <div class="p-3 border-b border-slate-700/50">
                  <FieldPicker onFieldSelect={handleFieldSelect} disabled={loading} />
                </div>

                {/* Compare Badge */}
                {compareSnapshot && (
                  <div class="mx-3 mt-2 px-3 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs animate-fade-in">
                    Comparing with: <strong>{compareSnapshot.label}</strong>
                    {compareSnapshot.org.orgLabel && (
                      <span class="text-cyan-400/60"> ({compareSnapshot.org.orgLabel})</span>
                    )}
                  </div>
                )}

                {/* Auto-diff banner */}
                {!compareSnapshot && lastSnapshot && !lastSnapshotDismissed && (
                  <div class="mx-3 mt-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs animate-fade-in flex items-center justify-between gap-2">
                    <span class="truncate">
                      Last snapshot: <strong>{lastSnapshot.objectApiName}.{lastSnapshot.fieldApiName}</strong>
                      <span class="text-amber-400/60 ml-1">· {formatTimestamp(lastSnapshot.capturedAt)}</span>
                    </span>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleCompare(lastSnapshot)}
                        class="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 font-medium transition-colors"
                      >
                        Compare
                      </button>
                      <button
                        onClick={() => setLastSnapshotDismissed(true)}
                        class="text-amber-400/60 hover:text-amber-200 transition-colors leading-none"
                        aria-label="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {/* Content Area */}
                <div class="flex-1 overflow-y-auto p-3">
                  {loading ? (
                    <LoadingSkeleton type="table" lines={8} />
                  ) : currentSnapshot ? (
                    <>
                      {/* Action Bar */}
                      <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-1.5 text-xs text-slate-400">
                          {formatFieldLabel(currentSnapshot.objectApiName, currentSnapshot.fieldApiName)}
                          <a
                            href={buildFieldSetupUrl(currentSnapshot.org.instanceUrl, currentSnapshot.objectApiName, currentSnapshot.fieldMetadataId)}
                            target="_blank"
                            rel="noreferrer"
                            title="Open field in Salesforce Object Manager"
                            class="text-slate-500 hover:text-cyan-400 transition-colors duration-150 flex-shrink-0"
                          >
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                          <span class="text-slate-500">· {currentSnapshot.permissions.length} entries</span>
                        </div>
                        <button onClick={handleCopyFLS} class="btn-primary text-xs py-1 px-3">
                          📋 Save Snapshot
                        </button>
                      </div>

                      {!diffResult && isDeadField(currentSnapshot.permissions) && (
                        <div class="mb-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                          <span class="text-rose-400 mt-px flex-shrink-0">⚠</span>
                          <span>
                            <strong>Dead field</strong> — no profile or permission set has Read access.
                            This field is effectively invisible to all users.
                          </span>
                        </div>
                      )}

                      <FlsTable
                        permissions={currentSnapshot.permissions}
                        diffResult={diffResult ?? undefined}
                        showDiffOnly={showDiffOnly}
                        onToggleDiffOnly={setShowDiffOnly}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        typeFilter={typeFilter}
                        onTypeFilterChange={setTypeFilter}
                        instanceUrl={currentSnapshot.org.instanceUrl}
                        sourceInstanceUrl={compareSnapshot?.org.instanceUrl}
                      />
                    </>
                  ) : (
                    <div class="flex-1 flex items-center justify-center py-12">
                      <EmptyState type="no-field-selected" />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div class="p-3">
            {isSalesforcePage === false ? (
              <div class="flex items-center justify-center py-12">
                <EmptyState type="no-salesforce" />
              </div>
            ) : (
              <ObjectAuditCapture />
            )}
          </div>
        )}

        {activeTab === 'snapshots' && (
          <div class="p-3">
            <SnapshotManager onCompare={handleCompare} onBulkApply={setBulkApplySnapshot} />
          </div>
        )}

        {activeTab === 'history' && (
          <div class="p-3">
            <HistoryPanel />
          </div>
        )}

        {activeTab === 'settings' && (
          <div class="p-3">
            <SettingsPanel />
          </div>
        )}
      </main>

      {bulkApplySnapshot && (
        <BulkApplyModal
          sourceSnapshot={bulkApplySnapshot}
          onClose={() => setBulkApplySnapshot(null)}
        />
      )}

      {applyChanges && (
        <ConfirmModal
          open={true}
          title="Apply FLS Changes"
          changes={applyChanges.map(c => ({
            name: c.permissionSetName,
            field: c.field,
            type: c.type,
            currentRead: c.currentRead,
            currentEdit: c.currentEdit,
            newRead: c.newRead,
            newEdit: c.newEdit,
          }))}
          onConfirm={handleConfirmApply}
          onCancel={() => setApplyChanges(null)}
          loading={applyLoading}
        />
      )}
    </div>
  );
}
