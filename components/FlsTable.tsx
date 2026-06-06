import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import type { FieldPermissionRecord, DiffResult, DiffRow } from '../lib/api/types';
import { DiffBadge } from './DiffBadge';
import { buildSetupUrl } from '../lib/utils/format';

export type TypeFilter = 'all' | 'Profile' | 'PermissionSet';

interface FlsTableProps {
  permissions: FieldPermissionRecord[];
  diffResult?: DiffResult;
  showDiffOnly?: boolean;
  onToggleDiffOnly?: (val: boolean) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  typeFilter?: TypeFilter;
  onTypeFilterChange?: (filter: TypeFilter) => void;
  /** Instance URL of the current (target) org — enables Setup deep links */
  instanceUrl?: string;
  /** Instance URL of the source/compare org — used for diff rows missing from target */
  sourceInstanceUrl?: string;
}

type SortKey = 'name' | 'type' | 'read' | 'edit' | 'status';
type SortDir = 'asc' | 'desc';

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span class="text-slate-600 ml-1">↕</span>;
  return <span class="text-cyan-400 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function BoolCell({ value }: { value: boolean }) {
  return (
    <span class={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold
                  ${value ? 'bg-teal-400/15 text-teal-400' : 'bg-slate-700/50 text-slate-500'}`}>
      {value ? '✓' : '✗'}
    </span>
  );
}

function TypeBadge({ type }: { type: 'Profile' | 'PermissionSet' }) {
  const isProfile = type === 'Profile';
  return (
    <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded
                  ${isProfile
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-blue-500/15 text-blue-400'}`}>
      {isProfile ? 'Profile' : 'PermSet'}
    </span>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="inline-flex items-center gap-2 cursor-pointer select-none">
      <span class="text-xs text-slate-400">{label}</span>
      <div class="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
          class="sr-only peer"
        />
        <div class="w-8 h-[18px] rounded-full bg-slate-700 peer-checked:bg-cyan-500/40 transition-colors duration-200" />
        <div class="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-slate-400
                    peer-checked:bg-cyan-400 peer-checked:translate-x-3.5
                    transition-all duration-200" />
      </div>
    </label>
  );
}

export function FlsTable({
  permissions,
  diffResult,
  showDiffOnly = false,
  onToggleDiffOnly,
  searchQuery = '',
  onSearchChange,
  typeFilter: typeFilterProp,
  onTypeFilterChange,
  instanceUrl,
  sourceInstanceUrl,
}: FlsTableProps) {
  const isDiffMode = !!diffResult;
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [localTypeFilter, setLocalTypeFilter] = useState<TypeFilter>('all');

  const search = onSearchChange !== undefined ? searchQuery : localSearch;
  const setSearch = onSearchChange ?? setLocalSearch;

  // Controlled if parent provides both prop + setter, otherwise local
  const typeFilter = onTypeFilterChange !== undefined ? (typeFilterProp ?? 'all') : localTypeFilter;
  const setTypeFilter = onTypeFilterChange ?? setLocalTypeFilter;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Single-view mode data
  const filteredPermissions = useMemo(() => {
    if (isDiffMode) return [];
    let rows = [...permissions];
    if (typeFilter !== 'all') rows = rows.filter(r => r.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name': return a.label.localeCompare(b.label) * dir;
        case 'type': return a.type.localeCompare(b.type) * dir;
        case 'read': return (Number(a.permissionsRead) - Number(b.permissionsRead)) * dir;
        case 'edit': return (Number(a.permissionsEdit) - Number(b.permissionsEdit)) * dir;
        default: return 0;
      }
    });
    return rows;
  }, [permissions, search, sortKey, sortDir, isDiffMode, typeFilter]);

  // Diff-view mode data
  const filteredDiffRows = useMemo(() => {
    if (!isDiffMode || !diffResult) return [];
    let rows = [...diffResult.rows];
    if (typeFilter !== 'all') rows = rows.filter(r => r.type === typeFilter);
    if (showDiffOnly) {
      rows = rows.filter(r => r.status !== 'MATCH');
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name': return a.label.localeCompare(b.label) * dir;
        case 'type': return a.type.localeCompare(b.type) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
        default: return 0;
      }
    });
    return rows;
  }, [diffResult, showDiffOnly, search, sortKey, sortDir, isDiffMode, typeFilter]);

  const totalCount = isDiffMode ? filteredDiffRows.length : filteredPermissions.length;

  const thClass = 'text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors duration-150 whitespace-nowrap';

  return (
    <div class="flex flex-col">
      {/* Toolbar */}
      <div class="flex flex-col gap-2 mb-3">
        <div class="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div class="relative flex-1 min-w-[140px]">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              placeholder="Filter by name…"
              class="w-full pl-8 pr-3 py-2 text-sm rounded-md bg-slate-800 border border-slate-700
                     text-slate-200 placeholder-slate-500
                     focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50
                     transition-all duration-200"
            />
          </div>

          {/* Count badge */}
          <span class="text-xs font-medium px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-400 whitespace-nowrap">
            {totalCount} {totalCount === 1 ? 'row' : 'rows'}
          </span>

          {/* Diff-only toggle */}
          {isDiffMode && onToggleDiffOnly && (
            <ToggleSwitch
              checked={showDiffOnly}
              onChange={onToggleDiffOnly}
              label="Differences only"
            />
          )}
        </div>

        {/* Type filter — segmented control */}
        <div class="flex rounded-md overflow-hidden border border-slate-700 w-fit text-xs font-medium">
          {(['all', 'Profile', 'PermissionSet'] as TypeFilter[]).map((opt) => {
            const label = opt === 'all' ? 'All' : opt === 'Profile' ? 'Profiles' : 'Permission Sets';
            const active = typeFilter === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setTypeFilter(opt)}
                class={`px-3 py-1.5 transition-colors duration-150 ${
                  active
                    ? opt === 'Profile'
                      ? 'bg-purple-500/20 text-purple-300 border-x border-slate-700'
                      : opt === 'PermissionSet'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-slate-700 text-slate-200'
                    : 'bg-slate-800/50 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'
                } ${opt !== 'PermissionSet' ? 'border-r border-slate-700' : ''}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div class="rounded-lg border border-slate-700 overflow-hidden">
        <div class="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700">
              {isDiffMode ? (
                <tr>
                  <th class={thClass} onClick={() => handleSort('name')}>
                    Name <SortArrow active={sortKey === 'name'} dir={sortDir} />
                  </th>
                  <th class={thClass} onClick={() => handleSort('type')}>
                    Type <SortArrow active={sortKey === 'type'} dir={sortDir} />
                  </th>
                  <th class={`${thClass} text-center`}>Src Visible</th>
                  <th class={`${thClass} text-center`}>Src Read Only</th>
                  <th class={`${thClass} text-center`}>Tgt Visible</th>
                  <th class={`${thClass} text-center`}>Tgt Read Only</th>
                  <th class={thClass} onClick={() => handleSort('status')}>
                    Status <SortArrow active={sortKey === 'status'} dir={sortDir} />
                  </th>
                </tr>
              ) : (
                <tr>
                  <th class={thClass} onClick={() => handleSort('name')}>
                    Name <SortArrow active={sortKey === 'name'} dir={sortDir} />
                  </th>
                  <th class={thClass} onClick={() => handleSort('type')}>
                    Type <SortArrow active={sortKey === 'type'} dir={sortDir} />
                  </th>
                  <th class={`${thClass} text-center`} onClick={() => handleSort('read')}>
                    Visible <SortArrow active={sortKey === 'read'} dir={sortDir} />
                  </th>
                  <th class={`${thClass} text-center`} onClick={() => handleSort('edit')}>
                    Read Only <SortArrow active={sortKey === 'edit'} dir={sortDir} />
                  </th>
                </tr>
              )}
            </thead>

            <tbody class="divide-y divide-slate-700/30">
              {isDiffMode ? (
                filteredDiffRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} class="px-4 py-8 text-center text-sm text-slate-500">
                      No rows to display
                    </td>
                  </tr>
                ) : (
                  filteredDiffRows.map((row, i) => (
                    <DiffTableRow key={row.name} row={row} index={i} instanceUrl={instanceUrl} sourceInstanceUrl={sourceInstanceUrl} />
                  ))
                )
              ) : (
                filteredPermissions.length === 0 ? (
                  <tr>
                    <td colSpan={4} class="px-4 py-8 text-center text-sm text-slate-500">
                      No rows to display
                    </td>
                  </tr>
                ) : (
                  filteredPermissions.map((perm, i) => (
                    <SingleTableRow key={perm.id} perm={perm} index={i} instanceUrl={instanceUrl} />
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SetupLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open in Salesforce Setup"
      onClick={(e) => e.stopPropagation()}
      class="ml-1.5 inline-flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-150
             text-slate-500 hover:text-cyan-400 focus:opacity-100 focus:text-cyan-400 focus:outline-none"
    >
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

function SingleTableRow({ perm, index, instanceUrl }: { perm: FieldPermissionRecord; index: number; instanceUrl?: string }) {
  const isProfile = perm.type === 'Profile';
  const setupUrl = instanceUrl ? buildSetupUrl(instanceUrl, perm.id, perm.type) : null;
  return (
    <tr class={`group hover:bg-slate-700/30 transition-colors duration-150
                ${index % 2 === 0 ? 'bg-slate-800/40' : 'bg-slate-800/20'}
                ${isProfile ? 'border-l-2 border-l-purple-500/50' : 'border-l-2 border-l-blue-500/50'}`}>
      <td class="px-3 py-2.5">
        <div class="flex items-center">
          <div class="min-w-0">
            <div class="text-slate-200 text-sm font-medium truncate max-w-[200px]" title={perm.label}>
              {perm.label}
            </div>
            <div class="text-xs text-slate-500 truncate">{perm.name}</div>
          </div>
          {setupUrl && <SetupLink url={setupUrl} />}
        </div>
      </td>
      <td class="px-3 py-2.5">
        <TypeBadge type={perm.type} />
      </td>
      <td class="px-3 py-2.5 text-center">
        <BoolCell value={perm.permissionsRead} />
      </td>
      <td class="px-3 py-2.5 text-center">
        <BoolCell value={perm.permissionsEdit} />
      </td>
    </tr>
  );
}

function DiffTableRow({ row, index, instanceUrl, sourceInstanceUrl }: {
  row: DiffRow;
  index: number;
  instanceUrl?: string;
  sourceInstanceUrl?: string;
}) {
  const isProfile = row.type === 'Profile';
  // Prefer target (current org) link; fall back to source link for MISSING_IN_TARGET rows
  const setupUrl = (() => {
    if (instanceUrl && row.targetId) return buildSetupUrl(instanceUrl, row.targetId, row.type);
    if (sourceInstanceUrl && row.sourceId) return buildSetupUrl(sourceInstanceUrl, row.sourceId, row.type);
    return null;
  })();
  return (
    <tr class={`group hover:bg-slate-700/30 transition-colors duration-150
                ${index % 2 === 0 ? 'bg-slate-800/40' : 'bg-slate-800/20'}
                ${isProfile ? 'border-l-2 border-l-purple-500/50' : 'border-l-2 border-l-blue-500/50'}`}>
      <td class="px-3 py-2.5">
        <div class="flex items-center">
          <div class="min-w-0">
            <div class="text-slate-200 text-sm font-medium truncate max-w-[180px]" title={row.label}>
              {row.label}
            </div>
            <div class="text-xs text-slate-500 truncate">{row.name}</div>
          </div>
          {setupUrl && <SetupLink url={setupUrl} />}
        </div>
      </td>
      <td class="px-3 py-2.5">
        <TypeBadge type={row.type} />
      </td>
      <td class="px-3 py-2.5 text-center">
        {row.source ? <BoolCell value={row.source.read} /> : <span class="text-slate-600">—</span>}
      </td>
      <td class="px-3 py-2.5 text-center">
        {row.source ? <BoolCell value={row.source.edit} /> : <span class="text-slate-600">—</span>}
      </td>
      <td class="px-3 py-2.5 text-center">
        {row.target ? <BoolCell value={row.target.read} /> : <span class="text-slate-600">—</span>}
      </td>
      <td class="px-3 py-2.5 text-center">
        {row.target ? <BoolCell value={row.target.edit} /> : <span class="text-slate-600">—</span>}
      </td>
      <td class="px-3 py-2.5">
        <DiffBadge status={row.status} />
      </td>
    </tr>
  );
}
