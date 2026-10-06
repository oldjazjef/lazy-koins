// Runtime configuration, read by core/config/runtime-env.ts before the app boots.
//
// NOT bundled into the JS — a static asset loaded by a plain <script> in index.html, so one build
// artefact serves every environment: the web container's entrypoint.sh overwrites this file at
// start from LK_* variables.
//
// These are the local development defaults, also hardcoded as fallbacks in runtime-env.ts.
window.__LK_ENV__ = {
  // Empty = same origin; the dev server proxies /api to :3333 (proxy.conf.json).
  apiBaseUrl: '',
  // 'dev' matches apps/api/.env.example's AUTH_MODE=dev: sign in as any e-mail, no Firebase.
  // 'firebase' = e-mail/password and Google through Firebase Authentication.
  authMode: 'dev',
  // The web app config from Firebase console → Project settings → Your apps. Public by design.
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
