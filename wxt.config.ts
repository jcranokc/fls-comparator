import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Use Preact for UI rendering
  vite: () => ({
    plugins: [preact()],
  }),

  // Target Firefox/Zen as the primary browser
  browser: 'firefox',

  // Manifest configuration
  manifest: {
    name: 'Salesforce FLS Comparator Expanded',
    description: 'Compare Salesforce Field Level Security across fields and orgs',
    version: '1.0.2',

    permissions: ['storage', 'tabs', 'cookies'],

    host_permissions: [
      'https://*.salesforce.com/*',
      'https://*.lightning.force.com/*',
      'https://*.my.salesforce.com/*',
      'https://*.sandbox.my.salesforce.com/*',
      'https://*.develop.my.salesforce.com/*',
      'https://*.salesforce-setup.com/*',
      'https://*.my.salesforce-setup.com/*',
      'https://*.sandbox.my.salesforce-setup.com/*',
    ],

    browser_specific_settings: {
      gecko: {
        id: 'fls-comparator@ijm-tools',
        strict_min_version: '109.0',
        // Required by Firefox for new extensions; this extension collects no data
        ...({ data_collection_permissions: { required: [], optional: [] } } as object),
      },
    },

    sidebar_action: {
      default_title: 'Salesforce FLS Comparator Expanded',
      default_panel: 'entrypoints/sidepanel/index.html',
    },
  },

  runner: {
    startUrls: ['https://login.salesforce.com'],
  },
});
