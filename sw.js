// ================================================================
//  SERVICE WORKER — Spiritual Breakthrough Chart
//  Victory Outreach Church of Eagle Rock · Pastor Augie Barajas
//
//  What this file does:
//  1. Caches app files so it loads instantly and works offline
//  2. Fires daily push notification reminders
//  3. Handles notification tap → opens the app to Check-In tab
//  4. Handles "Remind Me Later" snooze (re-fires in 1 hour)
//  5. Queues check-ins done offline and syncs when back online
//
//  IMPORTANT: Every time you update index.html or admin.html,
//  bump the CACHE_VERSION number below by 1 so phones clear
//  the old cached version and load your new files.
// ================================================================

const CACHE_VERSION = 'sbc-v3';

// Files to cache for offline use.
// Add any new files you create here.
const CACHED_FILES = [
  './index.html',
  './admin.html',
  './manifest.json',
  './sw.js',
];

// Your Apps Script URL — used for background sync
const API_URL = 'https://script.google.com/macros/s/AKfycbyfEkwKRLvEZ9KPVw95IZTqqLGwlHOKZCXMyjD2W8RvaNVKBONW1cH9rMg8UgVq4X5vtQ/exec';

// IndexedDB name for storing offline check-ins
const OFFLINE_DB  = 'sbc-offline';
const OFFLINE_STORE = 'pending-checkins';


// ================================================================
//  INSTALL — cache all app files
// ================================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        return cache.addAll(CACHED_FILES);
      })
      .then(() => {
        // Take over immediately without waiting for old SW to die
        return self.skipWaiting();
      })
      .catch(err => {
        // Don't block install if caching fails — app still works online
        console.warn('[SW] Cache install failed:', err);
      })
  );
});


// ================================================================
//  ACTIVATE — clean up old cache versions
// ================================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_VERSION)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Take control of all open tabs immediately
        return self.clients.claim();
      })
  );
});


// ================================================================
//  FETCH — serve from cache when offline
//  Strategy: Network first, fall back to cache
//  Skip caching: Google Apps Script API calls (always need live data)
// ================================================================
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never cache API calls — always go to network
  if (url.includes('script.google.com')) return;

  // Never cache Google Fonts or external resources
  if (url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) return;

  // For everything else: try network, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a valid response, update the cache with it
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_VERSION).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            // If it's a navigation request and we have index.html cached, serve that
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});


// ================================================================
//  PUSH NOTIFICATION
//  Triggered when the server sends a push message.
//  For this app, local notifications are also scheduled directly
//  from index.html — this handles server-sent pushes if you
//  add a push server later.
// ================================================================
self.addEventListener('push', event => {
  let payload = {
    title : 'Spiritual Breakthrough Chart',
    body  : "Don't miss today's victory — tap to check in!",
    day   : null,
  };

  // Try to parse JSON payload from server
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch(_) { payload.body = event.data.text() || payload.body; }
  }

  const options = {
    body             : payload.body,
    icon             : './icon-192.png',
    badge            : './icon-96.png',
    tag              : 'sbc-daily-checkin',
    renotify         : true,
    requireInteraction: false,
    vibrate          : [200, 100, 200],
    actions: [
      { action: 'open',  title: '✅ Check In Now'     },
      { action: 'later', title: '🔔 Remind Me Later'  },
    ],
    data: {
      url      : './index.html',
      timestamp: Date.now(),
    },
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});


// ================================================================
//  NOTIFICATION CLICK
//  Handles what happens when user taps a notification or action.
// ================================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // ── "Remind Me Later" — snooze for 1 hour ──
  if (event.action === 'later') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        // Tell the app to reschedule notification in 60 minutes
        clients.forEach(client => {
          client.postMessage({
            type       : 'snooze',
            snoozeMs   : 60 * 60 * 1000, // 1 hour
            triggeredAt: Date.now(),
          });
        });
        // If no app window is open, schedule via SW alarm approach
        if (!clients.length) {
          // Store snooze request — app will pick it up on next open
          storeSnooze();
        }
      })
    );
    return;
  }

  // ── "Check In Now" or tapping notification body ──
  const targetUrl = event.notification.data?.url || './index.html';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // If the app is already open in a tab, focus it
        const appWindow = clients.find(c =>
          c.url.includes('index.html') || c.url.endsWith('/')
        );
        if (appWindow) {
          appWindow.focus();
          // Tell the app to switch to the Check-In tab
          appWindow.postMessage({ type: 'openCheckin' });
          return;
        }
        // App is not open — open it fresh
        return self.clients.openWindow(targetUrl);
      })
  );
});


// ================================================================
//  NOTIFICATION CLOSE
//  Fires when user dismisses notification without tapping it.
//  We don't re-schedule here — the app handles daily scheduling.
// ================================================================
self.addEventListener('notificationclose', event => {
  // Optional: log dismissals for analytics later
  console.log('[SW] Notification dismissed:', event.notification.tag);
});


// ================================================================
//  MESSAGE FROM APP
//  The app sends messages to the SW for various tasks.
// ================================================================
self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  switch(type) {

    // App is requesting the SW to take over immediately
    // (used after updates to reload without waiting)
    case 'skipWaiting':
      self.skipWaiting();
      break;

    // App went offline during check-in — queue it for later
    case 'queueCheckin':
      if (data) saveOfflineCheckin(data);
      break;

    // App came back online — sync any queued check-ins
    case 'syncNow':
      syncOfflineCheckins();
      break;

    // App confirmed user is logged in — clear any snooze flags
    case 'userLoggedIn':
      clearSnooze();
      break;

  }
});


// ================================================================
//  BACKGROUND SYNC
//  When the device comes back online, sync any check-ins
//  that were completed while offline.
// ================================================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-checkins') {
    event.waitUntil(syncOfflineCheckins());
  }
});


// ================================================================
//  OFFLINE CHECK-IN QUEUE
//  Stores check-ins in IndexedDB when offline.
//  Syncs them to Google Sheets when back online.
// ================================================================

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveOfflineCheckin(checkinData) {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).add({
      ...checkinData,
      savedAt: Date.now(),
    });
    console.log('[SW] Offline check-in saved to queue');
  } catch(e) {
    console.error('[SW] Failed to save offline check-in:', e);
  }
}

async function syncOfflineCheckins() {
  try {
    const db    = await openOfflineDB();
    const tx    = db.transaction(OFFLINE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_STORE);

    const getAllReq = store.getAll();
    getAllReq.onsuccess = async () => {
      const pending = getAllReq.result;
      if (!pending.length) return;

      console.log('[SW] Syncing', pending.length, 'offline check-in(s)...');

      for (const item of pending) {
        try {
          const res = await fetch(API_URL, {
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
            // Remove from queue after successful sync
            const delTx = db.transaction(OFFLINE_STORE, 'readwrite');
            delTx.objectStore(OFFLINE_STORE).delete(item.id);
            console.log('[SW] Synced offline check-in for day', item.day);
            // Notify the app that sync succeeded
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach(c => c.postMessage({ type: 'syncComplete', day: item.day }));
          }
        } catch(e) {
          console.warn('[SW] Sync failed for item', item.id, '— will retry later');
        }
      }
    };
  } catch(e) {
    console.error('[SW] syncOfflineCheckins error:', e);
  }
}


// ================================================================
//  SNOOZE HELPERS
//  Stores a snooze request when user dismisses from notification
//  and app isn't open. App reads this on next launch.
// ================================================================

async function storeSnooze() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    const snoozeData = JSON.stringify({
      snoozedAt : Date.now(),
      snoozeMs  : 60 * 60 * 1000,
    });
    cache.put(
      new Request('./snooze-flag'),
      new Response(snoozeData, { headers: { 'Content-Type': 'application/json' } })
    );
  } catch(e) {}
}

async function clearSnooze() {
  try {
    const cache = await caches.open(CACHE_VERSION);
    cache.delete(new Request('./snooze-flag'));
  } catch(e) {}
}
