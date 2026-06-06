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
  CompositeSubrequest,
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
  } catch {
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


type CompositeResponseItem = { httpStatusCode: number; referenceId: string; body: unknown };

/**
 * Send a composite API request via the background service worker.
 * Returns the array of failed subrequest responses (httpStatusCode >= 400).
 * The caller decides which failures are fatal vs. ignorable.
 */
async function compositeRequest(
  session: SalesforceSession,
  compositeRequests: CompositeSubrequest[]
): Promise<CompositeResponseItem[]> {
  const response = await browser.runtime.sendMessage({
    type: 'COMPOSITE_REQUEST',
    payload: { instanceUrl: session.instanceUrl, sessionId: session.sessionId, compositeRequest: compositeRequests },
  }) as BgResponse;

  if (response?.type === 'API_ERROR') throw new Error(response.payload.message);

  const data = response?.payload as { compositeResponse?: CompositeResponseItem[] };
  return (data?.compositeResponse ?? []).filter(r => r.httpStatusCode >= 400);
}

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

function isSkippableError(failure: CompositeResponseItem): boolean {
  const body = failure.body;
  if (!Array.isArray(body)) return false;
  return (body as Array<{ errorCode?: string }>).some(e => e.errorCode && SILENT_SKIP_CODES.has(e.errorCode));
}

function isFieldWriteRejection(failure: CompositeResponseItem): boolean {
  const body = failure.body;
  if (!Array.isArray(body)) return false;
  return (body as Array<{ errorCode?: string }>).some(e => e.errorCode && FIELD_WRITE_REJECTION_CODES.has(e.errorCode));
}

/** Extract a human-readable error description from a Salesforce error body array. */
function extractSalesforceMessage(body: unknown): string {
  if (Array.isArray(body)) {
    const errs = body as Array<{ message?: string; errorCode?: string }>;
    if (errs.length > 0) {
      const { errorCode, message } = errs[0];
      if (errorCode && message) return `${errorCode}: ${message}`;
      if (message) return message;
      if (errorCode) return errorCode;
    }
  }
  return JSON.stringify(body).slice(0, 200);
}

function isDuplicateValue(failure: CompositeResponseItem): boolean {
  const body = failure.body;
  if (!Array.isArray(body)) return false;
  return (body as Array<{ errorCode?: string }>).some(e => e.errorCode === 'DUPLICATE_VALUE');
}

// The DUPLICATE_VALUE message embeds the existing record ID:
// "Duplicate row exists in FieldPermissions: [..., Id:01kTH00000kpn4DYAQ]"
function extractDuplicateId(body: unknown): string | null {
  if (!Array.isArray(body)) return null;
  const msg = (body as Array<{ message?: string }>).find(e => e.message)?.message ?? '';
  return msg.match(/\bId:([A-Za-z0-9]{15,18})\b/)?.[1] ?? null;
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
  while (!result.done && result.nextRecordsUrl) {
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

  // Source snapshot rows — pre-populate with snapshot's suggested values
  for (const sourcePerm of sourceSnapshot.permissions) {
    const targetPerm = targetMap.get(sourcePerm.name);
    if (!targetPerm) continue; // no permset ID available without a target record
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
  for (const targetPerm of targetSnapshot.permissions) {
    if (seen.has(targetPerm.name)) continue;
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

  return results.sort((a, b) => a.permissionSetName.localeCompare(b.permissionSetName));
}

/** Parse the change index encoded in a composite referenceId (e.g. "update_3" → 3). */
function parseChangeIndex(referenceId: string): number {
  return parseInt(referenceId.split('_').pop() ?? '', 10);
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

  // Build composite subrequests
  // We need to find existing FieldPermission record IDs first
  const fieldName = changes[0].field;
  const [objectName] = fieldName.split('.');

  const idSoql = `
    SELECT Id, ParentId
    FROM FieldPermissions
    WHERE SobjectType = '${encodeSOQL(objectName)}'
      AND Field = '${encodeSOQL(fieldName)}'
  `.replace(/\s+/g, ' ').trim();

  const existingFpRecords = await restQueryAll<{ Id: string; ParentId: string }>(session, idSoql);

  // Build two maps: one by ParentId directly, one by backing PermSet→Profile mapping
  // (FieldPermissions.ParentId can be either a Profile ID or a backing PermissionSet ID
  // depending on org configuration, so we index by both)
  const parentToFpId = new Map(existingFpRecords.map(r => [r.ParentId, r.Id]));

  // Collect ALL profile IDs we'll need: from existing records AND from the changes list.
  // This is critical for CREATE operations — if no FieldPermissions record exists yet,
  // the existing records won't contain the profile, but we still need the backing PermSet ID.
  const profileIdsFromExisting = existingFpRecords
    .filter(r => r.ParentId.toLowerCase().startsWith('00e'))
    .map(r => r.ParentId);
  const profileIdsFromChanges = changes
    .map(c => c.permissionSetId)
    .filter(id => id.toLowerCase().startsWith('00e'));
  const allProfileIds = [...new Set([...profileIdsFromExisting, ...profileIdsFromChanges])];

  const profileToPermSetId = new Map<string, string>();
  if (allProfileIds.length > 0) {
    // Batch in groups of 200 to stay under SOQL limits
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

  const subrequests: CompositeSubrequest[] = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    const fpId =
      parentToFpId.get(change.permissionSetId) ??
      parentToFpId.get(profileToPermSetId.get(change.permissionSetId) ?? '');

    const backingPermSetId = profileToPermSetId.get(change.permissionSetId);
    const isProfileId = change.type === 'Profile';
    const parentId = backingPermSetId ?? change.permissionSetId;

    if (fpId) {
      subrequests.push({
        method: 'PATCH' as const,
        url: `/services/data/v${apiVersion}/sobjects/FieldPermissions/${fpId}`,
        referenceId: `update_${index}`,
        body: {
          PermissionsRead: change.newRead,
          PermissionsEdit: change.newEdit,
        },
      });
    } else if (!isProfileId || backingPermSetId) {
      // Only POST if we have a valid ParentId — skip profiles whose backing PermSet wasn't found,
      // since FieldPermissions.ParentId must always be a PermissionSet ID, never a Profile ID.
      subrequests.push({
        method: 'POST' as const,
        url: `/services/data/v${apiVersion}/sobjects/FieldPermissions`,
        referenceId: `create_${index}`,
        body: {
          ParentId: parentId,
          SobjectType: objectName,
          Field: change.field,
          PermissionsRead: change.newRead,
          PermissionsEdit: change.newEdit,
        },
      });
    }
  }

  // Composite API max 25 subrequests per call
  const skipped: SkippedRow[] = [];
  const batchSize = 25;
  for (let i = 0; i < subrequests.length; i += batchSize) {
    const batch = subrequests.slice(i, i + batchSize);
    const failures = await compositeRequest(session, batch);

    // DUPLICATE_VALUE means a POST collided with an existing record whose ID the
    // pre-flight query missed (e.g. ParentId key mismatch across Profile/PermSet).
    // Extract the ID from the error message and retry as PATCH.
    const duplicates = failures.filter(isDuplicateValue);
    if (duplicates.length > 0) {
      const retries: CompositeSubrequest[] = [];
      for (const dup of duplicates) {
        const existingId = extractDuplicateId(dup.body);
        if (!existingId) continue;
        const original = batch.find(r => r.referenceId === dup.referenceId);
        if (!original || original.method !== 'POST') continue;
        retries.push({
          method: 'PATCH',
          url: `/services/data/v${apiVersion}/sobjects/FieldPermissions/${existingId}`,
          referenceId: `retry_${dup.referenceId}`,
          body: original.body,
        });
      }
      if (retries.length > 0) {
        const retryFailures = await compositeRequest(session, retries);
        const hardRetryFailures = retryFailures.filter(f => !isSkippableError(f) && !isFieldWriteRejection(f));
        if (hardRetryFailures.length > 0) {
          throw new Error(`Failed to write FieldPermissions: ${extractSalesforceMessage(hardRetryFailures[0].body)}`);
        }
      }
    }

    // Collect FIELD_INTEGRITY_EXCEPTION rows — field type doesn't support FLS writes.
    // These are surfaced to the user as warnings rather than silently dropped.
    for (const rej of failures.filter(isFieldWriteRejection)) {
      const idx = parseChangeIndex(rej.referenceId);
      const change = changes[idx];
      if (change) {
        skipped.push({
          permissionSetName: change.permissionSetName,
          type: change.type,
          reason: extractSalesforceMessage(rej.body),
        });
      }
    }

    const hardFailures = failures.filter(f => !isSkippableError(f) && !isFieldWriteRejection(f) && !isDuplicateValue(f));
    if (hardFailures.length > 0) {
      throw new Error(`Failed to write FieldPermissions: ${extractSalesforceMessage(hardFailures[0].body)}`);
    }
  }

  return { appliedCount: subrequests.length - skipped.length, skipped };
}
