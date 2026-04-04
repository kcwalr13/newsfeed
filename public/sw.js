// Service worker v1 — registration only.
// Offline caching is deferred to a future milestone.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
