# Privacy Policy

The Salesforce FLS Comparator Expanded browser extension communicates directly between the user's web browser and the Salesforce servers. No data is sent to any third parties.

We save some information in the browser's local extension storage to preserve FLS snapshots and user preferences across sessions. None of the saved data contains Salesforce record data (Accounts, Contacts, Opportunities, etc.) — only field-level security metadata (which profiles and permission sets have Read/Edit access to which fields).

The extension communicates via the official Salesforce REST and Tooling APIs on behalf of the currently logged-in user. This means the extension can access nothing beyond the metadata and features the user has already been granted access to in Salesforce.

All Salesforce API calls reuse the session token (`sid` cookie) that the browser already holds for the active Salesforce session. To acquire this token the extension requires permission to read cookie information for Salesforce domains (`*.salesforce.com`, `*.lightning.force.com`). No credentials are stored — only the live session token is read at the time of each API call.

To validate the accuracy of this description, inspect the source code, monitor network traffic in your browser's DevTools, or take my word for it.

---

## Local Storage Policy

Extension storage objects are sets of data stored in your browser by the extension via the `browser.storage.local` API. We use extension storage to remember your:

- **FLS Snapshots** — field-level security data (Read/Edit permissions per profile/permission set) captured for a specific object and field, along with a user-assigned label, the object and field API names, and the Salesforce org's instance URL and org ID. No record-level SObject data is stored.
- **Org Labels** — optional friendly names you assign to each Salesforce org context for display clarity.

We do not use extension storage for any other purpose. You may erase all stored data at any time by:
- Using the Snapshot Manager inside the extension to delete individual snapshots.
- Clearing the extension's storage via your browser's extension management page.
- Uninstalling the extension, which removes all associated storage.

---

## What We Do Not Collect

- No Salesforce record data (no Account, Contact, Opportunity, or any SObject row data).
- No personally identifiable information beyond what is inherent to your Salesforce session (org ID, instance URL).
- No analytics, telemetry, or usage tracking of any kind.
- No data is ever transmitted to any server other than your own Salesforce org.
