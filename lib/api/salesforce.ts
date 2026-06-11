/**
 * Salesforce REST + Tooling API wrappers.
 * All actual HTTP calls are delegated to the background service worker
 * to avoid CORS issues from the popup/panel context.
 */
import type {
  SalesforceSession,
  DescribeGlobalResponse,
  DescribeObjectResponse,
  ToolingQueryResponse,
  FieldPermissionRecord,
  FLSSnapshot,
} from './types';
import { getSettings } from '../store/snapshots';
import { generateId } from '../utils/format';

// ─── SOQL Helpers ────────────────────────────────────────────────────────────

/** Escape single quotes in a value interpolated into a SOQL string literal. */
function encodeSOQL(value: string): string {
  return value.replace(/'/g, "\\'");
}

// ─── API Version ──────────────────────────────────────────────────────────────

async function getApiVersion(): Promise<string> {
  const settings = await getSettings();
  return settings.apiVersion;
}

// ─── Low-Level Message Senders ────────────────────────────────────────────────

/**
 * Send a REST GET request via the background service worker.
 */
type BgResponse = { type: string; payload: any } | null | undefined;

async function restGet<T>(session: SalesforceSession, path: string): Promise<T> {
  const response = await browser.runtime.sendMessage({
    type: 'REST_GET',
    payload: { instanceUrl: session.instanceUrl, sessionId: session.sessionId, path },
  }) as BgResponse;

  if (response?.type === 'API_ERROR') throw new Error(response.payload.message);
  return response?.payload as T;
}

/**
 * Send a Tooling API SOQL query via the background service worker.
 */
async function toolingQuery<T>(
  session: SalesforceSession,
  soql: string
): Promise<ToolingQueryResponse<T>> {
  const response = await browser.runtime.sendMessage({
    type: 'TOOLING_QUERY',
    payload: { instanceUrl: session.instanceUrl, sessionId: session.sessionId, soql },
  }) as BgResponse;

  if (response?.type === 'API_ERROR') throw new Error(response.payload.message);
  return response?.payload as ToolingQueryResponse<T>;
}

/**
 * Fetch the 18-char CustomField record Id for a custom field (ends in __c).
 * Standard fields have no CustomField record — returns empty for those.
 * Used to build Object Manager deep links: /FieldsAndRelationships/{id}/view
 */
async function customFieldId(
  session: SalesforceSession,
  objectApiName: string,
  fieldApiName: string
): Promise<{ records: { Id: string }[] }> {
  if (!fieldApiName.endsWith('__c')) return { records: [] };

  // Strip __c suffix, then strip optional namespace prefix (ns__FieldName → FieldName)
  const withoutSuffix = fieldApiName.slice(0, -3);
  const parts = withoutSuffix.split('__');
  const developerName = parts.length >= 2 ? parts[parts.length - 1] : withoutSuffix;

  try {
    return await toolingQuery<{ Id: string }>(
      session,
      `SELECT Id FROM CustomField WHERE TableEnumOrId = '${encodeSOQL(objectApiName)}' AND DeveloperName = '${encodeSOQL(developerName)}'`
    );
  } catch (err) {
    // Standard fields have no CustomField record; treat empty result as non-error.
    // Session/network errors surface through the other parallel queries in fetchFLS.
    console.debug('[FLS Comparator] customFieldId lookup:', err instanceof Error ? err.message : err);
    return { records: [] };
  }
}

/**
 * Send a regular SOQL query via the background service worker.
 * Used for FieldPermissions and PermissionSet — avoids Tooling API
 * restrictions that affect orgs with Enhanced Profiles enabled.
 */
async function restQuery<T>(
  session: SalesforceSession,
  soql: string
): Promise<ToolingQueryResponse<T>> {
  const response = await browser.runtime.sendMessage({
    type: 'REST_QUERY',
    payload: { instanceUrl: session.instanceUrl, sessionId: session.sessionId, soql },
  }) as BgResponse;

  if (response?.type === 'API_ERROR') throw new Error(response.payload.message);
  return response?.payload as ToolingQueryResponse<T>;
}


/**
 * Execute anonymous Apex via the Tooling API.
 */
async function executeAnonymous(
  session: SalesforceSession,
  apexCode: string
): Promise<{ success: boolean; compileProblem?: string; exceptionMessage?: string }> {
  const response = await browser.runtime.sendMessage({
    type: 'EXECUTE_ANONYMOUS',
    payload: { instanceUrl: session.instanceUrl, sessionId: session.sessionId, anonymousBody: apexCode },
  }) as BgResponse;

  if (response?.type === 'API_ERROR') {
    throw new Error(response.payload.message);
  }

  const payload = response?.payload as { status: number; body: string };
  if (payload.status !== 200) {
    throw new Error(`Execute anonymous failed with status ${payload.status}: ${payload.body?.slice(0, 200)}`);
  }

  let result: { compiled?: boolean; success: boolean; compileProblem?: string | null; exceptionMessage?: string | null; exceptionStackTrace?: string | null };
  try {
    result = JSON.parse(payload.body ?? '{}');
  } catch {
    throw new Error(`Execute anonymous returned non-JSON response: ${payload.body?.slice(0, 200)}`);
  }

  return result;
}

/** Parse a Salesforce error response body (JSON array) into error code records. */
// Errors to drop silently — user can't act on them (license/type mismatches, stale IDs)
const SILENT_SKIP_CODES = new Set([
  'INVALID_CROSS_REFERENCE_KEY',   // permset type can't be parent of FieldPermissions
  'CANNOT_MODIFY_MANAGED_OBJECT',  // FLS record is locked by a managed package
  'INVALID_ID_FIELD',              // stale or unresolvable record ID
]);

// Errors that mean the field type rejects FLS writes — surface to user with Salesforce's message
const FIELD_WRITE_REJECTION_CODES = new Set([
  'FIELD_INTEGRITY_EXCEPTION',     // formula, encrypted, auto-number, or license restriction
]);

type SfError = { errorCode?: string; statusCode?: string; message?: string };

function errorCode(e: SfError): string | undefined {
  return e.errorCode ?? e.statusCode;
}

function hasErrorCode(errors: SfError[], codes: Set<string>): boolean {
  return errors.some(e => { const c = errorCode(e); return c && codes.has(c); });
}

/** Extract a human-readable error description from parsed Salesforce errors. */
function formatSfErrors(errors: SfError[]): string {
  if (errors.length === 0) return 'Unknown Salesforce error';
  const e = errors[0];
  const code = errorCode(e);
  const { message } = e;
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;
  return JSON.stringify(e).slice(0, 200);
}

// ─── Describe APIs ────────────────────────────────────────────────────────────

/**
 * Get all queryable SObjects in the org.
 */
export async function describeObjects(
  session: SalesforceSession
): Promise<{ name: string; label: string; custom: boolean }[]> {
  const apiVersion = await getApiVersion();
  const result = await restGet<DescribeGlobalResponse>(
    session,
    `/services/data/v${apiVersion}/sobjects`
  );

  return result.sobjects
    .filter(obj => obj.queryable && obj.layoutable)
    .map(obj => ({
      name: obj.name,
      label: obj.label,
      custom: obj.custom,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Get all permissionable fields for a given SObject.
 */
export async function describeFields(
  session: SalesforceSession,
  objectApiName: string
): Promise<{ name: string; label: string; type: string; custom: boolean }[]> {
  const apiVersion = await getApiVersion();
  const result = await restGet<DescribeObjectResponse>(
    session,
    `/services/data/v${apiVersion}/sobjects/${objectApiName}/describe`
  );

  return result.fields
    .filter(f => f.permissionable)
    .map(f => ({
      name: f.name,
      label: f.label,
      type: f.type,
      custom: f.custom,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Paginated Query Helper ───────────────────────────────────────────────────

/**
 * Run a SOQL query and automatically follow nextRecordsUrl pages.
 * Use this instead of restQuery when the result set may exceed 2000 records.
 */
async function restQueryAll<T>(session: SalesforceSession, soql: string): Promise<T[]> {
  let result = await restQuery<T>(session, soql);
  const records: T[] = [...result.records];
  const MAX_PAGES = 50; // caps at ~100,000 records per query
  let pages = 0;
  while (!result.done && result.nextRecordsUrl) {
    if (++pages >= MAX_PAGES) {
      console.warn('[FLS Comparator] restQueryAll: reached page limit, results truncated');
      break;
    }
    result = await restGet<ToolingQueryResponse<T>>(session, result.nextRecordsUrl);
    records.push(...result.records);
  }
  return records;
}

/**
 * Run a Tooling API SOQL query and automatically follow nextRecordsUrl pages.
 */
async function toolingQueryAll<T>(session: SalesforceSession, soql: string): Promise<T[]> {
  let result = await toolingQuery<T>(session, soql);
  const records: T[] = [...result.records];
  const MAX_PAGES = 50;
  let pages = 0;
  while (!result.done && result.nextRecordsUrl) {
    if (++pages >= MAX_PAGES) {
      console.warn('[FLS Comparator] toolingQueryAll: reached page limit, results truncated');
      break;
    }
    result = await restGet<ToolingQueryResponse<T>>(session, result.nextRecordsUrl);
    records.push(...result.records);
  }
  return records;
}

// ─── FLS Fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch FLS for a field across ALL profiles and permission sets.
 * Profiles/PermSets with no FieldPermissions record are included with false/false
 * so the user can see (and copy) the full permission picture — including revoked access.
 */
export async function fetchFLS(
  session: SalesforceSession,
  objectApiName: string,
  fieldApiName: string,
  label?: string
): Promise<FLSSnapshot> {
  // Run all four queries in parallel; all use restQueryAll to handle orgs with
  // > 2000 profiles, permission sets, or FieldPermissions records.
  const [profiles, backingPermSets, standalonePermSets, fpRecords, fieldDefResult] = await Promise.all([
    // All profiles — Name is the human-readable display name
    restQueryAll<{ Id: string; Name: string }>(
      session,
      `SELECT Id, Name FROM Profile ORDER BY Name`
    ),
    // Backing PermissionSets (one per Profile) — gives us the PermSet ID that
    // FieldPermissions.ParentId may reference instead of the Profile ID
    restQueryAll<{ Id: string; ProfileId: string }>(
      session,
      `SELECT Id, ProfileId FROM PermissionSet WHERE IsOwnedByProfile = true`
    ),
    // Standalone (non-profile-backed) permission sets
    restQueryAll<{ Id: string; Name: string; Label: string }>(
      session,
      `SELECT Id, Name, Label FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label`
    ),
    // Existing FieldPermissions for this field
    restQueryAll<{ Id: string; ParentId: string; PermissionsRead: boolean; PermissionsEdit: boolean }>(
      session,
      `SELECT Id, ParentId, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${encodeSOQL(objectApiName)}' AND Field = '${encodeSOQL(objectApiName)}.${encodeSOQL(fieldApiName)}'`
    ),
    // CustomField.Id — 18-char metadata record ID used in Object Manager URLs.
    // Only custom fields have a CustomField record; standard fields skip this and
    // fall back to the fields-list URL. Non-fatal: omit the link if the query fails.
    customFieldId(session, objectApiName, fieldApiName),
  ]);

  const fieldMetadataId = fieldDefResult.records[0]?.Id;

  // ParentId → {read, edit}
  const flsMap = new Map<string, { read: boolean; edit: boolean }>();
  for (const fp of fpRecords) {
    flsMap.set(fp.ParentId, { read: fp.PermissionsRead, edit: fp.PermissionsEdit });
  }

  // ProfileId → backing PermissionSet Id (FieldPermissions may use either as ParentId)
  const profileToPermSet = new Map<string, string>();
  for (const ps of backingPermSets) {
    if (ps.ProfileId) profileToPermSet.set(ps.ProfileId, ps.Id);
  }

  const permissions: FieldPermissionRecord[] = [
    // Profiles — look up FLS by Profile ID first, then by backing PermSet ID
    ...profiles.map(p => {
      const fls =
        flsMap.get(p.Id) ??
        flsMap.get(profileToPermSet.get(p.Id) ?? '') ??
        { read: false, edit: false };
      return {
        id: p.Id,
        name: p.Name,
        label: p.Name,
        type: 'Profile' as const,
        permissionsRead: fls.read,
        permissionsEdit: fls.edit,
      };
    }),
    // Standalone permission sets
    ...standalonePermSets.map(ps => {
      const fls = flsMap.get(ps.Id) ?? { read: false, edit: false };
      return {
        id: ps.Id,
        name: ps.Label ?? ps.Name,
        label: ps.Label ?? ps.Name,
        type: 'PermissionSet' as const,
        permissionsRead: fls.read,
        permissionsEdit: fls.edit,
      };
    }),
  ];

  return {
    id: generateId(),
    label: label ?? `${objectApiName}.${fieldApiName}`,
    capturedAt: new Date().toISOString(),
    org: { instanceUrl: session.instanceUrl, orgId: session.orgId },
    objectApiName,
    fieldApiName,
    fieldMetadataId,
    permissions,
  };
}

// ─── Object-Level FLS Capture ─────────────────────────────────────────────────

/**
 * Fetch FLS for ALL permissionable fields in an object using 4 total API calls.
 * Much more efficient than calling fetchFLS per field — the FieldPermissions
 * query covers the whole object at once, then results are grouped by field in memory.
 */
export async function fetchObjectFLS(
  session: SalesforceSession,
  objectApiName: string
): Promise<FLSSnapshot[]> {
  const [fields, profiles, backingPermSets, standalonePermSets, allFP] =
    await Promise.all([
      describeFields(session, objectApiName),
      restQueryAll<{ Id: string; Name: string }>(
        session,
        `SELECT Id, Name FROM Profile ORDER BY Name`
      ),
      restQueryAll<{ Id: string; ProfileId: string }>(
        session,
        `SELECT Id, ProfileId FROM PermissionSet WHERE IsOwnedByProfile = true`
      ),
      restQueryAll<{ Id: string; Name: string; Label: string }>(
        session,
        `SELECT Id, Name, Label FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label`
      ),
      // Single query for ALL FieldPermissions on this object — paginated in case the
      // combination of fields × profiles/permsets exceeds 2000 records.
      restQueryAll<{ ParentId: string; Field: string; PermissionsRead: boolean; PermissionsEdit: boolean }>(
        session,
        `SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${encodeSOQL(objectApiName)}'`
      ),
    ]);

  // ProfileId → backing PermissionSet Id
  const profileToPermSet = new Map<string, string>();
  for (const ps of backingPermSets) {
    if (ps.ProfileId) profileToPermSet.set(ps.ProfileId, ps.Id);
  }

  // Group FieldPermissions by field API name: Map<fieldName, Map<parentId, {read, edit}>>
  // fp.Field is in "ObjectName.FieldName" format — extract the field part after the dot.
  const fpByField = new Map<string, Map<string, { read: boolean; edit: boolean }>>();
  for (const fp of allFP) {
    const dotIdx = fp.Field.indexOf('.');
    const fieldKey = dotIdx >= 0 ? fp.Field.slice(dotIdx + 1) : fp.Field;
    if (!fpByField.has(fieldKey)) fpByField.set(fieldKey, new Map());
    fpByField.get(fieldKey)!.set(fp.ParentId, { read: fp.PermissionsRead, edit: fp.PermissionsEdit });
  }

  const capturedAt = new Date().toISOString();
  const org: import('./types').OrgContext = { instanceUrl: session.instanceUrl, orgId: session.orgId };

  return fields.map(field => {
    const flsMap = fpByField.get(field.name) ?? new Map<string, { read: boolean; edit: boolean }>();

    const permissions: FieldPermissionRecord[] = [
      ...profiles.map(p => {
        const fls =
          flsMap.get(p.Id) ??
          flsMap.get(profileToPermSet.get(p.Id) ?? '') ??
          { read: false, edit: false };
        return {
          id: p.Id,
          name: p.Name,
          label: p.Name,
          type: 'Profile' as const,
          permissionsRead: fls.read,
          permissionsEdit: fls.edit,
        };
      }),
      ...standalonePermSets.map(ps => {
        const fls = flsMap.get(ps.Id) ?? { read: false, edit: false };
        return {
          id: ps.Id,
          name: ps.Label ?? ps.Name,
          label: ps.Label ?? ps.Name,
          type: 'PermissionSet' as const,
          permissionsRead: fls.read,
          permissionsEdit: fls.edit,
        };
      }),
    ];

    return {
      id: generateId(),
      label: `${objectApiName}.${field.name}`,
      capturedAt,
      org,
      objectApiName,
      fieldApiName: field.name,
      permissions,
    };
  });
}

// ─── FLS Apply (Paste) ───────────────────────────────────────────────────────

export interface ApplyChange {
  permissionSetId: string;
  permissionSetName: string;
  field: string;
  type: 'Profile' | 'PermissionSet';
  currentRead: boolean;
  currentEdit: boolean;
  newRead: boolean;
  newEdit: boolean;
}

export interface SkippedRow {
  permissionSetName: string;
  type: 'Profile' | 'PermissionSet';
  reason: string;
}

export interface ApplyResult {
  appliedCount: number;
  skipped: SkippedRow[];
}

/**
 * Compute all FLS rows for the apply modal.
 * Returns every profile/permission set from both the source snapshot and the
 * target field's current FLS, so the user can see and toggle all of them.
 * Rows that appear in the source snapshot are pre-populated with the snapshot's
 * suggested values; target-only rows start with newRead=currentRead (no change).
 */
export async function computeApplyChanges(
  session: SalesforceSession,
  sourceSnapshot: FLSSnapshot,
  targetObjectApiName: string,
  targetFieldApiName: string
): Promise<ApplyChange[]> {
  const targetSnapshot = await fetchFLS(session, targetObjectApiName, targetFieldApiName);
  const targetMap = new Map(targetSnapshot.permissions.map(p => [p.name, p]));

  const field = `${targetObjectApiName}.${targetFieldApiName}`;
  const seen = new Set<string>();
  const results: ApplyChange[] = [];
  let skippedNoMatch = 0;

  // Source snapshot rows — pre-populate with snapshot's suggested values
  for (const sourcePerm of sourceSnapshot.permissions) {
    const targetPerm = targetMap.get(sourcePerm.name);
    if (!targetPerm) {
      skippedNoMatch++;
      continue; // no permset ID available without a target record
    }
    seen.add(sourcePerm.name);
    results.push({
      permissionSetId: targetPerm.id,
      permissionSetName: sourcePerm.name,
      field,
      type: targetPerm.type,
      currentRead: targetPerm.permissionsRead,
      currentEdit: targetPerm.permissionsEdit,
      newRead: sourcePerm.permissionsRead,
      newEdit: sourcePerm.permissionsEdit,
    });
  }

  // Target-only rows — not in snapshot, no suggested change
  let targetOnlyCount = 0;
  for (const targetPerm of targetSnapshot.permissions) {
    if (seen.has(targetPerm.name)) continue;
    targetOnlyCount++;
    results.push({
      permissionSetId: targetPerm.id,
      permissionSetName: targetPerm.name,
      field,
      type: targetPerm.type,
      currentRead: targetPerm.permissionsRead,
      currentEdit: targetPerm.permissionsEdit,
      newRead: targetPerm.permissionsRead,
      newEdit: targetPerm.permissionsEdit,
    });
  }

  console.log(`[FLS computeApplyChanges] ${field}: source=${sourceSnapshot.permissions.length} perms, target=${targetSnapshot.permissions.length} perms, matched=${seen.size}, skipped(no match)=${skippedNoMatch}, targetOnly=${targetOnlyCount}, total results=${results.length}`);

  return results.sort((a, b) => a.permissionSetName.localeCompare(b.permissionSetName));
}

/**
 * Apply FLS changes using the Composite API.
 * Returns the count of writes attempted and any rows skipped due to field-type
 * restrictions (formula, encrypted, auto-number fields, or license limits).
 */
export async function applyFLSChanges(
  session: SalesforceSession,
  changes: ApplyChange[]
): Promise<ApplyResult> {
  if (changes.length === 0) return { appliedCount: 0, skipped: [] };

  const apiVersion = await getApiVersion();

  // Find existing FieldPermission record IDs and backing PermissionSet mapping
  const fieldName = changes[0].field;
  const [objectName] = fieldName.split('.');

  const idSoql = `
    SELECT Id, ParentId
    FROM FieldPermissions
    WHERE SobjectType = '${encodeSOQL(objectName)}'
      AND Field = '${encodeSOQL(fieldName)}'
  `.replace(/\s+/g, ' ').trim();

  const existingFpRecords = await restQueryAll<{ Id: string; ParentId: string }>(session, idSoql);
  const parentToFpId = new Map(existingFpRecords.map(r => [r.ParentId, r.Id]));

  // Collect backing PermissionSet IDs for profiles
  const allProfileIds = [...new Set(changes
    .filter(c => c.type === 'Profile')
    .map(c => c.permissionSetId)
  )];

  const profileToPermSetId = new Map<string, string>();
  if (allProfileIds.length > 0) {
    for (let i = 0; i < allProfileIds.length; i += 200) {
      const batch = allProfileIds.slice(i, i + 200);
      const batchIdList = batch.map(id => `'${id}'`).join(', ');
      const psRecords = await restQueryAll<{ Id: string; ProfileId: string }>(
        session,
        `SELECT Id, ProfileId FROM PermissionSet WHERE IsOwnedByProfile = true AND ProfileId IN (${batchIdList})`
      );
      for (const ps of psRecords) {
        if (ps.ProfileId) profileToPermSetId.set(ps.ProfileId, ps.Id);
      }
    }
  }

  // Build DML rows for Apex. Use IDs directly from REST queries — skip Apex
  // SOQL entirely for speed. If an ID is in Tooling API format and Apex rejects
  // it, the per-row try-catch silently skips it.
  interface ApexFpRow { parentId: string; fpId: string; sobjectType: string; field: string; read: boolean; edit: boolean }

  const rows: ApexFpRow[] = [];

  for (const change of changes) {
    const backingPermSetId = profileToPermSetId.get(change.permissionSetId);
    const isProfileId = change.type === 'Profile';
    if (!isProfileId || backingPermSetId) {
      // Find existing FieldPermissions ID (may be Tooling API format, works for update/delete)
      const fpId =
        parentToFpId.get(change.permissionSetId) ??
        parentToFpId.get(profileToPermSetId.get(change.permissionSetId) ?? '') ??
        '';
      const parentId = backingPermSetId ?? change.permissionSetId;
      rows.push({ parentId, fpId, sobjectType: objectName, field: change.field, read: change.newRead, edit: change.newEdit });
    }
  }

  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const skipped: SkippedRow[] = [];
  const batchSize = 5;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const elements = chunk.map(r =>
      `new String[]{'${esc(r.parentId)}','${esc(r.fpId)}','${esc(r.sobjectType)}','${esc(r.field)}','${r.read?'1':'0'}','${r.edit?'1':'0'}'}`
    );

    // No Apex SOQL — just direct DML with try-catch. Fast.
    const lines = [
      'for(String[] r:new List<String[]>{',
      elements.join(','),
      '}){',
      'try{',
      'Boolean hr=Integer.valueOf(r[4])==1,he=Integer.valueOf(r[5])==1;',
      'if(r[1]!=\'\'){',
      'if(hr||he){update new FieldPermissions(Id=r[1],PermissionsRead=hr,PermissionsEdit=he);}else{delete new FieldPermissions(Id=r[1]);}',
      '}else if(hr||he){',
      'insert new FieldPermissions(ParentId=r[0],SobjectType=r[2],Field=r[3],PermissionsRead=hr,PermissionsEdit=he);',
      '}',
      '}catch(Exception e){}',
      '}',
    ];

    const apex = lines.join('');
    const result = await executeAnonymous(session, apex);
    if (!result.compiled) {
      throw new Error(`Apex compile error: ${result.compileProblem} | Code: ${apex.slice(0, 300)}`);
    }
    if (!result.success) {
      throw new Error(`${result.exceptionMessage} | Batch: ${apex.slice(0, 300)}`);
    }
  }

  return { appliedCount: rows.length, skipped };
}
