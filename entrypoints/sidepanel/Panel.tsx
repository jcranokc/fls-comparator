/**
 * Sidebar panel component for Firefox.
 * Wider layout than popup — takes advantage of sidebar width for
 * side-by-side diff views and more spacious table rendering.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type { FLSSnapshot, DiffResult } from '../../lib/api/types';
import { getSession, isOnSalesforcePage } from '../../lib/api/session';
import { fetchFLS } from '../../lib/api/salesforce';
import { saveSnapshot, loadSnapshots, findLastSnapshot } from '../../lib/store/snapshots';
import { computeDiff } from '../../lib/utils/diff';
import { formatFieldLabel, formatTimestamp, buildFieldSetupUrl } from '../../lib/utils/format';
import { FieldPicker } from '../../components/FieldPicker';
import { FlsTable } from '../../components/FlsTable';
import type { TypeFilter } from '../../components/FlsTable';
import { SnapshotManager } from '../../components/SnapshotManager';
import { SettingsPanel } from '../../components/SettingsPanel';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { ConfirmModal, type ConfirmResult } from '../../components/ConfirmModal';
import { BulkApplyModal } from '../../components/BulkApplyModal';
import { ObjectAuditCapture } from '../../components/ObjectAuditCapture';
import { HistoryPanel } from '../../components/HistoryPanel';
import type { ApplyChange } from '../../lib/api/salesforce';
import { computeApplyChanges, applyFLSChanges } from '../../lib/api/salesforce';
import { saveHistoryEntry } from '../../lib/store/history';
import { generateId } from '../../lib/utils/format';

type Tab = 'fls' | 'audit' | 'snapshots' | 'history' | 'settings';

function DropdownCompositionBadges({ snap }: { snap: FLSSnapshot }) {
  const pCount = snap.permissions.filter(p => p.type === 'Profile').length;
  const psCount = snap.permissions.filter(p => p.type === 'PermissionSet').length;
  return (
    <span class="flex items-center gap-1 flex-shrink-0 ml-1">
      {pCount > 0 && (
        <span class="text-[9px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-400">
          {pCount}P
        </span>
      )}
      {psCount > 0 && (
        <span class="text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">
          {psCount}PS
        </span>
      )}
    </span>
  );
}

export function Panel() {
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

  // Pre-selection coming from pendingNavigation (injected button click)
  const [pickerInitialObject, setPickerInitialObject] = useState<string | undefined>();
  const [pickerInitialField, setPickerInitialField] = useState<string | undefined>();

  // Auto-diff state
  const [lastSnapshot, setLastSnapshot] = useState<FLSSnapshot | null>(null);
  const [lastSnapshotDismissed, setLastSnapshotDismissed] = useState(false);

  // Apply state
  const [applyChanges, setApplyChanges] = useState<ApplyChange[] | null>(null);
  const [applySourceSnapshot, setApplySourceSnapshot] = useState<FLSSnapshot | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [applyWarning, setApplyWarning] = useState<string | null>(null);
  const [bulkApplySnapshot, setBulkApplySnapshot] = useState<FLSSnapshot | null>(null);

  // Saved snapshots (for "Apply ▾" dropdown on Field Security tab)
  const [savedSnapshots, setSavedSnapshots] = useState<FLSSnapshot[]>([]);
  const [applyDropdownOpen, setApplyDropdownOpen] = useState(false);
  const [applySearch, setApplySearch] = useState('');
  const applyDropdownRef = useRef<HTMLDivElement>(null);

  // Filtered snapshots for the Apply dropdown — recomputed on every render when search changes
  const applyFiltered = applySearch
    ? savedSnapshots.filter(s => {
        const q = applySearch.toLowerCase();
        return (
          s.label.toLowerCase().includes(q) ||
          s.objectApiName.toLowerCase().includes(q) ||
          s.fieldApiName.toLowerCase().includes(q) ||
          (s.org.orgLabel ?? '').toLowerCase().includes(q)
        );
      })
    : savedSnapshots;

  // Load saved snapshots so the "Apply ▾" dropdown can list them
  const refreshSavedSnapshots = useCallback(() => {
    loadSnapshots().then(setSavedSnapshots).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSavedSnapshots();
  }, [refreshSavedSnapshots]);

  // Fix 3: Close dropdown when clicking outside; clear search on close.
  // Also listen for Escape key so search is reset when the dropdown is dismissed via keyboard.
  useEffect(() => {
    if (!applyDropdownOpen) { setApplySearch(''); return; }
    const handleMouseDown = (e: MouseEvent) => {
      if (applyDropdownRef.current && !applyDropdownRef.current.contains(e.target as Node)) {
        setApplyDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setApplyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [applyDropdownOpen]);

  const checkPage = useCallback(() => {
    isOnSalesforcePage().then(setIsSalesforcePage);
  }, []);

  useEffect(() => {
    checkPage();
    // Re-check whenever the active tab changes or navigates
    const onUpdated = (_tabId: number, info: { status?: string; url?: string }) => {
      if (info.status === 'complete' || info.url) checkPage();
    };
    const onActivated = () => checkPage();
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, [checkPage]);

  useEffect(() => {
    if (currentSnapshot && compareSnapshot) {
      setDiffResult(computeDiff(compareSnapshot, currentSnapshot));
    } else {
      setDiffResult(null);
    }
  }, [currentSnapshot, compareSnapshot]);

  // Check pendingNavigation in storage and auto-navigate if present.
  // Called on mount AND whenever storage changes — covers two cases:
  //   1. Sidebar just opened: pendingNavigation may arrive slightly after mount (race with API calls)
  //   2. Sidebar was already open: mount effect already ran and found nothing, so we need the listener
  useEffect(() => {
    const consume = async () => {
      const result = await browser.storage.local.get('pendingNavigation');
      const nav = (result as Record<string, unknown>).pendingNavigation as
        | { objectApiName: string; fieldApiName: string; instanceUrl?: string }
        | undefined;
      if (!nav?.objectApiName || !nav?.fieldApiName) return;
      await browser.storage.local.remove('pendingNavigation');
      setActiveTab('fls');
      setPickerInitialObject(nav.objectApiName);
      setPickerInitialField(nav.fieldApiName);
      handleFieldSelect(nav.objectApiName, nav.fieldApiName, nav.instanceUrl);
    };

    consume();

    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes.pendingNavigation?.newValue) consume();
    };
    browser.storage.local.onChanged.addListener(onChanged);
    return () => browser.storage.local.onChanged.removeListener(onChanged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // handleFieldSelect is stable (useCallback)

  const handleFieldSelect = useCallback(async (objectName: string, fieldName: string, instanceUrl?: string) => {
    setLoading(true);
    setError(null);
    setTypeFilter('all');
    setLastSnapshot(null);
    setLastSnapshotDismissed(false);
    try {
      const session = await getSession(instanceUrl);
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
      refreshSavedSnapshots();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError('Failed to save snapshot');
    }
  }, [currentSnapshot, typeFilter, refreshSavedSnapshots]);

  const handleCompare = useCallback((snapshot: FLSSnapshot) => {
    setCompareSnapshot(snapshot);
    setActiveTab('fls');
  }, []);

  // Fix 2: Pass the target org's instanceUrl to getSession so the correct org's
  // session is used even when multiple Salesforce tabs are open.
  const handleApply = useCallback(async (snapshot: FLSSnapshot) => {
    if (!currentSnapshot) {
      setError('Select a target field on the Field Security tab first, then come back and click Apply.');
      return;
    }
    try {
      const session = await getSession(currentSnapshot.org.instanceUrl);
      if (!session) {
        setError('Could not get Salesforce session.');
        return;
      }
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
      .map(r => ({
        ...applyChanges[r.index],
        newRead: r.effectiveRead,
        newEdit: r.effectiveEdit,
      }));
    setApplyLoading(true);
    try {
      // Fix 2: Use the target org's instanceUrl so the apply goes to the right org.
      const session = await getSession(currentSnapshot?.org.instanceUrl);
      if (!session) throw new Error('Session expired');
      const applyResult = await applyFLSChanges(session, selectedChanges);
      if (applyResult.skipped.length > 0) {
        const reasons = [...new Set(applyResult.skipped.map(s => s.reason))];
        setApplyWarning(
          `${applyResult.skipped.length} permission set${applyResult.skipped.length !== 1 ? 's' : ''} skipped: ${reasons[0]}`
        );
      } else {
        setApplyWarning(null);
      }
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
      setError(null);
      // Reload the current field to reflect the changes, and remind user to refresh SF page
      if (currentSnapshot) {
        handleFieldSelect(currentSnapshot.objectApiName, currentSnapshot.fieldApiName);
      }
      // Brief green flash — reuse the save success state
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setApplyLoading(false);
    }
  }, [applyChanges, applySourceSnapshot, currentSnapshot, handleFieldSelect]);

  return (
    <div class="h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
      {/* Header — wider layout */}
      <header class="flex items-center justify-between px-5 py-4 border-b border-slate-700 bg-slate-900/95 backdrop-blur-sm">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 class="text-base font-semibold tracking-tight">FLS Comparator</h1>
            <p class="text-xs text-slate-500">Field Level Security Manager</p>
          </div>
        </div>
        {compareSnapshot && (
          <button
            onClick={() => { setCompareSnapshot(null); setDiffResult(null); }}
            class="btn-ghost text-xs py-1"
          >
            ✕ Clear comparison
          </button>
        )}
      </header>

      {/* Tab Navigation */}
      <nav class="flex border-b border-slate-700 px-3 gap-1" role="tablist">
        {([
          { id: 'fls' as Tab, label: 'Field Security', icon: '⚡' },
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
            <span class="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Error Banner */}
      {error && (
        <div class="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between animate-fade-in">
          <span>{error}</span>
          <button onClick={() => setError(null)} class="btn-icon text-rose-400 hover:text-rose-200">✕</button>
        </div>
      )}

      {/* Apply Warning Banner — skipped rows due to field-type restrictions */}
      {applyWarning && !error && (
        <div class="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm animate-fade-in flex items-start justify-between gap-2">
          <div class="flex items-start gap-2 min-w-0">
            <svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <span class="break-words">{applyWarning}</span>
          </div>
          <button onClick={() => setApplyWarning(null)} class="btn-icon text-amber-400 hover:text-amber-200 flex-shrink-0">✕</button>
        </div>
      )}

      {/* Apply Success Banner */}
      {saveSuccess && !error && (
        <div class="mx-4 mt-3 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm animate-fade-in">
          Changes applied — reload the Salesforce page to see them take effect.
        </div>
      )}

      {/* Content */}
      <main class="flex-1 overflow-y-auto">
        {activeTab === 'fls' && (
          <div class="flex flex-col h-full">
            {isSalesforcePage === false ? (
              <div class="flex-1 flex items-center justify-center p-8">
                <EmptyState type="no-salesforce" />
              </div>
            ) : (
              <>
                <div class="p-4 border-b border-slate-700/50">
                  <FieldPicker
                    onFieldSelect={handleFieldSelect}
                    disabled={loading}
                    initialObject={pickerInitialObject}
                    initialField={pickerInitialField}
                  />
                </div>

                {compareSnapshot && (
                  <div class="mx-4 mt-3 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm animate-fade-in flex items-center gap-2">
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span>
                      Comparing with: <strong>{compareSnapshot.label}</strong>
                      {compareSnapshot.org.orgLabel && (
                        <span class="text-cyan-400/60"> ({compareSnapshot.org.orgLabel})</span>
                      )}
                    </span>
                  </div>
                )}

                {/* Auto-diff banner */}
                {!compareSnapshot && lastSnapshot && !lastSnapshotDismissed && (
                  <div class="mx-4 mt-3 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm animate-fade-in flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 min-w-0">
                      <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span class="truncate">
                        Last snapshot: <strong>{lastSnapshot.objectApiName}.{lastSnapshot.fieldApiName}</strong>
                        <span class="text-amber-400/60 ml-1">
                          · {formatTimestamp(lastSnapshot.capturedAt)}
                          {lastSnapshot.org.orgLabel && ` · ${lastSnapshot.org.orgLabel}`}
                        </span>
                      </span>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleCompare(lastSnapshot)}
                        class="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-medium text-xs transition-colors"
                      >
                        Compare
                      </button>
                      <button
                        onClick={() => setLastSnapshotDismissed(true)}
                        class="text-amber-400/60 hover:text-amber-200 transition-colors"
                        aria-label="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                <div class="flex-1 overflow-y-auto p-4">
                  {loading ? (
                    <LoadingSkeleton type="table" lines={12} />
                  ) : currentSnapshot ? (
                    <>
                      <div class="flex items-center justify-between mb-4">
                        <div>
                          <div class="flex items-center gap-1.5">
                            <span class="text-sm font-medium">
                              {formatFieldLabel(currentSnapshot.objectApiName, currentSnapshot.fieldApiName)}
                            </span>
                            <a
                              href={buildFieldSetupUrl(currentSnapshot.org.instanceUrl, currentSnapshot.objectApiName, currentSnapshot.fieldMetadataId)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open field in Salesforce Object Manager"
                              class="text-slate-500 hover:text-cyan-400 transition-colors duration-150 flex-shrink-0"
                            >
                              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </a>
                          </div>
                          <div class="text-xs text-slate-500 mt-0.5">
                            {currentSnapshot.permissions.length} profiles & permission sets
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          {/* Apply Snapshot — direct button when comparing, dropdown otherwise */}
                          {(compareSnapshot || savedSnapshots.length > 0) && (
                            <div class="relative flex" ref={applyDropdownRef}>
                              {/* When a comparison is active: left side applies the compare snapshot directly */}
                              {compareSnapshot ? (
                                <button
                                  onClick={() => handleApply(compareSnapshot)}
                                  class="btn-secondary flex items-center gap-1.5 rounded-r-none border-r-0"
                                >
                                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                  </svg>
                                  Apply
                                </button>
                              ) : (
                                <button
                                  onClick={() => setApplyDropdownOpen(o => !o)}
                                  class="btn-secondary flex items-center gap-1.5"
                                >
                                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                  </svg>
                                  Apply
                                  <svg class="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                              {/* Chevron — always opens the full snapshot dropdown */}
                              {savedSnapshots.length > 0 && (
                                <button
                                  onClick={() => setApplyDropdownOpen(o => !o)}
                                  class={`btn-secondary px-2 flex items-center ${compareSnapshot ? 'rounded-l-none' : 'hidden'}`}
                                  aria-label="Choose snapshot to apply"
                                >
                                  <svg class="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              )}
                              {applyDropdownOpen && (
                                <div class="absolute right-0 top-full mt-1 z-50 w-[340px] rounded-lg bg-slate-800 border border-slate-600 shadow-xl shadow-black/40 overflow-hidden animate-fade-in flex flex-col max-h-[520px]">
                                  {/* Search */}
                                  <div class="px-3 pt-2.5 pb-2 border-b border-slate-700 flex-shrink-0">
                                    <div class="relative">
                                      <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                      </svg>
                                      <input
                                        type="text"
                                        value={applySearch}
                                        onInput={e => setApplySearch((e.target as HTMLInputElement).value)}
                                        placeholder="Search snapshots…"
                                        autoFocus
                                        class="w-full pl-7 pr-3 py-1.5 text-xs rounded-md bg-slate-700/50 border border-slate-600/50
                                               text-slate-200 placeholder-slate-500
                                               focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50
                                               transition-all duration-200"
                                      />
                                    </div>
                                  </div>

                                  {/* Copy permissions from */}
                                  <div class="flex-shrink-0 px-3 pt-2 pb-1 text-xs text-slate-400 font-medium">
                                    Copy permissions from…
                                  </div>
                                  <ul class="overflow-y-auto flex-1 min-h-0" style="max-height: 260px">
                                    {applyFiltered.length === 0 ? (
                                      <li class="px-3 py-4 text-xs text-slate-500 text-center">No snapshots match</li>
                                    ) : applyFiltered.map(snap => (
                                      <li key={snap.id}>
                                        <button
                                          class="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-700 transition-colors flex items-start justify-between gap-2"
                                          onClick={() => {
                                            setApplyDropdownOpen(false);
                                            setApplySearch('');
                                            handleApply(snap);
                                          }}
                                        >
                                          <div class="min-w-0">
                                            <div class="font-medium text-slate-200 truncate">{snap.label}</div>
                                            <div class="text-xs text-slate-500 mt-0.5 truncate">
                                              {snap.objectApiName}.{snap.fieldApiName}
                                              {snap.org.orgLabel ? ` · ${snap.org.orgLabel}` : ''}
                                            </div>
                                          </div>
                                          <DropdownCompositionBadges snap={snap} />
                                        </button>
                                      </li>
                                    ))}
                                  </ul>

                                  {/* Bulk apply section */}
                                  <div class="border-t border-slate-700 flex-shrink-0">
                                    <div class="px-3 py-1.5 text-xs text-slate-500 uppercase tracking-wide">
                                      Bulk apply to multiple fields
                                    </div>
                                    <ul class="overflow-y-auto max-h-40">
                                      {applyFiltered.length === 0 ? (
                                        <li class="px-3 py-3 text-xs text-slate-500 text-center">No snapshots match</li>
                                      ) : applyFiltered.map(snap => (
                                        <li key={`bulk-${snap.id}`}>
                                          <button
                                            class="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 transition-colors flex items-center justify-between gap-2"
                                            onClick={() => {
                                              setApplyDropdownOpen(false);
                                              setApplySearch('');
                                              setBulkApplySnapshot(snap);
                                            }}
                                          >
                                            <div class="flex items-center gap-2 min-w-0">
                                              <svg class="w-3.5 h-3.5 text-teal-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 8.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v8.25A2.25 2.25 0 006 16.5h2.25m8.25-8.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-7.5A2.25 2.25 0 018.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 00-2.25 2.25v6" />
                                              </svg>
                                              <div class="min-w-0">
                                                <div class="text-teal-300 font-medium truncate">{snap.label}</div>
                                                <div class="text-xs text-slate-500 truncate">{snap.objectApiName}.{snap.fieldApiName}</div>
                                              </div>
                                            </div>
                                            <DropdownCompositionBadges snap={snap} />
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Save Snapshot */}
                          <button onClick={handleCopyFLS} class={saveSuccess ? 'btn-success' : 'btn-primary'}>
                            {saveSuccess ? (
                              <>
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Saved!
                              </>
                            ) : (
                              <>
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                                Save Snapshot
                              </>
                            )}
                          </button>
                        </div>
                      </div>

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
                    <div class="flex-1 flex items-center justify-center py-16">
                      <EmptyState type="no-field-selected" />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div class="p-4">
            {isSalesforcePage === false ? (
              <div class="flex items-center justify-center py-16">
                <EmptyState type="no-salesforce" />
              </div>
            ) : (
              <ObjectAuditCapture />
            )}
          </div>
        )}

        {activeTab === 'snapshots' && (
          <div class="p-4">
            <SnapshotManager
              onCompare={handleCompare}
              onBulkApply={setBulkApplySnapshot}
            />
          </div>
        )}

        {activeTab === 'history' && (
          <div class="p-4">
            <HistoryPanel />
          </div>
        )}

        {activeTab === 'settings' && (
          <div class="p-4">
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
          onCancel={applyLoading ? () => {} : () => setApplyChanges(null)}
          loading={applyLoading}
        />
      )}
    </div>
  );
}
