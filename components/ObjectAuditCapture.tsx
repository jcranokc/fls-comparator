import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import type { FLSSnapshot, SalesforceSession } from '../lib/api/types';
import { describeObjects, fetchObjectFLS } from '../lib/api/salesforce';
import { getSession } from '../lib/api/session';
import { saveSnapshots, downloadObjectSnapshots, downloadObjectSnapshotsAsCsv, downloadObjectSnapshotsAsXlsx } from '../lib/store/snapshots';
import { LoadingSkeleton } from './LoadingSkeleton';

type AuditStatus = 'loading' | 'ready' | 'capturing' | 'done' | 'error';

interface ObjectItem {
  name: string;
  label: string;
  custom: boolean;
}

export function ObjectAuditCapture() {
  const [status, setStatus] = useState<AuditStatus>('loading');
  const [session, setSession] = useState<SalesforceSession | null>(null);
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [selectedObject, setSelectedObject] = useState('');
  const [objectSearch, setObjectSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<FLSSnapshot[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess) {
          setError('No active Salesforce session. Make sure you are logged into Salesforce.');
          setStatus('error');
          return;
        }
        setSession(sess);
        const objs = await describeObjects(sess);
        if (!cancelled) {
          setObjects(objs);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load objects');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredObjects = useMemo(() => {
    if (!objectSearch) return objects;
    const q = objectSearch.toLowerCase();
    return objects.filter(o => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
  }, [objects, objectSearch]);

  const handleObjectSelect = useCallback((name: string) => {
    setSelectedObject(name);
    setDropdownOpen(false);
    setObjectSearch('');
    // Reset any prior capture state (including error) when object changes
    setSnapshots([]);
    setSaved(false);
    setError('');
    setStatus('ready');
  }, [status]);

  const handleCapture = useCallback(async () => {
    if (!session || !selectedObject) return;
    setStatus('capturing');
    setError('');
    try {
      const snaps = await fetchObjectFLS(session, selectedObject);
      setSnapshots(snaps);
      setStatus('done');
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture FLS data');
      setStatus('ready');
    }
  }, [session, selectedObject]);

  const handleSaveAll = useCallback(async () => {
    try {
      await saveSnapshots(snapshots);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save snapshots');
    }
  }, [snapshots]);

  const handleDownload = useCallback(() => {
    downloadObjectSnapshots(snapshots, selectedObject);
  }, [snapshots, selectedObject]);

  const handleDownloadCsv = useCallback(() => {
    downloadObjectSnapshotsAsCsv(snapshots, selectedObject);
  }, [snapshots, selectedObject]);

  const handleDownloadXlsx = useCallback(() => {
    downloadObjectSnapshotsAsXlsx(snapshots, selectedObject);
  }, [snapshots, selectedObject]);

  const handleReset = useCallback(() => {
    setSnapshots([]);
    setSaved(false);
    setStatus('ready');
    setError('');
    // Keep the selected object so the user can easily re-run
  }, []);

  const selectedObjectItem = objects.find(o => o.name === selectedObject);
  const isCapturing = status === 'capturing';

  if (status === 'loading') {
    return <LoadingSkeleton type="picker" lines={2} />;
  }

  return (
    <div class="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 class="text-sm font-semibold text-slate-200">Object Audit</h2>
        <p class="text-xs text-slate-500 mt-0.5">
          Capture FLS for all permissionable fields in one object — 4 API calls regardless of field count.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div class="flex items-start gap-2 px-3 py-2.5 rounded-md bg-rose-400/10 border border-rose-400/20 text-rose-400 text-xs">
          <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span class="flex-1">{error}</span>
          <button onClick={() => setError('')} class="text-rose-400/60 hover:text-rose-400 transition-colors">✕</button>
        </div>
      )}

      {/* Object Picker */}
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-slate-400 uppercase tracking-wider">Object</label>
          {objects.length > 0 && (
            <span class="text-xs text-slate-500">{objects.length} objects</span>
          )}
        </div>
        <div ref={dropdownRef} class="relative">
          <button
            type="button"
            onClick={() => !isCapturing && setDropdownOpen(o => !o)}
            disabled={isCapturing || objects.length === 0}
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-md
                   bg-slate-800 border border-slate-700 text-sm text-left
                   hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                   disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            <span class={selectedObjectItem ? 'text-slate-100' : 'text-slate-500'}>
              {selectedObjectItem
                ? `${selectedObjectItem.label} (${selectedObjectItem.name})`
                : 'Select an object…'}
            </span>
            <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {dropdownOpen && (
            <div class="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md
                        bg-slate-800 border border-slate-700 shadow-xl shadow-black/30 animate-fade-in">
              <div class="relative px-2 pt-2 pb-1 sticky top-0 bg-slate-800 z-10">
                <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 mt-0.5"
                     fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  type="text"
                  value={objectSearch}
                  onInput={(e) => setObjectSearch((e.target as HTMLInputElement).value)}
                  placeholder="Search objects…"
                  autoFocus
                  class="w-full pl-7 pr-3 py-1.5 text-xs rounded-md bg-slate-700/50 border border-slate-600/50
                         text-slate-200 placeholder-slate-500
                         focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50
                         transition-all duration-200"
                />
              </div>
              <div class="py-1">
                {filteredObjects.length === 0 ? (
                  <div class="px-3 py-4 text-xs text-slate-500 text-center">No objects match</div>
                ) : (
                  filteredObjects.map(obj => (
                    <button
                      key={obj.name}
                      type="button"
                      onClick={() => handleObjectSelect(obj.name)}
                      class={`w-full text-left px-3 py-2 text-sm flex items-center justify-between
                             hover:bg-slate-700/60 transition-colors duration-150
                             ${obj.name === selectedObject ? 'bg-cyan-500/10 text-cyan-400' : 'text-slate-200'}`}
                    >
                      <span class="truncate">
                        {obj.label}
                        <span class="ml-1.5 text-xs text-slate-500">{obj.name}</span>
                      </span>
                      {obj.custom && (
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 ml-2 flex-shrink-0">
                          Custom
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Capture button — shown when object selected and not yet capturing/done */}
      {(status === 'ready' || status === 'done') && selectedObject && (
        <button
          onClick={status === 'done' ? handleReset : handleCapture}
          class={status === 'done' ? 'btn-ghost flex items-center justify-center gap-2' : 'btn-primary flex items-center justify-center gap-2 w-full'}
        >
          {status === 'done' ? (
            <>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Capture Another Object
            </>
          ) : (
            <>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Capture All Fields
            </>
          )}
        </button>
      )}

      {/* Capturing spinner */}
      {isCapturing && (
        <div class="flex items-center gap-3 px-4 py-3.5 rounded-lg bg-slate-800 border border-slate-700 animate-fade-in">
          <svg class="animate-spin w-4 h-4 text-cyan-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <div class="text-sm text-slate-200">
              Fetching FLS for <strong>{selectedObjectItem?.label ?? selectedObject}</strong>…
            </div>
            <div class="text-xs text-slate-500 mt-0.5">
              Querying all profiles, permission sets, and field permissions in 4 API calls
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {status === 'done' && snapshots.length > 0 && (
        <div class="flex flex-col gap-3 animate-fade-in">
          {/* Summary */}
          <div class="px-4 py-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="text-sm font-medium text-emerald-300">
                {snapshots.length} field{snapshots.length !== 1 ? 's' : ''} captured
              </span>
            </div>
            <div class="mt-1 text-xs text-slate-400">
              {selectedObjectItem?.label ?? selectedObject}
              {' · '}
              {snapshots[0]?.permissions.length ?? 0} profiles &amp; permission sets each
              {' · '}
              {new Date(snapshots[0]?.capturedAt ?? '').toLocaleString()}
            </div>
          </div>

          {/* Actions */}
          <div class="flex flex-col gap-2">
            <button
              onClick={handleSaveAll}
              disabled={saved}
              class={`${saved ? 'btn-success' : 'btn-primary'} flex items-center justify-center gap-2 w-full`}
            >
              {saved ? (
                <>
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Saved {snapshots.length} snapshots
                </>
              ) : (
                <>
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save All to Snapshots ({snapshots.length})
                </>
              )}
            </button>

            <button onClick={handleDownloadXlsx} class="btn-secondary flex items-center justify-center gap-2 w-full">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download as XLSX
            </button>

            <div class="flex gap-2">
              <button onClick={handleDownloadCsv} class="btn-ghost flex items-center justify-center gap-1.5 flex-1 text-xs">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                CSV
              </button>
              <button onClick={handleDownload} class="btn-ghost flex items-center justify-center gap-1.5 flex-1 text-xs">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                </svg>
                JSON
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
