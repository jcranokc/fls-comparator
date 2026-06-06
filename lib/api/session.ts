/**
 * Session management — communicates with the background to extract
 * Salesforce session info via the browser.cookies API.
 */
import type { SalesforceSession } from './types';

function isSalesforceUrl(url: string): boolean {
  return (
    url.includes('.salesforce.com') ||
    url.includes('.lightning.force.com') ||
    url.includes('.salesforce-setup.com')
  );
}

/**
 * Find the best Salesforce tab URL to use for session/cookie lookup.
 * Prefers the active tab; falls back to any Salesforce tab so the panel
 * still works when it is opened as its own tab (extension page).
 */
async function findSalesforceTabUrl(): Promise<string | null> {
  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeUrl = activeTabs[0]?.url ?? '';
  if (isSalesforceUrl(activeUrl)) return activeUrl;

  // Panel is the active tab — search all open tabs for a Salesforce page
  const allTabs = await browser.tabs.query({});
  return allTabs.find(t => isSalesforceUrl(t.url ?? ''))?.url ?? null;
}

/**
 * @param instanceUrl  When provided (e.g. from pendingNavigation), use it directly
 *                     so the right org is targeted even with multiple SF tabs open.
 */
export async function getSession(instanceUrl?: string): Promise<SalesforceSession | null> {
  try {
    const tabUrl = instanceUrl ?? await findSalesforceTabUrl();
    if (!tabUrl) return null;

    const response = await browser.runtime.sendMessage({
      type: 'GET_SESSION',
      payload: { tabUrl },
    }) as { type: string; payload: unknown };

    if (response?.type === 'SESSION_RESPONSE' && response.payload) {
      return response.payload as SalesforceSession;
    }

    return null;
  } catch (error) {
    console.error('[FLS Comparator] Failed to get session:', error);
    return null;
  }
}

export async function isOnSalesforcePage(): Promise<boolean> {
  try {
    return (await findSalesforceTabUrl()) !== null;
  } catch {
    return false;
  }
}
