import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Use Preact for UI rendering
  vite: () => ({
    plugins: [
      preact(),
      {
        // Preact's dangerouslySetInnerHTML handler uses innerHTML internally.
        // We never use dangerouslySetInnerHTML, so these paths are dead code,
        // but Firefox's AMO linter flags them statically. Replace the assignments
        // with textContent equivalents to silence the warning.
        name: 'replace-preact-innerHTML',
        renderChunk(code: string) {
          return code
            .replace(/(\w+)\.innerHTML=(\w+\.__html)/g, '$1.textContent=$2')
            .replace(/(\w+)\.innerHTML=""/g, '$1.textContent=""');
        },
      },
    ],
  }),

  // Target Firefox/Zen as the primary browser
  browser: 'firefox',

  // Manifest configuration
  manifest: {
    name: 'Salesforce FLS Comparator Expanded',
    description: 'Compare Salesforce Field Level Security across fields and orgs',
    version: '1.0.5',

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
        strict_min_version: '140.0',
        // Required by Firefox for new extensions; this extension collects no data
        ...({ data_collection_permissions: { required: ['none'], optional: [] } } as object),
      },
      // data_collection_permissions requires Firefox for Android 142+
      ...({ gecko_android: { strict_min_version: '142.0' } } as object),
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
