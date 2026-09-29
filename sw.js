// Meu Mercado V48.3-GITHUB — Service Worker simples para GitHub Pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
