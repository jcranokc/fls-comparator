import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import type { FLSSnapshot } from '../lib/api/types';
import { formatTimestamp, formatFullTimestamp, formatFieldLabel, formatOrgUrl, truncate } from '../lib/utils/format';

interface SnapshotCardProps {
  snapshot: FLSSnapshot;
  onCompare?: (snapshot: FLSSnapshot) => void;
  onBulkApply?: (snapshot: FLSSnapshot) => void;
  onExport?: (snapshot: FLSSnapshot) => void;
  onDelete?: (snapshot: FLSSnapshot) => void;
  onRename?: (id: string, newLabel: string) => void;
  onUpdateOrgLabel?: (snapshot: FLSSnapshot, newOrgLabel: string) => void;
  selected?: boolean;
}

function ActionButton({
  onClick,
  variant,
  children,
}: {
  onClick: () => void;
  variant: 'cyan' | 'teal' | 'slate' | 'rose';
  children: preact.ComponentChildren;
}) {
  const styles = {
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/40',
    teal: 'bg-teal-500/10 text-teal-400 border-teal-500/20 hover:bg-teal-500/20 hover:border-teal-500/40',
    slate: 'bg-slate-700/40 text-slate-300 border-slate-600/30 hover:bg-slate-700/60 hover:border-slate-600/50',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/40',
  };

  return (
    <button
      onClick={onClick}
      class={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border
              focus:outline-none focus:ring-2 focus:ring-cyan-500/30
              transition-all duration-200 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function SnapshotCard({
  snapshot,
  onCompare,
  onBulkApply,
  onExport,
  onDelete,
  onRename,
  onUpdateOrgLabel,
  selected = false,
}: SnapshotCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(snapshot.label);
  const [isEditingOrg, setIsEditingOrg] = useState(false);
  const [editOrgLabel, setEditOrgLabel] = useState(snapshot.org.orgLabel ?? '');

  const handleDoubleClick = useCallback(() => {
    setEditLabel(snapshot.label);
    setIsEditing(true);
  }, [snapshot.label]);

  const handleLabelSave = useCallback(() => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== snapshot.label) {
      onRename?.(snapshot.id, trimmed);
    } else {
      setEditLabel(snapshot.label);
    }
    setIsEditing(false);
  }, [editLabel, snapshot.label, snapshot.id, onRename]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') handleLabelSave();
    if (e.key === 'Escape') {
      setEditLabel(snapshot.label);
      setIsEditing(false);
    }
  }, [snapshot.label, handleLabelSave]);

  const handleOrgLabelSave = useCallback(() => {
    onUpdateOrgLabel?.(snapshot, editOrgLabel.trim());
    setIsEditingOrg(false);
  }, [editOrgLabel, snapshot, onUpdateOrgLabel]);

  const handleOrgKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') handleOrgLabelSave();
    if (e.key === 'Escape') {
      setEditOrgLabel(snapshot.org.orgLabel ?? '');
      setIsEditingOrg(false);
    }
  }, [snapshot.org.orgLabel, handleOrgLabelSave]);

  const fieldLabel = formatFieldLabel(snapshot.objectApiName, snapshot.fieldApiName);
  const orgDisplay = snapshot.org.orgLabel || formatOrgUrl(snapshot.org.instanceUrl);

  return (
    <div
      class={`bg-slate-800 rounded-lg p-4 border transition-all duration-200
              hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5
              ${selected
                ? 'border-cyan-500/50 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/20'
                : 'border-slate-700 hover:border-slate-600'}`}
    >
      {/* Header */}
      <div class="mb-3">
        {isEditing ? (
          <input
            type="text"
            value={editLabel}
            onInput={(e) => setEditLabel((e.target as HTMLInputElement).value)}
            onBlur={handleLabelSave}
            onKeyDown={handleKeyDown}
            autoFocus
            class="w-full text-sm font-semibold bg-slate-700/50 border border-cyan-500/50 rounded-md
                   px-2 py-1 text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
          />
        ) : (
          <h3
            class="text-sm font-semibold text-slate-100 cursor-pointer truncate
                   hover:text-cyan-400 transition-colors duration-150"
            onDblClick={handleDoubleClick}
            title="Double-click to edit label"
          >
            {snapshot.label}
          </h3>
        )}
      </div>

      {/* Metadata */}
      <div class="space-y-1.5 mb-4">
        {/* Field */}
        <div class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          <span class="text-xs text-slate-300 font-mono truncate" title={fieldLabel}>
            {truncate(fieldLabel, 35)}
          </span>
        </div>

        {/* Timestamp */}
        <div class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs text-slate-400" title={formatFullTimestamp(snapshot.capturedAt)}>
            {formatTimestamp(snapshot.capturedAt)}
          </span>
        </div>

        {/* Org */}
        <div class="flex items-center gap-2 group">
          <svg class="w-3.5 h-3.5 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
          </svg>
          {isEditingOrg ? (
            <input
              type="text"
              value={editOrgLabel}
              placeholder={formatOrgUrl(snapshot.org.instanceUrl)}
              onInput={(e) => setEditOrgLabel((e.target as HTMLInputElement).value)}
              onBlur={handleOrgLabelSave}
              onKeyDown={handleOrgKeyDown}
              autoFocus
              class="flex-1 text-xs bg-slate-700/50 border border-cyan-500/50 rounded px-1.5 py-0.5
                     text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
            />
          ) : (
            <>
              <span class="text-xs text-slate-400 truncate flex-1 min-w-0" title={snapshot.org.instanceUrl}>
                {orgDisplay}
              </span>
              {onUpdateOrgLabel && (
                <button
                  onClick={() => { setEditOrgLabel(snapshot.org.orgLabel ?? ''); setIsEditingOrg(true); }}
                  class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-500
                         hover:text-cyan-400 transition-all duration-150 flex-shrink-0"
                  title="Edit org label"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>

        {/* Composition badges */}
        {(() => {
          const profileCount = snapshot.permissions.filter(p => p.type === 'Profile').length;
          const permsetCount = snapshot.permissions.filter(p => p.type === 'PermissionSet').length;
          return (
            <div class="flex items-center gap-1.5 flex-wrap">
              {profileCount > 0 && (
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                  {profileCount} Profile{profileCount !== 1 ? 's' : ''}
                </span>
              )}
              {permsetCount > 0 && (
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                  {permsetCount} Perm Set{permsetCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Actions */}
      <div class="flex items-center gap-2 pt-3 border-t border-slate-700/50 flex-wrap">
        {onCompare && (
          <ActionButton variant="cyan" onClick={() => onCompare(snapshot)}>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            Compare
          </ActionButton>
        )}
        {onBulkApply && (
          <ActionButton variant="teal" onClick={() => onBulkApply(snapshot)}>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 8.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v8.25A2.25 2.25 0 006 16.5h2.25m8.25-8.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-7.5A2.25 2.25 0 018.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 00-2.25 2.25v6" />
            </svg>
            Bulk Apply
          </ActionButton>
        )}
        {onExport && (
          <ActionButton variant="slate" onClick={() => onExport(snapshot)}>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </ActionButton>
        )}
        {onDelete && (
          <ActionButton variant="rose" onClick={() => onDelete(snapshot)}>
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Delete
          </ActionButton>
        )}
      </div>
    </div>
  );
}
