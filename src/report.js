// Single seam for error reporting. Today it writes to the console; when the
// site gets a crash-reporting account (Sentry or similar), forward from here.

import { NAME } from './config.js';

export function reportError(error, context = {}) {
  console.error(`[${NAME}]`, context, error);
}

export function installGlobalHandlers(target = globalThis) {
  target.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { where: 'window.onerror' });
  });
  target.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { where: 'unhandledrejection' });
  });
}
