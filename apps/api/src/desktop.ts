/**
 * Entry point of the API bundle the desktop app loads in-process (`webpack.desktop.config.js` →
 * `dist/apps/desktop-api/main.js`, a CommonJS library). It starts nothing on import: the Electron
 * main process sets the environment (AUTH_MODE=local, LOCAL_MODE=true, DATABASE_URL in the data
 * folder, …), then `require`s this file and calls `bootstrap({ port: 0, … })`.
 */
export {
  bootstrap,
  type BootstrapOptions,
  DESKTOP_ACCESS_HEADER,
  type RunningApi,
} from './bootstrap';
export type {
  HostPdfPrinter,
  PdfPrintOptions,
} from './integrations/pdf/print-options';
