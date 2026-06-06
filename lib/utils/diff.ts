/**
 * Computes a diff between two FLS snapshots.
 * Matches rows by permission set/profile API name (not Salesforce ID),
 * which enables cross-org comparison.
 */
import type {
  FieldPermissionRecord,
  FLSSnapshot,
  DiffRow,
  DiffResult,
  DiffStatus,
} from '../api/types';

/**
 * Compare two FLS snapshots and produce a detailed diff.
 *
 * @param source - The "left" / baseline snapshot
 * @param target - The "right" / comparison snapshot
 * @returns DiffResult with per-row diffs and summary statistics
 */
export function computeDiff(source: FLSSnapshot, target: FLSSnapshot): DiffResult {
  const sourceMap = buildPermissionMap(source.permissions);
  const targetMap = buildPermissionMap(target.permissions);

  const allNames = new Set([...sourceMap.keys(), ...targetMap.keys()]);
  const rows: DiffRow[] = [];

  for (const name of allNames) {
    const src = sourceMap.get(name) ?? null;
    const tgt = targetMap.get(name) ?? null;

    const status = computeRowStatus(src, tgt);

    rows.push({
      name,
      label: src?.label ?? tgt?.label ?? name,
      type: src?.type ?? tgt?.type ?? 'PermissionSet',
      source: src ? { read: src.permissionsRead, edit: src.permissionsEdit } : null,
      target: tgt ? { read: tgt.permissionsRead, edit: tgt.permissionsEdit } : null,
      status,
      sourceId: src?.id,
      targetId: tgt?.id,
    });
  }

  // Sort: profiles first, then permission sets, then alphabetical
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'Profile' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const summary = {
    total: rows.length,
    matching: rows.filter(r => r.status === 'MATCH').length,
    differing: rows.filter(r =>
      r.status === 'READ_DIFFERS' || r.status === 'EDIT_DIFFERS' || r.status === 'BOTH_DIFFER'
    ).length,
    missingInTarget: rows.filter(r => r.status === 'MISSING_IN_TARGET').length,
    newInTarget: rows.filter(r => r.status === 'NEW_IN_TARGET').length,
  };

  return { rows, summary };
}

/**
 * Compute the diff status for a single row.
 */
function computeRowStatus(
  src: FieldPermissionRecord | null,
  tgt: FieldPermissionRecord | null
): DiffStatus {
  if (src && !tgt) return 'MISSING_IN_TARGET';
  if (!src && tgt) return 'NEW_IN_TARGET';

  // Both non-null guaranteed: allNames only contains names present in at least one map
  const readDiffers = src!.permissionsRead !== tgt!.permissionsRead;
  const editDiffers = src!.permissionsEdit !== tgt!.permissionsEdit;

  if (readDiffers && editDiffers) return 'BOTH_DIFFER';
  if (readDiffers) return 'READ_DIFFERS';
  if (editDiffers) return 'EDIT_DIFFERS';
  return 'MATCH';
}

/**
 * Build a map of permission name → record for fast lookup.
 */
function buildPermissionMap(
  permissions: FieldPermissionRecord[]
): Map<string, FieldPermissionRecord> {
  const map = new Map<string, FieldPermissionRecord>();
  for (const perm of permissions) {
    map.set(perm.name, perm);
  }
  return map;
}

/**
 * Returns true when no profile or permission set grants Read access to the field.
 * Such a field is effectively invisible to all users — a common misconfiguration.
 */
export function isDeadField(permissions: FieldPermissionRecord[]): boolean {
  // An empty array means the field hasn't been fetched yet — don't classify it as dead.
  if (permissions.length === 0) return false;
  return permissions.every(p => !p.permissionsRead);
}

/**
 * Filter diff rows to only show differences.
 */
export function filterDifferencesOnly(result: DiffResult): DiffResult {
  const rows = result.rows.filter(r => r.status !== 'MATCH');
  return {
    rows,
    summary: {
      total: rows.length,
      matching: 0,
      differing: rows.filter(r =>
        r.status === 'READ_DIFFERS' || r.status === 'EDIT_DIFFERS' || r.status === 'BOTH_DIFFER'
      ).length,
      missingInTarget: rows.filter(r => r.status === 'MISSING_IN_TARGET').length,
      newInTarget: rows.filter(r => r.status === 'NEW_IN_TARGET').length,
    },
  };
}
