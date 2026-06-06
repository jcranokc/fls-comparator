/**
 * Formatting helpers for display labels, timestamps, and strings.
 */

/**
 * Format an object + field name as a human-readable label.
 * e.g., "Contact.Email" or "Account.Custom_Field__c"
 */
export function formatFieldLabel(objectApiName: string, fieldApiName: string): string {
  return `${objectApiName}.${fieldApiName}`;
}

/**
 * Format an ISO timestamp as a relative or absolute time string.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Format an ISO timestamp as a full date-time string for tooltips.
 */
export function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Safely truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Format a Salesforce org instance URL to a short display name.
 * e.g., "https://myorg.lightning.force.com" → "myorg"
 */
export function formatOrgUrl(instanceUrl: string): string {
  try {
    const url = new URL(instanceUrl);
    const hostname = url.hostname;
    // Extract the subdomain before .lightning.force.com or .salesforce.com
    const parts = hostname.split('.');
    return parts[0] || hostname;
  } catch {
    return instanceUrl;
  }
}

/**
 * Convert an API instance URL (salesforce.com) to the Setup UI domain
 * (salesforce-setup.com). Setup pages live on a separate domain from the API,
 * and using the API domain causes "Insufficient Privileges" errors in the Setup UI.
 */
function toSetupDomain(instanceUrl: string): string {
  return instanceUrl.replace(/\.salesforce\.com/, '.salesforce-setup.com');
}

/**
 * Build a Salesforce Lightning Setup deep link for a Permission Set or Profile.
 * Opens the record directly in the Setup UI.
 */
export function buildSetupUrl(
  instanceUrl: string,
  id: string,
  type: 'Profile' | 'PermissionSet'
): string {
  const area = type === 'Profile' ? 'Profiles' : 'PermSets';
  return `${toSetupDomain(instanceUrl)}/lightning/setup/${area}/page?address=%2F${id}`;
}

/**
 * Build a deep link to the "Set Field-Level Security" page for a specific field.
 * Uses the classic StandardFieldAttributes endpoint wrapped in Lightning —
 * the same URL Salesforce itself generates when you click "Set Field-Level Security".
 * Falls back to the object's fields list when the CustomField.Id is unavailable
 * (e.g. for standard fields that have no CustomField record).
 */
export function buildFieldSetupUrl(instanceUrl: string, objectApiName: string, fieldMetadataId?: string): string {
  const base = toSetupDomain(instanceUrl);
  if (fieldMetadataId) {
    // StandardFieldAttributes is a classic page that only accepts 15-char IDs.
    // SOQL returns 18-char IDs (with a 3-char checksum suffix) — truncate to 15.
    const id15 = fieldMetadataId.slice(0, 15);
    const address = encodeURIComponent(
      `/_ui/common/config/field/StandardFieldAttributes/e?id=${id15}&type=${objectApiName}`
    );
    return `${base}/lightning/setup/null/page?address=${address}`;
  }
  return `${base}/lightning/setup/ObjectManager/${objectApiName}/FieldsAndRelationships/view`;
}

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
