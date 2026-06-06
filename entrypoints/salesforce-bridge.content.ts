/**
 * Content script injected into Salesforce pages.
 * Extracts session credentials (sid cookie, instance URL, org ID) and
 * responds to messages from the popup/panel.
 */
export default defineContentScript({
  matches: [
    'https://*.salesforce.com/*',
    'https://*.lightning.force.com/*',
    'https://*.my.salesforce.com/*',
    'https://*.sandbox.my.salesforce.com/*',
    'https://*.develop.my.salesforce.com/*',
    'https://*.salesforce-setup.com/*',
    'https://*.my.salesforce-setup.com/*',
    'https://*.sandbox.my.salesforce-setup.com/*',
  ],
  runAt: 'document_idle',

  main() {
    console.log('[FLS Comparator] Content script loaded on Salesforce page');

    // Inject the "Open in FLS Comparator" button on Set Field-Level Security pages
    tryInjectButton();

    // Lightning is a SPA — re-check on every URL change
    let lastHref = location.href;
    const spaObserver = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        document.getElementById('fls-comparator-launch-btn')?.remove();
        setTimeout(tryInjectButton, 900);
      }
    });
    spaObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => spaObserver.disconnect(), { once: true });
  },
});

// ─── Session Extraction ───────────────────────────────────────────────────────

interface SessionInfo {
  instanceUrl: string;
  sessionId: string;
  orgId: string;
}

function extractSession(): SessionInfo | null {
  const sessionId = extractSessionId();
  if (!sessionId) {
    console.warn('[FLS Comparator] Could not extract session ID from cookies');
    return null;
  }

  const instanceUrl = extractInstanceUrl();
  const orgId = extractOrgId();

  if (!orgId) {
    console.warn('[FLS Comparator] Could not extract org ID');
    return null;
  }

  return {
    instanceUrl,
    sessionId,
    orgId,
  };
}

/**
 * Extract the Salesforce session ID from the sid cookie pattern in the URL or page context.
 * Note: Salesforce marks sid as HttpOnly so document.cookie cannot read it — the background
 * worker handles actual session retrieval via browser.cookies.get() instead.
 * This function exists only to extract orgId from the sid when it IS accessible
 * (some older sandbox orgs set it without HttpOnly).
 */
function extractSessionId(): string | null {
  const cookies = document.cookie.split(';');
  const sidCookie = cookies.find(c => c.trim().startsWith('sid='));
  return sidCookie?.split('=')[1]?.trim() ?? null;
}

/**
 * Extract the Salesforce instance URL from the page location.
 */
function extractInstanceUrl(): string {
  return window.location.origin;
}

/**
 * Extract the Salesforce org ID from page context.
 * Tries multiple methods in order of reliability.
 */
function extractOrgId(): string | null {
  // Method 1: Salesforce global variable
  const sfdc = (window as Record<string, unknown>).Sfdc as
    | { canvas?: { oauth?: { orgId?: string } } }
    | undefined;
  if (sfdc?.canvas?.oauth?.orgId) {
    return sfdc.canvas.oauth.orgId;
  }

  // Method 2: Meta tag
  const metaOrgId = document.querySelector('meta[name="salesforce-orgId"]');
  if (metaOrgId) {
    return metaOrgId.getAttribute('content');
  }

  // Method 3: aura context (Lightning Experience)
  const auraConfig = (window as Record<string, unknown>).$A as
    | { getContext?: () => { getGlobalValueProviders?: () => { get?: (key: string) => string } } }
    | undefined;
  try {
    const orgId = auraConfig?.getContext?.()?.getGlobalValueProviders?.()?.get?.('$Organization.Id');
    if (orgId) return orgId;
  } catch {
    // Aura not available
  }

  // Method 4: Extract from the sid cookie (first 15/18 chars are org ID in some formats)
  const sid = extractSessionId();
  if (sid) {
    // The org ID is embedded in certain cookie patterns
    const orgIdMatch = sid.match(/^([a-zA-Z0-9]{15,18})!/);
    if (orgIdMatch) return orgIdMatch[1];
  }

  return null;
}

// ─── FLS Comparator Button Injection ─────────────────────────────────────────

interface FieldPageContext {
  fieldId?: string;
  objectApiName?: string;
  fieldLabel?: string;
}

function getFieldPageContext(): FieldPageContext | null {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  // Classic: /setup/ui/dfield_perms_edit.jsp?id=00N...
  if (pathname.includes('/setup/ui/dfield_perms_edit.jsp')) {
    const id = params.get('id');
    if (id) return { fieldId: id };
  }

  // Lightning Object Manager: /lightning/setup/ObjectManager/{obj}/FieldsAndRelationships/{id}/setfieldlevelsecurity
  const lightningMatch = pathname.match(
    /\/lightning\/setup\/ObjectManager\/([^/]+)\/FieldsAndRelationships\/([^/]+)\/setfieldlevelsecurity/i
  );
  if (lightningMatch) {
    return {
      objectApiName: decodeURIComponent(lightningMatch[1]),
      fieldId: decodeURIComponent(lightningMatch[2]),
    };
  }

  // salesforce-setup.com wraps classic pages via an `address` query param:
  // /lightning/setup/null/page?address=%2F_ui%2Fcommon%2Fconfig%2Ffield%2F...%3Fid%3D00N...%26type%3DAccount
  const addressParam = params.get('address');
  if (addressParam) {
    try {
      const decoded = decodeURIComponent(addressParam);
      if (decoded.includes('/config/field/')) {
        const qs = decoded.slice(decoded.indexOf('?') + 1);
        const addrParams = new URLSearchParams(qs);
        const id = addrParams.get('id');
        const type = addrParams.get('type'); // object API name
        if (id && /^[A-Za-z0-9]{15,18}$/.test(id)) {
          return { fieldId: id, objectApiName: type ?? undefined };
        }
      }
    } catch { /* ignore decode errors */ }
  }

  // DOM-based fallback: detect "Set Field-Level Security" in the rendered page
  if (isFieldSecurityPage()) {
    return extractContextFromDom(params);
  }

  return null;
}

function isFieldSecurityPage(): boolean {
  // Check multiple places the heading can appear
  const allText = [
    document.title,
    document.querySelector('h2')?.textContent ?? '',
    document.querySelector('h1')?.textContent ?? '',
    document.querySelector('.pageDescription')?.textContent ?? '',
    document.querySelector('.bPageTitle h2')?.textContent ?? '',
  ].join(' ').toLowerCase();
  return allText.includes('set field-level security') || allText.includes('field level security');
}

function extractContextFromDom(params: URLSearchParams): FieldPageContext | null {
  // 1. Try hidden form input — Classic FLS page stores field ID here
  const hiddenId = (
    document.querySelector<HTMLInputElement>('input[type="hidden"][name="id"]') ??
    document.querySelector<HTMLInputElement>('input[type="hidden"][name="fieldId"]') ??
    document.querySelector<HTMLInputElement>('#fieldId')
  )?.value;
  if (hiddenId && /^[A-Za-z0-9]{15,18}$/.test(hiddenId)) {
    return { fieldId: hiddenId };
  }

  // 2. Field ID in URL params
  const paramId = params.get('id');
  if (paramId && /^[A-Za-z0-9]{15,18}$/.test(paramId)) {
    return { fieldId: paramId };
  }

  // 3. Fall back to label + object name extracted from the page DOM + URL
  let fieldLabel: string | undefined;
  let objectApiName: string | undefined;

  // Extract field label from the "Field Label" row in the detail table
  document.querySelectorAll('th, td.labelCol').forEach(th => {
    if (th.textContent?.trim() === 'Field Label') {
      const td = th.nextElementSibling ?? th.closest('tr')?.querySelector('td:not(.labelCol)');
      const val = td?.textContent?.trim();
      if (val) fieldLabel = val;
    }
  });

  // Extract object name from setupid param: "AccountFields" → "Account"
  const setupid = params.get('setupid') ?? '';
  const objMatch = setupid.match(/^([A-Za-z][A-Za-z0-9_]*)(?:Fields?(?:Edit)?)$/i);
  if (objMatch && !/^custom$/i.test(objMatch[1])) objectApiName = objMatch[1];

  if (fieldLabel && objectApiName) return { fieldLabel, objectApiName };
  if (fieldLabel) return { fieldLabel };
  return null;
}

function makeButton(ctx: FieldPageContext): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'fls-comparator-launch-btn';
  btn.type = 'button';
  btn.textContent = '⚡ FLS Comparator';
  btn.title = 'Open in FLS Comparator';
  btn.addEventListener('click', () => {
    browser.runtime.sendMessage({
      type: 'OPEN_FLS_COMPARATOR',
      payload: { ...ctx, instanceUrl: window.location.origin },
    });
  });
  return btn;
}

const SAVE_BTN_SELECTOR = 'input[value="Save"], input[value="save"], input.btn[type="submit"]';

function injectInline(ctx: FieldPageContext, saveBtn: HTMLElement) {
  if (document.getElementById('fls-comparator-launch-btn')) return;
  const btn = makeButton(ctx);
  Object.assign(btn.style, {
    marginLeft: '6px', padding: '1px 10px', background: '#06b6d4', color: 'white',
    border: '1px solid #0891b2', borderRadius: '3px', cursor: 'pointer',
    fontSize: '12px', fontWeight: 'bold', verticalAlign: 'middle',
    lineHeight: '22px', height: '24px',
  });
  if (!saveBtn.parentElement) { injectFloat(ctx); return; }
  saveBtn.parentElement.insertBefore(btn, saveBtn.nextSibling);
}

function injectFloat(ctx: FieldPageContext) {
  if (document.getElementById('fls-comparator-launch-btn')) return;
  const btn = makeButton(ctx);
  Object.assign(btn.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
    padding: '10px 16px', background: '#06b6d4', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 16px rgba(6,182,212,0.5)',
  });
  document.body.appendChild(btn);
}

let pageWatcher: MutationObserver | null = null;

function tryInjectButton() {
  if (document.getElementById('fls-comparator-launch-btn')) return;

  const ctx = getFieldPageContext();
  const save = document.querySelector<HTMLElement>(SAVE_BTN_SELECTOR);

  // Best case: context + Save button both available right now
  if (ctx && save?.parentElement) {
    injectInline(ctx, save);
    return;
  }

  // Context available from URL, but no Save button in THIS frame.
  // On salesforce-setup.com the Classic FLS page is in an iframe — the outer
  // Lightning frame can parse the address param but can't reach iframe DOM.
  // Inject a floating button immediately in the outer frame.
  if (ctx && window === window.top) {
    injectFloat(ctx);
    return;
  }

  // Inside an iframe (or no URL context yet) — watch DOM for Save button + FLS page
  pageWatcher?.disconnect();
  pageWatcher = new MutationObserver(() => {
    if (document.getElementById('fls-comparator-launch-btn')) {
      pageWatcher?.disconnect();
      return;
    }
    const c = getFieldPageContext();
    if (!c) return;
    const s = document.querySelector<HTMLElement>(SAVE_BTN_SELECTOR);
    if (s?.parentElement) {
      pageWatcher?.disconnect();
      injectInline(c, s);
    } else if (isFieldSecurityPage() && window === window.top) {
      pageWatcher?.disconnect();
      injectFloat(c);
    }
  });
  pageWatcher.observe(document.documentElement, { childList: true, subtree: true });

  // Hard fallback after 20 s
  setTimeout(() => {
    pageWatcher?.disconnect();
    if (document.getElementById('fls-comparator-launch-btn')) return;
    const c = getFieldPageContext();
    if (c) injectFloat(c);
  }, 20000);
}
