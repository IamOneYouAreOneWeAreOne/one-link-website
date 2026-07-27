/* =============================================================================
   One Link  -  Service Worker
   =============================================================================

   Purpose:
     1. HASH-GATED OFFLINE CACHE. Tracked pages and assets may be cached after
        their bytes match a manifest authenticated by the pinned Ed25519 key.

     2. SIGNED MANIFEST VERIFICATION. The manifest at /manifest.json carries a
        SHA-256 hash for every static asset. Before any cache update, the SW
        verifies it against the public key pinned in this Worker, and refuses
        to install or update when the signature or any required hash fails.

     3. FAIL-CLOSED CACHE READS. Every response served by this Worker must be
        tracked and hash-matched. Navigations and first-time asset fetches are
        checked too; APIs and sensitive share routes are never cached.

   What this is NOT:
     * Not an analytics surface. It fetches nothing third-party, sets no
       cookies, and sends no telemetry. Diagnostic warnings remain local.
     * Not a notification surface. No push API, no Periodic Background Sync.
     * Not a side channel. All state lives in this origin's CacheStorage and
       CacheStorage, scoped to this origin only.

   License: AGPL-3.0-or-later
   ============================================================================ */

const SW_VERSION = '0.21.0-alpha.0+r99';
const CACHE_NAME  = `ol-cache-${SW_VERSION}`;

// -----------------------------------------------------------------------------
// MANIFEST SIGNING - pinned ed25519 public key.
//
// The /manifest.json file is signed offline with the matching ed25519 private
// key (lives in .keys/manifest-ed25519.sk on the maintainer's box, never on
// any server, never in CI, never in git). Every manifest fetch is verified
// against this pinned key BEFORE any cached-asset hash check is allowed to
// trust it. A network attacker who replaces manifest.json with a tampered
// version cannot forge a signature. A cached manifest is re-verified before
// reuse; absent a valid pinned-key manifest, requests fail closed.
//
// Rotation: the SW pubkey pin is the trust root. To rotate, ship a new SW
// version with the new pubkey AND a transition record signed by the old key;
// the rotation handler is not implemented yet because we have not rotated.
// -----------------------------------------------------------------------------
const MANIFEST_PUBKEY_HEX =
  '79c4c8da1ed485541a03057a588bfd88cd6530b407d524866842ec004498464c';

// Files eagerly precached so the site works on first offline visit.
// LEAN: only the homepage shell + critical CSS/JS + small icons.
// Everything else (WASM bundles, secondary pages, shaders) is cached
// lazily on first request. Every precache and lazy response is hash-gated.
const PRECACHE_URLS = [
  '/',
  '/css/one-link.css',
  '/css/immersive.css',
  '/live/bridge.js',
  '/images/favicon.ico',
  '/images/favicon.svg',
  '/images/logo-128.png',
  '/images/apple-touch-icon.png',
  '/manifest.json',
  '/app.webmanifest',
];

// Never cache these. They MUST hit the network so live values stay live.
const NEVER_CACHE = [
  '/api/health',
  '/api/capabilities',
  '/api/topology',
  '/api/session',
  '/api/share',
  '/api/presence',
  '/api/attest',
  '/download',
  '/share',
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
    await loadManifest();
    for (const url of PRECACHE_URLS) {
      if (url === '/manifest.json') continue;
      const request = new Request(url, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`precache fetch failed (${response.status}): ${url}`);
      await verifyAgainstManifest(response.clone(), request.url);
      await cache.put(request, response);
    }
    self.skipWaiting();
  })());
});

// -----------------------------------------------------------------------------
// activate: drop old caches.
// -----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('ol-cache-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// -----------------------------------------------------------------------------
// fetch: network-first for navigations, cache-first for static assets. Every
// response handled by this Worker is signature/hash gated before it is served.
// API, download, native, and share routes bypass CacheStorage entirely.
// -----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (isNeverCache(url)) return; // straight to network

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    if (url.pathname === '/manifest.json') {
      try {
        const response = await fetch(new Request(req, { cache: 'no-store' }));
        if (!response.ok) throw new Error(`manifest returned ${response.status}`);
        const candidate = await response.clone().json();
        if (!await verifyManifestSignature(candidate)) throw new Error('manifest signature rejected');
        MANIFEST_CACHE = candidate;
        await cache.put('/manifest.json', response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match('/manifest.json');
        if (cached) {
          const candidate = await cached.clone().json();
          if (await verifyManifestSignature(candidate)) {
            MANIFEST_CACHE = candidate;
            return cached;
          }
        }
        return integrityFailure(error);
      }
    }

    // 1. HTML navigations: verify network bytes before returning or caching;
    //    if offline, return only a still-valid verified cache entry.
    if (isHtmlNav(req)) {
      try {
        const fresh = await fetch(new Request(req, { cache: 'no-store' }));
        if (fresh && (fresh.ok || fresh.status === 404)) {
          await verifyAgainstManifest(fresh.clone(), req.url);
          await cache.put(req, fresh.clone());
          return fresh;
        }
        throw new Error(`navigation returned ${fresh?.status || 'no response'}`);
      } catch (networkError) {
        const cached = await cache.match(req) || (url.pathname === '/' ? await cache.match('/') : null);
        if (cached) {
          try {
            await verifyAgainstManifest(cached.clone(), req.url);
            return cached;
          } catch {
            await cache.delete(req);
          }
        }
        return integrityFailure(networkError);
      }
    }

    // 2. Static assets: cache-first WITH SYNCHRONOUS integrity verification.
    //    If the cached bytes pass the manifest hash check, serve them.
    //    If they fail (stale-cache after a deploy), evict + refetch INLINE
    //    so the visitor never sees a broken page from a stale asset.
    const cached = await cache.match(req);
    if (cached) {
      try {
        await verifyAgainstManifest(cached.clone(), req.url);
        return cached;
      } catch (err) {
        console.warn('[sw] cached integrity mismatch, evicting + refetching', req.url, err.message);
        await cache.delete(req);
        // fall through to network refetch below
      }
    }

    // 3. First-time fetch OR refetch after stale eviction. Never expose the
    //    network response until its bytes match a tracked manifest entry.
    try {
      const fresh = await fetch(new Request(req, { cache: 'no-store' }));
      if (!fresh || !fresh.ok) throw new Error(`asset returned ${fresh?.status || 'no response'}`);
      await verifyAgainstManifest(fresh.clone(), req.url);
      await cache.put(req, fresh.clone());
      return fresh;
    } catch (error) {
      return integrityFailure(error);
    }
  })());
});

function integrityFailure(error) {
  console.warn('[sw] fail-closed integrity gate:', error?.message || error);
  return new Response('site integrity verification unavailable', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// -----------------------------------------------------------------------------
// MANIFEST VERIFICATION
//
// /manifest.json shape:
//   { "version": "0.21.0-alpha.0+rN",
//     "assets": { "/css/one-link.css": "sha256-<hex>", ... },
//     "signature": "ed25519-<128-hex>",
//     "signed_by": "ed25519-pub-<64-hex>",
//     "signed_sha256": "sha256-<64-hex>",
//     "sig_payload_spec": "json({version, assets}) with sorted keys..." }
//
// Verification (every load):
//   1. Pubkey in manifest MUST match MANIFEST_PUBKEY_HEX above. If not, the
//      manifest is treated as unsigned and rejected.
//   2. Reconstruct the canonical signing payload: JSON of {version, assets}
//      with sorted asset keys, no whitespace.
//   3. ed25519.verify(signature, payload, pinned_pubkey) MUST pass.
//   4. Only if all three pass do we trust manifest.assets to gate cached
//      asset hashes.
//
// A cached manifest is not trusted merely because it was cached: every Worker
// lifecycle verifies it against the hardcoded key again. If no valid manifest
// exists, all cache-managed content requests fail closed.
// -----------------------------------------------------------------------------
let MANIFEST_CACHE = null;          // currently-trusted manifest (post-verify)
let MANIFEST_FETCH_INFLIGHT = null; // dedupe concurrent verifications

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[a-f0-9]+$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.substr(i, 2), 16);
    if (Number.isNaN(b)) return null;
    out[i / 2] = b;
  }
  return out;
}

function bytesToHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) {
    s += u8[i].toString(16).padStart(2, '0');
  }
  return s;
}

// Canonical signing payload  -  must byte-match what scripts/sign-manifest.py
// produces. Python uses json.dumps(payload, sort_keys=True, separators=(',',':')),
// which sorts ALL keys recursively. We mirror that here: top-level keys are
// emitted in sorted order ("assets" before "version") and asset keys are
// sorted before serialisation.
function canonicalSigPayload(manifest) {
  const assets = manifest.assets || {};
  const sortedAssets = {};
  for (const k of Object.keys(assets).sort()) sortedAssets[k] = assets[k];
  // Build object with keys in sorted order: "assets" < "version".
  const payload = { assets: sortedAssets, version: manifest.version || '' };
  return JSON.stringify(payload);
  // JSON.stringify with no replacer/indent emits no whitespace, matching
  // Python's separators=(',',':').
}

async function verifyManifestSignature(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  if (typeof manifest.version !== 'string' || manifest.version.length < 1 || manifest.version.length > 128) {
    return false;
  }
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    return false;
  }
  const entries = Object.entries(manifest.assets);
  if (entries.length < 1 || entries.length > 2_000) return false;
  for (const [path, digest] of entries) {
    if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(path)
        || path.includes('..')
        || typeof digest !== 'string'
        || !/^sha256-[a-f0-9]{64}$/.test(digest)) return false;
  }

  const signedBy = manifest.signed_by || '';
  const sigField = manifest.signature || '';
  if (!signedBy.startsWith('ed25519-pub-') || !sigField.startsWith('ed25519-')) {
    return false;
  }
  const declaredPubHex = signedBy.slice('ed25519-pub-'.length);
  if (declaredPubHex.toLowerCase() !== MANIFEST_PUBKEY_HEX.toLowerCase()) {
    console.warn('[sw] manifest declares pubkey that does not match pinned root');
    return false;
  }

  const sigHex = sigField.slice('ed25519-'.length);
  const sigBytes = hexToBytes(sigHex);
  const pubBytes = hexToBytes(MANIFEST_PUBKEY_HEX);
  if (!sigBytes || sigBytes.length !== 64 || !pubBytes || pubBytes.length !== 32) {
    return false;
  }

  const payload = new TextEncoder().encode(canonicalSigPayload(manifest));

  try {
    // Path A: WebCrypto Ed25519 (Chromium 113+, Safari 17+, Firefox 130+).
    const key = await crypto.subtle.importKey(
      'raw', pubBytes, { name: 'Ed25519' }, false, ['verify']
    );
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, payload);
  } catch (e) {
    // Path B: older browsers without Ed25519 in WebCrypto. We do NOT ship a
    // pure-JS fallback. Without native Ed25519 this Worker refuses to install
    // or serve cache-managed content; it never degrades to an unsigned cache.
    console.warn('[sw] WebCrypto Ed25519 unavailable; integrity gate remains closed:', e?.message || e);
    return false;
  }
}

async function loadManifest() {
  if (MANIFEST_CACHE) return MANIFEST_CACHE;
  if (MANIFEST_FETCH_INFLIGHT) return MANIFEST_FETCH_INFLIGHT;

  MANIFEST_FETCH_INFLIGHT = (async () => {
    const cache = await caches.open(CACHE_NAME);

    // Always re-fetch from network when possible. Cache only after signature
    // verification; fall back to a cached copy that is re-verified below.
    let candidate = null;
    let freshResponse = null;
    try {
      const fresh = await fetch('/manifest.json', { cache: 'no-store' });
      if (fresh && fresh.ok) {
        freshResponse = fresh.clone();
        candidate = await fresh.json();
      }
    } catch {
      // network gone
    }
    if (!candidate) {
      try {
        const cached = await cache.match('/manifest.json');
        if (cached) candidate = await cached.json();
      } catch {}
    }
    if (!candidate) return null;

    const ok = await verifyManifestSignature(candidate);
    if (!ok) {
      console.warn('[sw] manifest signature verification FAILED, refusing to trust assets dict');
      return null;
    }
    if (freshResponse) await cache.put('/manifest.json', freshResponse);
    MANIFEST_CACHE = candidate;
    return MANIFEST_CACHE;
  })();

  try {
    return await MANIFEST_FETCH_INFLIGHT;
  } finally {
    MANIFEST_FETCH_INFLIGHT = null;
  }
}

async function verifyAgainstManifest(response, url) {
  const manifest = await loadManifest();
  if (!manifest || !manifest.assets) throw new Error('no trusted site manifest');
  const requestPath = new URL(url).pathname;
  let path = requestPath;
  if (response.status === 404) {
    const locale = requestPath.match(/^\/(es|fr|de|pt|it)(?:\/|$)/)?.[1];
    path = locale ? `/${locale}/404.html` : '/404.html';
  } else if (requestPath === '/') {
    path = '/index.html';
  } else if (requestPath.endsWith('/')) {
    path = `${requestPath}index.html`;
  }
  const expected = manifest.assets[path];
  if (!expected || !/^sha256-[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`asset is not tracked by the signed manifest: ${path}`);
  }
  const expectedHex = expected.replace(/^sha256-/, '');
  const buf = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const actualHex = bytesToHex(new Uint8Array(digest));
  if (actualHex !== expectedHex) {
    throw new Error(`hash mismatch: expected ${expectedHex.slice(0,12)}... got ${actualHex.slice(0,12)}...`);
  }
}
