/**
 * Background service worker for the FLS Comparator extension.
 * Handles all Salesforce API calls to avoid CORS issues.
 *
 * Messages arrive from the popup/panel with session credentials,
 * and this worker performs the authenticated fetch and returns results.
 */
function isTrustedSender(sender: browser.Runtime.MessageSender): boolean {
  // Extension pages used as sidebar/popup have no sender.tab
  if (!sender.tab) return true;
  const url = sender.tab.url ?? '';
  // Extension pages opened as tabs (e.g. sidebar opened via tabs.create) are also trusted
  if (url.startsWith(browser.runtime.getURL('/'))) return true;
  if (!url) return false;
  // Content scripts must be running on a Salesforce domain
  try {
    const { hostname } = new URL(url);
    return (
      hostname.endsWith('.salesforce.com') ||
      hostname.endsWith('.lightning.force.com') ||
      hostname.endsWith('.salesforce-setup.com')
    );
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  console.log('[FLS Comparator] Background service worker started');

  browser.runtime.onMessage.addListener(
    (message: unknown, sender: browser.Runtime.MessageSender) => {
      if (!isTrustedSender(sender)) {
        console.warn('[FLS Comparator] Rejected message from untrusted sender:', sender.tab?.url);
        return false;
      }
      const msg = message as { type: string; payload?: Record<string, unknown> };

      switch (msg.type) {
        case 'GET_SESSION':
          return handleGetSession(msg.payload as { tabUrl: string });

        case 'REST_QUERY':
          return handleRestQuery(msg.payload as {
            instanceUrl: string;
            sessionId: string;
            soql: string;
          });

        case 'TOOLING_QUERY':
          return handleToolingQuery(msg.payload as {
            instanceUrl: string;
            sessionId: string;
            soql: string;
          });

        case 'REST_GET':
          return handleRestGet(msg.payload as {
            instanceUrl: string;
            sessionId: string;
            path: string;
          });

        case 'COMPOSITE_REQUEST':
          return handleCompositeRequest(msg.payload as {
            instanceUrl: string;
            sessionId: string;
            compositeRequest: Array<{
              method: string;
              url: string;
              referenceId: string;
              body?: unknown;
            }>;
          });

        case 'OPEN_FLS_COMPARATOR':
          return handleOpenFLSComparator(msg.payload as {
            fieldId: string;
            objectApiName?: string;
            instanceUrl: string;
          });

        default:
          return false; // Not handled
      }
    }
  );
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Extract session from the browser's cookie store.
 * Uses browser.cookies API which can read HttpOnly cookies — unlike document.cookie
 * in the content script, which modern Salesforce blocks for security.
 * Also normalises salesforce-setup.com → salesforce.com so API calls work.
 */
async function handleGetSession(
  payload: { tabUrl: string }
): Promise<{ type: string; payload: unknown }> {
  try {
    // Normalise setup domain → API domain
    const apiUrl = payload.tabUrl.replace(/salesforce-setup\.com/g, 'salesforce.com');
    const origin = new URL(apiUrl).origin;

    // Try to read the sid cookie on the API domain
    const sidCookie = await browser.cookies.get({ url: origin, name: 'sid' });
    if (!sidCookie?.value) {
      return { type: 'SESSION_RESPONSE', payload: null };
    }

    const sessionId = sidCookie.value;

    // Salesforce embeds the org ID at the start of the session token: "{orgId}!{token}"
    const orgIdMatch = sessionId.match(/^([A-Za-z0-9]{15,18})!/);
    const orgId = orgIdMatch?.[1] ?? null;
    if (!orgId) {
      return { type: 'SESSION_RESPONSE', payload: null };
    }

    return {
      type: 'SESSION_RESPONSE',
      payload: { instanceUrl: origin, sessionId, orgId },
    };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

async function handleRestQuery(payload: {
  instanceUrl: string;
  sessionId: string;
  soql: string;
}): Promise<{ type: string; payload: unknown }> {
  try {
    const url = `${payload.instanceUrl}/services/data/v61.0/query?q=${encodeURIComponent(payload.soql)}`;
    const data = await authenticatedFetch(url, payload.sessionId);
    return { type: 'API_RESPONSE', payload: data };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

async function handleToolingQuery(payload: {
  instanceUrl: string;
  sessionId: string;
  soql: string;
}): Promise<{ type: string; payload: unknown }> {
  try {
    const url = `${payload.instanceUrl}/services/data/v61.0/tooling/query?q=${encodeURIComponent(payload.soql)}`;
    const data = await authenticatedFetch(url, payload.sessionId);
    return { type: 'API_RESPONSE', payload: data };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

async function handleRestGet(payload: {
  instanceUrl: string;
  sessionId: string;
  path: string;
}): Promise<{ type: string; payload: unknown }> {
  try {
    const url = `${payload.instanceUrl}${payload.path}`;
    const data = await authenticatedFetch(url, payload.sessionId);
    return { type: 'API_RESPONSE', payload: data };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

async function handleCompositeRequest(payload: {
  instanceUrl: string;
  sessionId: string;
  compositeRequest: Array<{
    method: string;
    url: string;
    referenceId: string;
    body?: unknown;
  }>;
}): Promise<{ type: string; payload: unknown }> {
  try {
    const url = `${payload.instanceUrl}/services/data/v61.0/composite`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${payload.sessionId}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        compositeRequest: payload.compositeRequest,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Salesforce API error: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const data = await response.json();
    return { type: 'API_RESPONSE', payload: data };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

async function handleOpenFLSComparator(payload: {
  fieldId?: string;
  objectApiName?: string;
  fieldLabel?: string;
  instanceUrl: string;
}): Promise<{ type: string; payload: unknown }> {
  try {
    const apiUrl = payload.instanceUrl.replace(/salesforce-setup\.com/g, 'salesforce.com');
    const sidCookie = await browser.cookies.get({ url: apiUrl, name: 'sid' });

    if (sidCookie?.value) {
      const sessionId = sidCookie.value;
      let objectApiName = payload.objectApiName;
      let fieldApiName: string | undefined;

      if (payload.fieldId && /^[A-Za-z0-9]{15,18}$/.test(payload.fieldId)) {
        // Resolve via Tooling API CustomField record
        const fieldRes = await authenticatedFetch(
          `${apiUrl}/services/data/v61.0/tooling/query?q=${encodeURIComponent(
            `SELECT DeveloperName, TableEnumOrId, NamespacePrefix FROM CustomField WHERE Id = '${payload.fieldId}'`
          )}`,
          sessionId
        ) as { records?: Array<{ DeveloperName: string; TableEnumOrId: string; NamespacePrefix: string | null }> };

        const rec = fieldRes?.records?.[0];
        if (rec) {
          const ns = rec.NamespacePrefix ? `${rec.NamespacePrefix}__` : '';
          fieldApiName = `${ns}${rec.DeveloperName}__c`;
          if (!objectApiName) {
            const tableId = rec.TableEnumOrId;
            if (/^01I/i.test(tableId)) {
              const objRes = await authenticatedFetch(
                `${apiUrl}/services/data/v61.0/tooling/query?q=${encodeURIComponent(
                  `SELECT DeveloperName, NamespacePrefix FROM CustomObject WHERE Id = '${tableId}'`
                )}`,
                sessionId
              ) as { records?: Array<{ DeveloperName: string; NamespacePrefix: string | null }> };
              const obj = objRes?.records?.[0];
              if (obj) {
                const objNs = obj.NamespacePrefix ? `${obj.NamespacePrefix}__` : '';
                objectApiName = `${objNs}${obj.DeveloperName}__c`;
              }
            } else {
              objectApiName = tableId; // standard object name
            }
          }
        }
      } else if (payload.fieldLabel && payload.objectApiName) {
        // Resolve via REST describe — find field by label within the object
        const describe = await authenticatedFetch(
          `${apiUrl}/services/data/v61.0/sobjects/${payload.objectApiName}/describe`,
          sessionId
        ) as { fields?: Array<{ name: string; label: string }> };

        const field = describe.fields?.find(f => f.label === payload.fieldLabel);
        if (field) {
          fieldApiName = field.name;
          objectApiName = payload.objectApiName;
        }
      }

      if (objectApiName && fieldApiName) {
        await browser.storage.local.set({ pendingNavigation: { objectApiName, fieldApiName, instanceUrl: apiUrl } });
      }
    }

    // If the sidebar is already open, its storage.onChanged listener picks up
    // pendingNavigation automatically. If not, open the panel as a new tab —
    // tabs.create() works without user activation in MV2.
    const sb = (browser as unknown as { sidebarAction?: { isOpen?: (details: object) => Promise<boolean> } }).sidebarAction;
    const sidebarIsOpen = sb?.isOpen ? await sb.isOpen({}) : false;
    if (!sidebarIsOpen) {
      await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
    }

    return { type: 'OK', payload: null };
  } catch (error) {
    return makeErrorResponse(error);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function authenticatedFetch(url: string, sessionId: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${sessionId}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ApiError(
      'Your Salesforce session has expired — please reload the page and try again.',
      response.status
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiError(
      `Salesforce API error: ${response.status} ${response.statusText}`,
      response.status,
      errorText
    );
  }

  return response.json();
}

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function makeErrorResponse(error: unknown): { type: string; payload: { message: string; statusCode?: number } } {
  if (error instanceof ApiError) {
    // Include Salesforce's error body so we can diagnose API failures
    const detail = error.responseBody ? ` — ${error.responseBody.slice(0, 300)}` : '';
    return {
      type: 'API_ERROR',
      payload: {
        message: `${error.message}${detail}`,
        statusCode: error.statusCode,
      },
    };
  }
  return {
    type: 'API_ERROR',
    payload: {
      message: error instanceof Error ? error.message : 'Unknown error',
    },
  };
}
