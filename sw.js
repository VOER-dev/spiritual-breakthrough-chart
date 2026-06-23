// ================================================================
//  SERVICE WORKER — Spiritual Breakthrough Chart
//  Victory Outreach Church of Eagle Rock · Pastor Augie Barajas
//
//  VERSION: sbc-v4
//  Updated: Added congratulations flow support, offline check-in
//           queue, 1-hour snooze, and background sync.
//
//  BUMP THE VERSION NUMBER BELOW every time you update
//  index.html or admin.html so phones load the new files.
// ================================================================

const CACHE_VERSION = 'sbc-v5';

const CACHED_FILES = [
  './index.html',
  './admin.html',
  './manifest.json',
  './sw.js',
];

// Apps Script URL for background sync
const API_URL = 'https://script.google.com/macros/s/AKfycbyfEkwKRLvEZ9KPVw95IZTqqLGwlHOKZCXMyjD2W8RvaNVKBONW1cH9rMg8UgVq4X5vtQ/exec';

// IndexedDB store for offline check-ins
const OFFLINE_DB    = 'sbc-offline';
const OFFLINE_STORE = 'pending-checkins';


// ================================================================
//  INSTALL — cache all app files for offline use
// ================================================================
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CACHED_FILES))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install failed (app still works online):', err))
  );
});


// ================================================================
//  ACTIVATE — delete old cache versions so phones get fresh files
// ================================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => { console.log('[SW] Removing old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});


// ================================================================
//  FETCH — network first, cache fallback
//  Never cache: Google Apps Script API or external fonts
// ================================================================
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Skip: API calls, Google Fonts, chrome-extension, data: URLs
  if (
    url.includes('script.google.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com') ||
    url.startsWith('chrome-extension') ||
    url.startsWith('data:')
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache valid responses for offline use
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Navigation fallback — serve index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline — please check your connection.', { status: 503 });
        })
      )
  );
});


// ================================================================
//  PUSH NOTIFICATION
//  Handles server-sent pushes (used if you add a push server later).
//  Local daily reminders are scheduled directly in index.html.
// ================================================================
self.addEventListener('push', event => {
  let payload = {
    title: 'Spiritual Breakthrough Chart',
    body : "Don't miss today's victory — tap to check in!",
  };

  if (event.data) {
    try   { payload = { ...payload, ...event.data.json() }; }
    catch (_) { payload.body = event.data.text() || payload.body; }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body             : payload.body,
      icon             : './icon-192.png',
      badge            : './icon-96.png',
      tag              : 'sbc-daily',
      renotify         : true,
      requireInteraction: false,
      vibrate          : [200, 100, 200],
      actions: [
        { action: 'open',  title: '✅ Check In Now'    },
        { action: 'later', title: '🔔 Remind Me Later' },
      ],
      data: { url: './index.html', timestamp: Date.now() },
    })
  );
});


// ================================================================
//  NOTIFICATION CLICK
// ================================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // ── Snooze: Remind Me Later ──────────────────────────────
  if (event.action === 'later') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) {
          // App is open — tell it to reschedule in 1 hour
          clients.forEach(c => c.postMessage({
            type     : 'snooze',
            snoozeMs : 60 * 60 * 1000,
          }));
        } else {
          // App is closed — store snooze flag, app reads it on next open
          storeSnoozeFlag();
        }
      })
    );
    return;
  }

  // ── Open: Check In Now or tap on notification body ────────
  const targetUrl = event.notification.data?.url || './index.html';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const appWindow = clients.find(c =>
          c.url.includes('index.html') || c.url.endsWith('/')
        );
        if (appWindow) {
          appWindow.focus();
          // Tell app to switch to Check-In tab
          appWindow.postMessage({ type: 'openCheckin' });
        } else {
          // Open fresh
          self.clients.openWindow(targetUrl);
        }
      })
  );
});


// ================================================================
//  NOTIFICATION CLOSE (dismissed without tapping)
// ================================================================
self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification dismissed:', event.notification.tag);
});


// ================================================================
//  MESSAGES FROM index.html
// ================================================================
self.addEventListener('message', event => {
  const msg = event.data || {};

  switch (msg.type) {

    // Force SW to take over immediately after an update
    case 'skipWaiting':
      self.skipWaiting();
      break;

    // App completed Day 31 — fire a congratulations notification
    case 'day31Complete':
      self.registration.showNotification('🏆 31 Days of Victory!', {
        body   : `${msg.name || 'You'} completed the Spiritual Breakthrough Challenge!`,
        icon   : './icon-192.png',
        tag    : 'sbc-complete',
        actions: [{ action: 'open', title: '🎉 See My Results' }],
        data   : { url: './index.html' },
      });
      break;

    // App went offline during check-in — save it for later
    case 'queueCheckin':
      if (msg.data) saveOfflineCheckin(msg.data);
      break;

    // App is back online — sync any queued check-ins
    case 'syncNow':
      syncOfflineCheckins();
      break;

    // User started a new round — clear snooze flags
    case 'newRoundStarted':
    case 'userLoggedIn':
      clearSnoozeFlag();
      break;
  }
});


// ================================================================
//  BACKGROUND SYNC
//  Fires when device reconnects to internet.
// ================================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-checkins') {
    event.waitUntil(syncOfflineCheckins());
  }
});


// ================================================================
//  OFFLINE CHECK-IN QUEUE (IndexedDB)
// ================================================================

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(OFFLINE_STORE)) {
        e.target.result.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveOfflineCheckin(data) {
  try {
    const db = await openOfflineDB();
    db.transaction(OFFLINE_STORE, 'readwrite')
      .objectStore(OFFLINE_STORE)
      .add({ ...data, savedAt: Date.now() });
    console.log('[SW] Offline check-in queued for day', data.day);
  } catch(e) {
    console.error('[SW] Failed to queue offline check-in:', e);
  }
}

async function syncOfflineCheckins() {
  try {
    const db    = await openOfflineDB();
    const store = db.transaction(OFFLINE_STORE, 'readwrite').objectStore(OFFLINE_STORE);
    const all   = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });

    if (!all.length) return;
    console.log('[SW] Syncing', all.length, 'offline check-in(s)...');

    for (const item of all) {
      try {
        const res  = await fetch(API_URL, {
          method : 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body   : JSON.stringify({
            action : 'submitCheckin',
            email  : item.email,
            day    : item.day,
            date   : item.date,
            answers: item.answers,
          }),
        });
        const json = await res.json();
        if (json.success) {
          // Remove from queue
          const delDB = await openOfflineDB();
          delDB.transaction(OFFLINE_STORE, 'readwrite').objectStore(OFFLINE_STORE).delete(item.id);
          console.log('[SW] Synced day', item.day, 'for', item.email);
          // Tell app
          const clients = await self.clients.matchAll({ type: 'window' });
          clients.forEach(c => c.postMessage({ type: 'syncComplete', day: item.day }));
        }
      } catch(e) {
        console.warn('[SW] Sync failed for item', item.id, '— will retry');
      }
    }
  } catch(e) {
    console.error('[SW] syncOfflineCheckins error:', e);
  }
}


// ================================================================
//  SNOOZE FLAG (stored in Cache API so it survives SW restarts)
// ================================================================

async function storeSnoozeFlag() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(
      new Request('./snooze-flag'),
      new Response(JSON.stringify({ snoozedAt: Date.now(), snoozeMs: 3600000 }),
        { headers: { 'Content-Type': 'application/json' } })
    );
    console.log('[SW] Snooze flag stored');
  } catch(e) {}
}

async function clearSnoozeFlag() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.delete(new Request('./snooze-flag'));
  } catch(e) {}
}
