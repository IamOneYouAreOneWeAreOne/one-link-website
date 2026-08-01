// =============================================================================
// weareone-link.org - Cloudflare Worker
// =============================================================================
//
// Serves the One Link public site. Static assets from dist/, plus dynamic
// endpoints with explicit implementation boundaries:
//
//   GET  /api/health        - heartbeat
//   GET  /api/capabilities  - unsigned, hard-coded website-build advertisement;
//                              not live daemon inventory or release evidence
//   GET  /api/topology      - fail-closed relay-topology availability status
//   GET  /api/attest/:sha   - versioned release attestation, when enabled
//   POST /api/session       - registers ephemeral state and advertises Worker
//                              X25519; ML-KEM and shared-key exchange are pending
//   GET  /native            - protocol advertisement; no WebTransport session
//   GET  /download/:os      - artifact routing with explicit proof status
//
// Privacy scope:
//   - The application intentionally sets no tracking cookies, ad analytics, or
//     tracking pixels. Cloudflare still processes ordinary edge metadata.
//   - Dynamic services process the scoped state documented on /transparency/;
//     structured operational errors avoid full addresses and full share IDs.
//   - Response policy headers restrict browser capabilities but do not erase
//     provider, network, recipient, or endpoint metadata.
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
  // The inline <script type="speculationrules"> block on / is a static
  // prerender hint, not user-influenced. Whitelisted by its SHA-256 so
  // Chrome's speculation engine can consume it without loosening CSP to
  // 'unsafe-inline'. Regenerate via scripts/audit_live.py if the inline
  // content ever changes.
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-EtWPdt1tDLTK6jGuLdXS8Woyem6tIRWm7Sl6X3tkWqM='",
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
  "accessibility", "transparency", "changelog", "releases", "roadmap",
  "verify-download",
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

// Attach an X-Artifact-SHA256 header to a download response so the
// /verify-download/ page (and curl users) can identify the bytes received.
// This checksum is transport metadata, not an artifact signature.
//
// Three sources, in order of preference:
//   1. R2's auto-computed checksum from upload (obj.checksums.sha256).
//   2. customMetadata.sha256 we set at upload time.
//   3. nothing (no SHA known): we still expose the header empty so the
//      verify page can tell "we don't know" apart from "fetch failed."
//
// We CORS-expose the header so a same-origin fetch from /verify-download/
// can read it. Browsers do not allow custom headers on cross-origin reads
// without this even for same-origin fetches if the request was a CORS
// preflight via a Range or auth header; the explicit expose is harmless
// and future-proofs the page if the verifier ever moves off-origin.
function attachArtifactHash(headers, obj) {
  let hex = "";
  try {
    const checksumBuf = obj && obj.checksums && obj.checksums.sha256;
    if (checksumBuf && checksumBuf.byteLength > 0) {
      const arr = new Uint8Array(checksumBuf);
      let s = "";
      for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
      hex = s;
    }
  } catch { /* fall through */ }
  if (!hex) {
    const meta = obj && obj.customMetadata && obj.customMetadata.sha256;
    if (typeof meta === "string" && /^[a-f0-9]{64}$/i.test(meta)) {
      hex = meta.toLowerCase();
    }
  }
  if (hex) {
    headers.set("X-Artifact-SHA256", hex);
  }
  // Always expose the header so the verify page can read it on HEAD,
  // even when the value is absent (it'll fall back to manual compare).
  const existing = headers.get("Access-Control-Expose-Headers");
  const next = existing ? `${existing}, X-Artifact-SHA256` : "X-Artifact-SHA256";
  headers.set("Access-Control-Expose-Headers", next);
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
    schema: "website-health-v1",
    ok: true,
    service: "weareone-link.org",
    protocol_version: env.PROTOCOL_VERSION || "1",
    native_transport_ready: false,
    native_transfer_requirement: env.NATIVE_TRANSFER_CAP || "NATIVE_TRANSFER_V1",
    timestamp: new Date().toISOString(),
  });
}

// -----------------------------------------------------------------------------
// /api/capabilities - non-authoritative website requirement advertisement
// -----------------------------------------------------------------------------
function capabilities() {
  // These identifiers are product requirements tracked by the website build.
  // They are deliberately NOT returned as implemented capabilities. A future
  // live daemon inventory must be authenticated, versioned, and backed by
  // acceptance evidence before a client may promote it as authoritative.
  const requirements = [
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
  ];
  return json({
    schema: "website-capability-requirements-v1",
    authoritative: false,
    signed: false,
    reviewed_at: "2026-07-22",
    source: "hard-coded website build; not queried from a daemon",
    capabilities: [],
    implemented_capabilities: [],
    requirements,
    evidence: {
      daemon_inventory: "not-connected",
      acceptance_suite: "not-published",
      release_binding: "not-published",
    },
  });
}

// -----------------------------------------------------------------------------
// /api/topology - explicit topology availability status
//
// The relay registry is not wired. This endpoint must fail closed instead of
// returning shape-compatible zeros that a client could mislabel as live relay
// or daemon telemetry.
// -----------------------------------------------------------------------------
async function topology(env) {
  // Stub until a versioned, authenticated relay registry is wired.
  const now = Date.now();
  return json({
    schema: "topology-status-v1",
    authoritative: false,
    issued_at: new Date(now).toISOString(),
    active_nodes: null,
    active_relays: null,
    field_snapshot: null,
    relay_health: null,
    scope: "stub-not-production-inventory",
    note: "No authoritative relay registry is deployed for this website build.",
  });
}

// -----------------------------------------------------------------------------
// /api/attest/:sha - published release attestation
// -----------------------------------------------------------------------------
const MAX_ATTESTATION_BYTES = 256 * 1024;

async function attestation(env, sha) {
  if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
    return json({ error: "invalid sha256" }, { status: 400 });
  }
  const normalizedSha = sha.toLowerCase();

  // Fail closed. dist/attestations contains schema fixtures and historical
  // development samples, not proof for the rolling artifacts routed by
  // /download/*. A deployment must explicitly opt in after the immutable
  // release pipeline has uploaded matching documents to R2.
  if (env?.RELEASE_ATTESTATIONS_READY !== "true") {
    return json(
      {
        error: "release attestation unavailable",
        sha: normalizedSha,
        status: "not-published",
        // Say WHICH attestation is missing. GitHub build provenance IS
        // published for the rolling artifacts, so a bare "no attestation"
        // understates what a user can check, while this endpoint's stronger
        // claim (an Ed25519-signed document bound to the artifact and verified
        // against a pinned key) genuinely does not exist yet.
        note:
          "No One Link signed artifact-bound attestation is published for the "
          + "current rolling build. A GitHub build-provenance attestation is "
          + "published separately: verify it with gh attestation verify.",
      },
      { status: 404 }
    );
  }

  if (!env.ATTESTATIONS) {
    return json(
      {
        error: "release attestation store unavailable",
        sha: normalizedSha,
        status: "misconfigured",
      },
      { status: 503 }
    );
  }

  let obj;
  try {
    obj = await env.ATTESTATIONS.get(`${normalizedSha}.json`);
  } catch {
    return json(
      {
        error: "release attestation store request failed",
        sha: normalizedSha,
        status: "storage-error",
      },
      { status: 503 }
    );
  }

  if (!obj) {
    return json(
      { error: "no attestation on file for this sha", sha: normalizedSha, status: "not-published" },
      { status: 404 }
    );
  }

  // Attestations are small signed JSON documents. Parse and minimally bind
  // the document to the requested artifact before publishing it. This avoids
  // labelling an arbitrary or malformed R2 object as a release attestation.
  if (typeof obj.size === "number" && obj.size > MAX_ATTESTATION_BYTES) {
    return json(
      { error: "release attestation document is too large", sha: normalizedSha, status: "invalid-document" },
      { status: 503 }
    );
  }

  let document;
  try {
    document = await obj.json();
  } catch {
    return json(
      { error: "release attestation document is invalid JSON", sha: normalizedSha, status: "invalid-document" },
      { status: 503 }
    );
  }

  const artifactSha = document?.artifact?.sha256;
  const ed25519Signature = Array.isArray(document?.signatures)
    ? document.signatures.find(entry => entry?.scheme === "ed25519")
    : null;
  const structurallyBound = typeof artifactSha === "string"
    && artifactSha.toLowerCase() === normalizedSha
    && /^[a-f0-9]{64}$/i.test(ed25519Signature?.public_key_hex || "")
    && /^[a-f0-9]{128}$/i.test(ed25519Signature?.signature_hex || "");
  if (!structurallyBound) {
    return json(
      {
        error: "release attestation is not bound to the requested artifact",
        sha: normalizedSha,
        status: "invalid-document",
      },
      { status: 503 }
    );
  }

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-One-Link-Attestation-Status": "published",
    // The browser verifier checks the signature against its pinned key. The
    // API only asserts that a structurally valid document was published.
    "X-One-Link-Attestation-Signature": "present-unverified",
  });
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
  for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
  return new Response(JSON.stringify(document), { headers });
}

// -----------------------------------------------------------------------------
// POST /api/session - ephemeral registration plus capability advertisement
//
// Returns: {
//   server_x25519:       hex (32 bytes, REAL Worker-side WebCrypto-generated)
//   server_mlkem768_pk:  null  (deferred until WASM-in-Worker tooling ships)
//   session_id:          hex (16 bytes)
//   handshake_version:   "session-registration-v1+x25519-advertised+mlkem768-pending"
// }
//
// The Worker mints a fresh X25519 keypair via WebCrypto every restart, holds
// it in instance memory (no disk, no KV), and advertises the public half.
// The current browser bridge does not run ECDH against that key, so this
// endpoint must not be described as an established secure session.
//
// The PQ-hybrid half (ML-KEM-768) lands once we bundle ol_pqkem WASM
// for the Workers runtime - the bundler dance is more involved than
// fits in this push; doing it half-right would be worse than a clean
// deferral.
//
// What the browser-side ol_pqkem WASM self-test proves (in-tab only):
//   - both halves of the hybrid KEM compose correctly (Alice <-> Bob
//     locally; see /security/ when PQ-KEM demo ships)
//   - byte-identical to what the daemon would compute
// It does not prove protection of the browser-to-Worker path. Both the client
// key agreement and the Worker's PQ half remain pending.
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
    schema: "website-session-registration-v1",
    registered: true,
    server_x25519: serverKey.publicKeyHex,
    server_mlkem768_pk: null,
    session_id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
    handshake_version: "session-registration-v1+x25519-advertised+mlkem768-pending",
    note:
      "The Worker advertises an ephemeral X25519 public key, but this request " +
      "does not complete client ECDH or ML-KEM-768. Browser-side ol_pqkem WASM " +
      "only performs a local primitive self-test today.",
  });
}

// -----------------------------------------------------------------------------
// GET /native - explicit native-transport availability boundary
// -----------------------------------------------------------------------------
function nativeAdvert() {
  return json({
    schema: "native-transport-status-v1",
    authoritative: true,
    ready: false,
    status: "not-implemented-on-website-worker",
    transport_target: "webtransport-h3",
    accepted_caps: [],
    capability_requirements: [
      "NATIVE_TRANSFER_V1",
      "PAIR_QR_V1",
      "SPHINX_ONION_V1",
      "PQ_HYBRID_V1",
    ],
    session_endpoint: null,
    note: "This endpoint does not accept a native dial, negotiate WebTransport, or prove that a release relay is deployed.",
  }, { status: 501 });
}

// -----------------------------------------------------------------------------
// GET /download/:platform
//
// :platform is one of:
//
//   ``windows`` / ``macos`` / ``linux``  — OS only, arch auto-detected
//                                          from User-Agent, format defaults
//                                          to the native installer (.exe
//                                          installer / .dmg / .AppImage).
//
//   ``<os>-x86_64`` / ``<os>-arm64``    — explicit arch.
//
//   ``<os>[-<arch>]-zip``                — request the portable zip
//                                          instead of the native
//                                          installer (for users who want
//                                          to extract a folder + run
//                                          directly).
//
//   ``source``                           — R2-hosted source archive.
//   ``android`` / ``ios`` / ``openbsd``  — coming-soon page (honest).
//
// Resolution: detect OS + arch + format, choose the matching GitHub asset,
// then redirect. The default remains the mutable ``auto-latest`` prerelease
// so existing supported downloads keep working. A deployment can set
// VERSIONED_RELEASE_TAG to pin all public routes to an explicit v* tag.
//
// Why redirect, not proxy: the auto-latest GitHub release is the single
// source of truth (continuously rebuilt by the One Link repo's CI on
// every push). Redirecting keeps the user on the freshest artifact
// without R2 sync infrastructure, and the URL bar shows github.com so
// the user sees exactly where the bytes are coming from — privacy-by-
// transparency. R2 stays available for ``/download/source`` because the
// source-archive path is the canonical mirror.
// -----------------------------------------------------------------------------

// ``auto-latest`` is a rolling CI artifact channel. It is not an immutable
// release and is not evidence of artifact signing, attestation, or
// reproducibility. VERSIONED_RELEASE_TAG is deliberately opt-in so a future
// version can be promoted without changing the public download URLs.
const GITHUB_REPO = "https://github.com/coherence-energy-labs/one-link";
const VERSIONED_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z](?:[0-9A-Za-z.-]*[0-9A-Za-z])?)?$/;

function releaseDescriptor(env) {
  const configured = typeof env?.VERSIONED_RELEASE_TAG === "string"
    ? env.VERSIONED_RELEASE_TAG.trim()
    : "";
  if (configured && !VERSIONED_RELEASE_TAG_RE.test(configured)) {
    return {
      ok: false,
      error: "VERSIONED_RELEASE_TAG must be an explicit vMAJOR.MINOR.PATCH tag",
    };
  }
  const tag = configured || "auto-latest";
  const versionPinned = Boolean(configured);
  return {
    ok: true,
    channel: versionPinned ? "versioned" : "continuous",
    tag,
    version_pinned: versionPinned,
    // GitHub release assets can still be replaced by a repository maintainer.
    // A tag pins the route name; it does not by itself prove immutability.
    mutable: true,
    immutability: versionPinned ? "not-enforced" : "rolling-channel",
    base_url: `${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}`,
    // These stay unavailable until an artifact-bound, signed release catalog
    // is checked into the Worker. A tag alone is not cryptographic proof.
    integrity: {
      sha256: null,
      signature: "not-published",
      attestation: "not-published",
      reproducible_build: "not-verified",
    },
  };
}

function releaseHeaders(release) {
  return {
    "X-One-Link-Release-Channel": release.channel,
    "X-One-Link-Release-Tag": release.tag,
    "X-One-Link-Version-Pinned": String(release.version_pinned),
    "X-One-Link-Immutability": release.immutability,
    "X-One-Link-Artifact-Hash": "not-published",
    "X-One-Link-Artifact-Signature": "not-published",
    "X-One-Link-Artifact-Attestation": "not-published",
  };
}

// Parse a "platform spec" — the path segment after /download/. Accepts:
//   windows, macos, linux                      — OS only
//   windows-x86_64, macos-arm64, linux-arm64   — OS + arch
//   windows-x86_64-zip, macos-arm64-zip, …     — OS + arch + format
//   windows-zip                                — OS + default arch + portable
// Plus the legacy plain-OS aliases. Returns null on unparseable input.
function parsePlatformSpec(spec) {
  // Accept what people actually type. "win", "mac", "x64" and a trailing
  // file extension are all ordinary guesses, and every one of them used to
  // return "Nothing here." A download route that only answers its own
  // canonical spelling is a route most visitors never reach.
  let normalized = String(spec || "").toLowerCase().replace(/\/+$/, "");
  const EXTENSION_FORMAT = {
    ".exe": "installer", ".dmg": "installer", ".appimage": "installer",
    ".msi": "installer", ".zip": "zip", ".tar.gz": "zip",
  };
  for (const [ext, fmt] of Object.entries(EXTENSION_FORMAT)) {
    if (normalized.endsWith(ext)) {
      normalized = `${normalized.slice(0, -ext.length)}-${fmt}`;
      break;
    }
  }
  const TOKEN_ALIASES = {
    win: "windows", win32: "windows", win64: "windows",
    mac: "macos", osx: "macos", macosx: "macos", darwin: "macos",
    x64: "x86_64", x86: "x86_64", intel: "x86_64",
    arm: "arm64", apple_silicon: "arm64", applesilicon: "arm64",
    portable: "zip",
  };
  const parts = normalized
    .split("-")
    .filter((p) => p !== "")
    .map((p) => TOKEN_ALIASES[p] || p);
  const head = parts[0];
  const KNOWN_OS = new Set([
    "windows", "macos", "linux", "android", "ios",
    "openbsd", "freebsd", "source",
  ]);
  if (!KNOWN_OS.has(head)) return null;
  const out = { os: head, arch: null, format: null };
  for (const p of parts.slice(1)) {
    if (p === "x86_64" || p === "amd64") {
      if (out.arch !== null) return null;
      out.arch = "x86_64";
    }
    else if (p === "arm64" || p === "aarch64") {
      if (out.arch !== null) return null;
      out.arch = "arm64";
    }
    else if (p === "zip" || p === "portable") {
      if (out.format !== null) return null;
      out.format = "zip";
    }
    else if (p === "installer") {
      if (out.format !== null) return null;
      out.format = "installer";
    }
    else return null;
  }
  // Architectures and packaging formats only make sense for desktop binary
  // routes. Reject misleading forms such as /download/source-arm64 instead
  // of silently ignoring their suffixes.
  if (!["windows", "macos", "linux"].includes(head)
      && (out.arch !== null || out.format !== null)) {
    return null;
  }
  return out;
}

// Heuristic OS + arch detection from the User-Agent header. Used to
// pick a default when the user hit /download/windows (etc.) without
// an explicit arch hint. Apple does not provide a reliable Mac architecture
// signal in the ordinary UA, so macOS returns unknown instead of guessing.
// Detect the visitor's OS from the User-Agent. Powers the
// ``/download/auto`` shortcut so the homepage "Download" CTA goes
// straight to the right installer with one click — no platform
// picker, no intermediate page. Unrecognised UAs return no platform: sending
// an arbitrary Windows build is worse than asking the visitor to choose.
function detectOsFromUA(ua) {
  const s = (ua || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (s.includes("android")) return "android";
  if (s.includes("mac os") || s.includes("macintosh") || s.includes("darwin")) return "macos";
  if (s.includes("windows")) return "windows";
  if (s.includes("linux") || s.includes("ubuntu") || s.includes("debian") || s.includes("fedora")) return "linux";
  if (/freebsd|openbsd|netbsd/.test(s)) return "openbsd";
  return null;
}

function detectArchFromUA(ua, fallbackOs) {
  const s = (ua || "").toLowerCase();
  // Windows ARM identifies itself as "Windows NT 10.0; ARM64" or similar.
  if (fallbackOs === "windows") {
    if (s.includes("arm64") || s.includes("arm;")) return "arm64";
    return "x86_64";
  }
  if (fallbackOs === "macos") {
    // Safari and Chromium commonly report "Intel Mac OS X" on both Intel
    // and Apple Silicon. Guessing arm64 here sent Intel users an unusable
    // artifact. Require an explicit architecture route instead.
    return null;
  }
  if (fallbackOs === "linux") {
    if (s.includes("aarch64") || s.includes("arm64")) return "arm64";
    return "x86_64";
  }
  return "x86_64";
}

// Choose the GitHub auto-latest asset name for an (os, arch, format)
// tuple. Returns null when there is no asset for that combination
// (e.g. /download/android — no Android build yet).
function chooseAsset(os, arch, format) {
  if (os === "windows") {
    if (arch !== "x86_64" && arch !== "arm64") return null;
    if (format === "zip") return `one-link-windows-${arch}.zip`;
    // Default + explicit installer both → the per-user Inno Setup .exe.
    return `one-link-setup-${arch}.exe`;
  }
  if (os === "macos") {
    // Only Apple Silicon artifacts currently exist. Never substitute arm64
    // for an x86_64 request and never invent an absent Intel zip.
    if (arch !== "arm64") return null;
    if (format === "zip") return `one-link-macos-${arch}.zip`;
    return `one-link-macos-${arch}.dmg`;
  }
  if (os === "linux") {
    if (arch !== "x86_64" && arch !== "arm64") return null;
    if (format === "zip") return `one-link-linux-${arch}.zip`;
    return `one-link-linux-${arch}.AppImage`;
  }
  return null;
}

async function download(env, platformSpec, request) {
  const release = releaseDescriptor(env);
  if (!release.ok) {
    return json(
      { error: "release routing is misconfigured", detail: release.error },
      { status: 503 }
    );
  }

  // ``auto`` — the homepage "Download" CTA target. Detect everything
  // from the User-Agent and short-circuit straight to the redirect.
  // No platform picker, no intermediate page, no required JS. One
  // click → installer bytes in their Downloads folder.
  if (platformSpec === "auto") {
    const ua = request?.headers.get("User-Agent") || "";
    const detectedOs = detectOsFromUA(ua);
    if (!detectedOs) {
      const accept = (request?.headers.get("Accept") || "").toLowerCase();
      if (!accept.includes("text/html")) {
        return json(
          {
            error: "platform selection required",
            available: [
              "windows-x86_64", "windows-arm64", "macos-arm64",
              "linux-x86_64", "linux-arm64", "source",
            ],
            note: "The User-Agent did not identify a supported platform, so no artifact was selected.",
          },
          { status: 300 }
        );
      }
      const headers = new Headers({
        Location: "/download/",
        "Cache-Control": "no-store",
        Vary: "User-Agent, Accept",
      });
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
      return new Response(null, { status: 302, headers });
    }
    // Android / iOS / OpenBSD don't have installers yet — route to
    // the coming-soon page rather than redirecting to a 404 asset.
    if (detectedOs === "android" || detectedOs === "ios" || detectedOs === "openbsd") {
      return downloadComingSoonPage(detectedOs, detectLanguage(request));
    }
    const detectedArch = detectArchFromUA(ua, detectedOs);
    const asset = chooseAsset(detectedOs, detectedArch, "installer");
    if (asset) {
      const target = `${release.base_url}/${asset}`;
      const headers = new Headers({
        Location: target,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...releaseHeaders(release),
      });
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      return new Response(null, { status: 302, headers });
    }
    // Unknown platform fall-through → coming-soon page in the visitor's
    // language so they at least understand what happened.
    if (detectedOs === "macos") {
      return unavailableMacArchitecture(request, detectedArch);
    }
    return downloadComingSoonPage(detectedOs, detectLanguage(request));
  }

  const parsed = parsePlatformSpec(platformSpec);
  if (!parsed) {
    // A person in a browser gets the platform picker, which is the thing
    // they were looking for. Machine clients keep the explicit JSON 404 and
    // its list of valid specs, so the API contract is unchanged.
    const wantsHtml = (request?.headers.get("Accept") || "")
      .toLowerCase()
      .includes("text/html");
    if (wantsHtml) {
      const headers = new Headers({
        Location: "/download/",
        "Cache-Control": "no-store",
        Vary: "Accept",
      });
      for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
      for (const [k, v] of Object.entries(NEL_OPT_OUT_HEADERS)) headers.set(k, v);
      return new Response(null, { status: 302, headers });
    }
    return json({
      error: "unknown platform",
      available: [
        "auto",
        "windows", "windows-x86_64", "windows-arm64", "windows-x86_64-zip",
        "macos", "macos-arm64", "macos-arm64-zip",
        "linux", "linux-x86_64", "linux-arm64",
        "source",
      ],
      unavailable: ["macos-x86_64", "android", "ios", "openbsd", "freebsd"],
    }, { status: 404 });
  }
  const os = parsed.os;

  // Source archive: served from R2 (the 38 MB tarball is too large to
  // live in the website git history). Both .zip + .tar.gz live in the
  // bucket; UA decides which gets offered as the default — POSIX
  // users get .tar.gz, everyone else gets .zip.
  if (os === "source" && env.RELEASES) {
    const ua = (request?.headers.get("User-Agent") || "").toLowerCase();
    const wantsZip = /windows|iphone|ipad|ios|android|mac os/.test(ua);
    const sourcePrefix = release.version_pinned
      ? `releases/${release.tag}`
      : "latest";
    const key = wantsZip
      ? `${sourcePrefix}/one-link-source.zip`
      : `${sourcePrefix}/one-link-source.tar.gz`;
    let obj;
    try {
      obj = await env.RELEASES.get(key);
    } catch {
      return json(
        {
          error: "source archive store request failed",
          status: "storage-error",
          retryable: true,
        },
        { status: 503 }
      );
    }
    if (obj) {
      const headers = new Headers();
      attachArtifactHash(headers, obj);
      const sourceSha256 = headers.get("X-Artifact-SHA256");
      const accept = (request?.headers.get("Accept") || "").toLowerCase();
      if (accept.includes("application/json")) {
        return json({
          os: "source",
          asset: wantsZip ? "one-link-source.zip" : "one-link-source.tar.gz",
          release: {
            channel: release.channel,
            tag: release.tag,
            version_pinned: release.version_pinned,
            mutable: release.mutable,
            immutability: release.immutability,
          },
          integrity: {
            ...release.integrity,
            sha256: sourceSha256 || null,
          },
          note: sourceSha256
            ? "A transport checksum is available, but no artifact signature or attestation is published."
            : "No artifact-bound reference hash, signature, or attestation is published.",
        });
      }
      headers.set("Content-Type", wantsZip ? "application/zip" : "application/gzip");
      headers.set(
        "Content-Disposition",
        `attachment; filename="${wantsZip ? "one-link-source.zip" : "one-link-source.tar.gz"}"`
      );
      headers.set(
        "Cache-Control",
        "public, max-age=86400"
      );
      for (const [k, v] of Object.entries(releaseHeaders(release))) headers.set(k, v);
      if (headers.has("X-Artifact-SHA256")) {
        headers.set("X-One-Link-Artifact-Hash", "published-unsigned");
      }
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

  if (os === "source") {
    return json(
      {
        error: "source archive store unavailable",
        status: "misconfigured",
        note: "Clone the public repository while the release mirror is unavailable.",
      },
      { status: 503 }
    );
  }

  // Binary platforms: redirect to the matching GitHub auto-latest
  // asset. No R2 sync infrastructure to maintain — the One Link CI
  // continuously rebuilds the auto-latest release on every push to
  // master, and this redirect picks up whatever is freshest.
  if (os === "windows" || os === "macos" || os === "linux") {
    const ua = request?.headers.get("User-Agent") || "";
    const arch = parsed.arch || detectArchFromUA(ua, os);
    const format = parsed.format || "installer";
    const asset = chooseAsset(os, arch, format);
    if (!asset) {
      if (os === "macos") return unavailableMacArchitecture(request, arch);
      return downloadComingSoonPage(os, detectLanguage(request));
    }
    const target = `${release.base_url}/${asset}`;
    // Browser navigation → 302 redirect to GitHub. Programmatic clients
    // that ask for JSON (e.g. ``curl -H 'Accept: application/json'``)
    // get the resolved URL back as JSON so scripts don't have to
    // follow redirects + parse Location headers.
    const accept = (request?.headers.get("Accept") || "").toLowerCase();
    if (accept.includes("application/json")) {
      return json({
        os, arch, format, asset, url: target,
        release: {
          channel: release.channel,
          tag: release.tag,
          version_pinned: release.version_pinned,
          mutable: release.mutable,
          immutability: release.immutability,
        },
        integrity: release.integrity,
        note: release.version_pinned
          ? "Version-pinned GitHub URL. Repository maintainers can still replace the asset; no signature or attestation is published by this route."
          : "Mutable GitHub continuous build. It carries a GitHub build-provenance attestation, but it is not a signed, reproducible, immutable release.",
      });
    }
    const headers = new Headers({
      Location: target,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      ...releaseHeaders(release),
    });
    for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
    return new Response(null, { status: 302, headers });
  }

  // Platforms we don't ship a binary for yet (android, ios, openbsd,
  // freebsd) → coming-soon page. Programmatic clients get JSON 503 so
  // their state machines see it as "not yet" not "redirect."
  const accept = (request?.headers.get("Accept") || "").toLowerCase();
  if (!accept.includes("text/html")) {
    return json(
      { error: "no binary artifact on file yet", os,
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

function unavailableMacArchitecture(request, arch) {
  const explicitIntel = arch === "x86_64";
  const status = explicitIntel ? 503 : 300;
  const payload = {
    error: explicitIntel
      ? "macOS Intel artifact unavailable"
      : "macOS architecture selection required",
    os: "macos",
    arch: arch || null,
    available: ["macos-arm64", "macos-arm64-zip"],
    note: explicitIntel
      ? "No x86_64 macOS artifact is published. This route will not substitute an Apple Silicon build."
      : "A normal macOS User-Agent does not reliably identify Intel versus Apple Silicon. Choose explicitly.",
  };
  const accept = (request?.headers.get("Accept") || "").toLowerCase();
  if (!accept.includes("text/html")) return json(payload, { status });

  const block = {
    label: explicitIntel ? "macOS Intel" : "macOS",
    headline: explicitIntel
      ? "No macOS Intel artifact is published."
      : "Choose your macOS architecture.",
    lede: explicitIntel
      ? "This route will not send you an Apple Silicon artifact or a filename that does not exist. Build from source, or use the Apple Silicon download only on an Apple Silicon Mac."
      : "Browsers do not reliably reveal whether a Mac is Intel or Apple Silicon. Select Apple Silicon below only if that matches your Mac. There is no Intel artifact today.",
    cta: {
      kind: "direct",
      label: "Apple Silicon download",
      href: "/download/macos-arm64",
    },
    note: "Current desktop artifacts are rolling alpha builds carrying GitHub build-provenance attestations. Artifact signing and reproducible-build proof are not published.",
  };
  return downloadComingSoonPage("macos", "en", block, status);
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
    android: { label: "Android", headline: "No Android artifact is published.", lede: "Follow the public repository for build instructions and release status.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Choose Apple Silicon or build from source.", lede: "A rolling Apple Silicon artifact exists. No Intel artifact, Developer ID signature, or notarization proof is published.", cta: { kind: "build", anchor: "#macos" }, note: "Do not bypass Gatekeeper on the assumption that this website verified a publisher signature." },
    windows: { label: "Windows", headline: "A rolling Windows alpha build is available.", lede: "The artifact is not Authenticode-signed and no One Link release signature is published. Treat it as a test build.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Rolling Linux alpha builds are available.", lede: "AppImage and portable zip artifacts are published for x86_64 and arm64. They are not signed production releases; .deb and .rpm packages are not published.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "OpenBSD port pending.", lede: "If you are on OpenBSD you can probably build from source faster than we can write a port. Patches welcome.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "FreeBSD port pending.", lede: "Same story as OpenBSD. Build from source today.", cta: { kind: "source" }, note: null },
    source:  { label: "Source",  headline: "Building from source today.", lede: "AGPL-3.0. Every line of the daemon, every protocol crate, every shader. Clone, read, fork, run your own.", cta: { kind: "clone" }, note: "Requires Rust 1.95+, Python 3.11+, and an internet connection long enough to pull the workspace. Build instructions are in the repo README." },
  },
  es: {
    ios:     { label: "iOS",     headline: "iOS llega vía TestFlight.", lede: "Las apps de iOS solo se instalan por App Store o TestFlight. Aún no estamos en ninguno. Sigue el repo y publicaremos el enlace de TestFlight en cuanto se abra.", cta: { kind: "watch" }, note: "Si quieres un aviso directo en el momento que TestFlight abra, comenta en el issue #1 del repo. No hace falta correo ni registro." },
    android: { label: "Android", headline: "No hay artefacto Android publicado.", lede: "Consulta el repositorio público para instrucciones y estado.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Elige Apple Silicon o compila desde el código.", lede: "Existe un artefacto continuo para Apple Silicon. No se publica artefacto Intel, firma Developer ID ni prueba de notarización.", cta: { kind: "build", anchor: "#macos" }, note: "No esquives Gatekeeper suponiendo que este sitio verificó una firma del editor." },
    windows: { label: "Windows", headline: "Hay una build alfa continua de Windows.", lede: "El artefacto no tiene Authenticode ni una firma de versión One Link publicada. Trátalo como build de prueba.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Hay builds alfa continuas para Linux.", lede: "Se publican AppImage y zip portátiles para x86_64 y arm64. No son versiones de producción firmadas; no se publican paquetes .deb ni .rpm.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port de OpenBSD pendiente.", lede: "Si estás en OpenBSD probablemente puedas compilar desde la fuente más rápido de lo que tardamos en escribir un port. Se aceptan parches.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port de FreeBSD pendiente.", lede: "La misma historia que OpenBSD. Compila desde la fuente hoy.", cta: { kind: "source" }, note: null },
    source:  { label: "Fuente",  headline: "Construyendo desde la fuente hoy.", lede: "AGPL-3.0. Cada línea del daemon, cada crate del protocolo, cada shader. Clónalo, léelo, bifúrcalo, opera el tuyo.", cta: { kind: "clone" }, note: "Requiere Rust 1.95+, Python 3.11+ y una conexión a internet lo bastante larga para descargar el workspace. Las instrucciones de compilación están en el README del repo." },
  },
  fr: {
    ios:     { label: "iOS",     headline: "iOS arrive via TestFlight.", lede: "Les apps iOS ne s'installent qu'à travers l'App Store ou TestFlight. Nous ne sommes encore sur aucun. Suivez le dépôt et nous publierons le lien TestFlight dès qu'il sera ouvert.", cta: { kind: "watch" }, note: "Si vous voulez une alerte directe au moment où TestFlight ouvre, commentez le ticket #1 du dépôt. Pas besoin d'e-mail ni d'inscription." },
    android: { label: "Android", headline: "Aucun artefact Android n'est publié.", lede: "Consultez le dépôt public pour les instructions et l'état.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Choisissez Apple Silicon ou compilez les sources.", lede: "Un artefact continu Apple Silicon existe. Aucun artefact Intel, signature Developer ID ou preuve de notarisation n'est publié.", cta: { kind: "build", anchor: "#macos" }, note: "Ne contournez pas Gatekeeper en supposant que ce site a vérifié une signature d'éditeur." },
    windows: { label: "Windows", headline: "Un build alpha continu Windows est disponible.", lede: "L'artefact n'est pas signé Authenticode et aucune signature de version One Link n'est publiée. Traitez-le comme un build de test.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Des builds alpha continus Linux sont disponibles.", lede: "Des AppImage et zip portables sont publiés pour x86_64 et arm64. Ce ne sont pas des versions de production signées ; aucun paquet .deb ou .rpm n'est publié.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port OpenBSD en attente.", lede: "Si vous êtes sous OpenBSD vous pouvez probablement compiler depuis la source plus vite que nous n'écrivons un port. Les patchs sont les bienvenus.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port FreeBSD en attente.", lede: "Même histoire qu'OpenBSD. Compilez depuis la source aujourd'hui.", cta: { kind: "source" }, note: null },
    source:  { label: "Source",  headline: "Compiler depuis la source aujourd'hui.", lede: "AGPL-3.0. Chaque ligne du daemon, chaque crate du protocole, chaque shader. Clonez, lisez, forkez, exploitez le vôtre.", cta: { kind: "clone" }, note: "Nécessite Rust 1.95+, Python 3.11+, et une connexion internet assez longue pour télécharger le workspace. Les instructions de compilation sont dans le README du dépôt." },
  },
  de: {
    ios:     { label: "iOS",     headline: "iOS kommt via TestFlight.", lede: "iOS-Apps lassen sich nur über den App Store oder TestFlight installieren. Wir sind auf keinem davon. Beobachten Sie das Repo, wir posten den TestFlight-Link in dem Moment, in dem er offen ist.", cta: { kind: "watch" }, note: "Wenn Sie einen direkten Hinweis möchten, sobald TestFlight öffnet, kommentieren Sie Issue #1 im Repo. Keine E-Mail, keine Anmeldung nötig." },
    android: { label: "Android", headline: "Kein Android-Artefakt ist veröffentlicht.", lede: "Anleitungen und Status stehen im öffentlichen Repository.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Apple Silicon wählen oder aus dem Quelltext bauen.", lede: "Ein kontinuierliches Apple-Silicon-Artefakt existiert. Intel-Artefakt, Developer-ID-Signatur und Notarisierungsnachweis sind nicht veröffentlicht.", cta: { kind: "build", anchor: "#macos" }, note: "Umgehen Sie Gatekeeper nicht in der Annahme, diese Website habe eine Herausgebersignatur geprüft." },
    windows: { label: "Windows", headline: "Ein kontinuierlicher Windows-Alpha-Build ist verfügbar.", lede: "Das Artefakt ist nicht Authenticode-signiert; eine One-Link-Releasesignatur ist nicht veröffentlicht. Behandeln Sie es als Test-Build.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Kontinuierliche Linux-Alpha-Builds sind verfügbar.", lede: "AppImage und portable Zip-Artefakte werden für x86_64 und arm64 veröffentlicht. Es sind keine signierten Produktions-Releases; .deb- und .rpm-Pakete sind nicht veröffentlicht.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "OpenBSD-Port ausstehend.", lede: "Wenn Sie unter OpenBSD sind, können Sie wahrscheinlich schneller aus dem Quelltext bauen, als wir einen Port schreiben können. Patches willkommen.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "FreeBSD-Port ausstehend.", lede: "Gleiche Geschichte wie OpenBSD. Bauen Sie heute aus dem Quelltext.", cta: { kind: "source" }, note: null },
    source:  { label: "Quelltext", headline: "Heute aus dem Quelltext bauen.", lede: "AGPL-3.0. Jede Zeile des Daemons, jede Protokoll-Crate, jeder Shader. Klonen, lesen, forken, eigenen betreiben.", cta: { kind: "clone" }, note: "Benötigt Rust 1.95+, Python 3.11+ und eine Internetverbindung, die lange genug ist, um den Workspace zu ziehen. Build-Anweisungen sind in der README des Repos." },
  },
  pt: {
    ios:     { label: "iOS",     headline: "iOS chega via TestFlight.", lede: "As apps iOS só se instalam pela App Store ou TestFlight. Ainda não estamos em nenhuma. Acompanhe o repo e publicaremos o link de TestFlight no momento em que estiver aberto.", cta: { kind: "watch" }, note: "Se quiser um aviso direto no momento em que o TestFlight abrir, comente o issue #1 no repo. Não é preciso e-mail nem registo." },
    android: { label: "Android", headline: "Nenhum artefacto Android está publicado.", lede: "Consulte o repositório público para instruções e estado.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Escolha Apple Silicon ou compile o código.", lede: "Existe um artefacto contínuo para Apple Silicon. Não há artefacto Intel, assinatura Developer ID nem prova de notarização publicados.", cta: { kind: "build", anchor: "#macos" }, note: "Não contorne o Gatekeeper supondo que este site verificou uma assinatura do editor." },
    windows: { label: "Windows", headline: "Está disponível um build alfa contínuo de Windows.", lede: "O artefacto não tem Authenticode e não há assinatura de versão One Link publicada. Trate-o como build de teste.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Há builds alfa contínuos para Linux.", lede: "São publicados AppImage e zip portáteis para x86_64 e arm64. Não são versões de produção assinadas; não há pacotes .deb nem .rpm publicados.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port de OpenBSD pendente.", lede: "Se está em OpenBSD provavelmente consegue compilar a partir do código mais rápido do que nós escrevemos um port. Patches bem-vindos.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port de FreeBSD pendente.", lede: "Mesma história que OpenBSD. Compile a partir do código hoje.", cta: { kind: "source" }, note: null },
    source:  { label: "Código",  headline: "A compilar a partir do código hoje.", lede: "AGPL-3.0. Cada linha do daemon, cada crate do protocolo, cada shader. Clone, leia, faça fork, opere o seu.", cta: { kind: "clone" }, note: "Requer Rust 1.95+, Python 3.11+ e uma ligação à internet suficientemente longa para puxar o workspace. As instruções de compilação estão no README do repo." },
  },
  it: {
    ios:     { label: "iOS",     headline: "iOS arriva tramite TestFlight.", lede: "Le app iOS si possono installare solo dall'App Store o da TestFlight. Non siamo ancora su nessuno dei due. Segui il repo e pubblicheremo il link TestFlight nel momento in cui sarà aperto.", cta: { kind: "watch" }, note: "Se vuoi un avviso diretto nel momento in cui TestFlight apre, lascia un commento sull'issue #1 nel repo. Niente email, niente registrazione." },
    android: { label: "Android", headline: "Nessun artefatto Android è pubblicato.", lede: "Consulta il repository pubblico per istruzioni e stato.", cta: { kind: "build", anchor: "#android" }, note: null },
    macos:   { label: "macOS",   headline: "Scegli Apple Silicon o compila il sorgente.", lede: "Esiste un artefatto continuo per Apple Silicon. Non sono pubblicati artefatto Intel, firma Developer ID o prova di notarizzazione.", cta: { kind: "build", anchor: "#macos" }, note: "Non aggirare Gatekeeper supponendo che questo sito abbia verificato una firma dell'editore." },
    windows: { label: "Windows", headline: "È disponibile una build alfa continua Windows.", lede: "L'artefatto non ha Authenticode e non è pubblicata una firma di release One Link. Trattalo come build di test.", cta: { kind: "build", anchor: "#windows" }, note: null },
    linux:   { label: "Linux",   headline: "Sono disponibili build alfa continue per Linux.", lede: "Sono pubblicati AppImage e zip portatili per x86_64 e arm64. Non sono release di produzione firmate; non sono pubblicati pacchetti .deb o .rpm.", cta: { kind: "build", anchor: "#linux" }, note: null },
    openbsd: { label: "OpenBSD", headline: "Port OpenBSD in sospeso.", lede: "Se sei su OpenBSD probabilmente puoi compilare dal sorgente più velocemente di quanto noi possiamo scrivere un port. Patch benvenute.", cta: { kind: "source" }, note: null },
    freebsd: { label: "FreeBSD", headline: "Port FreeBSD in sospeso.", lede: "Stessa storia di OpenBSD. Compila dal sorgente oggi.", cta: { kind: "source" }, note: null },
    source:  { label: "Sorgente", headline: "Compilare dal sorgente oggi.", lede: "AGPL-3.0. Ogni riga del daemon, ogni crate del protocollo, ogni shader. Clonalo, leggilo, forkalo, esegui il tuo.", cta: { kind: "clone" }, note: "Richiede Rust 1.95+, Python 3.11+ e una connessione internet abbastanza lunga da scaricare il workspace. Le istruzioni di build sono nel README del repo." },
  },
};

const COMING_SOON_CHROME = {
  en: { skipLink: "Skip to content", logoAria: "One Link", navAria: "Main", navHowItWorks: "How it works", navFeatures: "Features", navSecurity: "Security", navAll: "All downloads", titleSuffix: "not yet", ctaPrimary: "Download source today", ctaOthers: "Other platforms", ctaBuild: "Build from source", ctaWatch: "Watch on GitHub", ctaClone: "Clone on GitHub", ctaSource: "Source on GitHub", archiveLine: "The public repository is the canonical source. The release-mirror archive is available only while its R2 object is healthy. AGPL-3.0.", honestLine: "Honest status: supported platforms have mutable rolling alpha artifacts, each with a GitHub build-provenance attestation. No artifact signature, publisher code signing, or reproducibility result is published.", footerBuilt: "Built in the open. AGPL-3.0.", footerNoTracking: "No tracking, no analytics, no cookies.", footerMantra: "we are one" },
  es: { skipLink: "Saltar al contenido", logoAria: "One Link", navAria: "Principal", navHowItWorks: "Cómo funciona", navFeatures: "Funciones", navSecurity: "Seguridad", navAll: "Todas las descargas", titleSuffix: "aún no", ctaPrimary: "Descargar la fuente hoy", ctaOthers: "Otras plataformas", ctaBuild: "Compilar desde la fuente", ctaWatch: "Seguir en GitHub", ctaClone: "Clonar en GitHub", ctaSource: "Fuente en GitHub", archiveLine: "El repositorio público es la fuente canónica. El archivo del espejo de versiones solo está disponible mientras su objeto R2 funcione. AGPL-3.0.", honestLine: "Estado honesto: las plataformas compatibles tienen artefactos alfa continuos y mutables, cada uno con una atestación de procedencia de compilación de GitHub. No se publican firma de artefacto, firma del editor ni resultado reproducible.", footerBuilt: "Construido en abierto. AGPL-3.0.", footerNoTracking: "Sin rastreo, sin analíticas, sin cookies.", footerMantra: "somos uno" },
  fr: { skipLink: "Aller au contenu", logoAria: "One Link", navAria: "Principale", navHowItWorks: "Comment ça marche", navFeatures: "Fonctionnalités", navSecurity: "Sécurité", navAll: "Tous les téléchargements", titleSuffix: "pas encore", ctaPrimary: "Télécharger la source aujourd'hui", ctaOthers: "Autres plateformes", ctaBuild: "Compiler depuis la source", ctaWatch: "Suivre sur GitHub", ctaClone: "Cloner sur GitHub", ctaSource: "Source sur GitHub", archiveLine: "Le dépôt public est la source canonique. L'archive du miroir de version n'est disponible que lorsque son objet R2 est sain. AGPL-3.0.", honestLine: "Statut honnête : les plateformes prises en charge ont des artefacts alpha continus et modifiables, chacun avec une attestation de provenance de build GitHub. Aucune signature d'artefact, signature d'éditeur ou preuve de reproductibilité n'est publiée.", footerBuilt: "Construit à découvert. AGPL-3.0.", footerNoTracking: "Pas de pistage, pas d'analytique, pas de cookies.", footerMantra: "nous sommes un" },
  de: { skipLink: "Zum Inhalt springen", logoAria: "One Link", navAria: "Haupt", navHowItWorks: "So funktioniert es", navFeatures: "Funktionen", navSecurity: "Sicherheit", navAll: "Alle Downloads", titleSuffix: "noch nicht", ctaPrimary: "Quelltext heute herunterladen", ctaOthers: "Andere Plattformen", ctaBuild: "Aus dem Quelltext bauen", ctaWatch: "Auf GitHub beobachten", ctaClone: "Auf GitHub klonen", ctaSource: "Quelltext auf GitHub", archiveLine: "Das öffentliche Repository ist die kanonische Quelle. Das Release-Spiegelarchiv ist nur verfügbar, solange sein R2-Objekt erreichbar ist. AGPL-3.0.", honestLine: "Ehrlicher Status: unterstützte Plattformen haben veränderliche kontinuierliche Alpha-Artefakte, jedes mit einer GitHub-Build-Herkunftsattestierung. Artefaktsignatur, Herausgebersignatur und Reproduzierbarkeitsnachweis sind nicht veröffentlicht.", footerBuilt: "Offen gebaut. AGPL-3.0.", footerNoTracking: "Kein Tracking, keine Analytik, keine Cookies.", footerMantra: "wir sind eins" },
  pt: { skipLink: "Saltar para o conteúdo", logoAria: "One Link", navAria: "Principal", navHowItWorks: "Como funciona", navFeatures: "Funcionalidades", navSecurity: "Segurança", navAll: "Todas as descargas", titleSuffix: "ainda não", ctaPrimary: "Descarregar o código hoje", ctaOthers: "Outras plataformas", ctaBuild: "Compilar a partir do código", ctaWatch: "Acompanhar no GitHub", ctaClone: "Clonar no GitHub", ctaSource: "Código no GitHub", archiveLine: "O repositório público é a fonte canónica. O arquivo do espelho de versões só está disponível enquanto o objeto R2 estiver saudável. AGPL-3.0.", honestLine: "Estado honesto: as plataformas suportadas têm artefactos alfa contínuos e mutáveis, cada um com uma atestação de proveniência de build do GitHub. Não são publicadas assinatura de artefacto, assinatura do editor ou prova de reprodução.", footerBuilt: "Construído em aberto. AGPL-3.0.", footerNoTracking: "Sem rastreamento, sem analítica, sem cookies.", footerMantra: "somos um" },
  it: { skipLink: "Salta al contenuto", logoAria: "One Link", navAria: "Principale", navHowItWorks: "Come funziona", navFeatures: "Funzionalità", navSecurity: "Sicurezza", navAll: "Tutti i download", titleSuffix: "non ancora", ctaPrimary: "Scarica il sorgente oggi", ctaOthers: "Altre piattaforme", ctaBuild: "Compila dal sorgente", ctaWatch: "Segui su GitHub", ctaClone: "Clona su GitHub", ctaSource: "Sorgente su GitHub", archiveLine: "Il repository pubblico è la fonte canonica. L'archivio dello specchio di release è disponibile solo mentre il relativo oggetto R2 è integro. AGPL-3.0.", honestLine: "Stato onesto: le piattaforme supportate hanno artefatti alfa continui e modificabili, ognuno con un'attestazione di provenienza di build GitHub. Non sono pubblicate firma dell'artefatto, firma dell'editore o prova di riproducibilità.", footerBuilt: "Costruito allo scoperto. AGPL-3.0.", footerNoTracking: "Nessun tracciamento, nessuna analitica, nessun cookie.", footerMantra: "siamo uno" },
};

function downloadComingSoonPage(os, lang = "en", overrideBlock = null, status = 200) {
  const repo = "https://github.com/coherence-energy-labs/one-link";
  const L = COMING_SOON_BLOCKS[lang] || COMING_SOON_BLOCKS.en;
  const C = COMING_SOON_CHROME[lang] || COMING_SOON_CHROME.en;
  const b = overrideBlock || L[os] || L.source;
  // Resolve the CTA from its semantic kind so each language uses the right
  // wording without translators duplicating button text per OS.
  const ctaLabel = b.cta.label || (
    b.cta.kind === "build"  ? C.ctaBuild  :
    b.cta.kind === "watch"  ? C.ctaWatch  :
    b.cta.kind === "clone"  ? C.ctaClone  :
    b.cta.kind === "source" ? C.ctaSource : C.ctaSource
  );
  const ctaHref = b.cta.href || (
    b.cta.kind === "build" ? `${repo}${b.cta.anchor || ""}` : repo
  );
  // The site-logo + nav links target the language root + the canonical
  // English content paths (matches every other translated page in the site
  // — translated chrome, English content URLs with hreflang="en").
  const langRoot = lang === "en" ? "/" : `/${lang}/`;
  const navLangAttr = lang === "en" ? "" : ' hreflang="en"';
  // "not yet" is right for a platform with no build (Android, iOS, the BSDs).
  // It is WRONG for macOS, which reaches this page only because a browser
  // cannot reveal Intel vs Apple Silicon -- the body offers a real Apple
  // Silicon download, so titling the tab "not yet" contradicts the page and
  // tells most Mac owners there is nothing for them. Reuse the block's own
  // already-translated headline there instead of inventing a new string.
  const offersADownload = Boolean(b.downloadHref) || os === "macos";
  const titleSuffix = offersADownload
    ? String(b.headline || "").replace(/[.!]+$/, "") || C.titleSuffix
    : C.titleSuffix;
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>One Link ${b.label} &mdash; ${titleSuffix}</title>
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
  return new Response(html, { status, headers });
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
    if (attestMatch) return attestation(env, attestMatch[1]);

    // /download/<spec> where <spec> is windows / macos-arm64 /
    // linux-x86_64-zip / source / etc. Allows lowercase letters,
    // digits, and dashes for the arch + format suffixes.
    // A TRAILING SLASH must not fall through to the static assets. Every
    // other page on this site ends in one (/download/, /features/), so
    // "/download/windows/" is what a person naturally types -- and it used
    // to miss this route entirely and render the generic 404 page.
    const downloadMatch = path.match(/^\/download\/([a-z][a-z0-9_.-]*)\/?$/);
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
    const shareApiMatch = path.match(/^\/api\/share\/([A-Za-z0-9_-]{16})$/);
    if (shareApiMatch && request.method === "GET")
      return shareDownload(env, shareApiMatch[1]);
    const sharePathMatch = path.match(/^\/share\/([A-Za-z0-9_-]{16})\/?$/);
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
// plaintext. Application expiry is scheduled for 24 hours. Provider outages
// can delay physical deletion, so this is not an absolute retention claim.
// A successful consume deletes the R2 object before returning ciphertext.
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
// NAT or carrier-grade gateway share a rate budget. Malformed input collapses
// into one non-identifying bucket; a full address is never used as a DO name.
export function shareRateBucketKey(ip) {
  if (!ip || typeof ip !== "string") return "unknown";
  const candidate = ip.trim().toLowerCase();
  const v4 = candidate.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return `v4:${octets[0]}.${octets[1]}.${octets[2]}`;
    }
    return "unknown";
  }
  if (!candidate.includes(":")) return "unknown";

  // Expand one RFC 4291 "::" run, including an optional dotted-quad tail,
  // then retain exactly the first three 16-bit groups (/48).
  let ipv6 = candidate;
  const dottedTail = ipv6.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedTail) {
    const parts = dottedTail[1].split(".").map(Number);
    if (!parts.every((part) => part >= 0 && part <= 255)) return "unknown";
    const replacement = `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
    ipv6 = ipv6.slice(0, -dottedTail[1].length) + replacement;
  }
  if ((ipv6.match(/::/g) || []).length > 1) return "unknown";
  const halves = ipv6.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return "unknown";
  const missing = 8 - left.length - right.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return "unknown";
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return "unknown";
  }
  return `v6:${groups.slice(0, 3).map((group) => parseInt(group, 16).toString(16)).join(":")}`;
}

async function shareUpload(env, request) {
  if (!env.RELEASES || !env.SHARE_OBJECTS) {
    return json({ error: "share storage unavailable" }, { status: 503 });
  }
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("application/octet-stream")) {
    return json({ error: "expected application/octet-stream" }, { status: 400 });
  }
  const lengthValue = request.headers.get("Content-Length");
  if (lengthValue === null) {
    return json(
      { error: "content-length required", max_bytes: SHARE_MAX_BYTES },
      { status: 411 },
    );
  }
  if (!/^\d+$/.test(lengthValue)) {
    return json({ error: "invalid content-length" }, { status: 400 });
  }
  const expectedBytes = Number(lengthValue);
  if (!Number.isSafeInteger(expectedBytes)) {
    return json({ error: "invalid content-length" }, { status: 400 });
  }
  if (expectedBytes === 0) {
    return json({ error: "empty body" }, { status: 400 });
  }
  if (expectedBytes > SHARE_MAX_BYTES) {
    return json({ error: "too large", max_bytes: SHARE_MAX_BYTES }, { status: 413 });
  }
  if (!request.body) {
    return json({ error: "missing body" }, { status: 400 });
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
    if (!rateRes.ok) {
      console.error(JSON.stringify({ event: "share_rate_unavailable", status: rateRes.status }));
      return json({ error: "share admission control unavailable" }, { status: 503 });
    }
  }

  const id = shareRandomId();
  const expiresAt = Date.now() + SHARE_TTL_MS;

  try {
    const stub = env.SHARE_OBJECTS.get(env.SHARE_OBJECTS.idFromName(id));
    const storeRequest = new Request("https://share-object/store", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Share-Id": id,
        "X-Share-Expires-At": String(expiresAt),
        "X-Share-Bytes": String(expectedBytes),
      },
      body: request.body,
      duplex: "half",
    });
    const stored = await stub.fetch(storeRequest);
    if (!stored.ok) {
      console.error(JSON.stringify({
        event: "share_store_failed",
        status: stored.status,
        share_id_prefix: id.slice(0, 4),
      }));
      return json({ error: "store failed" }, { status: 503 });
    }
  } catch (e) {
    console.error(JSON.stringify({
      event: "share_store_exception",
      error: e?.message || String(e),
      share_id_prefix: id.slice(0, 4),
    }));
    return json({ error: "store failed" }, { status: 503 });
  }

  return json({
    id,
    expires_at: new Date(expiresAt).toISOString(),
    bytes: expectedBytes,
    lifecycle: "single-consumer claim; R2 deletion completes before ciphertext is returned",
    expiry: "Durable Object alarm scheduled for expiry with retry on cleanup failure",
  });
}

async function shareDownload(env, id) {
  if (!env.RELEASES || !env.SHARE_OBJECTS) {
    return json({ error: "share storage unavailable" }, { status: 503 });
  }
  const stub = env.SHARE_OBJECTS.get(env.SHARE_OBJECTS.idFromName(id));
  return stub.fetch("https://share-object/consume", {
    method: "POST",
    headers: { "X-Share-Id": id },
  });
}

// -----------------------------------------------------------------------------
// MeshPresence Durable Object
//
// Holds the in-flight set of visitor sessions for the live "N here right now"
// counter + the mesh-viz dots. In-memory application state is keyed by a
// random session id and includes { geo: {lat, lng}, last_seen_ms }. The region
// is client supplied and coarse; Cloudflare still receives ordinary request
// and connection metadata outside this map. Closed and idle entries are
// removed from the map, without making a claim about provider-level logs.
//
// Wire protocol (JSON over WebSocket):
//   client -> server  { type: "hello",  protocol: 1, geo: {lat, lng} }
//   server -> client  { type: "welcome", self_id: "...", population: N }
//   server -> ALL     { type: "population", n: N }
//   server -> ALL     { type: "peers", peers: [{id, lat, lng}, ...] }
//   client -> server  { type: "ping", to: "<peer-id>" }   (pseudonymous session id)
//   server -> RECIP   { type: "ping", from: "<sender-id>" }
//
// This application code sets no cookies and does not add an access-log store.
// Cloudflare receives the connection IP and other edge metadata. Idle session
// entries are evicted from this in-memory map after 90 seconds.
// -----------------------------------------------------------------------------
const PRESENCE_IDLE_MS = 90_000;
const PRESENCE_BROADCAST_THROTTLE_MS = 1_500;
const PRESENCE_MAX_SESSIONS = 5_000;
const PRESENCE_FRAME_BURST = 30;
const PRESENCE_FRAME_REFILL_PER_SECOND = 5;

export class MeshPresence {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // sessionId -> { ws, geo, lastSeen, validated, frameTokens }
    this.lastBroadcast = 0;
    this.sweepStarted = false;
  }

  randomId() {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
  }

  population() {
    let total = 0;
    for (const session of this.sessions.values()) {
      if (session.validated) total++;
    }
    return total;
  }

  consumeFrameBudget(session, rawLength) {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - session.frameRefillAt) / 1000);
    session.frameTokens = Math.min(
      PRESENCE_FRAME_BURST,
      session.frameTokens + elapsedSeconds * PRESENCE_FRAME_REFILL_PER_SECOND,
    );
    session.frameRefillAt = now;
    const cost = Math.max(1, Math.ceil(rawLength / 4096));
    if (session.frameTokens < cost) return false;
    session.frameTokens -= cost;
    return true;
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
      if (evicted) {
        this.broadcast({ type: "population", n: this.population() });
        this.maybeBroadcastPeers();
      }
      setTimeout(tick, 30_000);
    };
    setTimeout(tick, 30_000);
  }

  peersSnapshot() {
    return Array.from(this.sessions.entries())
      .filter(([, session]) => session.validated)
      .map(([id, session]) => ({
        id,
        lat: session.geo?.lat ?? 0.5,
        lng: session.geo?.lng ?? 0.5,
      }));
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const s of this.sessions.values()) {
      if (!s.validated) continue;
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
    if (!s?.validated) return;
    try {
      s.ws.send(JSON.stringify({ type: "peers", peers: this.peersSnapshot() }));
    } catch {}
  }

  handleMessage(sessionId, raw) {
    if (typeof raw !== "string" || raw.length > 140_000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "hello": {
        if (session.validated || msg.protocol !== 1 || !msg.geo || typeof msg.geo !== "object") {
          try { session.ws.close(1008, "invalid hello"); } catch {}
          return;
        }
        const lat = Number(msg.geo.lat);
        const lng = Number(msg.geo.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          try { session.ws.close(1008, "invalid geo hint"); } catch {}
          return;
        }
        session.geo = {
          lat: Math.max(0, Math.min(1, lat)),
          lng: Math.max(0, Math.min(1, lng)),
        };
        session.validated = true;
        session.lastSeen = Date.now();
        session.ws.send(JSON.stringify({
          type: "welcome",
          self_id: sessionId,
          population: this.population(),
        }));
        this.broadcast({ type: "population", n: this.population() });
        // 1. Direct: tell the new tab who's already here (bypasses throttle).
        this.sendPeersTo(sessionId);
        // 2. Throttled broadcast: tell everyone else about the new tab.
        this.maybeBroadcastPeers();
        break;
      }
      case "heartbeat": {
        if (!session.validated || !this.consumeFrameBudget(session, raw.length)) return;
        session.lastSeen = Date.now();
        break;
      }
      case "ping": {
        if (!session.validated || !this.consumeFrameBudget(session, raw.length)) return;
        session.lastSeen = Date.now();
        const target = this.sessions.get(msg.to);
        if (target?.validated && msg.to !== sessionId) {
          try {
            target.ws.send(JSON.stringify({ type: "ping", from: sessionId }));
          } catch {}
        }
        break;
      }

      // -------------------------------------------------------------------
      // STRANGER CHAT relay (pseudonymous and Cloudflare-relayed). Content is
      // encrypted after the ol_pair_qr exchange; typing remains locked until
      // both clients report an out-of-band five-word SAS comparison.
      // -------------------------------------------------------------------
      // chat-request : "Alice asks Bob to open a chat"
      // chat-accept  : Bob returns the handshake response
      // SAS confirmations travel inside authenticated chat-msg ciphertext;
      // the relay cannot forge that control payload.
      // chat-decline : "Bob declines"
      // chat-msg     : bounded encrypted frame (client enforces 280 plaintext chars)
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
        if (!session.validated || !this.consumeFrameBudget(session, raw.length)) return;
        session.lastSeen = Date.now();
        const target = this.sessions.get(msg.to);
        if (target?.validated && msg.to !== sessionId) {
          try {
            const out = { type: msg.type, from: sessionId };
            const frameField = {
              "chat-request": "invite_hex",
              "chat-accept": "response_hex",
              "chat-confirm": "confirm_hex",
            }[msg.type];
            if (frameField) {
              const value = msg[frameField];
              if (typeof value !== "string"
                  || value.length < 2
                  || value.length > 131_072
                  || value.length % 2 !== 0
                  || !/^[0-9a-f]+$/i.test(value)) break;
              out[frameField] = value;
            }
            target.ws.send(JSON.stringify(out));
          } catch {}
        }
        break;
      }

      // Encrypted message frame: { iv_b64, ct_b64 }. The DO forwards
      // verbatim. It cannot decrypt; the key never touches the server.
      case "chat-msg": {
        if (!session.validated || !this.consumeFrameBudget(session, raw.length)) return;
        session.lastSeen = Date.now();
        const target = this.sessions.get(msg.to);
        if (target?.validated && msg.to !== sessionId
            && typeof msg.iv_b64 === "string"
            && typeof msg.ct_b64 === "string"
            && msg.iv_b64.length > 0
            && msg.iv_b64.length <= 24
            && msg.ct_b64.length > 0
            && msg.ct_b64.length <= 1024
            && msg.iv_b64.length % 4 === 0
            && msg.ct_b64.length % 4 === 0
            && /^[A-Za-z0-9+/]*={0,2}$/.test(msg.iv_b64)
            && /^[A-Za-z0-9+/]*={0,2}$/.test(msg.ct_b64)) {
          try {
            target.ws.send(JSON.stringify({
              type: "chat-msg",
              from: sessionId,
              iv_b64: msg.iv_b64,
              ct_b64: msg.ct_b64,
              ts: Date.now(),
            }));
          } catch {}
        }
        break;
      }
    }
  }

  async fetch(request) {
    if (this.sessions.size >= PRESENCE_MAX_SESSIONS) {
      return json({ error: "website presence is at capacity" }, { status: 503 });
    }
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];

    let sessionId = this.randomId();
    while (this.sessions.has(sessionId)) sessionId = this.randomId();
    const now = Date.now();
    this.sessions.set(sessionId, {
      ws: server,
      geo: { lat: 0.5, lng: 0.5 },
      lastSeen: now,
      validated: false,
      frameTokens: PRESENCE_FRAME_BURST,
      frameRefillAt: now,
    });

    server.accept();
    this.startSweep();

    server.addEventListener("message", (ev) => {
      this.handleMessage(sessionId, ev.data);
    });
    const cleanup = () => {
      const existing = this.sessions.get(sessionId);
      if (!existing) return;
      this.sessions.delete(sessionId);
      if (existing.validated) {
        this.broadcast({ type: "population", n: this.population() });
        this.maybeBroadcastPeers();
      }
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }
}

// -----------------------------------------------------------------------------
// ShareObject Durable Object - one coordination atom per ciphertext object
//
// A per-share request queue plus durable lifecycle state prevents concurrent
// GETs from both winning. R2 deletion is awaited before ciphertext leaves the
// object. An expiry alarm removes never-consumed objects and reschedules itself
// after provider failures so cleanup is not dependent on a future GET.
// -----------------------------------------------------------------------------
const SHARE_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const SHARE_CLEANUP_RETRY_MS = 5 * 60 * 1000;
const SHARE_TOMBSTONE_MS = 60 * 60 * 1000;

function shareObjectResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(PRIVACY_HEADERS)) headers.set(key, value);
  return new Response(body, { ...init, headers });
}

function shareObjectJson(payload, status) {
  return shareObjectResponse(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export class ShareObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.operation = Promise.resolve();
  }

  enqueue(operation) {
    const run = this.operation.then(operation, operation);
    this.operation = run.then(() => undefined, () => undefined);
    return run;
  }

  validId(id) {
    return typeof id === "string" && /^[A-Za-z0-9_-]{16}$/.test(id);
  }

  async fetch(request) {
    return this.enqueue(() => this.handleFetch(request));
  }

  async handleFetch(request) {
    const url = new URL(request.url);
    const id = request.headers.get("X-Share-Id") || "";
    if (!this.validId(id)) return shareObjectJson({ error: "invalid share id" }, 400);
    if (!this.env.RELEASES) return shareObjectJson({ error: "share storage unavailable" }, 503);

    if (url.pathname === "/store" && request.method === "POST") {
      return this.store(id, request);
    }
    if (url.pathname === "/consume" && request.method === "POST") {
      return this.consume(id);
    }
    return shareObjectJson({ error: "not found" }, 404);
  }

  async store(id, request) {
    const now = Date.now();
    const expiresAt = Number(request.headers.get("X-Share-Expires-At"));
    const expectedBytes = Number(request.headers.get("X-Share-Bytes"));
    if (!Number.isInteger(expiresAt)
        || expiresAt <= now
        || expiresAt > now + SHARE_TTL_MS + 60_000
        || !Number.isInteger(expectedBytes)
        || expectedBytes <= 0
        || expectedBytes > SHARE_MAX_BYTES) {
      return shareObjectJson({ error: "invalid share metadata" }, 400);
    }
    const existing = await this.state.storage.get("lifecycle");
    if (existing) return shareObjectJson({ error: "share id already initialized" }, 409);

    const lifecycle = {
      version: 1,
      id,
      status: "uploading",
      created_at: now,
      expires_at: expiresAt,
      bytes: expectedBytes,
    };
    await this.state.storage.put("lifecycle", lifecycle);
    await this.state.storage.setAlarm(expiresAt);

    try {
      const body = await request.arrayBuffer();
      if (body.byteLength !== expectedBytes || body.byteLength > SHARE_MAX_BYTES) {
        await this.cleanupOrRetry(lifecycle, "upload-size-mismatch");
        return shareObjectJson({ error: "invalid share body" }, 400);
      }
      await this.env.RELEASES.put(`shares/${id}`, body, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
          expires_at: String(expiresAt),
          created_at: String(now),
          lifecycle: "share-object-v1",
        },
      });
      lifecycle.status = "available";
      await this.state.storage.put("lifecycle", lifecycle);
      return shareObjectJson({ stored: true, expires_at: expiresAt }, 201);
    } catch (error) {
      await this.cleanupOrRetry(lifecycle, "upload-failed");
      console.error(JSON.stringify({
        event: "share_object_upload_failed",
        error: error?.message || String(error),
        share_id_prefix: id.slice(0, 4),
      }));
      return shareObjectJson({ error: "store failed" }, 503);
    }
  }

  async consume(id) {
    const now = Date.now();
    const lifecycle = await this.state.storage.get("lifecycle");
    if (!lifecycle || lifecycle.id !== id) {
      return shareObjectJson({ error: "not found or already collected" }, 404);
    }
    if (lifecycle.status === "consumed") {
      return shareObjectJson({ error: "already collected" }, 410);
    }
    if (lifecycle.expires_at <= now) {
      const deleted = await this.cleanupOrRetry(lifecycle, "expired-on-read");
      return shareObjectJson(
        { error: deleted ? "expired" : "expiry cleanup pending" },
        deleted ? 410 : 503,
      );
    }
    if (lifecycle.status !== "available") {
      return shareObjectJson({ error: "share is not available" }, 409);
    }

    lifecycle.status = "consuming";
    lifecycle.claim_started_at = now;
    await this.state.storage.put("lifecycle", lifecycle);
    await this.state.storage.setAlarm(Math.min(lifecycle.expires_at, now + SHARE_CLAIM_TIMEOUT_MS));

    let object;
    try {
      object = await this.env.RELEASES.get(`shares/${id}`);
      if (!object) {
        lifecycle.status = "consumed";
        lifecycle.consumed_at = Date.now();
        await this.state.storage.put("lifecycle", lifecycle);
        await this.state.storage.setAlarm(Date.now() + SHARE_TOMBSTONE_MS);
        return shareObjectJson({ error: "not found or already collected" }, 404);
      }
      if (!Number.isInteger(object.size)
          || object.size <= 0
          || object.size > SHARE_MAX_BYTES
          || object.size !== lifecycle.bytes) {
        throw new Error("stored share metadata size outside enforced bounds");
      }
      const body = await object.arrayBuffer();
      if (body.byteLength !== object.size
          || body.byteLength <= 0
          || body.byteLength > SHARE_MAX_BYTES) {
        throw new Error("stored share size outside enforced bounds");
      }
      // This await is the one-shot commit point. No ciphertext response is
      // released while the R2 object still exists.
      await this.env.RELEASES.delete(`shares/${id}`);
      lifecycle.status = "consumed";
      lifecycle.consumed_at = Date.now();
      delete lifecycle.claim_started_at;
      await this.state.storage.put("lifecycle", lifecycle);
      await this.state.storage.setAlarm(Date.now() + SHARE_TOMBSTONE_MS);

      return shareObjectResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Share-Bytes": String(body.byteLength),
          "X-Share-Lifecycle": "consumed-after-r2-delete-ack",
        },
      });
    } catch (error) {
      lifecycle.status = "available";
      delete lifecycle.claim_started_at;
      await this.state.storage.put("lifecycle", lifecycle);
      await this.state.storage.setAlarm(lifecycle.expires_at);
      console.error(JSON.stringify({
        event: "share_object_consume_failed",
        error: error?.message || String(error),
        share_id_prefix: id.slice(0, 4),
      }));
      return shareObjectJson({ error: "collection failed; retry later" }, 503);
    }
  }

  async cleanupOrRetry(lifecycle, reason) {
    try {
      await this.env.RELEASES.delete(`shares/${lifecycle.id}`);
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      return true;
    } catch (error) {
      lifecycle.status = "cleanup-pending";
      lifecycle.cleanup_reason = reason;
      lifecycle.cleanup_attempted_at = Date.now();
      await this.state.storage.put("lifecycle", lifecycle);
      await this.state.storage.setAlarm(Date.now() + SHARE_CLEANUP_RETRY_MS);
      console.error(JSON.stringify({
        event: "share_object_cleanup_retry",
        reason,
        error: error?.message || String(error),
        share_id_prefix: lifecycle.id.slice(0, 4),
      }));
      return false;
    }
  }

  async alarm() {
    return this.enqueue(async () => {
      const lifecycle = await this.state.storage.get("lifecycle");
      if (!lifecycle) {
        await this.state.storage.deleteAlarm();
        return;
      }
      const now = Date.now();
      if (lifecycle.status === "consumed") {
        await this.state.storage.deleteAlarm();
        await this.state.storage.deleteAll();
        return;
      }
      if (lifecycle.status === "consuming" && lifecycle.expires_at > now) {
        const leaseEnds = Number(lifecycle.claim_started_at || 0) + SHARE_CLAIM_TIMEOUT_MS;
        if (leaseEnds > now) {
          await this.state.storage.setAlarm(Math.min(lifecycle.expires_at, leaseEnds));
          return;
        }
        lifecycle.status = "available";
        delete lifecycle.claim_started_at;
        await this.state.storage.put("lifecycle", lifecycle);
        await this.state.storage.setAlarm(lifecycle.expires_at);
        return;
      }
      if (lifecycle.status === "available" && lifecycle.expires_at > now) {
        await this.state.storage.setAlarm(lifecycle.expires_at);
        return;
      }
      await this.cleanupOrRetry(lifecycle, "expiry-alarm");
    });
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
// State is held in instance memory + DO storage. Each persisted update also
// schedules an idle-expiry alarm; runtime eviction alone would not delete
// Durable Object storage.
// -----------------------------------------------------------------------------
const SHARE_RATE_CAPACITY    = 12;
const SHARE_RATE_REFILL_PER_S = 2 / 60; // 2 per minute
const SHARE_RATE_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    await this.state.storage.setAlarm(Date.now() + SHARE_RATE_IDLE_TTL_MS);
  }

  async alarm() {
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
    this.tokens = null;
    this.lastRefillMs = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    await this.loadState();
    const now = Date.now();
    this.refill(now);

    if (url.pathname === "/check" && request.method === "POST") {
      const cost = Number(url.searchParams.get("cost") || "1");
      if (!Number.isInteger(cost) || cost < 1 || cost > SHARE_RATE_CAPACITY) {
        return new Response(
          JSON.stringify({ error: "invalid token cost" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
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
// Reserved binding only. It does not hold negotiated keys, sequence numbers,
// streams, or an active capability set. Keep it fail-closed until a versioned
// native transport and its acceptance tests are deployed.
// -----------------------------------------------------------------------------
export class NativeSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response(
      JSON.stringify({
        ok: false,
        schema: "native-session-status-v1",
        status: "not-implemented",
        session_durable_object: true,
        note: "No WebTransport session, shared key, or native capability negotiation is established.",
      }),
      {
        status: 501,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
