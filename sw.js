// ═══════════════════════════════════════════════════════
// SERVICE WORKER — Spiritual Breakthrough Chart
// Victory Outreach Church of Eagle Rock
// ═══════════════════════════════════════════════════════

// Bump this any time you update your files to clear old cache
const CACHE_NAME = 'sbc-v2';

const ASSETS = [
  './index.html',
  './admin.html',
  './manifest.json',
];

// ── INSTALL ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.log('SW cache failed:', err))
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH (offline) ───────────────────────────────────
// Skip caching Apps Script API — always needs to be live
self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ── PUSH NOTIFICATION ────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Spiritual Breakthrough Chart', body: "Don't miss today's victory — tap to check in!" };
  try { data = e.data.json(); } catch(_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      tag: 'sbc-daily',
      renotify: true,
      requireInteraction: false,
      actions: [
        { action: 'checkin', title: 'Check In Now' },
        { action: 'later',   title: 'Remind Me Later' }
      ],
      data: { url: './index.html' }
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'later') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) clients[0].postMessage({ type: 'snooze' });
      })
    );
    return;
  }

  const targetUrl = e.notification.data?.url || './index.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('index.html'));
      if (existing) { existing.focus(); return; }
      self.clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGE FROM APP ──────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'skipWaiting') self.skipWaiting();
});
