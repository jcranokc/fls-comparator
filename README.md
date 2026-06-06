# Salesforce FLS Comparator Expanded

A browser extension for Firefox, Zen Browser, and Chrome for Salesforce administrators and developers to capture, compare, and apply Field-Level Security (FLS) settings across fields and organisations — entirely in-browser, with no external server.

[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/salesforce-fls-comparator/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What It Does

Salesforce's built-in FLS management requires navigating to each field individually, making it slow and error-prone to audit or replicate permissions across fields. This extension fixes that.

**Core capabilities:**

- **Capture** — fetch FLS for any field in seconds: every Profile and Permission Set's Read/Edit access in one table
- **Compare** — diff two fields side-by-side with colour-coded change indicators (match / read differs / edit differs / missing)
- **Apply** — copy FLS from one field and paste it onto another with a confirmation screen showing exactly what will change
- **Audit** — bulk-capture all fields on an object and export as JSON, CSV, or XLSX pivot matrix
- **Cross-org** — export a snapshot from a sandbox, import in production, and diff by permission name (not org-specific ID)
- **History** — full apply audit log with rollback support

---

## Installation

### Firefox / Zen Browser
Install from the [Firefox Add-ons page](https://addons.mozilla.org/en-US/firefox/addon/salesforce-fls-comparator/).

### Chrome
Install from the [Chrome Web Store](https://chrome.google.com/webstore).

### Load Unpacked (Development)
1. Clone the repo and run `npm install && npm run build:firefox`
2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**
3. Select `dist/firefox/manifest.json`

---

## Usage

1. Log in to any Salesforce org (any edition, including free Developer Edition)
2. Open the FLS Comparator sidebar: **View → Sidebar → FLS Comparator**  
   *(or click the toolbar icon for the popup)*
3. Select an **Object** and **Field** from the dropdowns
4. Click **Fetch FLS** — the table renders Read/Edit access for every Profile and Permission Set
5. Click **Save Snapshot** to name and store the result

### Compare Two Fields
1. Fetch FLS for Field A and save a snapshot
2. Select Field B and fetch its FLS
3. Click **Compare with saved** — a colour-coded diff appears inline

### Apply (Copy/Paste FLS)
1. Save a snapshot from the source field
2. Navigate to the target field and fetch its FLS
3. Click **Apply** → review the confirmation screen (shows before/after per permission set) → confirm

### Object Audit
Switch to the **Audit** tab, select an object, and click **Capture All Fields**. Download the result as a pivot matrix (XLSX or CSV) — fields as rows, profiles as columns, R+E / R / E / — as cell values.

### Cross-Org Comparison
1. In Org A: fetch FLS, click **Save Snapshot**, then **Export (JSON)**
2. In Org B: open the **Snapshots** tab, click **Import**, select the JSON file
3. Fetch FLS for the equivalent field in Org B, then compare against the imported snapshot  
   Matching is done by permission API name — not Salesforce ID — so cross-org diffs work correctly

---

## Features

| Feature | Detail |
|---|---|
| FLS capture | Parallel REST + Tooling API queries; profiles and permission sets unified |
| Diff engine | 6 statuses: Match, Read Differs, Edit Differs, Both Differ, Missing in Target, New in Target |
| Apply engine | Composite API batch writes (25 subrequests/call); DUPLICATE_VALUE auto-retry as PATCH |
| Object audit | 4 API calls regardless of field count; exports JSON / CSV / XLSX |
| Snapshots | CRUD, rename, org labelling, import/export |
| Apply history | 200-entry audit log with per-row rollback |
| Settings | API version pin, snapshot limit, org label manager |
| Content script | Injects launch button on Salesforce Set Field-Level Security pages |
| Dead field detection | Flags fields with zero Read access across all profiles |
| Deep links | Direct links to Salesforce Setup for each profile, permission set, and field |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Extension platform | WebExtension MV3 (Firefox primary, Chrome compatible) |
| Language | TypeScript |
| Framework | WXT (Web Extension Toolkit) |
| UI | Preact + JSX |
| Styling | Tailwind CSS |
| Salesforce APIs | REST API + Tooling API + Composite API |
| Storage | `browser.storage.local` |
| Testing | Vitest |

---

## Project Structure

```
├── entrypoints/
│   ├── background.ts              # Service worker — all Salesforce API calls
│   ├── salesforce-bridge.content.ts  # Content script — injects launch button
│   ├── popup/App.tsx              # Popup UI (5 tabs: FLS, Audit, Snapshots, History, Settings)
│   └── sidepanel/Panel.tsx        # Firefox sidebar (same UI, wider layout)
├── lib/
│   ├── api/
│   │   ├── salesforce.ts          # REST/Tooling/Composite API wrappers + apply engine
│   │   ├── session.ts             # Session extraction via browser.cookies
│   │   └── types.ts               # All TypeScript types
│   ├── store/
│   │   ├── snapshots.ts           # Snapshot CRUD, export, import, settings
│   │   └── history.ts             # Apply history log
│   └── utils/
│       ├── diff.ts                # FLS diff algorithm
│       └── format.ts              # Label, URL, and timestamp helpers
├── components/                    # Preact UI components
└── tests/                         # Vitest unit tests
```

---

## Development

```bash
# Install dependencies
npm install

# Dev build with HMR (Firefox)
npm run dev:firefox

# Production build
npm run build:firefox
npm run build:chrome

# Run tests
npm test
```

Requires Firefox 109+ or any Chromium browser for Chrome builds.

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist snapshots and history in `browser.storage.local` |
| `tabs` | Identify the active Salesforce tab to retrieve the instance URL |
| `cookies` | Read the HttpOnly `sid` session cookie in the background worker to authenticate Salesforce API calls |
| `host_permissions` (Salesforce domains) | Allow the background worker to make authenticated cross-origin API calls to the user's Salesforce org |

All network traffic goes only to the user's own Salesforce org. No data is sent to any external server. No telemetry, no analytics, no remote code.

---

## Requirements

- An active Salesforce session in the browser (any edition — [free Developer Edition](https://developer.salesforce.com/signup) works)
- Firefox 109+ / Zen Browser, or Chrome / any Chromium browser
- Salesforce Lightning Experience (Classic has partial support via the content script button)

---

## License

MIT — see [LICENSE](LICENSE).
