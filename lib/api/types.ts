/**
 * Core data types for Salesforce Field Level Security (FLS) operations.
 */

// ─── FLS Snapshot ─────────────────────────────────────────────────────────────

/** A single field's FLS across all profiles/permission sets */
export interface FLSSnapshot {
  /** Unique identifier (UUID v4) */
  id: string;
  /** User-assigned label, e.g. "Contact.Email - Prod" */
  label: string;
  /** ISO 8601 timestamp of when this snapshot was captured */
  capturedAt: string;
  /** The org this snapshot was taken from */
  org: OrgContext;
  /** Salesforce object API name, e.g. "Contact" */
  objectApiName: string;
  /** Salesforce field API name, e.g. "Email" */
  fieldApiName: string;
  /** FLS permissions for each profile/permission set */
  permissions: FieldPermissionRecord[];
  /** Salesforce FieldDefinition.DurableId — used to build Setup deep links */
  fieldMetadataId?: string;
}

// ─── Org Context ──────────────────────────────────────────────────────────────

export interface OrgContext {
  /** Salesforce instance URL, e.g. "https://myorg.lightning.force.com" */
  instanceUrl: string;
  /** 18-character Salesforce org ID */
  orgId: string;
  /** User-assigned org label for display clarity */
  orgLabel?: string;
}

// ─── Field Permission Record ──────────────────────────────────────────────────

export interface FieldPermissionRecord {
  /** Salesforce record ID for the PermissionSet/Profile */
  id: string;
  /** API name of the permission set or profile */
  name: string;
  /** Display label */
  label: string;
  /** Whether this is a Profile or PermissionSet */
  type: 'Profile' | 'PermissionSet';
  /** Whether Read access is granted */
  permissionsRead: boolean;
  /** Whether Edit access is granted */
  permissionsEdit: boolean;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SalesforceSession {
  /** Instance URL for API calls */
  instanceUrl: string;
  /** Session ID (Bearer token) */
  sessionId: string;
  /** Org ID */
  orgId: string;
}

// ─── Salesforce API Response Shapes ───────────────────────────────────────────

/** Response from /services/data/vXX.0/sobjects */
export interface DescribeGlobalResponse {
  sobjects: SObjectDescribe[];
}

export interface SObjectDescribe {
  name: string;
  label: string;
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  layoutable: boolean;
}

/** Response from /services/data/vXX.0/sobjects/{Object}/describe */
export interface DescribeObjectResponse {
  name: string;
  label: string;
  fields: FieldDescribe[];
}

export interface FieldDescribe {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  permissionable: boolean;
}

/** Response from Tooling API query for FieldPermissions */
export interface ToolingQueryResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface FieldPermissionToolingRecord {
  Id: string;
  Field: string;
  SobjectType: string;
  ParentId: string;
  Parent?: {
    Name: string;
    Label: string;
    IsOwnedByProfile: boolean;
    Profile?: { Name: string } | null;
  };
  PermissionsRead: boolean;
  PermissionsEdit: boolean;
}

export interface PermissionSetToolingRecord {
  Id: string;
  Name: string;
  Label: string;
  IsCustom: boolean;
  IsOwnedByProfile: boolean;
}

// ─── Diff Types ───────────────────────────────────────────────────────────────

export type DiffStatus =
  | 'MATCH'
  | 'READ_DIFFERS'
  | 'EDIT_DIFFERS'
  | 'BOTH_DIFFER'
  | 'MISSING_IN_TARGET'
  | 'NEW_IN_TARGET';

export interface DiffRow {
  /** The permission name used for matching */
  name: string;
  /** Display label */
  label: string;
  /** Profile or PermissionSet */
  type: 'Profile' | 'PermissionSet';
  /** Source (left) permission values — null if NEW_IN_TARGET */
  source: { read: boolean; edit: boolean } | null;
  /** Target (right) permission values — null if MISSING_IN_TARGET */
  target: { read: boolean; edit: boolean } | null;
  /** Computed diff status */
  status: DiffStatus;
  /** Salesforce record ID from the source snapshot (for setup deep link) */
  sourceId?: string;
  /** Salesforce record ID from the target snapshot (for setup deep link) */
  targetId?: string;
}

export interface DiffResult {
  rows: DiffRow[];
  summary: {
    total: number;
    matching: number;
    differing: number;
    missingInTarget: number;
    newInTarget: number;
  };
}

// ─── Message Types (extension messaging) ──────────────────────────────────────

export type ExtensionMessage =
  | { type: 'GET_SESSION' }
  | { type: 'SESSION_RESPONSE'; payload: SalesforceSession | null }
  | { type: 'TOOLING_QUERY'; payload: { instanceUrl: string; sessionId: string; soql: string } }
  | { type: 'REST_GET'; payload: { instanceUrl: string; sessionId: string; path: string } }
  | { type: 'COMPOSITE_REQUEST'; payload: { instanceUrl: string; sessionId: string; compositeRequest: CompositeSubrequest[] } }
  | { type: 'API_RESPONSE'; payload: unknown }
  | { type: 'API_ERROR'; payload: { message: string; statusCode?: number } };

export interface CompositeSubrequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  referenceId: string;
  body?: unknown;
}

// ─── Apply History ────────────────────────────────────────────────────────────

/** One permission set / profile row captured before and after an apply */
export interface ApplyHistoryChange {
  permissionSetId: string;
  permissionSetName: string;
  type: 'Profile' | 'PermissionSet';
  wasRead: boolean;
  wasEdit: boolean;
  nowRead: boolean;
  nowEdit: boolean;
}

/** A single apply operation recorded to the audit log */
export interface ApplyHistoryEntry {
  id: string;
  appliedAt: string;
  /** Label of the snapshot used as the source */
  sourceLabel: string;
  sourceObjectApiName: string;
  sourceFieldApiName: string;
  targetObjectApiName: string;
  targetFieldApiName: string;
  org: OrgContext;
  changes: ApplyHistoryChange[];
  /** True once this entry has been rolled back */
  rolledBack?: boolean;
  /** ID of the history entry that reversed this one */
  rollbackEntryId?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ExtensionSettings {
  /** Salesforce API version, e.g. "61.0" */
  apiVersion: string;
  /** Maximum number of snapshots to store */
  maxSnapshots: number;
  /** Default org label template */
  defaultOrgLabel: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiVersion: '61.0',
  maxSnapshots: 50,
  defaultOrgLabel: '',
};
