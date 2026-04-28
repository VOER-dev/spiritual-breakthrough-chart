// ═══════════════════════════════════════════════════════
// SERVICE WORKER — Spiritual Breakthrough Chart
// Handles push notifications + offline caching
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'sbc-v1';
const ASSETS = ['/', '/index.html'];

// ── INSTALL ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
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

// ── FETCH (offline support) ───────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── PUSH NOTIFICATION ────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Spiritual Breakthrough', body: "Time for your daily check-in! Don't miss today's victory." };
  try { data = e.data.json(); } catch(_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-96.png',
      tag: 'daily-checkin',
      renotify: true,
      requireInteraction: false,
      actions: [
        { action: 'checkin', title: 'Check In Now' },
        { action: 'later', title: 'Remind Me Later' }
      ],
      data: { url: '/index.html#checkin' }
    })
  );
});

// ── NOTIFICATION CLICK ───────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/index.html';

  if (e.action === 'later') {
    // Re-schedule in 1 hour via setTimeout in client
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) clients[0].postMessage({ type: 'snooze' });
      })
    );
    return;
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('index.html'));
      if (existing) { existing.focus(); existing.navigate(url); }
      else self.clients.openWindow(url);
    })
  );
});

// ── SCHEDULED NOTIFICATION (via postMessage from app) ─
self.addEventListener('message', e => {
  if (e.data?.type === 'scheduleDaily') {
    // This is handled by the app's JS scheduler
    // SW just responds to confirm receipt
    e.source?.postMessage({ type: 'scheduled', time: e.data.time });
  }
});
