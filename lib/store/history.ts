import { storage } from 'wxt/storage';
import type { ApplyHistoryEntry } from '../api/types';
import { STORAGE_KEY_HISTORY } from './types';

const HISTORY_CAP = 200;

const historyItem = storage.defineItem<ApplyHistoryEntry[]>(`local:${STORAGE_KEY_HISTORY}`, {
  fallback: [],
});

export async function saveHistoryEntry(entry: ApplyHistoryEntry): Promise<void> {
  const history = await loadHistory();
  const trimmed = history.length >= HISTORY_CAP ? history.slice(history.length - HISTORY_CAP + 1) : history;
  await historyItem.setValue([...trimmed, entry]);
}

export async function loadHistory(): Promise<ApplyHistoryEntry[]> {
  return historyItem.getValue();
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await loadHistory();
  await historyItem.setValue(history.filter(e => e.id !== id));
}

export async function clearHistory(): Promise<void> {
  await historyItem.setValue([]);
}

export async function markEntryRolledBack(id: string, rollbackEntryId: string): Promise<void> {
  const history = await loadHistory();
  const entry = history.find(e => e.id === id);
  if (entry) {
    entry.rolledBack = true;
    entry.rollbackEntryId = rollbackEntryId;
    await historyItem.setValue(history);
  }
}
