/**
 * Re-exports of core types used by the storage layer.
 */
export type {
  FLSSnapshot,
  OrgContext,
  FieldPermissionRecord,
  ExtensionSettings,
} from '../api/types';

export { DEFAULT_SETTINGS } from '../api/types';

/** Key used in browser.storage.local for snapshots */
export const STORAGE_KEY_SNAPSHOTS = 'fls_snapshots';

/** Key used in browser.storage.local for settings */
export const STORAGE_KEY_SETTINGS = 'fls_settings';

/** Key used in browser.storage.local for the apply history log */
export const STORAGE_KEY_HISTORY = 'fls_history';
