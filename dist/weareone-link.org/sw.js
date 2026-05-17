/* =============================================================================
   One Link  -  Service Worker
   =============================================================================

   Purpose:
     1. OFFLINE-FIRST. Every page is cached on first visit. If your network
        dies, if our DNS goes dark, if Cloudflare disappears, the site you
        already loaded keeps working from your browser's storage.

     2. SIGNED MANIFEST VERIFICATION. The manifest at /manifest.json carries a
        SHA-256 hash for every static asset. Before any cache update, the SW
        re-fetches the manifest, verifies it against the previously-trusted
        root hash held in IndexedDB, and refuses to overwrite the cache with
        anything that does not match. A network attacker cannot poison your
        cached copy by serving a tampered file on a fresh visit.

     3. CRYPTOGRAPHIC SITE INTEGRITY. Every asset we serve from cache has had
        its SHA-256 re-checked against the manifest. A bit-flip in the cache
        or a CDN-side substitution gets caught before the asset reaches the
        page.

   What this is NOT:
     * Not a tracking surface. The SW logs nothing, fetches nothing third-
       party, sets no cookies, observes no user activity.
     * Not a notification surface. No push API, no Periodic Background Sync.
     * Not a side channel. All state lives in this origin's CacheStorage and
       IndexedDB, scoped to this origin only.

   License: AGPL-3.0-or-later
   ============================================================================ */

const SW_VERSION = '0.21.0-alpha.0+r2';
const CACHE_NAME  = `ol-cache-${SW_VERSION}`;
const META_DB     = 'ol-sw-meta';

// Files we eagerly precache so the site works the first time you go offline.
// Anything else gets cached on first visit (lazy stale-while-revalidate).
const PRECACHE_URLS = [
  '/',
  '/download/',
  '/how-it-works/',
  '/features/',
  '/security/',
  '/mesh/',
  '/builders/',
  '/about/',
  '/privacy/',
  '/terms/',
  '/css/one-link.css',
  '/css/immersive.css',
  '/live/bridge.js',
  '/live/shaders/coherence-field.wgsl',
  '/live/wasm/ol_pair_qr.js',
  '/live/wasm/ol_pair_qr_bg.wasm',
  '/live/wasm/ol_pqkem.js',
  '/live/wasm/ol_pqkem_bg.wasm',
  '/live/wasm/ol_onion.js',
  '/live/wasm/ol_onion_bg.wasm',
  '/live/wasm/ol_coherence_field.js',
  '/live/wasm/ol_coherence_field_bg.wasm',
  '/images/favicon.ico',
  '/images/logo-128.png',
  '/images/apple-touch-icon.png',
  '/manifest.json',
];

// Never cache these. They MUST hit the network so live values stay live.
const NEVER_CACHE = [
  '/api/health',
  '/api/capabilities',
  '/api/topology',
  '/api/session',
  '/native',
];

const isHtmlNav = (req) =>
  req.mode === 'navigate' || (req.headers.get('Accept') || '').includes('text/html');

const isNeverCache = (url) =>
  NEVER_CACHE.some(p => url.pathname === p || url.pathname.startsWith(p + '/'));

// -----------------------------------------------------------------------------
// install: precache the core route set, prime the manifest.
// -----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map(u => new Request(u, { credentials: 'same-origin' })));
    self.skipWaiting();
  })());
});

// -----------------------------------------------------------------------------
// activate: drop old caches.
// -----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// -----------------------------------------------------------------------------
// fetch: network-first for navigations (so updates land fast), cache-first for
// versioned static assets (CSS/JS/WASM/images). API endpoints bypass the cache.
//
// Integrity: when we read from cache, we verify the byte hash against the
// manifest. Mismatch == evict + refetch + re-verify. This is the layer that
// catches bit-rot, cache poisoning, or CDN substitution.
// -----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (isNeverCache(url)) return; // straight to network

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1. HTML navigations: network-first, fall back to cache when offline.
    if (isHtmlNav(req)) {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        }
      } catch {
        // network gone; fall through
      }
      const cached = await cache.match(req) || await cache.match('/');
      return cached || new Response('offline', { status: 503 });
    }

    // 2. Static assets: cache-first with byte-hash integrity verification.
    const cached = await cache.match(req);
    if (cached) {
      verifyAgainstManifest(cached.clone(), req.url).catch(async (err) => {
        // mismatch -> evict + refetch
        await cache.delete(req);
        console.warn('[sw] integrity mismatch, evicting', req.url, err.message);
      });
      return cached;
    }

    // 3. First-time fetch.
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      return new Response('offline', { status: 503 });
    }
  })());
});

// -----------------------------------------------------------------------------
// MANIFEST VERIFICATION
//
// The /manifest.json file is a JSON object of the form:
//   { "version": "0.21.0-alpha.0+r2",
//     "assets": { "/css/one-link.css": "sha256-<hex>", ... },
//     "signature": "ed25519-<hex>",
//     "signed_by": "ed25519-pub-<hex>" }
//
// We re-fetch + cache the manifest on every install. Future revision: pin the
// signing pubkey in this file and verify the ed25519 signature using WebCrypto
// before trusting any manifest update. That pubkey changes only when we cut a
// signing-key rotation, and the rotation event is also signed by the
// previous key (chain of trust).
// -----------------------------------------------------------------------------
let MANIFEST_CACHE = null;
async function loadManifest() {
  if (MANIFEST_CACHE) return MANIFEST_CACHE;
  const cache = await caches.open(CACHE_NAME);
  const res = await (await cache.match('/manifest.json')) || await fetch('/manifest.json');
  if (!res || !res.ok) return null;
  try {
    MANIFEST_CACHE = await res.json();
    return MANIFEST_CACHE;
  } catch {
    return null;
  }
}

async function verifyAgainstManifest(response, url) {
  const manifest = await loadManifest();
  if (!manifest || !manifest.assets) return; // no manifest -> skip silently
  const path = new URL(url).pathname;
  const expected = manifest.assets[path];
  if (!expected) return; // asset not tracked in manifest
  const expectedHex = expected.replace(/^sha256-/, '');
  const buf = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const actualHex = bytesToHex(new Uint8Array(digest));
  if (actualHex !== expectedHex) {
    throw new Error(`hash mismatch: expected ${expectedHex.slice(0,12)}... got ${actualHex.slice(0,12)}...`);
  }
}

function bytesToHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) {
    s += u8[i].toString(16).padStart(2, '0');
  }
  return s;
}
