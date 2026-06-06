import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { ExtensionSettings } from '../lib/api/types';
import { getSettings, saveSettings, loadUniqueOrgs, updateAllOrgLabels } from '../lib/store/snapshots';
import { formatOrgUrl } from '../lib/utils/format';
import type { OrgContext } from '../lib/api/types';

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [apiVersion, setApiVersion] = useState('61.0');
  const [maxSnapshots, setMaxSnapshots] = useState(50);
  const [defaultOrgLabel, setDefaultOrgLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Org label manager state
  const [orgs, setOrgs] = useState<Array<{ org: OrgContext; snapshotCount: number }>>([]);
  const [orgLabelDraft, setOrgLabelDraft] = useState<Record<string, string>>({});
  const [orgLabelSaved, setOrgLabelSaved] = useState<Record<string, boolean>>({});
  const [orgLabelError, setOrgLabelError] = useState<Record<string, string>>({});

  // Load settings and unique orgs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settings, uniqueOrgs] = await Promise.all([getSettings(), loadUniqueOrgs()]);
        if (!cancelled) {
          setApiVersion(settings.apiVersion);
          setMaxSnapshots(settings.maxSnapshots);
          setDefaultOrgLabel(settings.defaultOrgLabel);
          setOrgs(uniqueOrgs);
          const drafts: Record<string, string> = {};
          for (const { org } of uniqueOrgs) {
            drafts[org.orgId] = org.orgLabel ?? '';
          }
          setOrgLabelDraft(drafts);
        }
      } catch (err) {
        console.error('[SettingsPanel] Failed to load settings:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOrgLabelSave = async (orgId: string) => {
    try {
      const label = orgLabelDraft[orgId] ?? '';
      await updateAllOrgLabels(orgId, label);
      setOrgs(prev => prev.map(item =>
        item.org.orgId === orgId
          ? { ...item, org: { ...item.org, orgLabel: label || undefined } }
          : item
      ));
      setOrgLabelSaved(prev => ({ ...prev, [orgId]: true }));
      setTimeout(() => setOrgLabelSaved(prev => ({ ...prev, [orgId]: false })), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setOrgLabelError(prev => ({ ...prev, [orgId]: msg }));
      setTimeout(() => setOrgLabelError(prev => ({ ...prev, [orgId]: '' })), 4000);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaved(false);
      const settings: ExtensionSettings = {
        apiVersion,
        maxSnapshots: Math.max(1, maxSnapshots),
        defaultOrgLabel,
      };
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[SettingsPanel] Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = `w-full px-3 py-2.5 text-sm rounded-md bg-slate-800 border border-slate-700
                      text-slate-200 placeholder-slate-500
                      focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                      disabled:opacity-50 transition-all duration-200`;

  const labelClass = 'block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5';

  if (loading) {
    return (
      <div class="p-5 space-y-6">
        {[1, 2, 3].map(i => (
          <div key={i} class="space-y-2 animate-pulse">
            <div class="h-3 w-24 rounded bg-slate-700/60" />
            <div class="h-10 w-full rounded-md bg-slate-700/60" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      {/* Header */}
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
        <div class="flex items-center gap-2">
          <svg class="w-4.5 h-4.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h2 class="text-base font-semibold text-slate-100">Settings</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            class="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50
                   transition-all duration-200"
            aria-label="Close settings"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Form */}
      <div class="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* API Version */}
        <div>
          <label class={labelClass} htmlFor="settings-api-version">API Version</label>
          <input
            id="settings-api-version"
            type="text"
            value={apiVersion}
            onInput={(e) => setApiVersion((e.target as HTMLInputElement).value)}
            placeholder="61.0"
            class={inputClass}
          />
          <p class="mt-1 text-[11px] text-slate-500">
            Salesforce REST API version used for all requests
          </p>
        </div>

        {/* Max Snapshots */}
        <div>
          <label class={labelClass} htmlFor="settings-max-snapshots">Max Snapshots</label>
          <input
            id="settings-max-snapshots"
            type="number"
            min={1}
            max={500}
            value={maxSnapshots}
            onInput={(e) => setMaxSnapshots(parseInt((e.target as HTMLInputElement).value) || 1)}
            class={inputClass}
          />
          <p class="mt-1 text-[11px] text-slate-500">
            Maximum number of snapshots stored locally (oldest removed first)
          </p>
        </div>

        {/* Default Org Label */}
        <div>
          <label class={labelClass} htmlFor="settings-org-label">Default Org Label</label>
          <input
            id="settings-org-label"
            type="text"
            value={defaultOrgLabel}
            onInput={(e) => setDefaultOrgLabel((e.target as HTMLInputElement).value)}
            placeholder="e.g., Production, Sandbox"
            class={inputClass}
          />
          <p class="mt-1 text-[11px] text-slate-500">
            Default label applied to new snapshots for org identification
          </p>
        </div>

        {/* Org Label Manager */}
        {orgs.length > 0 && (
          <div>
            <p class={labelClass}>Saved Org Labels</p>
            <p class="text-[11px] text-slate-500 mb-3">
              Rename orgs across all their snapshots at once
            </p>
            <div class="space-y-2">
              {orgs.map(({ org, snapshotCount }) => (
                <div key={org.orgId} class="rounded-md bg-slate-900/60 border border-slate-700/60 px-3 py-2.5">
                  <div class="flex items-center justify-between gap-2 mb-1.5">
                    <span class="text-[11px] text-slate-500 font-mono truncate" title={org.instanceUrl}>
                      {formatOrgUrl(org.instanceUrl)}
                    </span>
                    <span class="text-[10px] text-slate-600 flex-shrink-0">
                      {snapshotCount} snapshot{snapshotCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      value={orgLabelDraft[org.orgId] ?? ''}
                      onInput={(e) => setOrgLabelDraft(prev => ({
                        ...prev,
                        [org.orgId]: (e.target as HTMLInputElement).value,
                      }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleOrgLabelSave(org.orgId); }}
                      placeholder="e.g., Production, Staging"
                      class="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-slate-800 border border-slate-700
                             text-slate-200 placeholder-slate-500
                             focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                             transition-all duration-200"
                    />
                    <button
                      onClick={() => handleOrgLabelSave(org.orgId)}
                      class="px-2.5 py-1.5 text-xs font-medium rounded-md
                             bg-cyan-500/10 text-cyan-400 border border-cyan-500/20
                             hover:bg-cyan-500/20 hover:border-cyan-500/40
                             transition-all duration-200 flex-shrink-0"
                    >
                      {orgLabelSaved[org.orgId] ? (
                        <span class="flex items-center gap-1 text-teal-400">
                          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          Saved
                        </span>
                      ) : 'Save'}
                    </button>
                  </div>
                  {orgLabelError[org.orgId] && (
                    <p class="mt-1 text-[11px] text-rose-400">{orgLabelError[org.orgId]}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div class="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-700/50">
        {saved && (
          <span class="text-xs text-teal-400 flex items-center gap-1 animate-[fadeIn_200ms_ease-out]">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Settings saved
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md
                 bg-cyan-500 text-white hover:bg-cyan-400
                 disabled:opacity-70 disabled:cursor-not-allowed
                 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:ring-offset-2 focus:ring-offset-slate-900
                 transition-all duration-200"
        >
          {saving ? (
            <>
              <svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving…
            </>
          ) : (
            'Save Settings'
          )}
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
