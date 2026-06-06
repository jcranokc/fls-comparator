# FLS Comparator — Firefox/Zen Browser Extension
## Claude Code Development Plan

---

## Project Overview

A cross-browser WebExtension (Firefox/Zen primary, Chrome compatible) that replicates and
improves upon the FLS Comparator Chrome extension. Allows Salesforce admins and developers
to compare Field Level Security settings across fields within the same org or across multiple orgs.

**Primary target:** Firefox / Zen Browser (WebExtension MV3)
**Secondary target:** Chrome/Edge (same codebase, minimal manifest delta)

---

## Goals

- Copy FLS from one Salesforce field to a clipboard-style buffer
- Paste / apply that FLS profile to one or more target fields
- Compare two fields side-by-side with a visual diff (Read/Edit per profile/permission set)
- Support cross-org comparison by letting the user store a snapshot from Org A and apply or diff in Org B
- Work entirely in-browser — no external server, no data leaves the machine

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Extension platform | WebExtension MV3 | Firefox + Chrome compatible |
| Language | TypeScript | Type safety for API response shapes |
| Bundler | Vite + `@samrum/vite-plugin-web-extension` | MV3 support, fast HMR |
| UI framework | Preact | Small bundle, familiar JSX |
| Styling | Tailwind CSS (CDN build via PostCSS) | Rapid UI iteration |
| Salesforce API | REST + Tooling API | Available from any authenticated session |
| Storage | `browser.storage.local` | Persist snapshots across tabs/sessions |
| Testing | Vitest | Co-located with Vite |

---

## Repository Structure

```
fls-comparator/
├── CLAUDE.md                    ← this file
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── manifests/
│   ├── manifest.firefox.json    ← gecko-specific keys
│   └── manifest.chrome.json     ← chrome-specific keys
├── src/
│   ├── background/
│   │   └── service-worker.ts    ← MV3 background (handles cross-origin fetch)
│   ├── content/
│   │   └── salesforce-bridge.ts ← injected into Salesforce pages; extracts session/org info
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── App.tsx              ← main UI entry point
│   ├── panel/                   ← sidebar panel (Firefox sidebar_action)
│   │   ├── index.html
│   │   └── Panel.tsx
│   ├── api/
│   │   ├── salesforce.ts        ← REST + Tooling API wrappers
│   │   ├── types.ts             ← FieldPermissions, PermissionSet, Profile shapes
│   │   └── session.ts           ← extract instanceUrl + sessionId from page context
│   ├── store/
│   │   ├── snapshots.ts         ← read/write FLS snapshots to browser.storage.local
│   │   └── types.ts             ← FLSSnapshot, OrgContext shapes
│   ├── components/
│   │   ├── FlsTable.tsx         ← comparison grid component
│   │   ├── FieldPicker.tsx      ← object/field selector dropdowns
│   │   ├── SnapshotCard.tsx     ← saved snapshot display
│   │   └── DiffBadge.tsx        ← Read/Edit/None badge with diff highlight
│   └── utils/
│       ├── diff.ts              ← compute FLS diff between two snapshots
│       └── format.ts            ← label formatting helpers
├── tests/
│   ├── api/salesforce.test.ts
│   ├── store/snapshots.test.ts
│   └── utils/diff.test.ts
└── dist/                        ← build output (gitignored)
```

---

## Manifest Strategy

Use a single shared base and merge browser-specific keys at build time.

**Firefox-specific additions (`manifest.firefox.json`):**
```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "fls-comparator@ijm-tools",
      "strict_min_version": "109.0"
    }
  },
  "sidebar_action": {
    "default_title": "FLS Comparator",
    "default_panel": "src/panel/index.html"
  }
}
```

**Shared permissions:**
```json
"permissions": ["storage", "scripting", "tabs"],
"host_permissions": ["https://*.salesforce.com/*", "https://*.lightning.force.com/*"]
```

---

## Core Data Model

```typescript
// A single field's FLS across all profiles/permission sets
interface FLSSnapshot {
  id: string;                    // uuid
  label: string;                 // user-assigned name, e.g. "Contact.Email - Prod"
  capturedAt: string;            // ISO timestamp
  org: OrgContext;
  objectApiName: string;
  fieldApiName: string;
  permissions: FieldPermissionRecord[];
}

interface OrgContext {
  instanceUrl: string;
  orgId: string;
  orgLabel?: string;             // user-assigned
}

interface FieldPermissionRecord {
  id: string;                    // PermissionSet/Profile Id
  name: string;                  // API name
  label: string;                 // display label
  type: "Profile" | "PermissionSet";
  permissionsRead: boolean;
  permissionsEdit: boolean;
}
```

---

## Salesforce API Queries

### Get all objects (for picker)
```
GET /services/data/v61.0/sobjects
```

### Get fields for an object (for picker)
```
GET /services/data/v61.0/sobjects/{ObjectName}/describe
→ fields[].name, fields[].label
```

### Get FLS for a field (Tooling API)
```
GET /services/data/v61.0/tooling/query?q=
  SELECT Id, Field, SobjectType, ParentId, Parent.Name, Parent.Label,
         Parent.IsCustom, PermissionsRead, PermissionsEdit
  FROM FieldPermissions
  WHERE SobjectType = '{ObjectName}'
    AND Field = '{ObjectName}.{FieldName}'
```

### Get Profile vs PermissionSet type
```
GET /services/data/v61.0/tooling/query?q=
  SELECT Id, Name, Label, IsCustom, Type
  FROM PermissionSet
  WHERE Id IN ('{id1}', '{id2}', ...)
```

**Note:** Session token and instanceUrl are extracted from the active Salesforce tab by
the content script and passed to the background service worker, which makes the actual
fetch calls (avoids CORS issues in the content script context).

---

## Feature Phases

### Phase 1 — Core FLS Capture & Display
**Goal:** Open the extension on a Salesforce Setup page, pick an object and field, see all
FLS rows in a clean table.

Tasks:
- [ ] Project scaffold: Vite + TypeScript + Preact + Tailwind
- [ ] Manifest files (Firefox + Chrome variants), build script merges them
- [ ] Content script: extract `window.location`, session cookie (`sid`), and org ID from page
- [ ] Background service worker: receive `{instanceUrl, sessionId, query}`, execute fetch, return result
- [ ] `salesforce.ts`: `describeObjects()`, `describeFields(object)`, `fetchFLS(object, field)`
- [ ] `FieldPicker` component: object dropdown → field dropdown (dependent)
- [ ] `FlsTable` component: renders FieldPermissionRecord rows with Read/Edit columns
- [ ] Popup UI wired end-to-end: pick field → fetch → display table
- [ ] Sidebar panel (Firefox): same UI in wider sidebar layout

**Acceptance criteria:** On any Salesforce Lightning page, open the extension, select
Contact > Email, and see a complete FLS table with all profiles and permission sets.

---

### Phase 2 — Copy / Paste FLS (Single Org)
**Goal:** Copy FLS from Field A, paste it onto Field B within the same org.

Tasks:
- [ ] `snapshots.ts`: `saveSnapshot()`, `loadSnapshots()`, `deleteSnapshot()` using `browser.storage.local`
- [ ] "Copy FLS" button — saves current table as a named snapshot
- [ ] `SnapshotCard` component: shows saved snapshot label, object.field, timestamp, org
- [ ] "Compare with saved" — side-by-side `FlsTable` showing two snapshots
- [ ] `diff.ts`: computes per-row diff (match / read-differs / edit-differs / both-differ / missing)
- [ ] `DiffBadge` component: color-coded Read/Edit cells (green = match, yellow = differs, red = missing)
- [ ] Apply (paste) FLS — takes snapshot permissions and builds a Metadata API deploy payload
- [ ] Apply confirmation modal: shows what will change before executing
- [ ] Apply via Metadata API: `POST /services/data/v61.0/tooling/composite/` batch upsert on FieldPermissions

**Acceptance criteria:** Copy FLS from Contact.Email, navigate to Contact.Phone, paste —
all matching profiles get identical Read/Edit values with a confirmation summary shown first.

---

### Phase 3 — Cross-Org Comparison
**Goal:** Export a snapshot from Org A, import/compare in Org B.

Tasks:
- [ ] Export snapshot as JSON file (download)
- [ ] Import snapshot from JSON file (file picker in popup)
- [ ] Snapshot manager screen: list all saved snapshots, label editing, delete
- [ ] Org label assignment: let user name each org context for display clarity
- [ ] Cross-org diff view: match by permission set/profile Name (not Id, which differs across orgs)
- [ ] "Missing in target org" row highlighting (profile exists in snapshot but not in current org)

**Acceptance criteria:** Export FLS snapshot from Staging, import in Production, see a diff
table with rows color-coded by match status and missing rows flagged.

---

### Phase 4 — UX Polish & Settings
**Goal:** Reach a quality bar suitable for publishing to addons.mozilla.org.

Tasks:
- [ ] Settings page: default org label, Salesforce API version pin, max snapshot storage limit
- [ ] Keyboard shortcuts (open sidebar, trigger copy)
- [ ] Search/filter row in FLS table (filter by profile name)
- [ ] "Only show differences" toggle in diff view
- [ ] Loading skeletons and error states for all async operations
- [ ] Empty states with actionable copy ("Not on a Salesforce page — navigate to Setup first")
- [ ] Extension icon badge showing snapshot count
- [ ] Responsive layout for popup (narrow) vs sidebar (wide)
- [ ] Accessibility: keyboard navigation, ARIA labels, focus management

---

### Phase 5 — Publishing
Tasks:
- [ ] Firefox: submit to addons.mozilla.org (AMO), complete review questionnaire
- [ ] Chrome: submit to Chrome Web Store (same codebase, Chrome manifest variant)
- [ ] README with screenshots and install links
- [ ] CHANGELOG.md

---

## Key Implementation Notes

### Session Extraction
Salesforce Lightning stores the session in a cookie named `sid` scoped to the instance domain.
The content script reads `document.cookie` and sends `{instanceUrl, sessionId, orgId}` to
the background worker via `browser.runtime.sendMessage`. The background worker performs all
API calls — this avoids CORS preflight issues that would occur from content script context.

```typescript
// content/salesforce-bridge.ts
const sid = document.cookie.split(';')
  .find(c => c.trim().startsWith('sid='))
  ?.split('=')[1];

const instanceUrl = window.location.origin; // https://myorg.lightning.force.com

const orgId = (window as any).Sfdc?.canvas?.oauth?.orgId
  ?? document.querySelector('meta[name="salesforce-orgId"]')?.getAttribute('content');
```

### Background Fetch Pattern
```typescript
// background/service-worker.ts
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'TOOLING_QUERY') {
    const { instanceUrl, sessionId, soql } = msg;
    const res = await fetch(
      `${instanceUrl}/services/data/v61.0/tooling/query?q=${encodeURIComponent(soql)}`,
      { headers: { Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' } }
    );
    return res.json();
  }
});
```

### Firefox vs Chrome Namespace
Use the `webextension-polyfill` package so all code uses `browser.*` uniformly.
Chrome's `chrome.*` namespace is wrapped transparently.

```
npm install webextension-polyfill
npm install -D @types/webextension-polyfill
```

### Cross-Org Matching
When diffing snapshots from different orgs, match rows by `name` (API name of the
permission set/profile), not `id` (which is org-specific). Mark rows as:
- `MATCH` — same name, same Read + Edit
- `READ_DIFFERS` — same name, Read value differs
- `EDIT_DIFFERS` — same name, Edit value differs
- `BOTH_DIFFER` — same name, both differ
- `MISSING_IN_TARGET` — exists in snapshot, no matching name in current org
- `NEW_IN_TARGET` — exists in current org, no matching name in snapshot

---

## Build Commands

```bash
# Install dependencies
npm install

# Dev build with HMR (Firefox)
npm run dev:firefox

# Dev build (Chrome)
npm run dev:chrome

# Production build
npm run build:firefox
npm run build:chrome

# Run tests
npm run test

# Load in Firefox
# about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json

# Load in Zen
# Same as Firefox — Zen is Firefox-based, uses the same about:debugging flow
```

---

## Testing Strategy

- **Unit tests (Vitest):** `diff.ts`, `snapshots.ts`, `salesforce.ts` query builders
- **Mock Salesforce responses:** fixture JSON files in `tests/fixtures/` for FieldPermissions queries
- **Manual testing:** Load unpacked extension in Firefox against a real sandbox org
- **Suggested test orgs:** IJM FullTest or a personal developer edition org

---

## Out of Scope (v1)

- Object-level CRUD permission comparison (separate feature, different API surface)
- Apex class / VF page access comparison
- Bulk apply across multiple fields simultaneously
- Team sharing of snapshots (would require a backend)
- Salesforce Classic support
