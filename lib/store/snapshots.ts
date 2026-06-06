/**
 * Snapshot storage layer using browser.storage.local.
 * Handles CRUD operations, export, and import of FLS snapshots.
 */
import { storage } from 'wxt/storage';
import * as XLSX from 'xlsx';
import type { FLSSnapshot, ExtensionSettings, OrgContext } from '../api/types';
import { DEFAULT_SETTINGS, STORAGE_KEY_SNAPSHOTS, STORAGE_KEY_SETTINGS } from './types';

// ─── Define WXT storage items ────────────────────────────────────────────────

const snapshotsItem = storage.defineItem<FLSSnapshot[]>(`local:${STORAGE_KEY_SNAPSHOTS}`, {
  fallback: [],
});

const settingsItem = storage.defineItem<ExtensionSettings>(`local:${STORAGE_KEY_SETTINGS}`, {
  fallback: DEFAULT_SETTINGS,
});

// ─── Snapshot CRUD ───────────────────────────────────────────────────────────

/**
 * Save a new snapshot to storage.
 * Respects the maxSnapshots setting — removes oldest if at capacity.
 */
export async function saveSnapshot(snapshot: FLSSnapshot): Promise<void> {
  const settings = await getSettings();
  const snapshots = await loadSnapshots();

  // Enforce max snapshot limit — remove oldest first
  while (snapshots.length >= settings.maxSnapshots) {
    snapshots.shift();
  }

  snapshots.push(snapshot);
  await snapshotsItem.setValue(snapshots);
}

/**
 * Load all saved snapshots from storage.
 */
export async function loadSnapshots(): Promise<FLSSnapshot[]> {
  return await snapshotsItem.getValue();
}

/**
 * Load a single snapshot by ID.
 */
export async function loadSnapshot(id: string): Promise<FLSSnapshot | null> {
  const snapshots = await loadSnapshots();
  return snapshots.find(s => s.id === id) ?? null;
}

/**
 * Delete a snapshot by ID.
 */
export async function deleteSnapshot(id: string): Promise<void> {
  const snapshots = await loadSnapshots();
  const filtered = snapshots.filter(s => s.id !== id);
  await snapshotsItem.setValue(filtered);
}

/**
 * Delete all snapshots.
 */
export async function deleteAllSnapshots(): Promise<void> {
  await snapshotsItem.setValue([]);
}

/**
 * Update a snapshot's label.
 */
export async function updateSnapshotLabel(id: string, label: string): Promise<void> {
  const snapshots = await loadSnapshots();
  const snapshot = snapshots.find(s => s.id === id);
  if (snapshot) {
    snapshot.label = label;
    await snapshotsItem.setValue(snapshots);
  }
}

/**
 * Update a snapshot's org label.
 */
export async function updateOrgLabel(id: string, orgLabel: string): Promise<void> {
  const snapshots = await loadSnapshots();
  const snapshot = snapshots.find(s => s.id === id);
  if (snapshot) {
    snapshot.org.orgLabel = orgLabel || undefined;
    await snapshotsItem.setValue(snapshots);
  }
}

/**
 * Update the org label for every snapshot sharing the given orgId.
 * Org labels are a property of the org, not individual snapshots — editing
 * one propagates to all snapshots from the same org.
 */
export async function updateAllOrgLabels(orgId: string, orgLabel: string): Promise<void> {
  const snapshots = await loadSnapshots();
  let changed = false;
  for (const s of snapshots) {
    if (s.org.orgId === orgId) {
      s.org.orgLabel = orgLabel || undefined;
      changed = true;
    }
  }
  if (changed) await snapshotsItem.setValue(snapshots);
}

/**
 * Return one OrgContext per unique orgId, with a snapshot count.
 * Used by the Settings org-label manager.
 */
export async function loadUniqueOrgs(): Promise<Array<{ org: OrgContext; snapshotCount: number }>> {
  const snapshots = await loadSnapshots();
  const map = new Map<string, { org: OrgContext; count: number }>();
  for (const s of snapshots) {
    const key = s.org.orgId || s.org.instanceUrl;
    if (!map.has(key)) {
      map.set(key, { org: { ...s.org }, count: 0 });
    }
    map.get(key)!.count++;
  }
  return Array.from(map.values()).map(({ org, count }) => ({ org, snapshotCount: count }));
}

/**
 * Save multiple snapshots at once (object-level audit).
 * Intentionally bypasses the per-save maxSnapshots limit — the user knowingly
 * requested a bulk audit. Oldest snapshots are trimmed only if the total would
 * exceed twice the configured limit.
 */
export async function saveSnapshots(snapshots: FLSSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const settings = await getSettings();
  const existing = await loadSnapshots();
  const combined = [...existing, ...snapshots];
  const cap = Math.max(settings.maxSnapshots, combined.length);
  const trimmed = combined.length > cap ? combined.slice(combined.length - cap) : combined;
  await snapshotsItem.setValue(trimmed);
}

// ─── Export / Import ─────────────────────────────────────────────────────────

/**
 * Export a snapshot as a downloadable JSON blob.
 */
export function exportSnapshotAsJson(snapshot: FLSSnapshot): Blob {
  const json = JSON.stringify(snapshot, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Trigger a file download of a snapshot.
 */
export function downloadSnapshot(snapshot: FLSSnapshot): void {
  const blob = exportSnapshotAsJson(snapshot);
  const url = URL.createObjectURL(blob);
  const filename = `fls-${snapshot.objectApiName}-${snapshot.fieldApiName}-${Date.now()}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download all snapshots from an object audit as an XLSX workbook.
 * Two sheets: "Profiles" and "Permission Sets", each a pivoted matrix
 * with fields as rows and principals as columns (R+E / R / E / -).
 */
export function downloadObjectSnapshotsAsXlsx(snapshots: FLSSnapshot[], objectApiName: string): void {
  if (snapshots.length === 0) return;

  const wb = XLSX.utils.book_new();

  const buildSheet = (type: 'Profile' | 'PermissionSet') => {
    // All principals of this type, in stable order from the first snapshot
    const principals = snapshots[0].permissions.filter(p => p.type === type);

    // Header row
    const header = ['Field', ...principals.map(p => p.name)];

    // Data rows
    const rows = snapshots.map(snap => {
      const permMap = new Map(snap.permissions.map(p => [p.name, p]));
      const cells = principals.map(p => {
        const perm = permMap.get(p.name);
        if (!perm) return '-';
        const r = perm.permissionsRead;
        const e = perm.permissionsEdit;
        return r && e ? 'R+E' : r ? 'R' : e ? 'E' : '-';
      });
      return [snap.fieldApiName, ...cells];
    });

    return XLSX.utils.aoa_to_sheet([header, ...rows]);
  };

  XLSX.utils.book_append_sheet(wb, buildSheet('Profile'), 'Profiles');
  XLSX.utils.book_append_sheet(wb, buildSheet('PermissionSet'), 'Permission Sets');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fls-audit-${objectApiName}-${Date.now()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download all snapshots from an object audit as a pivoted CSV matrix.
 * Rows = fields, columns = profiles/permission sets, cells = R+E / R / E / -.
 * Opens natively in Excel, Numbers, and Google Sheets.
 */
export function downloadObjectSnapshotsAsCsv(snapshots: FLSSnapshot[], objectApiName: string): void {
  if (snapshots.length === 0) return;

  // Collect all unique principals in stable order from the first snapshot
  // (all snapshots share the same profiles/permsets list).
  const principals = snapshots[0].permissions.map(p => ({
    name: p.name,
    type: p.type,
  }));

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;

  // Header row: Field | <principal label (type)>...
  const headerCols = principals.map(p => escape(`${p.name} (${p.type === 'Profile' ? 'P' : 'PS'})`));
  const header = [escape('Field'), ...headerCols].join(',');

  // Data rows
  const rows = snapshots.map(snap => {
    const permMap = new Map(snap.permissions.map(p => [p.name, p]));
    const cells = principals.map(p => {
      const perm = permMap.get(p.name);
      if (!perm) return '"-"';
      const r = perm.permissionsRead;
      const e = perm.permissionsEdit;
      const cell = r && e ? 'R+E' : r ? 'R' : e ? 'E' : '-';
      return escape(cell);
    });
    return [escape(snap.fieldApiName), ...cells].join(',');
  });

  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = `fls-audit-${objectApiName}-${Date.now()}.csv`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download all snapshots from an object audit as a single JSON file.
 * The file wraps all per-field snapshots with audit metadata so it can be
 * identified and imported as a unit later.
 */
export function downloadObjectSnapshots(snapshots: FLSSnapshot[], objectApiName: string): void {
  const payload = {
    type: 'fls-object-audit',
    objectApiName,
    capturedAt: snapshots[0]?.capturedAt ?? new Date().toISOString(),
    fieldCount: snapshots.length,
    snapshots,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `fls-audit-${objectApiName}-${Date.now()}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a snapshot from a JSON file.
 * Validates the structure before saving.
 */
export async function importSnapshot(file: File): Promise<FLSSnapshot> {
  const text = await file.text();
  const parsed = JSON.parse(text);

  // Basic validation
  if (!isValidSnapshot(parsed)) {
    throw new Error('Invalid snapshot file format');
  }

  await saveSnapshot(parsed);
  return parsed;
}

/**
 * Validate that an object has the shape of an FLSSnapshot.
 */
function isValidSnapshot(obj: unknown): obj is FLSSnapshot {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    typeof s.capturedAt === 'string' &&
    typeof s.objectApiName === 'string' &&
    typeof s.fieldApiName === 'string' &&
    typeof s.org === 'object' &&
    Array.isArray(s.permissions)
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Load extension settings.
 */
export async function getSettings(): Promise<ExtensionSettings> {
  return await settingsItem.getValue();
}

/**
 * Save extension settings.
 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await settingsItem.setValue(settings);
}

/**
 * Get snapshot count for badge display.
 */
export async function getSnapshotCount(): Promise<number> {
  const snapshots = await loadSnapshots();
  return snapshots.length;
}

/**
 * Find the most recently saved snapshot across all orgs.
 * Used to surface the auto-diff banner after any field fetch.
 */
export async function findLastSnapshot(): Promise<FLSSnapshot | null> {
  const snapshots = await loadSnapshots();
  if (snapshots.length === 0) return null;
  return snapshots.reduce((latest, s) => s.capturedAt > latest.capturedAt ? s : latest);
}
