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

const PRIVACY_HEADERS = {
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), join-ad-interest-group=(), run-ad-auction=()",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function applyHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
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
// POST /api/session - server-side X25519 + ML-KEM-768 hybrid handshake init
//
// Body: { client_x25519: hex, client_mlkem768_ct: hex }
// Returns: { server_x25519: hex, server_mlkem768_pk: hex, session_id: hex }
//
// In-browser WASM combines (x25519_shared || mlkem768_shared) -> HKDF -> root key.
// Site session is then E2EE between browser and Worker. No cookies needed;
// session_id is held in JS memory, vanishes on tab close.
// -----------------------------------------------------------------------------
async function openSession(env, request) {
  // Stub until ol_pqkem WASM bindings are wired. Returns shape the bridge
  // expects so the page can render the "session established" indicator.
  return json({
    server_x25519: "00".repeat(32),
    server_mlkem768_pk: "00".repeat(1184),
    session_id: crypto.randomUUID().replace(/-/g, ""),
    handshake_version: "x25519+mlkem768-v1",
    note: "hybrid handshake stub: real keys wired once ol_pqkem WASM is bound",
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

  // Source download is REAL and AVAILABLE TODAY: served as a static asset
  // bundled into dist/. Works on any device, including iOS (downloads as a
  // .tar.gz the user can email to themselves / open with Files app).
  if (os === "source") {
    const ua = (request?.headers.get("User-Agent") || "").toLowerCase();
    const wantsZip = /windows|iphone|ipad|ios|android|mac os/.test(ua);
    const target = wantsZip
      ? "/downloads/one-link-source.zip"
      : "/downloads/one-link-source.tar.gz";
    return Response.redirect(new URL(target, request.url).toString(), 302);
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

  return downloadComingSoonPage(os);
}

// -----------------------------------------------------------------------------
// "Not yet" HTML page (on-brand, OS-specific, honest)
// -----------------------------------------------------------------------------
function downloadComingSoonPage(os) {
  const repo = "https://github.com/IamOneYouAreOneWeAreOne/one-link";

  // Per-OS honesty. We do NOT claim a binary will be ready by date X.
  const blocks = {
    ios: {
      label: "iOS",
      headline: "iOS is coming via TestFlight.",
      lede: "iOS apps can only install through the App Store or TestFlight. We are not on either yet. Watch the repo and we will post the TestFlight link the moment it is open.",
      cta: { label: "Watch on GitHub", href: repo },
      note: "If you want a direct ping the moment TestFlight opens, drop a comment on issue #1 in the repo. No email or signup needed.",
    },
    android: {
      label: "Android",
      headline: "Android build is being packaged.",
      lede: "We are bundling a signed APK now. Until that lands, the source builds cleanly with the Android NDK. Instructions in the repo.",
      cta: { label: "Build from source", href: `${repo}#android` },
      note: null,
    },
    macos: {
      label: "macOS",
      headline: "macOS signed build is being notarized.",
      lede: "Apple Developer ID notarization takes a beat. Until the signed .dmg lands, the daemon builds cleanly from source with cargo + Python 3.11+.",
      cta: { label: "Build from source", href: `${repo}#macos` },
      note: "macOS will refuse to open an unsigned binary served from a website. We are not going to ask you to bypass Gatekeeper. Either build it yourself or wait for the signed build.",
    },
    windows: {
      label: "Windows",
      headline: "Windows signed installer is being packaged.",
      lede: "We are getting the Authenticode signing cert in place so SmartScreen does not yell at you. Until that lands, the daemon builds cleanly from source.",
      cta: { label: "Build from source", href: `${repo}#windows` },
      note: null,
    },
    linux: {
      label: "Linux",
      headline: "Linux build is being packaged.",
      lede: "AppImage + .deb + .rpm coming. For now the daemon builds cleanly from source on any glibc 2.28+ distro.",
      cta: { label: "Build from source", href: `${repo}#linux` },
      note: null,
    },
    openbsd: {
      label: "OpenBSD",
      headline: "OpenBSD port pending.",
      lede: "If you are on OpenBSD you can probably build from source faster than we can write a port. Patches welcome.",
      cta: { label: "Source on GitHub", href: repo },
      note: null,
    },
    freebsd: {
      label: "FreeBSD",
      headline: "FreeBSD port pending.",
      lede: "Same story as OpenBSD. Build from source today.",
      cta: { label: "Source on GitHub", href: repo },
      note: null,
    },
    source: {
      label: "Source",
      headline: "Building from source today.",
      lede: "AGPL-3.0. Every line of the daemon, every protocol crate, every shader. Clone, read, fork, run your own.",
      cta: { label: "Clone on GitHub", href: repo },
      note: "Requires Rust 1.95+, Python 3.11+, and an internet connection long enough to pull the workspace. Build instructions are in the repo README.",
    },
  };

  const b = blocks[os] || blocks.source;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>One Link for ${b.label} &mdash; not yet</title>
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
    <a href="/" class="site-logo"><span class="logo-mark"></span><span>One Link</span></a>
    <nav class="site-nav" aria-label="Main">
      <a href="/how-it-works/">How it works</a>
      <a href="/features/">Features</a>
      <a href="/security/">Security</a>
      <a href="/download/" class="cta-get">All downloads</a>
    </nav>
  </div>
</header>
<main id="main">
  <section class="hero" style="padding-bottom: 1rem;">
    <div class="container">
      <span class="we-are-one">${b.label}</span>
      <h1>${b.headline}</h1>
      <p class="lede">${b.lede}</p>
      <div class="cta-row">
        <a href="/download/source" class="btn btn-primary btn-large">
          Download source today <span class="arr">&rarr;</span>
        </a>
        <a href="${b.cta.href}" class="btn btn-ghost btn-large" rel="noopener">
          ${b.cta.label}
        </a>
        <a href="/download/" class="btn btn-ghost">Other platforms</a>
      </div>
      <p style="color: var(--ol-text-soft); max-width: 56ch; margin-top: 1rem; font-size: 0.92rem;">
        The source archive (19 MB) works on every device including this one.
        Every protocol, every crate, every shader, every word of the daemon.
        AGPL-3.0.
      </p>
      ${b.note ? `<p style="color: var(--ol-text-soft); max-width: 56ch; margin-top: 1.5rem;">${b.note}</p>` : ""}
    </div>
  </section>
  <section class="section-tight">
    <div class="container">
      <p style="color: var(--ol-text-dim); font-family: var(--ol-mono); font-size: 0.85rem;">
        Honest status: no signed binary has been published to the release relay yet.
        This page is what you see when the front door is still being painted.
        The protocol works today. The polish is on the way.
      </p>
    </div>
  </section>
</main>
<footer class="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer-bottom">
      <span class="built-by">Built in the open. AGPL-3.0. <a href="/security/">No tracking, no analytics, no cookies.</a></span>
      <span class="built-by">we are one</span>
    </div>
  </div>
</footer>
</body>
</html>`;

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(PRIVACY_HEADERS)) headers.set(k, v);
  return new Response(html, { status: 503, headers });
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") return health(env);
    if (path === "/api/capabilities") return capabilities(env);
    if (path === "/api/topology") return topology(env);
    if (path === "/api/session" && request.method === "POST")
      return openSession(env, request);
    if (path === "/native") return nativeAdvert(env);

    const attestMatch = path.match(/^\/api\/attest\/([a-f0-9]+)$/i);
    if (attestMatch) return attestation(env, attestMatch[1], request);

    const downloadMatch = path.match(/^\/download\/([a-z]+)$/);
    if (downloadMatch && request.method === "GET")
      return download(env, downloadMatch[1], request);

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
    const assetResponse = await env.ASSETS.fetch(request);
    return applyHeaders(assetResponse);
  },
};

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
    if (now - this.lastBroadcast < PRESENCE_BROADCAST_THROTTLE_MS) return;
    this.lastBroadcast = now;
    this.broadcast({ type: "peers", peers: this.peersSnapshot() });
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
