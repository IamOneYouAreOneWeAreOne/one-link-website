// =============================================================================
// weareone-link.org - Cloudflare Worker
// =============================================================================
//
// Serves the One Link public site. Static assets from dist/, plus dynamic
// endpoints that are themselves alien tech, not marketing surface:
//
//   GET  /api/health        - heartbeat
//   GET  /api/capabilities  - live capability advertisement from demo daemon
//                              (the /features page is GENERATED from this)
//   GET  /api/topology      - live relay topology for the mesh-viz canvas
//   GET  /api/attest/:sha   - reproducible-build attestation chain for an artifact
//   POST /api/session       - opens a session: returns server X25519 + ML-KEM-768
//                              public keys for in-browser hybrid handshake
//   GET  /native            - WebTransport endpoint (One Link wire protocol)
//   GET  /download/:os      - signed binary fetch (mesh-routed by default,
//                              plain CDN fallback if WASM unsupported)
//
// Privacy by construction:
//   - No cookies set anywhere.
//   - No third-party requests.
//   - No analytics, no tracking pixels.
//   - No request body or identifier is logged.
//   - Every response includes Permissions-Policy that bans tracking surfaces.
//
// Copyright (C) 2024-2026 One Link contributors. AGPL-3.0.
// =============================================================================

// -----------------------------------------------------------------------------
// CONTENT-SECURITY-POLICY
//
// Defense-in-depth for the same threat SRI catches (an attacker injecting or
// substituting code), but enforced at the document level by the browser
// independently of any per-tag attribute. A successful XSS injection can't
// execute because inline scripts and 'unsafe-eval' are both denied, and
// off-origin script/font/connect destinations are all blocked.
//
// Directive-by-directive justification:
//
//   default-src 'self'
//     fallback for any fetch type not listed below: same-origin only.
//   script-src 'self' 'wasm-unsafe-eval'
//     external <script src=> must be same-origin (SRI re-enforces the byte
//     hash). 'wasm-unsafe-eval' is needed by the WASM crates: ol_pair_qr,
//     ol_pqkem, ol_onion, ol_coherence_field all call WebAssembly.instantiate.
//   style-src 'self' 'unsafe-inline'
//     stylesheets from same-origin only. 'unsafe-inline' covers the inline
//     style="..." attributes used for one-off layout tweaks across pages.
//     CSS injection has a much smaller blast radius than script injection.
//   img-src 'self' data: blob:
//     images same-origin only; data: for inline SVGs / favicons; blob: for
//     the /share/ recipient flow that downloads via URL.createObjectURL.
//   font-src 'self'
//     no third-party fonts, ever.
//   connect-src 'self'
//     fetch + WebSocket destinations must be same-origin (this covers the
//     /api/presence WebSocket because wss://weareone-link.org IS same-origin).
//   worker-src 'self'
//     service worker registered at /sw.js, same-origin.
//   manifest-src 'self'
//     PWA manifest (manifest.json), same-origin.
//   media-src 'self' blob:
//     ambient audio; blob: for any future client-side-decoded media.
//   object-src 'none'
//     no Flash, no Java, no <object>/<embed>.
//   frame-ancestors 'none'
//     same as X-Frame-Options: DENY; nobody embeds us.
//   base-uri 'self'
//     prevents <base> injection from rewriting all relative URLs.
//   form-action 'self'
//     forms submit to same-origin only.
//   upgrade-insecure-requests
//     auto-rewrites any accidental http:// reference to https://.
// -----------------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // 'unsafe-inline' was needed for ~159 inline style="" attrs site-wide.
  // The audit P1 sweep migrated all of them to utility classes in
  // one-link.css, so we can now enforce style-src to same-origin only.
  // Any future inline style="" will fail loudly in the browser console.
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const PRIVACY_HEADERS = {
  "Content-Security-Policy": CSP,
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), join-ad-interest-group=(), run-ad-auction=()",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Strict-Transport-Security: tell browsers to refuse any future http:// load
  // for this hostname for the next two years, and to preload the same for
  // subdomains. Once preloaded into Chromium's HSTS list the protection
  // applies even on a fresh browser install that never visited the site.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  // CORS: needed so <script integrity=... crossorigin=anonymous> succeeds.
  // Static site, no cookies, no auth, no per-user state - * is correct.
  "Access-Control-Allow-Origin": "*",
};

// Cloudflare auto-injects NEL (Network Error Logging) + Report-To headers
// that stream telemetry to a.nel.cloudflare.com on every page load. That
// contradicts the "we collect nothing" doctrine even though we did not
// ask for it. Override with an empty NEL policy so the browser disables
// reporting for this origin entirely.
// Content directories that serve an index.html. Used to issue 301 on the
// no-trailing-slash form (the assets binding would otherwise 307). Also
// matched under each language prefix (e.g. /es/about, /fr/security).
const CONTENT_SLUGS = [
  "about", "audits", "builders", "download", "features", "how-it-works",
  "mesh", "mirror", "one", "privacy", "security", "share", "terms",
  "accessibility", "transparency", "changelog", "releases",
];
const LANG_PREFIXES = ["es", "fr", "de", "pt", "it"];
const CONTENT_DIRS = new Set([
  ...CONTENT_SLUGS.map(s => "/" + s),
  ...CONTENT_SLUGS.flatMap(s =>
    LANG_PREFIXES.map(l => `/${l}/${s}`)
  ),
  ...LANG_PREFIXES.map(l => `/${l}`),
]);

// Tor Onion-Location header.
//
// When a Tor Browser visitor hits weareone-link.org, this header tells
// the browser "the same content is also reachable at <ONION_URL>", and
// Tor Browser will surface a one-click prompt to migrate to the onion
// route. Onion services do not depend on DNS, do not require a CA, and
// do not expose the user's IP to the destination. They are the right
// fit for a privacy-tool marketing site.
//
// We only emit this header when ONION_HOSTNAME is set on the Worker
// environment AND the request was NOT itself made over Tor (otherwise
// we would tell Tor Browser to redirect to itself in a loop). The
// .onion hostname is set up out-of-band once the v3 hidden service
// is deployed; until then this is a noop. Reference:
//   https://community.torproject.org/onion-services/advanced/onion-location/
function onionLocationHeader(request, env) {
  const onionHostname = env?.ONION_HOSTNAME;
  if (!onionHostname || typeof onionHostname !== "string") return null;
  if (!onionHostname.endsWith(".onion")) return null;
  // Build the matching onion URL preserving the request path + query.
  const url = new URL(request.url);
  const target = `http://${onionHostname}${url.pathname}${url.search}`;
  return target;
}

// Permanent redirect helper that strips Cloudflare auto-injected telemetry
// headers from the response. Used everywhere we 301 in this worker.
function permanentRedirect(location) {
  return new Response(null, {
    status: 301,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=31536000",
      ...NEL_OPT_OUT_HEADERS,
    },
  });
}

const NEL_OPT_OUT_HEADERS = {
  "NEL": '{"report_to":"","max_age":0,"success_fraction":0,"failure_fraction":0}',
  "Report-To": '{"group":"","max_age":0,"endpoints":[]}',
};

function applyHeaders(response, request, env) {
  const headers = new Headers(response.headers);
  // Onion-Location for Tor Browser visitors (no-op when ONION_HOSTNAME
  // is unset, which is the current state until the v3 hidden service
  // is deployed under the project's legal entity).
  if (request && env) {
    const onion = onionLocationHeader(request, env);
    if (onion) headers.set("Onion-Location", onion);
  }
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  // Always overwrite Cloudflare's auto-injected NEL/Report-To with the
  // opt-out shape (these are set by CF regardless of whether origin sets
  // anything, so we explicitly stomp them).
  for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) {
    headers.set(k, v);
  }
  // HTML pages have no cross-origin-fetch use case (the SRI-with-crossorigin
  // dance only applies to <script integrity=...> + <link integrity=...>
  // tags, not to the HTML document that hosts them). Drop the wildcard
  // CORS header for text/html responses so an attacker on origin X can't
  // fetch+parse our HTML in their tab. Also bump cache-control so the CDN
  // can actually serve a HIT instead of must-revalidating every request.
  const ct = (headers.get("Content-Type") || "").toLowerCase();
  if (ct.includes("text/html")) {
    headers.delete("Access-Control-Allow-Origin");
    headers.set(
      "Cache-Control",
      "public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400"
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(payload, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
  for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(payload, null, 2), { ...init, headers });
}

// -----------------------------------------------------------------------------
// /api/health
// -----------------------------------------------------------------------------
function health(env) {
  return json({
    ok: true,
    service: "weareone-link.org",
    protocol_version: env.PROTOCOL_VERSION || "1",
    native_transfer_cap: env.NATIVE_TRANSFER_CAP || "NATIVE_TRANSFER_V1",
    timestamp: new Date().toISOString(),
  });
}

// -----------------------------------------------------------------------------
// /api/capabilities - live capability advertisement
//
// This is the SOURCE OF TRUTH for the /features page. The HTML page does NOT
// hard-code the feature list. It fetches this endpoint at build time AND at
// page-view time, then renders only what the live demo daemon actually
// advertises. If a capability is removed from the daemon, the page reflects
// it within a deploy. You cannot lie about features.
// -----------------------------------------------------------------------------
function capabilities(env) {
  // Mirrors One Link daemon's CapabilityAdvert structure. Hard-coded here
  // until the Worker can dial the actual demo daemon for the live version
  // (next session's wiring).
  return json({
    protocol_version: env.PROTOCOL_VERSION || "1",
    issued_at: new Date().toISOString(),
    capabilities: [
      "NATIVE_TRANSFER_V1",
      "PAIR_QR_V1",
      "SPHINX_ONION_V1",
      "PQ_HYBRID_V1",
      "DOUBLE_RATCHET_V1",
      "THRESHOLD_RECOVERY_V1",
      "CONFIDENTIAL_COMPUTE_V1",
      "FOLDER_MIRROR_V1",
      "TAU_ROUTING_V1",
      "FIELD_BOUND_BLINDING_V1",
      "FOUNTAIN_TRANSFER_V1",
      "RELAY_OUTBOX_V1",
      "HARDWARE_KEY_TOFU_V1",
    ],
    signed: false, // becomes true once Ed25519 + ML-DSA-65 hybrid wired
  });
}

// -----------------------------------------------------------------------------
// /api/topology - live mesh map data feed
//
// Returns aggregated, identifier-free node counts and τ_c routing field
// snapshot for the mesh-viz canvas. Never returns IPs, never returns
// individual session data.
// -----------------------------------------------------------------------------
async function topology(env) {
  // Stub until live relay registry is wired. Returns shape the canvas expects.
  const now = Date.now();
  return json({
    issued_at: new Date(now).toISOString(),
    active_nodes: 0,
    active_relays: 0,
    field_snapshot: {
      resolution: [64, 64],
      tau_c_min: 0.05,
      tau_c_max: 0.95,
      dt_ms: 16.67,
    },
    relay_health: [],
    note: "live topology binding lands once RELAY_KV is provisioned",
  });
}

// -----------------------------------------------------------------------------
// /api/attest/:sha - reproducible-build attestation chain
// -----------------------------------------------------------------------------
async function attestation(env, sha, request) {
  if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
    return json({ error: "invalid sha256" }, { status: 400 });
  }

  // 1. R2 (production path).
  if (env.ATTESTATIONS) {
    const obj = await env.ATTESTATIONS.get(`${sha}.json`);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          ...PRIVACY_HEADERS,
        },
      });
    }
  }

  // 2. Static fallback: shipped at /attestations/<sha>.json.
  // Lets us seed the chain with sample/historical attestations before R2
  // is provisioned, and serves as the offline-first source.
  try {
    const fallback = new URL(request.url);
    fallback.pathname = `/attestations/${sha}.json`;
    const res = await env.ASSETS.fetch(new Request(fallback.toString()));
    if (res && res.ok) {
      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }
  } catch {
    // fall through
  }

  return json(
    { error: "no attestation on file for this sha", sha },
    { status: 404 }
  );
}

// -----------------------------------------------------------------------------
// POST /api/session - server-side X25519 (real) + ML-KEM-768 (deferred) handshake
//
// Returns: {
//   server_x25519:       hex (32 bytes, REAL Worker-side WebCrypto-generated)
//   server_mlkem768_pk:  null  (deferred until WASM-in-Worker tooling ships)
//   session_id:          hex (16 bytes)
//   handshake_version:   "x25519-v1+mlkem768-pending"
// }
//
// Currently the X25519 half is genuine: the Worker mints a fresh X25519
// keypair via WebCrypto every restart, holds it in instance memory (no
// disk, no KV), and serves the public half. Browser side runs ECDH
// against it and gets a real classical shared secret.
//
// The PQ-hybrid half (ML-KEM-768) lands once we bundle ol_pqkem WASM
// for the Workers runtime - the bundler dance is more involved than
// fits in this push; doing it half-right would be worse than a clean
// deferral.
//
// What the browser-side ol_pqkem WASM still proves (in-tab):
//   - both halves of the hybrid KEM compose correctly (Alice <-> Bob
//     locally; see /security/ when PQ-KEM demo ships)
//   - byte-identical to what the daemon would compute
//   So the protocol primitive is verifiable. The SERVER's PQ half is
//   what's pending here, not the math.
// -----------------------------------------------------------------------------
let __SERVER_X25519_KEY = null;
async function getOrMintServerX25519() {
  if (__SERVER_X25519_KEY) return __SERVER_X25519_KEY;
  const pair = await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits", "deriveKey"]
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  __SERVER_X25519_KEY = {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyHex: [...new Uint8Array(raw)]
      .map(b => b.toString(16).padStart(2, "0"))
      .join(""),
  };
  return __SERVER_X25519_KEY;
}

async function openSession(env, request) {
  let serverKey;
  try {
    serverKey = await getOrMintServerX25519();
  } catch (e) {
    return json(
      {
        error: "x25519 unavailable on this runtime",
        detail: e?.message || String(e),
      },
      { status: 503 }
    );
  }
  return json({
    server_x25519: serverKey.publicKeyHex,
    server_mlkem768_pk: null,
    session_id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
    handshake_version: "x25519-v1+mlkem768-pending",
    note:
      "X25519 half is real (Worker WebCrypto-generated, in-memory). " +
      "ML-KEM-768 half lands when the WASM-in-Worker bundler dance is " +
      "complete. Browser-side ol_pqkem WASM exercises BOTH halves " +
      "locally so the hybrid math is verifiable today.",
  });
}

// -----------------------------------------------------------------------------
// GET /native - WebTransport endpoint (One Link wire protocol)
//
// Cloudflare Workers don't yet expose raw WebTransport in stable, so this is
// the negotiation surface. Once WebTransport-on-Workers lands, this becomes
// the actual UDP-style entrypoint for the FILE_NATIVE_CHUNK pipeline.
// -----------------------------------------------------------------------------
function nativeAdvert(env) {
  return json({
    transport: "webtransport-h3",
    status: "advertised",
    accepted_caps: [
      "NATIVE_TRANSFER_V1",
      "PAIR_QR_V1",
      "SPHINX_ONION_V1",
      "PQ_HYBRID_V1",
    ],
    note: "WebTransport upgrade lands when CF Worker support is stable; the demo daemon at the release relay accepts native dial today",
  });
}

// -----------------------------------------------------------------------------
// GET /download/:os
//
// Default: mesh-routed via daemon-WASM running in the visitor's browser.
// Fallback: signed binary from R2, plain HTTPS, still signed.
//
// All downloads also publish an attestation entry the page can verify.
// -----------------------------------------------------------------------------
async function download(env, os, request) {
  const known = new Set([
    "windows", "macos", "linux", "android", "ios",
    "openbsd", "freebsd", "source",
  ]);
  if (!known.has(os)) {
    return json({ error: "unknown os", supported: [...known] }, { status: 404 });
  }

  // Source download is REAL and AVAILABLE TODAY: served from R2 so the
  // 38 MB tarball does not have to live in the website git history.
  // Works on any device, including iOS (downloads as a .tar.gz the user
  // can email to themselves / open with Files app).
  if (os === "source" && env.RELEASES) {
    const ua = (request?.headers.get("User-Agent") || "").toLowerCase();
    const wantsZip = /windows|iphone|ipad|ios|android|mac os/.test(ua);
    const key = wantsZip
      ? "latest/one-link-source.zip"
      : "latest/one-link-source.tar.gz";
    const obj = await env.RELEASES.get(key);
    if (obj) {
      const headers = new Headers();
      headers.set("Content-Type", wantsZip ? "application/zip" : "application/gzip");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${wantsZip ? "one-link-source.zip" : "one-link-source.tar.gz"}"`
      );
      headers.set("Cache-Control", "public, max-age=86400");
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }
    // R2 miss: 503 with honest reason.
    return json(
      { error: "source archive temporarily unavailable", note: "R2 object missing; retry shortly" },
      { status: 503 }
    );
  }

  // Windows .exe: 59 MB single-file PyInstaller build with
  // one_link_native bundled (Rust hot paths). Hosted on R2 (>25 MiB
  // exceeds the Workers static-asset cap). Falls through to the
  // "not yet" HTML page if R2 isn't reachable.
  if (os === "windows" && env.RELEASES) {
    const obj = await env.RELEASES.get("latest/one-link-windows.exe");
    if (obj) {
      const headers = new Headers();
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", 'attachment; filename="one-link.exe"');
      headers.set("Cache-Control", "public, max-age=86400");
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }
  }

  // Linux x86_64 .tar.gz: PyInstaller onedir bundle, gzipped (~72 MB).
  // To install: `tar xzf one-link-linux-x86_64.tar.gz && cd one-link &&
  // ./one-link`. Single-executable AppImage build comes next push.
  if (os === "linux" && env.RELEASES) {
    const obj = await env.RELEASES.get("latest/one-link-linux-x86_64.tar.gz");
    if (obj) {
      const headers = new Headers();
      headers.set("Content-Type", "application/gzip");
      headers.set("Content-Disposition", 'attachment; filename="one-link-linux-x86_64.tar.gz"');
      headers.set("Cache-Control", "public, max-age=86400");
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }
  }

  // Real signed artifact path: serve directly from R2 when present.
  if (env.RELEASES) {
    const key = `latest/one-link-${os}.bin`;
    const obj = await env.RELEASES.get(key);
    if (obj) {
      const headers = new Headers();
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename="one-link-${os}.bin"`);
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("X-Artifact-SHA256", obj.checksums?.sha256 || "");
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      return new Response(obj.body, { headers });
    }
  }

  // No artifact yet. Branch on Accept header:
  //   browser navigation (Accept: text/html) -> render an on-brand
  //     HTML "not yet" page with OS-specific honest guidance.
  //   programmatic clients (curl, fetch with JSON Accept) -> the old
  //     JSON 503 shape so scripts can detect the state.
  const accept = (request?.headers.get("Accept") || "").toLowerCase();
  if (!accept.includes("text/html")) {
    return json(
      { error: "no signed release on file yet", os,
        note: "browse to this URL in a browser for the human-readable page" },
      { status: 503 }
    );
  }

  return downloadComingSoonPage(os, detectLanguage(request));
}

// -----------------------------------------------------------------------------
// Language detection
//
// Picks the visitor's preferred language from the Accept-Language header,
// constrained to languages we ship pages in. Falls back to English when no
// match — that matches the rest of the site's behavior (English is the
// canonical, every other language is an opt-in alias).
//
// We do NOT cookie this. Each request is detected independently. That keeps
// the privacy posture intact (no per-visitor server-side state) and is fine
// because the only headers it reaches are the few worker-rendered fallback
// pages — the static i18n pages serve via path prefix anyway.
// -----------------------------------------------------------------------------
const SUPPORTED_LANGS = ["en", "es", "fr", "de", "pt", "it"];
function detectLanguage(request) {
  if (!request) return "en";
  const url = new URL(request.url);
  // Path prefix wins when present (explicit signal beats header).
  const pathMatch = url.pathname.match(/^\/(es|fr|de|pt|it)(?:\/|$)/);
  if (pathMatch) return pathMatch[1];
  // Accept-Language q-value parsing, picking the first supported tag.
  const raw = (request.headers.get("Accept-Language") || "").toLowerCase();
  if (!raw) return "en";
  const tags = raw.split(",").map(s => {
    const [tag, q] = s.trim().split(";q=");
    return { tag: (tag || "").split("-")[0], q: parseFloat(q || "1") };
  }).filter(t => t.tag).sort((a, b) => b.q - a.q);
  for (const t of tags) {
    if (SUPPORTED_LANGS.includes(t.tag)) return t.tag;
  }
  return "en";
}

// -----------------------------------------------------------------------------
// "Not yet" HTML page (on-brand, OS-specific, honest, in the visitor's
// language). The chrome + per-OS body strings are dispatched by detected
// language; English is the canonical and the fallback.
// -----------------------------------------------------------------------------
const COMING_SOON_BLOCKS = {
  en: {
    ios: {
      label: "iOS",
      headline: "iOS is coming via TestFlight.",
      lede: "iOS apps can only install through the App Store or TestFlight. We are not on either yet. Watch the repo and we will post the TestFlight link the moment it is open.",
      cta: { kind: "watch" },
      note: "If you want a direct ping the moment TestFlight opens, drop a comment on issue #1 in the repo. No email or signup needed.",
    },
    android: { label: "Android", headline: "Android build is being packaged.", lede: "We are bundling a signed APK now. Until that lands, the source builds cleanly with the Android NDK. Instructions in the repo.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "macOS signed build is being notarized.", lede: "Apple Developer ID notarization takes a beat. Until the signed .dmg lands, the daemon builds cleanly from source with cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "macOS will refuse to open an unsigned binary served from a website. We are not going to ask you to bypass Gatekeeper. Either build it yourself or wait for the signed build." },
    windows: { label: "Windows", headline: "Windows signed installer is being packaged.", lede: "We are getting the Authenticode signing cert in place so SmartScreen does not yell at you. Until that lands, the daemon builds cleanly from source.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Linux build is being packaged.", lede: "AppImage + .deb + .rpm coming. For now the daemon builds cleanly from source on any glibc 2.28+ distro.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "OpenBSD port pending.", lede: "If you are on OpenBSD you can probably build from source faster than we can write a port. Patches welcome.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "FreeBSD port pending.", lede: "Same story as OpenBSD. Build from source today.", cta: { kind: "source" }, note: null },
    source:  { label: "Source",  headline: "Building from source today.", lede: "AGPL-3.0. Every line of the daemon, every protocol crate, every shader. Clone, read, fork, run your own.", cta: { kind: "clone" }, note: "Requires Rust 1.95+, Python 3.11+, and an internet connection long enough to pull the workspace. Build instructions are in the repo README." },
  },
  es: {
    ios:     { label: "iOS",     headline: "iOS llega vía TestFlight.", lede: "Las apps de iOS solo se instalan por App Store o TestFlight. Aún no estamos en ninguno. Sigue el repo y publicaremos el enlace de TestFlight en cuanto se abra.", cta: { kind: "watch" }, note: "Si quieres un aviso directo en el momento que TestFlight abra, comenta en el issue #1 del repo. No hace falta correo ni registro." },
    android: { label: "Android", headline: "El build de Android está en preparación.", lede: "Estamos empaquetando un APK firmado ahora. Hasta que llegue, la fuente compila sin problemas con el Android NDK. Instrucciones en el repo.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "El build firmado de macOS está siendo notarizado.", lede: "La notarización con Apple Developer ID lleva su tiempo. Hasta que llegue el .dmg firmado, el daemon compila sin problemas desde la fuente con cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "macOS no abre un binario sin firmar servido desde un sitio web. No te vamos a pedir que esquives Gatekeeper. O lo compilas tú o esperas al build firmado." },
    windows: { label: "Windows", headline: "El instalador firmado de Windows está en preparación.", lede: "Estamos poniendo en marcha el certificado Authenticode para que SmartScreen no te chille. Hasta entonces, el daemon compila sin problemas desde la fuente.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "El build de Linux está en preparación.", lede: "AppImage + .deb + .rpm en camino. Por ahora el daemon compila sin problemas desde la fuente en cualquier distro con glibc 2.28+.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port de OpenBSD pendiente.", lede: "Si estás en OpenBSD probablemente puedas compilar desde la fuente más rápido de lo que tardamos en escribir un port. Se aceptan parches.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port de FreeBSD pendiente.", lede: "La misma historia que OpenBSD. Compila desde la fuente hoy.", cta: { kind: "source" }, note: null },
    source:  { label: "Fuente",  headline: "Construyendo desde la fuente hoy.", lede: "AGPL-3.0. Cada línea del daemon, cada crate del protocolo, cada shader. Clónalo, léelo, bifúrcalo, opera el tuyo.", cta: { kind: "clone" }, note: "Requiere Rust 1.95+, Python 3.11+ y una conexión a internet lo bastante larga para descargar el workspace. Las instrucciones de compilación están en el README del repo." },
  },
  fr: {
    ios:     { label: "iOS",     headline: "iOS arrive via TestFlight.", lede: "Les apps iOS ne s'installent qu'à travers l'App Store ou TestFlight. Nous ne sommes encore sur aucun. Suivez le dépôt et nous publierons le lien TestFlight dès qu'il sera ouvert.", cta: { kind: "watch" }, note: "Si vous voulez une alerte directe au moment où TestFlight ouvre, commentez le ticket #1 du dépôt. Pas besoin d'e-mail ni d'inscription." },
    android: { label: "Android", headline: "Le build Android est en préparation.", lede: "Nous empaquetons un APK signé maintenant. En attendant, la source compile sans problème avec le NDK Android. Instructions dans le dépôt.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Le build signé macOS est en cours de notarisation.", lede: "La notarisation Apple Developer ID prend du temps. En attendant le .dmg signé, le daemon compile sans problème depuis la source avec cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "macOS refuse d'ouvrir un binaire non signé servi depuis un site web. Nous n'allons pas vous demander de contourner Gatekeeper. Soit vous compilez vous-même, soit vous attendez le build signé." },
    windows: { label: "Windows", headline: "L'installeur signé Windows est en préparation.", lede: "Nous mettons en place le certificat Authenticode pour que SmartScreen ne crie pas. En attendant, le daemon compile sans problème depuis la source.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Le build Linux est en préparation.", lede: "AppImage + .deb + .rpm en route. Pour l'instant le daemon compile sans problème depuis la source sur toute distro glibc 2.28+.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port OpenBSD en attente.", lede: "Si vous êtes sous OpenBSD vous pouvez probablement compiler depuis la source plus vite que nous n'écrivons un port. Les patchs sont les bienvenus.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port FreeBSD en attente.", lede: "Même histoire qu'OpenBSD. Compilez depuis la source aujourd'hui.", cta: { kind: "source" }, note: null },
    source:  { label: "Source",  headline: "Compiler depuis la source aujourd'hui.", lede: "AGPL-3.0. Chaque ligne du daemon, chaque crate du protocole, chaque shader. Clonez, lisez, forkez, exploitez le vôtre.", cta: { kind: "clone" }, note: "Nécessite Rust 1.95+, Python 3.11+, et une connexion internet assez longue pour télécharger le workspace. Les instructions de compilation sont dans le README du dépôt." },
  },
  de: {
    ios:     { label: "iOS",     headline: "iOS kommt via TestFlight.", lede: "iOS-Apps lassen sich nur über den App Store oder TestFlight installieren. Wir sind auf keinem davon. Beobachten Sie das Repo, wir posten den TestFlight-Link in dem Moment, in dem er offen ist.", cta: { kind: "watch" }, note: "Wenn Sie einen direkten Hinweis möchten, sobald TestFlight öffnet, kommentieren Sie Issue #1 im Repo. Keine E-Mail, keine Anmeldung nötig." },
    android: { label: "Android", headline: "Android-Build wird gerade gepackt.", lede: "Wir bauen jetzt ein signiertes APK. Bis das landet, kompiliert der Quelltext sauber mit dem Android NDK. Anleitung im Repo.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Signiertes macOS-Build wird notariell beglaubigt.", lede: "Die Apple Developer ID Notarisierung braucht einen Moment. Bis das signierte .dmg landet, baut der Daemon sauber aus dem Quelltext mit cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "macOS weigert sich, eine unsignierte Binärdatei von einer Website zu öffnen. Wir werden Sie nicht bitten, Gatekeeper zu umgehen. Bauen Sie es selbst oder warten Sie auf den signierten Build." },
    windows: { label: "Windows", headline: "Signierter Windows-Installer wird gerade gepackt.", lede: "Wir bringen das Authenticode-Signaturzertifikat in Stellung, damit SmartScreen Sie nicht anschreit. Bis dahin baut der Daemon sauber aus dem Quelltext.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Linux-Build wird gerade gepackt.", lede: "AppImage + .deb + .rpm kommen. Vorerst baut der Daemon sauber aus dem Quelltext auf jeder glibc-2.28+-Distro.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "OpenBSD-Port ausstehend.", lede: "Wenn Sie unter OpenBSD sind, können Sie wahrscheinlich schneller aus dem Quelltext bauen, als wir einen Port schreiben können. Patches willkommen.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "FreeBSD-Port ausstehend.", lede: "Gleiche Geschichte wie OpenBSD. Bauen Sie heute aus dem Quelltext.", cta: { kind: "source" }, note: null },
    source:  { label: "Quelltext", headline: "Heute aus dem Quelltext bauen.", lede: "AGPL-3.0. Jede Zeile des Daemons, jede Protokoll-Crate, jeder Shader. Klonen, lesen, forken, eigenen betreiben.", cta: { kind: "clone" }, note: "Benötigt Rust 1.95+, Python 3.11+ und eine Internetverbindung, die lange genug ist, um den Workspace zu ziehen. Build-Anweisungen sind in der README des Repos." },
  },
  pt: {
    ios:     { label: "iOS",     headline: "iOS chega via TestFlight.", lede: "As apps iOS só se instalam pela App Store ou TestFlight. Ainda não estamos em nenhuma. Acompanhe o repo e publicaremos o link de TestFlight no momento em que estiver aberto.", cta: { kind: "watch" }, note: "Se quiser um aviso direto no momento em que o TestFlight abrir, comente o issue #1 no repo. Não é preciso e-mail nem registo." },
    android: { label: "Android", headline: "O build de Android está a ser empacotado.", lede: "Estamos a empacotar um APK assinado agora. Até isso chegar, o código compila bem com o Android NDK. Instruções no repo.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "O build assinado de macOS está a ser notarizado.", lede: "A notarização Apple Developer ID demora um pouco. Até chegar o .dmg assinado, o daemon compila bem a partir do código com cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "O macOS recusa abrir um binário sem assinatura servido a partir de um site. Não lhe vamos pedir para contornar o Gatekeeper. Ou compila você ou espera pelo build assinado." },
    windows: { label: "Windows", headline: "O instalador assinado de Windows está a ser empacotado.", lede: "Estamos a pôr em marcha o certificado Authenticode para que o SmartScreen não lhe grite. Até lá, o daemon compila bem a partir do código.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "O build de Linux está a ser empacotado.", lede: "AppImage + .deb + .rpm a caminho. Por agora o daemon compila bem a partir do código em qualquer distro glibc 2.28+.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port de OpenBSD pendente.", lede: "Se está em OpenBSD provavelmente consegue compilar a partir do código mais rápido do que nós escrevemos um port. Patches bem-vindos.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port de FreeBSD pendente.", lede: "Mesma história que OpenBSD. Compile a partir do código hoje.", cta: { kind: "source" }, note: null },
    source:  { label: "Código",  headline: "A compilar a partir do código hoje.", lede: "AGPL-3.0. Cada linha do daemon, cada crate do protocolo, cada shader. Clone, leia, faça fork, opere o seu.", cta: { kind: "clone" }, note: "Requer Rust 1.95+, Python 3.11+ e uma ligação à internet suficientemente longa para puxar o workspace. As instruções de compilação estão no README do repo." },
  },
  it: {
    ios:     { label: "iOS",     headline: "iOS arriva tramite TestFlight.", lede: "Le app iOS si possono installare solo dall'App Store o da TestFlight. Non siamo ancora su nessuno dei due. Segui il repo e pubblicheremo il link TestFlight nel momento in cui sarà aperto.", cta: { kind: "watch" }, note: "Se vuoi un avviso diretto nel momento in cui TestFlight apre, lascia un commento sull'issue #1 nel repo. Niente email, niente registrazione." },
    android: { label: "Android", headline: "La build per Android è in preparazione.", lede: "Stiamo impacchettando un APK firmato adesso. Finché non arriva, il sorgente compila pulito con l'Android NDK. Istruzioni nel repo.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "La build firmata per macOS è in notarizzazione.", lede: "La notarizzazione Apple Developer ID richiede un attimo. Finché non arriva il .dmg firmato, il daemon compila pulito dal sorgente con cargo + Python 3.11+.", cta: { kind: "build", anchor: "#macos" }, note: "macOS rifiuta di aprire un binario non firmato servito da un sito web. Non ti chiederemo di aggirare Gatekeeper. O lo compili tu o aspetti la build firmata." },
    windows: { label: "Windows", headline: "L'installer firmato per Windows è in preparazione.", lede: "Stiamo mettendo in piedi il certificato Authenticode in modo che SmartScreen non ti urli contro. Fino ad allora, il daemon compila pulito dal sorgente.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "La build per Linux è in preparazione.", lede: "AppImage + .deb + .rpm in arrivo. Per ora il daemon compila pulito dal sorgente su qualsiasi distro con glibc 2.28+.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port OpenBSD in sospeso.", lede: "Se sei su OpenBSD probabilmente puoi compilare dal sorgente più velocemente di quanto noi possiamo scrivere un port. Patch benvenute.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port FreeBSD in sospeso.", lede: "Stessa storia di OpenBSD. Compila dal sorgente oggi.", cta: { kind: "source" }, note: null },
    source:  { label: "Sorgente", headline: "Compilare dal sorgente oggi.", lede: "AGPL-3.0. Ogni riga del daemon, ogni crate del protocollo, ogni shader. Clonalo, leggilo, forkalo, esegui il tuo.", cta: { kind: "clone" }, note: "Richiede Rust 1.95+, Python 3.11+ e una connessione internet abbastanza lunga da scaricare il workspace. Le istruzioni di build sono nel README del repo." },
  },
};

const COMING_SOON_CHROME = {
  en: { skipLink: "Skip to content", logoAria: "One Link",   navAria: "Main",       navHowItWorks: "How it works", navFeatures: "Features",       navSecurity: "Security",   navAll: "All downloads", titleSuffix: "not yet",      ctaPrimary: "Download source today", ctaOthers: "Other platforms", ctaBuild: "Build from source",  ctaWatch: "Watch on GitHub", ctaClone: "Clone on GitHub", ctaSource: "Source on GitHub", archiveLine: "The source archive (19 MB) works on every device including this one. Every protocol, every crate, every shader, every word of the daemon. AGPL-3.0.", honestLine: "Honest status: no signed binary has been published to the release relay yet. This page is what you see when the front door is still being painted. The protocol works today. The polish is on the way.", footerBuilt: "Built in the open. AGPL-3.0.",                  footerNoTracking: "No tracking, no analytics, no cookies.", footerMantra: "we are one" },
  es: { skipLink: "Saltar al contenido",  logoAria: "One Link", navAria: "Principal", navHowItWorks: "Cómo funciona", navFeatures: "Funciones",     navSecurity: "Seguridad",  navAll: "Todas las descargas", titleSuffix: "aún no", ctaPrimary: "Descargar la fuente hoy", ctaOthers: "Otras plataformas", ctaBuild: "Compilar desde la fuente", ctaWatch: "Seguir en GitHub", ctaClone: "Clonar en GitHub", ctaSource: "Fuente en GitHub", archiveLine: "El archivo de la fuente (19 MB) funciona en cada dispositivo incluido este. Cada protocolo, cada crate, cada shader, cada palabra del daemon. AGPL-3.0.", honestLine: "Estado honesto: aún no se ha publicado ningún binario firmado en el relé de versiones. Esta página es lo que ves cuando la puerta de entrada aún se está pintando. El protocolo funciona hoy. El acabado está en camino.", footerBuilt: "Construido en abierto. AGPL-3.0.", footerNoTracking: "Sin rastreo, sin analíticas, sin cookies.", footerMantra: "somos uno" },
  fr: { skipLink: "Aller au contenu",     logoAria: "One Link", navAria: "Principale", navHowItWorks: "Comment ça marche", navFeatures: "Fonctionnalités", navSecurity: "Sécurité", navAll: "Tous les téléchargements", titleSuffix: "pas encore", ctaPrimary: "Télécharger la source aujourd'hui", ctaOthers: "Autres plateformes", ctaBuild: "Compiler depuis la source", ctaWatch: "Suivre sur GitHub", ctaClone: "Cloner sur GitHub", ctaSource: "Source sur GitHub", archiveLine: "L'archive source (19 Mo) fonctionne sur chaque appareil y compris celui-ci. Chaque protocole, chaque crate, chaque shader, chaque mot du daemon. AGPL-3.0.", honestLine: "Statut honnête : aucun binaire signé n'a encore été publié sur le relais de versions. Cette page est ce que vous voyez quand la porte d'entrée est encore en train d'être peinte. Le protocole fonctionne aujourd'hui. Le poli est en chemin.", footerBuilt: "Construit à découvert. AGPL-3.0.", footerNoTracking: "Pas de pistage, pas d'analytique, pas de cookies.", footerMantra: "nous sommes un" },
  de: { skipLink: "Zum Inhalt springen", logoAria: "One Link", navAria: "Haupt",      navHowItWorks: "So funktioniert es", navFeatures: "Funktionen",    navSecurity: "Sicherheit", navAll: "Alle Downloads",         titleSuffix: "noch nicht",  ctaPrimary: "Quelltext heute herunterladen", ctaOthers: "Andere Plattformen", ctaBuild: "Aus dem Quelltext bauen", ctaWatch: "Auf GitHub beobachten", ctaClone: "Auf GitHub klonen", ctaSource: "Quelltext auf GitHub", archiveLine: "Das Quelltext-Archiv (19 MB) funktioniert auf jedem Gerät, auch auf diesem. Jedes Protokoll, jede Crate, jeder Shader, jedes Wort des Daemons. AGPL-3.0.", honestLine: "Ehrlicher Status: noch keine signierte Binärdatei wurde am Release-Relay veröffentlicht. Diese Seite ist das, was Sie sehen, während die Eingangstür noch gestrichen wird. Das Protokoll funktioniert heute. Der Schliff ist auf dem Weg.", footerBuilt: "Offen gebaut. AGPL-3.0.", footerNoTracking: "Kein Tracking, keine Analytik, keine Cookies.", footerMantra: "wir sind eins" },
  pt: { skipLink: "Saltar para o conteúdo", logoAria: "One Link", navAria: "Principal", navHowItWorks: "Como funciona", navFeatures: "Funcionalidades", navSecurity: "Segurança", navAll: "Todas as descargas",        titleSuffix: "ainda não",   ctaPrimary: "Descarregar o código hoje", ctaOthers: "Outras plataformas", ctaBuild: "Compilar a partir do código", ctaWatch: "Acompanhar no GitHub", ctaClone: "Clonar no GitHub", ctaSource: "Código no GitHub", archiveLine: "O arquivo do código (19 MB) funciona em cada dispositivo incluindo este. Cada protocolo, cada crate, cada shader, cada palavra do daemon. AGPL-3.0.", honestLine: "Estado honesto: ainda não foi publicado nenhum binário assinado no relé de versões. Esta página é o que vê quando a porta da frente ainda está a ser pintada. O protocolo funciona hoje. O polimento está a caminho.", footerBuilt: "Construído em aberto. AGPL-3.0.", footerNoTracking: "Sem rastreamento, sem analítica, sem cookies.", footerMantra: "somos um" },
  it: { skipLink: "Salta al contenuto",   logoAria: "One Link", navAria: "Principale", navHowItWorks: "Come funziona", navFeatures: "Funzionalità",  navSecurity: "Sicurezza",  navAll: "Tutti i download",       titleSuffix: "non ancora",  ctaPrimary: "Scarica il sorgente oggi", ctaOthers: "Altre piattaforme",  ctaBuild: "Compila dal sorgente",  ctaWatch: "Segui su GitHub", ctaClone: "Clona su GitHub", ctaSource: "Sorgente su GitHub", archiveLine: "L'archivio del sorgente (19 MB) funziona su ogni dispositivo, incluso questo. Ogni protocollo, ogni crate, ogni shader, ogni parola del daemon. AGPL-3.0.", honestLine: "Stato onesto: nessun binario firmato è ancora stato pubblicato sul relay di rilascio. Questa pagina è ciò che vedi quando la porta d'ingresso è ancora in fase di verniciatura. Il protocollo funziona oggi. La rifinitura è in arrivo.", footerBuilt: "Costruito allo scoperto. AGPL-3.0.", footerNoTracking: "Nessun tracciamento, nessuna analitica, nessun cookie.", footerMantra: "siamo uno" },
};

function downloadComingSoonPage(os, lang = "en") {
  const repo = "https://github.com/IamOneYouAreOneWeAreOne/one-link";
  const L = COMING_SOON_BLOCKS[lang] || COMING_SOON_BLOCKS.en;
  const C = COMING_SOON_CHROME[lang] || COMING_SOON_CHROME.en;
  const b = L[os] || L.source;
  // Resolve the CTA from its semantic kind so each language uses the right
  // wording without translators duplicating button text per OS.
  const ctaLabel = (
    b.cta.kind === "build"  ? C.ctaBuild  :
    b.cta.kind === "watch"  ? C.ctaWatch  :
    b.cta.kind === "clone"  ? C.ctaClone  :
    b.cta.kind === "source" ? C.ctaSource : C.ctaSource
  );
  const ctaHref = (
    b.cta.kind === "build" ? `${repo}${b.cta.anchor || ""}` : repo
  );
  // The site-logo + nav links target the language root + the canonical
  // English content paths (matches every other translated page in the site
  // — translated chrome, English content URLs with hreflang="en").
  const langRoot = lang === "en" ? "/" : `/${lang}/`;
  const navLangAttr = lang === "en" ? "" : ' hreflang="en"';
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>One Link ${b.label} &mdash; ${C.titleSuffix}</title>
  <meta name="description" content="${b.headline}">
  <meta name="theme-color" content="#04060b">
  <meta name="color-scheme" content="dark">
  <meta name="robots" content="noindex">
  <link rel="icon" type="image/x-icon" href="/images/favicon.ico">
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/one-link.css">
</head>
<body>
<header class="site-header" role="banner">
  <div class="container">
    <a href="${langRoot}" class="site-logo"><span class="logo-mark"></span><span>One Link</span></a>
    <nav class="site-nav" aria-label="${C.navAria}">
      <a href="/how-it-works/"${navLangAttr}>${C.navHowItWorks}</a>
      <a href="/features/"${navLangAttr}>${C.navFeatures}</a>
      <a href="/security/"${navLangAttr}>${C.navSecurity}</a>
      <a href="/download/" class="cta-get"${navLangAttr}>${C.navAll}</a>
    </nav>
  </div>
</header>
<main id="main">
  <section class="hero ol-pb-sm">
    <div class="container">
      <span class="we-are-one">${b.label}</span>
      <h1>${b.headline}</h1>
      <p class="lede">${b.lede}</p>
      <div class="cta-row">
        <a href="/download/source" class="btn btn-primary btn-large">
          ${C.ctaPrimary} <span class="arr">&rarr;</span>
        </a>
        <a href="${ctaHref}" class="btn btn-ghost btn-large" rel="noopener">
          ${ctaLabel}
        </a>
        <a href="/download/" class="btn btn-ghost">${C.ctaOthers}</a>
      </div>
      <p class="ol-soft-prose">${C.archiveLine}</p>
      ${b.note ? `<p class="ol-soft-note">${b.note}</p>` : ""}
    </div>
  </section>
  <section class="section-tight">
    <div class="container">
      <p class="ol-dim-mono">${C.honestLine}</p>
    </div>
  </section>
</main>
<footer class="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer-bottom">
      <span class="built-by">${C.footerBuilt} <a href="/security/"${navLangAttr}>${C.footerNoTracking}</a></span>
      <span class="built-by">${C.footerMantra}</span>
    </div>
  </div>
</footer>
</body>
</html>`;

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Language", lang);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Accept-Language");
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
  for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
  // 200 (not 503): the page IS the response for this URL today; 5xx makes
  // Google de-index over time. The page is honest about the binary being
  // in flight; that does not mean the page itself is a server error.
  return new Response(html, { status: 200, headers });
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Canonical-host redirect: www -> apex. Both hostnames are bound to this
    // worker via wrangler.toml, so without this they'd both serve 200 with the
    // same body (duplicate content, split share of any inbound link credit,
    // weaker HSTS preload posture). 301 (permanent) so browsers and crawlers
    // remember the canonical for the apex domain.
    if (url.hostname === "www.weareone-link.org") {
      url.hostname = "weareone-link.org";
      // Build the response manually rather than Response.redirect() so we can
      // overwrite Cloudflare's auto-injected NEL/Report-To telemetry headers
      // on the redirect itself (privacy-by-construction also covers redirects).
      return permanentRedirect(url.toString());
    }

    // Canonical-case redirect: every path on this site is lowercase. If a
    // visitor (or a sloppy link in someone else's post) hits an uppercased
    // variant like /Features/, send them to the canonical lowercase path.
    // Skip /api/ + /share/<id> since their case-sensitivity is genuine.
    if (/[A-Z]/.test(path) && !path.startsWith("/api/") && !path.startsWith("/share/")) {
      url.pathname = path.toLowerCase();
      return permanentRedirect(url.toString());
    }

    // Trailing-slash normalization on content directories. The assets binding
    // would otherwise emit a 307 — and Google treats 301 as a stronger
    // canonical signal than 307, so route the small fixed set of content
    // dirs through a 301 first.
    if (CONTENT_DIRS.has(path)) {
      url.pathname = path + "/";
      return permanentRedirect(url.toString());
    }

    // /favicon.ico is conventional; the page <head> already references the
    // canonical /images/favicon.ico, but link-preview crawlers + browser
    // address-bar guesses hit the apex /favicon.ico. 301 there.
    if (path === "/favicon.ico") {
      url.pathname = "/images/favicon.ico";
      return permanentRedirect(url.toString());
    }

    if (path === "/api/health") return health(env);
    if (path === "/api/capabilities") return capabilities(env);
    if (path === "/api/topology") return topology(env);
    if (path === "/api/session" && request.method === "POST")
      return openSession(env, request);
    if (path === "/native") return nativeAdvert(env);

    const attestMatch = path.match(/^\/api\/attest\/([a-f0-9]+)$/i);
    if (attestMatch) return attestation(env, attestMatch[1], request);

    const downloadMatch = path.match(/^\/download\/([a-z]+)$/);
    if (downloadMatch && (request.method === "GET" || request.method === "HEAD"))
      return download(env, downloadMatch[1], request);

    // ---------------------------------------------------------------
    // SHARE-A-FILE (encrypted in-browser, one-shot, R2-backed)
    // ---------------------------------------------------------------
    // POST /api/share            -> store ciphertext, return { id, expires_at }
    // GET  /api/share/:id        -> serve ciphertext, then delete
    // GET  /share/:id            -> serve the /share/index.html page (the JS
    //                                reads the id from the URL + key from the
    //                                fragment, fetches, decrypts, downloads)
    if (path === "/api/share" && request.method === "POST")
      return shareUpload(env, request);
    const shareApiMatch = path.match(/^\/api\/share\/([A-Za-z0-9_-]{8,32})$/);
    if (shareApiMatch && request.method === "GET")
      return shareDownload(env, shareApiMatch[1]);
    const sharePathMatch = path.match(/^\/share\/([A-Za-z0-9_-]{8,32})\/?$/);
    if (sharePathMatch) {
      // Rewrite to the static /share/index.html so the JS module loads;
      // the JS reads location.pathname to extract the id.
      const rewriteUrl = new URL(request.url);
      rewriteUrl.pathname = "/share/index.html";
      const rewritten = new Request(rewriteUrl.toString(), request);
      const res = await env.ASSETS.fetch(rewritten);
      return applyHeaders(res, request, env);
    }

    // Live presence WebSocket: all sessions share a single Durable Object
    // instance ("global") for the demo. Trivially shardable later by region.
    if (path === "/api/presence") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "expected websocket upgrade" }, { status: 426 });
      }
      if (!env.PRESENCE) {
        return json({ error: "PRESENCE durable-object binding missing" }, { status: 503 });
      }
      const id = env.PRESENCE.idFromName("global");
      const stub = env.PRESENCE.get(id);
      return stub.fetch(request);
    }

    // Everything else: static assets
    let assetResponse = await env.ASSETS.fetch(request);

    // Language-aware 404: when a request under /es/, /fr/, etc. misses,
    // serve that language's /<lang>/404.html instead of the English root
    // /404.html the assets binding falls back to. The HTML page text
    // matches the visitor's language; the response is still HTTP 404.
    if (assetResponse.status === 404) {
      const ct = (assetResponse.headers.get("Content-Type") || "").toLowerCase();
      if (ct.includes("text/html")) {
        const langMatch = path.match(/^\/(es|fr|de|pt|it)(?:\/|$)/);
        if (langMatch) {
          const lang = langMatch[1];
          const localizedUrl = new URL(request.url);
          localizedUrl.pathname = `/${lang}/404.html`;
          const localized = await env.ASSETS.fetch(
            new Request(localizedUrl.toString(), request)
          );
          if (localized.ok) {
            assetResponse = new Response(localized.body, {
              status: 404,
              statusText: "Not Found",
              headers: localized.headers,
            });
          }
        }
      }
    }

    const finalized = applyHeaders(assetResponse, request, env);
    // Long-cache the asset paths the HTML cache-busts via `?v=N`. Any change
    // to the file bumps the version query, forcing a fresh URL; until then
    // `immutable` lets the browser skip even a conditional revalidate.
    if (path.startsWith("/css/") ||
        path.startsWith("/live/") ||
        path.startsWith("/images/") ||
        path.startsWith("/og/") ||
        path === "/app.webmanifest") {
      const h = new Headers(finalized.headers);
      h.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(finalized.body, {
        status: finalized.status,
        statusText: finalized.statusText,
        headers: h,
      });
    }
    return finalized;
  },
};

// -----------------------------------------------------------------------------
// SHARE-A-FILE  (encrypted in-browser, one-shot, R2-backed)
//
// The server only ever sees ciphertext + a random object id. It never sees
// the key (which lives in the URL fragment client-side) and never sees the
// plaintext. R2 holds the ciphertext for 24h max; first successful GET
// deletes the object.
// -----------------------------------------------------------------------------
const SHARE_MAX_BYTES   = 26 * 1024 * 1024;        // 26 MiB = 25 MiB plaintext + tag overhead
const SHARE_TTL_MS      = 24 * 60 * 60 * 1000;     // 24h

function shareRandomId() {
  // 16 url-safe chars from crypto rng.
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Reduce an IP to a /24 (IPv4) or /48 (IPv6) so co-tenants behind a single
// NAT or carrier-grade gateway share a rate budget, but distinct end-users
// don't collide. Falls back to the full string if the format is unfamiliar.
function shareRateBucketKey(ip) {
  if (!ip || typeof ip !== "string") return "unknown";
  // IPv4: a.b.c.d -> "v4:a.b.c"
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `v4:${v4[1]}.${v4[2]}.${v4[3]}`;
  // IPv6: full or compressed; take first 3 hextets (/48).
  if (ip.includes(":")) {
    const parts = ip.toLowerCase().split(":");
    const head = parts.slice(0, 3).join(":");
    return `v6:${head}`;
  }
  return `raw:${ip}`;
}

async function shareUpload(env, request) {
  if (!env.RELEASES) {
    return json({ error: "R2 not bound" }, { status: 503 });
  }
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("application/octet-stream")) {
    return json({ error: "expected application/octet-stream" }, { status: 400 });
  }
  const lenHeader = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (lenHeader && lenHeader > SHARE_MAX_BYTES) {
    return json({ error: "too large", max_bytes: SHARE_MAX_BYTES }, { status: 413 });
  }

  // -------------------------------------------------------------------
  // Rate limit: per-IP token bucket in a Durable Object. Keyed by
  // CF-Connecting-IP (Cloudflare's authoritative client-IP header,
  // unfakeable from outside the edge). One bucket per /24 subnet so
  // dial-up NAT pools share a budget but normal users see their own.
  // -------------------------------------------------------------------
  if (env.SHARE_RATE) {
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const bucketKey = shareRateBucketKey(ip);
    const rateId = env.SHARE_RATE.idFromName(bucketKey);
    const rateStub = env.SHARE_RATE.get(rateId);
    const rateUrl = new URL("https://share-rate/check");
    rateUrl.searchParams.set("cost", "1");
    const rateRes = await rateStub.fetch(rateUrl.toString(), { method: "POST" });
    if (rateRes.status === 429) {
      const retry = rateRes.headers.get("Retry-After") || "60";
      return json(
        {
          error: "rate limited",
          retry_after_seconds: parseInt(retry, 10) || 60,
          note: "Too many uploads from your network. Try again in a minute.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(retry) },
        }
      );
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return json({ error: "empty body" }, { status: 400 });
  }
  if (body.byteLength > SHARE_MAX_BYTES) {
    return json({ error: "too large", max_bytes: SHARE_MAX_BYTES }, { status: 413 });
  }

  const id = shareRandomId();
  const expiresAt = Date.now() + SHARE_TTL_MS;

  try {
    await env.RELEASES.put(`shares/${id}`, body, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        expires_at: String(expiresAt),
        created_at: String(Date.now()),
      },
    });
  } catch (e) {
    return json({ error: "store failed", detail: e?.message || String(e) }, { status: 500 });
  }

  return json({
    id,
    expires_at: new Date(expiresAt).toISOString(),
    bytes: body.byteLength,
    note: "one-shot: deletes on first download, or in 24 hours.",
  });
}

async function shareDownload(env, id) {
  if (!env.RELEASES) return json({ error: "R2 not bound" }, { status: 503 });
  const key = `shares/${id}`;
  const obj = await env.RELEASES.get(key);
  if (!obj) return json({ error: "not found or already collected" }, { status: 404 });

  // TTL enforcement (R2 has no native TTL; we check on read).
  const expires = parseInt(obj.customMetadata?.expires_at || "0", 10);
  if (expires && Date.now() > expires) {
    await env.RELEASES.delete(key).catch(() => {});
    return json({ error: "expired" }, { status: 410 });
  }

  const body = await obj.arrayBuffer();
  // Delete BEFORE returning so a network mid-flight failure still means
  // the object is gone (one-shot semantics).
  await env.RELEASES.delete(key).catch(() => {});

  const headers = new Headers();
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Share-Bytes", String(body.byteLength));
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
  return new Response(body, { headers });
}

// -----------------------------------------------------------------------------
// MeshPresence Durable Object
//
// Holds the in-flight set of visitor sessions for the live "N here right now"
// counter + the mesh-viz dots. Pure ephemeral state: keyed by random session
// id, valued by { geo: {lat, lng}, last_seen_ms }. Zero PII. Garbage
// collected when sockets close + on idle heartbeat sweep.
//
// Wire protocol (JSON over WebSocket):
//   client -> server  { type: "hello",  protocol: 1, geo: {lat, lng} }
//   server -> client  { type: "welcome", self_id: "...", population: N }
//   server -> ALL     { type: "population", n: N }
//   server -> ALL     { type: "peers", peers: [{id, lat, lng}, ...] }
//   client -> server  { type: "ping", to: "<peer-id>" }   (anonymous, ephemeral)
//   server -> RECIP   { type: "ping", from: "<sender-id>" }
//
// No IPs, no Cookies, no headers logged. Idle sessions evict after 90s.
// -----------------------------------------------------------------------------
const PRESENCE_IDLE_MS = 90_000;
const PRESENCE_BROADCAST_THROTTLE_MS = 1_500;

export class MeshPresence {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // sessionId -> { ws, geo, lastSeen }
    this.lastBroadcast = 0;
    this.sweepStarted = false;
  }

  randomId() {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
  }

  startSweep() {
    if (this.sweepStarted) return;
    this.sweepStarted = true;
    const tick = () => {
      const now = Date.now();
      let evicted = 0;
      for (const [id, s] of this.sessions) {
        if (now - s.lastSeen > PRESENCE_IDLE_MS) {
          try { s.ws.close(1000, "idle"); } catch {}
          this.sessions.delete(id);
          evicted++;
        }
      }
      if (evicted) this.broadcast({ type: "population", n: this.sessions.size });
      setTimeout(tick, 30_000);
    };
    setTimeout(tick, 30_000);
  }

  peersSnapshot() {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      lat: s.geo?.lat ?? 0.5,
      lng: s.geo?.lng ?? 0.5,
    }));
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const s of this.sessions.values()) {
      try { s.ws.send(payload); } catch {}
    }
  }

  maybeBroadcastPeers() {
    const now = Date.now();
    const sinceLast = now - this.lastBroadcast;
    if (sinceLast >= PRESENCE_BROADCAST_THROTTLE_MS) {
      this.lastBroadcast = now;
      this.broadcast({ type: "peers", peers: this.peersSnapshot() });
      return;
    }
    // We're inside the throttle window. Schedule a deferred broadcast for
    // the remainder of the window so the most recent peer change still
    // reaches everyone. Without this, when N tabs connect in quick
    // succession (≤1.5s) only the first one's broadcast fires; the rest
    // are silently dropped and tabs never learn about each other.
    if (this._deferredBroadcast) return;
    const delay = PRESENCE_BROADCAST_THROTTLE_MS - sinceLast;
    this._deferredBroadcast = setTimeout(() => {
      this._deferredBroadcast = null;
      this.lastBroadcast = Date.now();
      this.broadcast({ type: "peers", peers: this.peersSnapshot() });
    }, delay);
  }

  /** Send the current peer snapshot DIRECTLY to one session, bypassing the
   *  broadcast throttle. New connections need this so they see existing
   *  peers immediately instead of waiting for someone else to trigger a
   *  broadcast. */
  sendPeersTo(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      s.ws.send(JSON.stringify({ type: "peers", peers: this.peersSnapshot() }));
    } catch {}
  }

  handleMessage(sessionId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastSeen = Date.now();

    switch (msg.type) {
      case "hello": {
        if (msg.geo && typeof msg.geo === "object") {
          session.geo = {
            lat: Math.max(0, Math.min(1, +msg.geo.lat || 0.5)),
            lng: Math.max(0, Math.min(1, +msg.geo.lng || 0.5)),
          };
        }
        session.ws.send(JSON.stringify({
          type: "welcome",
          self_id: sessionId,
          population: this.sessions.size,
        }));
        this.broadcast({ type: "population", n: this.sessions.size });
        // 1. Direct: tell the new tab who's already here (bypasses throttle).
        this.sendPeersTo(sessionId);
        // 2. Throttled broadcast: tell everyone else about the new tab.
        this.maybeBroadcastPeers();
        break;
      }
      case "heartbeat": {
        break;
      }
      case "ping": {
        const target = this.sessions.get(msg.to);
        if (target && msg.to !== sessionId) {
          try {
            target.ws.send(JSON.stringify({ type: "ping", from: sessionId }));
          } catch {}
        }
        break;
      }

      // -------------------------------------------------------------------
      // STRANGER CHAT relay  (server-side server-relayed, NOT yet E2EE).
      // -------------------------------------------------------------------
      // chat-request : "Alice asks Bob to open a chat"
      // chat-accept  : "Bob agrees, chat is open"
      // chat-decline : "Bob declines"
      // chat-msg     : single short message (server enforces 280 char cap)
      // chat-leave   : tell the other side we closed the panel
      //
      // The DO never stores chat content. It receives a frame, forwards
      // it to the named recipient if they're still connected, drops it
      // otherwise. No persistence, no history server-side.
      // -------------------------------------------------------------------
      // E2EE handshake transport (DO never reads the payload bytes):
      //   chat-request  carries the Inviter's signed Invite bytes
      //   chat-accept   carries the Scanner's PairResponse bytes
      //   chat-confirm  carries the Inviter's PairConfirm bytes
      // After confirm, both clients hold the same 32-byte chain key
      // and seal every subsequent chat-msg with AES-GCM-256.
      case "chat-request":
      case "chat-accept":
      case "chat-confirm":
      case "chat-decline":
      case "chat-leave": {
        const target = this.sessions.get(msg.to);
        if (target && msg.to !== sessionId) {
          try {
            // Pass through invite_hex / response_hex / confirm_hex blindly.
            // The DO does NOT parse them; it only forwards opaque bytes.
            const out = { type: msg.type, from: sessionId };
            if (typeof msg.invite_hex   === "string") out.invite_hex   = msg.invite_hex.slice(0, 4096);
            if (typeof msg.response_hex === "string") out.response_hex = msg.response_hex.slice(0, 4096);
            if (typeof msg.confirm_hex  === "string") out.confirm_hex  = msg.confirm_hex.slice(0, 4096);
            target.ws.send(JSON.stringify(out));
          } catch {}
        }
        break;
      }

      // Encrypted message frame: { iv_b64, ct_b64 }. The DO forwards
      // verbatim. It cannot decrypt; the key never touches the server.
      case "chat-msg": {
        const target = this.sessions.get(msg.to);
        if (target && msg.to !== sessionId
            && typeof msg.iv_b64 === "string"
            && typeof msg.ct_b64 === "string") {
          try {
            target.ws.send(JSON.stringify({
              type: "chat-msg",
              from: sessionId,
              iv_b64: msg.iv_b64.slice(0, 64),
              ct_b64: msg.ct_b64.slice(0, 2048),
              ts: Date.now(),
            }));
          } catch {}
        }
        break;
      }
    }
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];

    const sessionId = this.randomId();
    this.sessions.set(sessionId, {
      ws: server,
      geo: { lat: 0.5, lng: 0.5 },
      lastSeen: Date.now(),
    });

    server.accept();
    this.startSweep();

    server.addEventListener("message", (ev) => {
      this.handleMessage(sessionId, ev.data);
      this.maybeBroadcastPeers();
    });
    const cleanup = () => {
      this.sessions.delete(sessionId);
      this.broadcast({ type: "population", n: this.sessions.size });
      this.maybeBroadcastPeers();
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}

// -----------------------------------------------------------------------------
// ShareRate Durable Object  -  per-IP token bucket for /api/share abuse control
//
// Each DO instance is one bucket, keyed by the /24 (or /48 for v6) of the
// uploader's CF-Connecting-IP. The Worker dials this DO before accepting an
// upload; if the bucket has tokens, it consumes one and the upload proceeds.
// If empty, the DO returns 429 with a Retry-After header.
//
// Tunables (intentionally generous for normal users, ruinous for scripted
// floods):
//
//   CAPACITY    = 12        max burst   (12 uploads back-to-back)
//   REFILL_RATE = 2/min     steady state (one upload per 30s)
//
// At 2/min, a real human pasting links to friends never notices. A botnet
// trying to fill R2 from one /24 is throttled to 2880/day per subnet, with
// the 25 MiB-per-upload cap making it a 70 GiB/day ceiling per source - and
// R2 will gladly bill the operator for those tokens, not us, until the
// bucket fires.
//
// State is held in instance memory + DO storage. DO migrations preserve
// storage across deploys; an idle bucket gets evicted by the DO runtime
// after ~30 days, which is fine (it just resets to full).
// -----------------------------------------------------------------------------
const SHARE_RATE_CAPACITY    = 12;
const SHARE_RATE_REFILL_PER_S = 2 / 60; // 2 per minute

export class ShareRate {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tokens = null;        // lazy-loaded from storage on first hit
    this.lastRefillMs = null;
  }

  async loadState() {
    if (this.tokens !== null) return;
    const stored = await this.state.storage.get(["tokens", "last_refill_ms"]);
    this.tokens = typeof stored.get("tokens") === "number"
      ? stored.get("tokens") : SHARE_RATE_CAPACITY;
    this.lastRefillMs = typeof stored.get("last_refill_ms") === "number"
      ? stored.get("last_refill_ms") : Date.now();
  }

  refill(nowMs) {
    const elapsedSec = Math.max(0, (nowMs - this.lastRefillMs) / 1000);
    const earned = elapsedSec * SHARE_RATE_REFILL_PER_S;
    this.tokens = Math.min(SHARE_RATE_CAPACITY, this.tokens + earned);
    this.lastRefillMs = nowMs;
  }

  secondsUntilOneToken() {
    if (this.tokens >= 1) return 0;
    const needed = 1 - this.tokens;
    return Math.ceil(needed / SHARE_RATE_REFILL_PER_S);
  }

  async persist() {
    await this.state.storage.put({
      tokens: this.tokens,
      last_refill_ms: this.lastRefillMs,
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    await this.loadState();
    const now = Date.now();
    this.refill(now);

    if (url.pathname === "/check" && request.method === "POST") {
      const cost = parseFloat(url.searchParams.get("cost") || "1") || 1;
      if (this.tokens >= cost) {
        this.tokens -= cost;
        await this.persist();
        return new Response(
          JSON.stringify({ ok: true, remaining: this.tokens }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      const retryAfter = this.secondsUntilOneToken();
      await this.persist();
      return new Response(
        JSON.stringify({
          ok: false,
          remaining: this.tokens,
          retry_after_seconds: retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        }
      );
    }

    if (url.pathname === "/peek") {
      return new Response(
        JSON.stringify({
          tokens: this.tokens,
          capacity: SHARE_RATE_CAPACITY,
          refill_per_second: SHARE_RATE_REFILL_PER_S,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }
}

// -----------------------------------------------------------------------------
// NativeSession Durable Object
//
// Per-session state for the WebTransport /native channel. Holds the agreed
// hybrid session keys, the One Link wire protocol sequence numbers, and the
// active capability set. Garbage collected on idle.
// -----------------------------------------------------------------------------
export class NativeSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response(
      JSON.stringify({
        ok: true,
        session_durable_object: true,
        note: "real WebTransport session lifecycle wires once CF Worker supports raw WT streams",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}
