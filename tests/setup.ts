/**
 * Vitest global setup — runs before each test file.
 * Installs fakeBrowser as the global `browser`/`chrome` so that
 * @wxt-dev/browser (and therefore wxt/storage) works in Node test environment.
 */
import { fakeBrowser } from 'wxt/testing';

(globalThis as unknown as Record<string, unknown>).browser = fakeBrowser;
(globalThis as unknown as Record<string, unknown>).chrome = fakeBrowser;
