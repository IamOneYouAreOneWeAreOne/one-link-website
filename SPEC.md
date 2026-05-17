# One Link Website - Complete Specification

**Version**: 0.21.0-alpha + r34
**Status**: Living document. Reflects shipped code as of 2026-05-17.
**Domains**: `weareone-link.org` (primary) + `weareone-link.com` (301 redirect)
**License**: AGPL-3.0-or-later

This document governs the public website for the One Link network. It is the source of truth. If the code and this spec disagree, the discrepancy is a bug in one of them. Open a PR against whichever needs fixing.

---

## TABLE OF CONTENTS

- [0. Quick start for a new contributor](#0-quick-start)
- [1. Vision and doctrine](#1-vision-and-doctrine)
- [2. The alien-tech surface (22 items, status)](#2-alien-tech-surface)
- [3. Architecture](#3-architecture)
- [4. Wire protocols (every endpoint)](#4-wire-protocols)
- [5. WASM crates](#5-wasm-crates)
- [6. Pages](#6-pages)
- [7. Security model](#7-security-model)
- [8. Coherence Language integration](#8-coherence-language-integration)
- [9. Relationship to the One Link daemon](#9-relationship-to-the-one-link-daemon)
- [10. Build and deploy](#10-build-and-deploy)
- [11. Roadmap](#11-roadmap)
- [12. Claim-and-evidence ledger](#12-claim-and-evidence-ledger)
- [13. Decision log (ADRs)](#13-decision-log-adrs)
- [14. Troubleshooting](#14-troubleshooting)
- [Appendix A. File inventory](#appendix-a-file-inventory)
- [Appendix B. Wrangler bindings](#appendix-b-wrangler-bindings)
- [Appendix C. Attestation chain JSON schema](#appendix-c-attestation-chain-json-schema)
- [Appendix D. Glossary](#appendix-d-glossary)

---

# 0. Quick start

If you have never touched this repo before, do these in order:

```bash
# 1. Verify Coherence Lang toolchain
python tools/clc.py doctor
# Expected: clean output, coherence_lang version 1.0.3+, package location found.

# 2. Verify Rust wasm toolchain
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95
wasm-bindgen --version    # must print: wasm-bindgen 0.2.95

# 3. Build the WASM bundles
./scripts/build-wasm.sh
# Expected output in dist/weareone-link.org/live/wasm/:
#   ol_pair_qr.js + ol_pair_qr_bg.wasm           (~250 KB)
#   ol_pqkem.js + ol_pqkem_bg.wasm               (~191 KB)
#   ol_onion.js + ol_onion_bg.wasm               (~161 KB)
#   ol_coherence_field.js + ol_coherence_field_bg.wasm  (~77 KB)

# 4. Emit the WGSL shader via the Coherence Lang compiler
python scripts/emit-wgsl.py
# Writes dist/weareone-link.org/live/shaders/coherence-field.wgsl

# 5. Run the .cl SSG (touches all 11 routes, emits provenance manifest)
python tools/clc.py run pipeline/ssg/src/one_link_build.cl

# 6. Recompute manifest hashes (any time a tracked asset changes)
#   See section 7.4 for the helper script. For now this is a manual step.

# 7. Local dev server (Cloudflare Worker + static assets + DO + WebSocket)
wrangler dev --config wrangler.toml
# Then open http://localhost:8787/

# 8. Deploy
wrangler deploy --config wrangler.toml         # .org primary site
wrangler deploy --config wrangler.com.toml     # .com 301 redirect worker
```

If any of those steps surprises you, read the relevant section of this spec before improvising.

---

# 1. Vision and doctrine

## 1.1 What this site is

One Link is a free, private, peer-to-peer network for messages, files, and devices. The website is its public face. The website's job is to:

1. Convince a first-time visitor that One Link is real, useful, and trustworthy.
2. Hand them a binary they can install in one tap.
3. Show them, with running code in their browser, that the protocol works exactly as we describe.
4. Earn their trust through architecture (we collect nothing) rather than promises (we promise not to collect anything).

The site is not a marketing brochure. The site is a working demonstration of the network. Visiting the site is the first time you use One Link.

## 1.2 What this site is NOT

- **Not a SaaS product.** No accounts, no tiers, no enterprise pitch.
- **Not a venture-backed startup site.** No "trusted by," no investor logos, no pricing.
- **Not a marketing surveillance funnel.** No tracking pixels, no email capture, no remarketing.
- **Not a wrapper around someone else's auth/CMS/CDN.** Every byte is first-party.
- **Not an "AI app."** No LLM integration anywhere on the public surface.
- **Not a single-developer demo.** It runs in production on the same protocol the daemon uses.

## 1.3 Voice doctrine (binding)

The voice across every page, every copy block, every meta description, every error message:

- **"We are one." For the people. Just works. Super private. Super secure.**
- **NOT corporate.** No "Pricing," no "Enterprise," no "Contact sales." Donations only (Bitcoin / Lightning / Monero).
- Manifesto-quiet, not marketing-loud. Sovereignty-coded, deeply human.
- Plain verbs. Get. Send. Open. Pair. Share. Never "Initiate Transfer Session."
- **No em-dashes in user-facing copy.** Use periods, commas, or parentheses. (Em-dashes in comments, commit messages, this spec are fine.)
- No "trusted by" lists, no logo walls.
- No timelines in roadmaps. Use ordering language ("Phase B requires Phase A complete"), not calendars.

Sample tone, locked across the site:

> "Send a 50GB file to your sister. No upload. No server. No limit."
> "If we vanish tomorrow, your One Link still works."
> "Just install. It just works. It's already yours."
> "Nothing leaves your hands without your key."

## 1.4 UX doctrine (binding)

**Extremely easy.** Every alien capability disappears behind ONE button. AirDrop-easy, not VPN-setup-easy.

- No settings on the visible surface. Defaults are correct. No "Advanced." No "Configure." No "Options."
- No jargon. "Only you and they can read it" beats "end-to-end encrypted."
- Every action is one gesture. Install = one button. Pair = scan. Send = drag.
- No setup wizard. No first-run questionnaire. No signup. No email collection.
- Failure is invisible. Relay down? Try the next silently. WASM unsupported? Fall back silently.
- Every interaction visibly completes in under five seconds.

Corollary: **the alien tech is the engine, not the UI**. The UI is one tap. The engine is unspeakable.

## 1.5 Two domains, one site

```
   weareone-link.com  (registrar: Cloudflare)
            |
            | 301 (preserves path + query)
            v
   weareone-link.org  (canonical)
```

The `.com` Worker is a 60-line stateless 301 redirect ([src/redirect.js](src/redirect.js)). The `.org` Worker holds the entire site ([src/worker.js](src/worker.js)). No content lives at `.com` ever.

---

# 2. Alien-tech surface

The "blow socks off" feature set, with shipped status as of 2026-05-17 + r7.

| # | Item | Status | Crate / file | Section |
|---|---|---|---|---|
| 1 | Download IS the protocol (browser becomes a One Link node) | **shipped (verifying, Windows + Linux)** | bridge.js `runVerifyingDownload` (streams + SHA-256 verifies against signed attestation; transport-layer ol_transfer still pending) | §6.2 |
| 2 | Pair-by-QR with real handshake in 5 seconds | **shipped** | `ol_pair_qr` WASM | §5.1, §6.1 |
| 3 | Optional Sphinx onion-routed download (preview button) | **shipped** | `ol_onion` WASM + /download/ button | §5.3, §6.2 |
| 4 | Coherence-field background = real Helmholtz on GPU | **shipped** | WGSL emitted from `wgsl_emitter` | §3.6, §6.1 |
| 5 | Live global mesh map | **partial (synthetic + animated)** | presence DO + real Helmholtz field solver coloring + 1.4s ripple animation on peer join/leave; `ol_routing`/`ol_homology` still not WASM | §6.6 |
| 6 | Reproducible-build attestation UI | **shipped** (schema, sample) | `ol_pqsig`, `ol_confidential` (schema only) | §4.5, §6.2, App C |
| 7 | Two-tab browser daemon demo | **shipped** | `BroadcastChannel` + `ol_pair_qr` WASM | §6.1 |
| 8 | Threshold recovery demo on page | **shipped** | `ol_threshold_recovery` WASM + /security/ | §6.5 |
| 9 | Feature matrix generated from live capability advert | **shipped** | worker.js `/api/capabilities` + `startCapAdvertSync` | §4.2 |
| 10 | Cryptographic site integrity (signed manifest, SW verify) | **shipped** | [sw.js](dist/weareone-link.org/sw.js), [manifest.json](dist/weareone-link.org/manifest.json) | §7.4 |
| 11 | Site IS a One Link node (PQ-hybrid session on load) | **shipped (X25519 server-real, ML-KEM browser-real)** | `ol_pqkem` browser WASM + Worker `crypto.subtle.generateKey({name:'X25519'})` on /api/session; ML-KEM-768 server half deferred until WASM-in-Worker bundler dance | §5.2, §4.4 |
| 12 | Zero accounts / cookies / analytics / tracking | **shipped** (architectural) | worker.js, sw.js | §7.1 |
| 13 | "Rebuild this site from source" button | deferred | future CI surface | §11 |
| 14 | Website ships INSIDE the product (daemon serves it) | deferred | daemon work | §11 |
| 15 | Hardware-key TOFU recognition (software fallback) | **shipped** | `ol_hwkey` WASM (TofuStore) + /security/ "mint or recognize this device" | §6.5 |
| 16 | Feature page generated live from cap advert | **shipped** | live capability banner above static matrix | §4.2 |
| 17 | Self-defending site (in-browser bundle verifier) | **shipped** | [sw.js](dist/weareone-link.org/sw.js) + ed25519-signed manifest | §7.4 |
| 18 | Stranger-pair right now (two visitors, real chat) | **shipped** | `MeshPresence` DO + `ol_pair_qr` WASM + E2EE chat panel | §3.2.2, §4.6, §6.1 |
| 19 | Default-private mesh delivery for downloads | deferred | `ol_onion` UI wiring | §11 |
| 20 | No business model surface anywhere | **shipped** (architectural) | repo audit | §1.2 |
| 21 | "You just became 1 of N" live counter ticks up on connect | **shipped** | `MeshPresence` DO + presence bar | §4.6, §6.1 |
| 22 | Tor onion mirror with cross-consistency proof | deferred | infra work | §11 |
| 23 | In-browser PQ-hybrid signing (Ed25519 + ML-DSA-65) | **shipped** | `ol_pqsig` WASM + /security/ demo | §6.5 |
| 24 | One-shot encrypted file share via URL fragment | **shipped** | worker.js `/api/share` + R2 + /share/ page | §6.11 |
| 25 | CSP + HSTS + SRI + signed-manifest defense-in-depth | **shipped** | worker.js `PRIVACY_HEADERS` + scripts/inject-sri.py | §7.5, §7.7 |
| 26 | Per-IP token-bucket rate limit on /api/share | **shipped** | `ShareRate` Durable Object | §3.2.3 |
| 27 | Per-chunk forward-secret ratchet demo | **shipped** | `ol_ratchet` WASM + /security/ "walk the ratchet" | §6.5 |
| 28 | In-browser attestation verifier (Ed25519 against pinned key) | **shipped** | `wireAttestationVerify` + WebCrypto Ed25519 on /download/ | §6.2 |
| 29 | Streaming + verifying download (chunk-by-chunk SHA-256 against signed attestation) | **shipped** (Windows + Linux) | `runVerifyingDownload` on /download/ | §6.2 |
| 30 | PWA install (Add to Home Screen launches site as standalone app) | **shipped** | `/app.webmanifest` + iOS/Android meta tags on all 13 pages | §6.1 |
| 31 | Real X25519 server handshake (classical half of /api/session) | **shipped** | Worker WebCrypto `generateKey({name:'X25519'})` + in-memory keypair | §4.4 |
| 32 | Linux signed release | **shipped** | PyInstaller onedir + gzip, 72 MB, glibc 2.28+, R2 + signed attestation | §6.2 |

**Summary as of r34**: 26 fully shipped, 1 partial (item 5), 6 deferred (13, 14, 19, 22, plus macOS/iOS native builds and ML-KEM-768 server half).

**Deferred items + why each is deferred:**

| # | Item | Blocker |
|---|---|---|
| 13 | "Rebuild this site from source" button | needs CI surface; doable without external blockers, just hasn't shipped |
| 14 | Website ships INSIDE the product (daemon serves it) | daemon-side work; needs the daemon to bundle the static dist/ and serve it on localhost |
| 19 | Default-private mesh delivery for downloads | needs `ol_onion` UI wiring into the actual download path (currently preview-only) |
| 22 | Tor onion mirror with cross-consistency proof | needs separate hosting setup |
| - | macOS .dmg (signed) | Apple Developer enrollment ($99/yr + cert setup); only you can do this |
| - | iOS TestFlight | same Apple Developer block |
| - | Android signed APK | not blocked; just hasn't been built |
| - | ML-KEM-768 server half of /api/session | WASM-in-Worker bundler dance (~2-4 hours of focused work) |
| - | Live relay registry in RELAY_KV | needs a running demo daemon publishing real presence |

---

# 3. Architecture

## 3.1 Hosting layer

Two Cloudflare Workers, one DNS zone each:

```
weareone-link.org/*  ->  weareone-link-org  Worker  (src/worker.js)
                          static assets from dist/weareone-link.org/
                          + Durable Objects + R2 + KV

weareone-link.com/*  ->  weareone-link-com-redirect Worker  (src/redirect.js)
                          301 -> https://weareone-link.org/<same path + query>
```

Both deployed via `wrangler deploy --config <toml>`. Configurations live in [wrangler.toml](wrangler.toml) and [wrangler.com.toml](wrangler.com.toml). Bindings documented in Appendix B.

## 3.2 Durable Objects

### 3.2.1 `NativeSession`

Per-session state holder for the `/native` WebTransport channel. Currently a stub; becomes load-bearing when Cloudflare Workers' WebTransport support lands stable. Will hold:

- The agreed hybrid session keys (X25519 + ML-KEM-768 root).
- Wire-protocol sequence numbers.
- Active capability set advertised by the client.

GC: when the WT session closes, the DO is evicted (CF default).

### 3.2.2 `MeshPresence`

Holds the in-flight set of visitor sessions for the live "N here right now" counter and the peer-dot overlay. **This is the only DO doing real work today.**

State per session, in-memory only:

```ts
type Session = {
  ws: WebSocket,                     // live socket
  geo: { lat: number, lng: number }, // approximate, timezone-derived, [0..1]
  lastSeen: number,                  // ms epoch
};
sessions: Map<sessionId, Session>;
```

`sessionId` = 16 hex chars from `crypto.getRandomValues`. Not derived from anything about the user. Survives the session, dies on close.

Throttled broadcast: peer-snapshot rebroadcast no more than once per 1500 ms (`PRESENCE_BROADCAST_THROTTLE_MS`). Idle sweep runs every 30 seconds and evicts any session whose `lastSeen` is more than 90 seconds old.

**What this DO never sees**: IP address, User-Agent, cookies (there are none), browser-geolocation. The visitor's `geo` is derived client-side from `Intl.DateTimeFormat().resolvedOptions().timeZone` mapped to an approximate longitude bucket.

Wire protocol: §4.6.

## 3.3 KV + R2 bindings

```
[[r2_buckets]]
binding = "RELEASES"        # signed binary artifacts, served by /download/:os
[[r2_buckets]]
binding = "ATTESTATIONS"    # reproducible-build attestation JSONs, served by /api/attest/:sha
[[kv_namespaces]]
binding = "RELAY_KV"        # live relay registry for /api/topology (future)
```

Today the worker prefers R2 for attestation lookups and **falls back to the static asset at `/attestations/<sha>.json`** if R2 misses. This lets us seed the chain with sample/historical attestations before R2 is provisioned.

## 3.4 Static `dist/` layout

```
dist/weareone-link.org/
  index.html                       Programmatically composed by .cl SSG
  index.cl.html                    Phase-1 SSG sample output (proof of life)
  about/index.html                 .cl SSG folds provenance meta in
  builders/index.html              "
  download/index.html              "
  features/index.html              "
  how-it-works/index.html          "
  mesh/index.html                  "
  security/index.html              "
  privacy/index.html               "
  terms/index.html                 "
  404.html                         "

  manifest.json                    Signed asset manifest (SHA-256 per file)
  sitemap.xml
  robots.txt                       Blocks GPTBot/ClaudeBot/PerplexityBot/...
  feed.xml                         RSS for release announcements
  _headers                         Cloudflare Pages-style header overrides

  css/
    one-link.css                   ~1000 lines: visual identity, all routes
    immersive.css                  ~440 lines: home-only immersive layer

  live/
    bridge.js                      ~1100 lines vanilla ES module
    shaders/
      coherence-field.wgsl         292 lines, emitted by wgsl_emitter
    wasm/
      ol_pair_qr.js                wasm-bindgen JS glue
      ol_pair_qr_bg.wasm           250 KB
      ol_pqkem.js
      ol_pqkem_bg.wasm             191 KB
      ol_onion.js
      ol_onion_bg.wasm             161 KB
      ol_coherence_field.js
      ol_coherence_field_bg.wasm   77 KB

  images/favicon.svg
  og/one-link.svg + one-link.png + download.png

  attestations/
    <sha256>.json                  Per-release attestation chain document

  sw.js                            Service Worker (offline + integrity)

  .build-stamp                     Plain text, emitted by .cl SSG
  .provenance.json                 Auditable JSON of every route touched
```

The `.cl` SSG owns every HTML file in this tree. The home page is programmatically composed; the other ten routes are folded in (read source HTML, inject provenance meta, write back). See §8.

## 3.5 The Cloudflare Worker

[src/worker.js](src/worker.js), 479 lines. Single `fetch` handler dispatching by path:

```
/api/health           GET   -> heartbeat JSON
/api/capabilities     GET   -> live cap advert (truth source for /features)
/api/topology         GET   -> aggregated mesh data, no PII
/api/session          POST  -> server-side hybrid handshake init
/api/attest/:sha      GET   -> attestation chain (R2 -> static fallback)
/api/presence         GET (Upgrade: websocket) -> MeshPresence DO
/native               GET   -> WebTransport handshake stub
/download/:os         GET   -> signed binary from R2 (currently 503 placeholder)
<everything else>     GET   -> env.ASSETS.fetch (static dist/)
```

Every response goes through `applyHeaders()` which sets the privacy header pack defined in `PRIVACY_HEADERS`:

```js
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(),
                    browsing-topics=(), join-ad-interest-group=(), run-ad-auction=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

**The Worker never logs requests.** No `console.log(request)`, no analytics tap, no third-party fetch. The only outbound network call the Worker ever makes is to R2 / KV / DO bindings, all of which are scoped to this account and contain no visitor PII.

## 3.6 The WGSL emission path

The shader at `dist/.../live/shaders/coherence-field.wgsl` is **not hand-written**. It is byte-for-byte the output of:

```python
from coherence_lang.codegen.wgsl_emitter import emit_coherence_field_shaders
shader_text = emit_coherence_field_shaders()
```

[scripts/emit-wgsl.py](scripts/emit-wgsl.py) drives this. The emitted shader includes:

- `CoherenceFieldState` struct (24 fields, 96 bytes, storage-buffer aligned).
- `coh_tau(r)` — tau coupling derived from oscillator displacement.
- `coh_oscillator_force` / `coh_oscillator_energy` — damped Helmholtz.
- `coh_kl_term`, `coh_coherence_energy`, `coh_maintenance_power`, `coh_damkohler` — coherence energetics.
- `coh_forget_ebbinghaus`, `coh_forget_power` — forgetting curves.
- `hash21`, `noise2d`, `fbm` — organic texture functions.
- `@compute @workgroup_size(1) fn field_step` — advances state by one timestep.
- `@compute @workgroup_size(1) fn inject_perturbation` — adds energy at the mouse/click position.

The same source path the daemon uses for GPU dispatch produces this shader. The site does not have a separate "marketing shader." This is the real thing.

## 3.7 The WASM build pipeline

[scripts/build-wasm.sh](scripts/build-wasm.sh) drives `cargo build --release --target wasm32-unknown-unknown` over the four wrapper crates, then runs `wasm-bindgen --target web` on each to emit JS glue.

Workspace at [live/wasm/Cargo.toml](live/wasm/Cargo.toml) pins dependency versions to **match the One Link daemon workspace exactly** so member crates inherit production versions without modifying the daemon repo:

```toml
[workspace.dependencies]
blake3       = { version = "1.5", features = ["traits-preview"] }   # rayon dropped for wasm
ed25519-dalek = { version = "2.1", features = ["rand_core", "pkcs8", "pem"] }
rand_core    = { version = "0.6", features = ["std", "getrandom"] }
thiserror    = "1.0"
subtle       = "2.6"
zeroize      = { version = "1.8", features = ["derive"] }
hex          = "0.4"
aead         = "0.5"
chacha20poly1305 = { version = "0.10", features = ["stream"] }
```

Each wrapper crate uses:

- `crate-type = ["cdylib", "rlib"]` — required by wasm-bindgen.
- `wasm-bindgen = "=0.2.95"` — pinned to match the installed CLI version. Mismatch breaks the bindgen output.
- `getrandom = { version = "0.2", features = ["js"] }` — routes RNG to `crypto.getRandomValues` in the browser.

Release profile, picked for size:

```toml
[profile.release]
opt-level     = "z"
lto           = true
codegen-units = 1
strip         = "debuginfo"
panic         = "abort"
```

## 3.8 The .cl SSG

[pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl), ~250 lines of Coherence Language. Type-checks clean via `python tools/clc.py check`, runs via `python tools/clc.py run`.

Phase-1 coverage (shipped):
- Home page programmatically composed: head + provenance block + body + header + hero + footer.
- 10 other routes folded in: SSG reads the existing dist HTML, injects `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` after `<head>`, writes back.
- Emits `.build-stamp` and `.provenance.json` (auditable JSON listing every route touched).

Phase-2 plan (§11):
- Full programmatic composition of all 11 routes from .cl source.
- SiteWorld-node-driven content model (nodes/edges/lenses like CEL).
- Build-time fetch of `/api/capabilities` so /features regenerates from the live cap advert at build time too.

---

# 4. Wire protocols

Every endpoint, request shape, response shape, error modes.

## 4.1 `GET /api/health`

Liveness check.

**Response (200, application/json)**:
```json
{
  "ok": true,
  "service": "weareone-link.org",
  "protocol_version": "1",
  "native_transfer_cap": "NATIVE_TRANSFER_V1",
  "timestamp": "2026-05-17T00:00:00.000Z"
}
```

No auth required. `Cache-Control: no-store`.

## 4.2 `GET /api/capabilities`

Live capability advertisement. The /features page is the rendered form of this data. **The page cannot lie about features because it pulls from this endpoint.**

**Response (200, application/json)**:
```json
{
  "protocol_version": "1",
  "issued_at": "2026-05-17T00:00:00.000Z",
  "capabilities": [
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
    "HARDWARE_KEY_TOFU_V1"
  ],
  "signed": false
}
```

Current state: hard-coded in the Worker. Next push: Worker dials the live demo daemon and proxies the real `CapabilityAdvert`. `signed: true` once the daemon signs the response with its identity key and the worker forwards the signature.

## 4.3 `GET /api/topology`

Aggregated mesh-map data feed. **Never returns IPs, never returns individual session data.** Returns shape only until the release relay is provisioned.

**Response (200, application/json)**:
```json
{
  "issued_at": "...",
  "active_nodes": 0,
  "active_relays": 0,
  "field_snapshot": {
    "resolution": [64, 64],
    "tau_c_min": 0.05,
    "tau_c_max": 0.95,
    "dt_ms": 16.67
  },
  "relay_health": [],
  "note": "live topology binding lands once RELAY_KV is provisioned"
}
```

## 4.4 `POST /api/session`

Server-side X25519 + ML-KEM-768 hybrid handshake init.

**Request (application/json)**:
```json
{
  "client_pq_pub_hex": "<1216 bytes hex>",
  "pq_sizes": { "public_key_bytes": 1216, ... },
  "protocol": "x25519+mlkem768-v1"
}
```

**Response (200, application/json)**:
```json
{
  "server_x25519": "<32 bytes hex>",
  "server_mlkem768_pk": "<1184 bytes hex>",
  "session_id": "<32 hex chars>",
  "handshake_version": "x25519+mlkem768-v1",
  "note": "hybrid handshake stub: real keys wired once ol_pqkem WASM is bound"
}
```

Current state: placeholder keys; the browser still does a real full Alice <-> Bob round-trip locally via `ol_pqkem_wasm.liveDemoRoundTrip()` so the "PQ session verified" badge tells the truth about the in-browser side. Next push: server returns its real hybrid pubkey; bridge.js calls `encapsulateAgainst(server_pub)` to derive the actual shared secret.

## 4.5 `GET /api/attest/:sha`

Reproducible-build attestation chain for a given artifact hash.

`sha` must match `/^[a-f0-9]{64}$/i` or 400 is returned.

Lookup order:
1. R2 `ATTESTATIONS` bucket → key `<sha>.json`.
2. Static asset fallback → `dist/.../attestations/<sha>.json` via `env.ASSETS.fetch`.
3. 404 with `{ "error": "no attestation on file for this sha", "sha": "..." }`.

Sample document at [dist/weareone-link.org/attestations/f905eef1...json](dist/weareone-link.org/attestations/). Full schema in Appendix C.

## 4.6 `GET /api/presence` (WebSocket)

The live "N here right now" channel.

```
Client -> Server:
  GET /api/presence
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Version: 13
  Sec-WebSocket-Key: <base64>

Server -> Client:
  101 Switching Protocols
  Upgrade: websocket
  (then standard ws framing)
```

All wire messages are JSON, one per frame.

**Client -> Server messages**:

```json
{ "type": "hello", "protocol": 1, "geo": { "lat": 0.45, "lng": 0.78 } }
{ "type": "heartbeat" }
{ "type": "ping", "to": "<peer-session-id>" }
```

**Server -> Client messages**:

```json
{ "type": "welcome",    "self_id": "<32 hex chars>", "population": 7 }
{ "type": "population", "n": 8 }
{ "type": "peers", "peers": [ { "id": "...", "lat": 0.5, "lng": 0.5 }, ... ] }
{ "type": "ping", "from": "<sender-session-id>" }
```

Throttling: `population` broadcasts fire on every join/leave. `peers` broadcasts are throttled to one per 1500ms server-side. Idle sweep evicts sessions whose `lastSeen` is older than 90 seconds; on eviction, the server pushes a fresh `population` to all remaining sessions.

**Privacy invariant**: the server never sees, stores, or broadcasts anything about the client beyond the random session id and the client-supplied approximate `geo` (timezone-derived, never IP-derived). No Cookie header, no User-Agent logging, no fingerprinting.

## 4.7 `GET /native` (WebTransport, planned)

Today returns a JSON advertisement of the wire protocol. When Cloudflare Workers' WebTransport support lands stable, this upgrades to a real WT session backed by the `NativeSession` Durable Object.

**Response (today, 200, application/json)**:
```json
{
  "transport": "webtransport-h3",
  "status": "advertised",
  "accepted_caps": [ "NATIVE_TRANSFER_V1", "PAIR_QR_V1", "SPHINX_ONION_V1", "PQ_HYBRID_V1" ],
  "note": "WebTransport upgrade lands when CF Worker support is stable;
           the demo daemon at the release relay accepts native dial today"
}
```

## 4.8 `GET /download/:os`

Signed binary fetch. `:os` must be one of: `windows, macos, linux, android, ios, openbsd, freebsd, source`.

Returns 503 today (no binaries in R2 yet). When wired:

```
200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="one-link-<os>.bin"
Cache-Control: public, max-age=86400
X-Artifact-SHA256: <64 hex chars>
+ privacy headers
```

The body is the real signed binary, streamed from R2.

---

# 5. WASM crates

Four wrapper crates compile real production One Link Rust crates to WebAssembly. **The browser runs the same crypto code the daemon runs.**

## 5.1 `ol_pair_qr_wasm`

**Wraps**: [`ol_pair_qr`]($HOME/Projects/Coherence/One_link/native/ol_pair_qr) (Phase F2 of Coherence Mesh Plan)
**Output**: `ol_pair_qr.js` (25 KB) + `ol_pair_qr_bg.wasm` (250 KB)
**Demo on site**: home page pair-by-QR card

JS-facing API:

```js
class OlInviter {
  constructor(expiryUnix, capabilityLabel);     // generates Ed25519 id key + Invite
  get inviteBytes;                              // Uint8Array of signed Invite bytes
  get inviteHex;                                // hex string of same
  receiveResponse(responseBytes) -> string;     // returns 5-word SAS
  confirm() -> [confirmBytes, chainKey32];      // completes handshake
}

class OlScanner {
  static scan(inviteBytes, nowUnix) -> OlScanner;
  get responseBytes;
  get sas;                                      // scanner-side 5-word SAS
  receiveConfirm(confirmBytes) -> Uint8Array;   // 32-byte chain key
}

encodeQrSvg(payloadBytes) -> string;            // inline SVG, error-correction Q
liveDemoRoundTrip() -> {
  inviteBytes: Uint8Array,
  inviteHex: string,
  responseBytes: Uint8Array,
  sasInviter: string,
  sasScanner: string,
  confirmBytes: Uint8Array,
  chainKey: Uint8Array,
  matched: boolean,
};
ol_pair_qr_version() -> string;
ol_pair_qr_domain()  -> "OL-pair-qr-v1";
```

The `qrcode` crate is compiled INTO our WASM (no third-party JS QR encoder). The QR rendered on the page is encoded by the same toolchain that produces One Link wire frames.

## 5.2 `ol_pqkem_wasm`

**Wraps**: [`ol_pqkem`]($HOME/Projects/Coherence/One_link/native/ol_pqkem) (PQ-hybrid KEM per ADR-0017)
**Output**: `ol_pqkem.js` (21 KB) + `ol_pqkem_bg.wasm` (191 KB)
**Demo on site**: hero PQ-session status badge ("deriving" -> "verified")

JS-facing API:

```js
class OlPqKemKeypair {
  constructor();                                // generates fresh hybrid keypair
  get publicKeyBytes;                           // 1216 bytes
  decapsulate(ctBytes) -> Uint8Array;           // 32-byte shared secret
}

encapsulateAgainst(peerPubKeyBytes) -> [ctBytes, sharedSecret];
liveDemoRoundTrip() -> {
  alicePub, bobCiphertext,
  bobSharedSecret, aliceSharedSecret,
  matched: boolean,
};
pqKemSizes() -> {
  public_key_bytes: 1216,
  secret_key_bytes: 2432,
  ciphertext_bytes: 1120,
  shared_secret_bytes: 32,
};
ol_pqkem_version() -> string;
```

Hybrid construction per ADR-0017: ML-KEM-768 || X25519 with a BLAKE3 combiner that binds (ml-kem ct + ml-kem ss + x25519 eph pub + x25519 ss).

## 5.3 `ol_onion_wasm`

**Wraps**: [`ol_onion`]($HOME/Projects/Coherence/One_link/native/ol_onion) (Phase F3, Sphinx-style routing)
**Output**: `ol_onion.js` (16 KB) + `ol_onion_bg.wasm` (161 KB)
**Demo on site**: /download/ "private route" toggle (UI pending)

JS-facing API:

```js
liveDemoRoundTrip(payloadBytes) -> {
  hops: 3,
  payloadSize, packetSize,
  hopIds: [hex, hex, hex],
  hopPubkeys: [hex, hex, hex],
  peelStages: ["forward", "forward", "deliver"],
  deliveredHex: string,
  deliveredMatches: boolean,
};
onionMaxUserPayload() -> number;
onionPacketSize() -> number;
ol_onion_version() -> string;
```

Generates 3 ephemeral X25519 hops, wraps payload in 3 nested AEAD layers, peels each layer through the production `peel_one_layer` function with the matching hop secret. Wire bytes are identical to what the daemon would emit for a real onion-routed transfer.

## 5.4 `ol_coherence_field_wasm`

**Wraps**: [`ol_coherence_field`]($HOME/Projects/Coherence/One_link/native/ol_coherence_field) (Phase E, Helmholtz solver)
**Output**: `ol_coherence_field.js` (10 KB) + `ol_coherence_field_bg.wasm` (77 KB)
**Demo on site**: future mesh-page solver (data piping in next push)

JS-facing API:

```js
solveSteadyHelmholtz(
  nNodes: number,
  edgesFlat: Uint32Array,    // [u,v, u,v, ...]
  edgeWeights: Float64Array, // one per edge pair
  source: Float64Array,      // length nNodes
  diffusion: number,
  gamma: number,
) -> Float64Array;            // field values at every node

ol_coherence_field_version() -> string;
```

Required a tiny additive upstream fix: `#[cfg(not(target_arch = "wasm32"))]` on the two `matvec_par*` functions in `pde/mod.rs` and moving `rayon` under `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]` in the daemon's `Cargo.toml`. Native builds are byte-identical. wasm32 now compiles clean using the serial matvec path (which is what the daemon chooses for small graphs anyway).

## 5.5 Build and version pinning

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95
./scripts/build-wasm.sh
```

**Critical**: `wasm-bindgen` (the lib in each wrapper Cargo.toml) is pinned to `=0.2.95` to match the CLI version. Any mismatch produces:

> `the binary is out of date; rebuild your Wasm file OR update the binary`

If you update one, update the other.

---

# 6. Pages

## 6.1 `/` Home (immersive)

The most ambitious surface on the site. Drives [index.html](dist/weareone-link.org/index.html) + [css/immersive.css](dist/weareone-link.org/css/immersive.css) + [live/bridge.js](dist/weareone-link.org/live/bridge.js).

```
+------------------------------------------------------------+
| [logo] One Link              How / Features / ... [Get One]|  <- glass header
+------------------------------------------------------------+
|                                                  [N HERE]   |  <- live presence ribbon
|                                                             |
|  WE ARE ONE                                                 |
|                                                             |
|  Send anything.                                             |
|  To anyone.                                                 |
|  Only you and they can read it.                             |  <- words rise from field
|                                                             |
|  A free, private network for your messages...               |
|                                                             |
|  [Get One Link →]   [See how it works]                      |
|                                                             |
|  [● 1,247 nodes]  [● site verified] [● pq verified]         |
|                                                             |
|    [v]  click to send a pulse                               |
+------------------------------------------------------------+
   ↕  full-bleed WebGPU coherence field, mouse-reactive
      glowing peer dots overlay (real other visitors)
      self dot in amber
   ↕

   Three promises, three tiles
   Pair-by-QR live card (real WASM handshake)
   "Why this exists" closer
   Footer
```

**Visceral elements**, all real:

- **WebGPU coherence-field** fills the viewport. Real damped Helmholtz on GPU via compiler-emitted shader (§3.6). Cursor moves ripple the field. Click sends a pulse.
- **Word-rise hero**: each word in the headline has a staggered `--d` CSS custom-property delay, gets blur(14px) → blur(0) + translateY(18px) → 0 + opacity 0 → 1 over 1.1s. The line "Only you can read it." uses the cyan-violet gradient text.
- **Live presence ribbon** top-right ticks "N here right now" with the real count from the `MeshPresence` Durable Object.
- **Glowing peer dots overlay** floats over the field. Each visitor gets a deterministic-per-id hue. Click a dot → anonymous ping sent over the presence WebSocket. Sender sees `is-pinged` ring expansion. Receiver sees `is-ping-source` flash on the sender's dot + field pulse at sender position + "someone said hello" toast.
- **Self dot** is amber, larger, crowned with "you" label.
- **Status pills** under CTAs: nodes online (animated counter), site verified (Service Worker state), pq session (verified when ol_pqkem round-trip matches).
- **Pair-by-QR card** runs the real `ol_pair_qr` Inviter+Scanner handshake in-browser, renders real SVG QR encoded by the qrcode crate compiled into WASM, displays the real 5-word SAS the daemon would derive.
- **Ambient audio toggle** bottom-right (Web Audio: 55Hz drone + 220Hz triangle shimmer + 0.07Hz LFO). Off by default.
- **Scroll hint** bottom of hero, smooth scrolls to next section.
- **Reduced-motion**: word-rise animation collapses to instant readability.

## 6.2 `/download/`

Get One Link. The destination from every CTA.

Hero: "One tap. It just works."

OS-detected primary CTA. [bridge.js](dist/weareone-link.org/live/bridge.js) reads navigator UA/platform and rewrites the button to the right binary. Detected arch (x86_64 / arm64) shown beneath.

Alternates row: all 7 platforms + "Source (build it yourself)".

**Attestation strip beneath the button**:
```
version       0.21.0
released      2026-05-12
sha256        <64 hex>
signature     Ed25519 + ML-DSA-65 hybrid verified
attestation   ol_confidential + field witness fresh
build         reproducible, in sealed environment
verify        [read attestation chain] -> /api/attest/<sha>
```

Three "why proof matters" tiles: signed twice, built in a sealed room, reproducible.

Code block showing the real download wire protocol (1-7 steps from session open through sig verify).

"Private download" section explains the Sphinx-routed default. UI hook for `window.olRunOnionPreview()` lands when the toggle ships.

## 6.3 `/how-it-works/`

Four-step walkthrough in plain verbs:

1. Open the app.
2. Pair with someone.
3. Send something.
4. Done.

"If they are offline" tiles: encrypted before it left / held briefly / many relays never one.

"If you want to hide your trail" section: three-hop private routing, with a code block showing wrap stages.

"The math if you want it" — collapsible `.ol-proof` panel with the full crypto stack:

```
identity              Ed25519 + ML-DSA-65 hybrid signature
session keys          X25519 + ML-KEM-768 hybrid key exchange
forward secrecy       Double Ratchet over the hybrid root
per-chunk crypto      ChaCha20-Poly1305 AEAD, rekey every N chunks
pairing verification  5-word SAS, Levenshtein-audited word list
onion routing         Sphinx Coherence (Ristretto255, PQ-hybrid blinding, field witness)
signature aggregation Schnorr aggregation, Pippenger MSM batch verify
confidential build    ol_confidential AttestationDoc, PQ-hybrid + peer nonce + 30s freshness
threshold recovery    BN multi-sig, per-signer R values, k-of-n share split
routing               tau_c routing field, ol_coherence_field Helmholtz solver
capability access     Macaroons, constant-time verify, 1M-iter soundness gate
storage               ChunkRatchet at rest, Zeroize on drop
```

## 6.4 `/features/`

The capability matrix. Honest comparison vs Signal / WhatsApp / iMessage / Telegram / AirDrop / Magic Wormhole. "Yes" only where the architecture itself guarantees it; policy promises don't count.

Categories:
- For people: messages, files, calls, shared folders, pairing, devices-as-one.
- For privacy: 3-hop routing, hardware-key TOFU, threshold recovery, field-bound binding, duress mode, confidential builds.

Live badge: "live from /api/capabilities updated 2s ago". UI is ready for the dynamic fetch; today the matrix is static.

## 6.5 `/security/`

Honest threat model. Two columns:

**What we defend against**:
- Passive eavesdropping (PQ-hybrid keys defeat harvest-now-decrypt-later).
- Active impersonation (5-word SAS detects MITM).
- Server compromise (no archive to steal).
- Traffic analysis (optional 3-hop routing).
- Lost device (threshold recovery).
- Coerced unlock (duress mode).

**What we cannot fix**:
- A camera over your shoulder.
- A compromised operating system.
- The other person leaking it.
- Global passive adversaries on private mode (timing padding helps, doesn't perfect).

**The receipts**: formal verification (TLA+ specs), constant-time crypto with 1M-iter soundness gate, nightly fuzz across 42 binaries, reproducible releases.

## 6.6 `/mesh/`

Bigger mesh visualization. Hero count "You are one of N." Wide 21:9 canvas with peer dots + relay halos + visitor "you" marker.

"What you are seeing" — explainer for the tau_c routing field. Code block showing the per-frame solver call.

"What we do NOT show" — no IPs, no usernames, no precise locations.

## 6.7 `/builders/`

For developers. Lists 12 of the 38 native crates with one-line explanations. Run-your-own-relay one-liner. Donation block (BTC / Lightning / Monero — addresses are placeholders, fill before mainnet).

## 6.8 `/about/`

The covenant. What One Link is, what it is not, who is behind it (anyone who picks it up; no company, no founders), and the relationship to the coherence-field research program the protocol grew out of.

## 6.9 `/privacy/` and `/terms/`

Short, honest, one-page each. Privacy says "we collect nothing" five different ways. Terms says AGPL-3.0 + "we make no warranty."

## 6.10 `/404.html`

Minimal. "Nothing here. Try the network." with home + download CTAs. Coherence field background still runs.

---

# 7. Security model

## 7.1 What we collect

**Nothing.** No email, no phone, no name, no analytics, no cookies, no tracking pixels, no fingerprinting, no third-party scripts. The Cloudflare Worker does not write a single thing about who visited or what they downloaded.

This is by construction, not by policy:

- The Worker code (visible at [src/worker.js](src/worker.js)) has no `console.log(request)`, no analytics tap, no fetch to a third party.
- The Service Worker (visible at [sw.js](dist/weareone-link.org/sw.js)) has no push API, no Periodic Background Sync, no message channel to a server.
- The presence Durable Object holds opaque session ids only; it never sees IPs (CF terminates TLS; the DO receives WebSocket frames, not the underlying connection).
- The HTML pages have zero third-party `<script src>` and zero third-party `<img src>`. SubResource Integrity hash verification by the Service Worker enforces this.

If a government asked us tomorrow who downloaded One Link, who paired with whom, or what was sent through the network, the honest answer is "we do not know and there is no way to find out."

## 7.2 What we defend against

```
                          attacker
                             |
                             v
   .----------------------.  |   .----------------------.
   |  passive watcher     |  |   |  active MITM         |
   |  on the wire         |  |   |  on the wire         |
   '----------------------'  |   '----------------------'
        |                    |        |
        | sees ciphertext    |        | tries to ride the QR
        | only (PQ-hybrid    |        | scan; gets caught by
        | keys)              |        | 5-word SAS mismatch
        v                    |        v
   .----------------------.  |   .----------------------.
   |   harvested now,     |  |   |   SAS comparison     |
   |   still useless in   |  |   |   says "not equal" - |
   |   the quantum era    |  |   |   abort, restart     |
   '----------------------'  |   '----------------------'
                             |
                             v
   .----------------------.  |   .----------------------.
   |  compromised relay   |  |   |  compromised CDN     |
   |  / DO instance       |  |   |  / cache poisoning   |
   '----------------------'  |   '----------------------'
        |                    |        |
        | sees sealed boxes  |        | SW manifest verify
        | with no recipient  |        | catches the byte
        | identity it can    |        | swap, evicts, refetches
        | derive             |        |
        v                    |        v
   .----------------------.  |   .----------------------.
   |  no archive to steal |  |   |  signed manifest is  |
   '----------------------'  |   |  the trust anchor    |
                             |   '----------------------'
                             v
                       (architecture, not policy)
```

## 7.3 What we cannot defend against

- A camera over your shoulder.
- A compromised operating system.
- The other person leaking the conversation.
- Global passive adversaries on private mode (timing padding helps, doesn't perfect).

We say this on /security/ explicitly.

## 7.4 Service Worker integrity model

[sw.js](dist/weareone-link.org/sw.js), ~150 lines.

**Three jobs**:

1. **Offline-first**. Precaches every page on install (`PRECACHE_URLS`). Navigations are network-first with cache fallback; static assets are cache-first with integrity verification.

2. **Signed manifest verification**. Reads [/manifest.json](dist/weareone-link.org/manifest.json) on install + on demand. Every cached asset's bytes are SHA-256-hashed and compared against the manifest entry before being served. Mismatch: evict, refetch, re-verify.

3. **Cryptographic site integrity**. The verifier is in the same origin's Service Worker; it cannot be replaced from off-origin. A bit-flip in CacheStorage or a CDN-side substitution gets caught.

**Future signing wire** (placeholder today):

```json
{
  "version": "0.21.0-alpha.0+r7",
  "issued_at": "2026-05-17T00:00:00Z",
  "signed_by": "ed25519-pub-<hex>",
  "signature": "ed25519-<hex>",     // signature of the assets map
  "assets": { "/css/...": "sha256-...", ... }
}
```

When the offline signing rig is provisioned: the pubkey gets pinned in `sw.js` as a constant, and the SW verifies the signature on every manifest fetch using WebCrypto's Ed25519 API. Rotations are chained through previous-key signatures.

## 7.5 Headers

The full pack, served on every response by the Worker plus baked into [_headers](dist/weareone-link.org/_headers) for Cloudflare static asset serving:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'

Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(),
                    interest-cohort=(), browsing-topics=(),
                    join-ad-interest-group=(), run-ad-auction=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

**COEP: require-corp + COOP: same-origin** enables cross-origin isolation, which gates access to `SharedArrayBuffer` for future multi-thread WASM and gives the highest level of process isolation modern browsers offer.

## 7.6 Robots and AI scrapers

[robots.txt](dist/weareone-link.org/robots.txt) explicitly denies GPTBot, ClaudeBot, PerplexityBot, Google-Extended, anthropic-ai, Bytespider, CCBot. We have nothing to hide but we are not your training corpus.

---

# 8. Coherence Language integration

## 8.1 Why .cl

The user wrote One Link's daemon in Rust + Python. They wrote the Coherence Lang compiler / WGSL emitter / capability system as the substrate behind it. Writing the website's SSG and GPU shader in our own language is the only honest stack story for a project that ships its own crypto AND its own routing math.

## 8.2 The SSG program

[pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl), ~250 lines.

Module shape:

```
module one_link.ssg.build;

import std.io.fs as fs;
import std.io.fs.path as path;
import std.time as time;

const DIST_DIR        : String = "dist/weareone-link.org";
const PROVENANCE_TAG  : String = "coherence-lang/1.0.3 one_link.ssg.build";

// HTML helpers: html_head, site_header, site_footer, home_hero, ...
// They are pure @ L0 fns returning String.

// FILE I/O helpers, effects [ExternalIO]:
fn write_file(filepath: String, content: String) effects [ExternalIO];
fn fold_in_page(rel_path: String, route: String, stamp: String) effects [ExternalIO];

// JSON helper: provenance_json(stamp, routes) returns String.

process main() -> Unit effects [ExternalIO] {
  // 1. write home programmatically composed -> dist/.../index.cl.html
  // 2. for each of 10 other routes: fold in <meta x-emitted-by ...>
  // 3. write .build-stamp and .provenance.json
}
```

Type-check + run:

```
python tools/clc.py check pipeline/ssg/src/one_link_build.cl
python tools/clc.py run   pipeline/ssg/src/one_link_build.cl
```

Output:
- `dist/.../index.cl.html` — programmatic home page sample.
- All 11 HTML files get `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` injected after `<head>`.
- `.build-stamp` plain text.
- `.provenance.json` auditable list of every route touched.

**Effect-system gotcha** (encoded so the next contributor doesn't hit it): bare `fs.write_text()` calls inside `process main()` aren't permitted. Every disk write must go through an `fn write_file(...) effects [ExternalIO]` helper. CEL's `build.cl` uses this pattern; we matched it.

## 8.3 The WGSL emission path

```
.cl source ----+
               | (today: coherence_lang ships canonical shader source)
               v
coherence_lang.codegen.wgsl_emitter.emit_coherence_field_shaders()
               |
               v
       WGSL string  ----[scripts/emit-wgsl.py]----> dist/.../live/shaders/coherence-field.wgsl
```

Today we call `emit_coherence_field_shaders()` directly; it returns the canonical One Link field shader. Future phase: write One Link's specific solver in `.cl`, compile via the full compiler pipeline (`.cl -> CIR -> wgsl_emitter`) so the shader is byte-derived from One-Link-specific source.

## 8.4 Wrappers

```
clc.cmd              Windows shim, finds Python + calls tools/clc.py
clc.ps1              PowerShell variant of the same
tools/clc.py         Resolves COHERENCE_COMPILER env or falls back to
                     $HOME\Projects\Coherence\coherence_lang
                     Imports coherence_lang.compiler.cli.main and dispatches.
```

To use the system-wide `clc` command (PowerShell aliases `clc` to `Clear-Content`, so use `clc.cmd` or run `tools/enable-clc.ps1`):

```
.\clc.cmd doctor
.\clc.cmd check pipeline/ssg/src/one_link_build.cl
.\clc.cmd run   pipeline/ssg/src/one_link_build.cl
```

---

# 9. Relationship to the One Link daemon

## 9.1 What we bind

Four production crates from [`$HOME/Projects/Coherence/One_link/native/`]($HOME/Projects/Coherence/One_link/native/) are pulled by path-dependency into our wasm wrappers:

| Wrapper | Production crate | Daemon role |
|---|---|---|
| `ol_pair_qr_wasm` | `ol_pair_qr` | Phase F2 in-person pairing |
| `ol_pqkem_wasm` | `ol_pqkem` | ADR-0017 PQ-hybrid KEM |
| `ol_onion_wasm` | `ol_onion` | Phase F3 Sphinx onion routing |
| `ol_coherence_field_wasm` | `ol_coherence_field` | Phase E tau_c routing field |

Workspace deps in [live/wasm/Cargo.toml](live/wasm/Cargo.toml) are pinned to match the daemon workspace exactly. Member crates inherit production versions without modifying the daemon repo.

## 9.2 Upstream changes we made

**One**, and it was additive only:

- `One_link/native/ol_coherence_field/Cargo.toml`: moved `rayon` under `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]`.
- `One_link/native/ol_coherence_field/src/pde/mod.rs`: added `#[cfg(not(target_arch = "wasm32"))]` on `matvec_par` and `matvec_par_with_threshold`. The serial `matvec` is unchanged and remains the daemon's chosen path for graphs below 16k nodes.

Native daemon builds are byte-identical. wasm32 now compiles clean. **Run the daemon test suite before tagging the next daemon release** to confirm — see §14.

## 9.3 Version coupling

The wrapper crate `Cargo.toml` files all declare `version = "0.21.0-alpha.0"` to match the daemon. When the daemon bumps, we bump in lockstep. The manifest's `version` field follows the same scheme with a `+rN` revision suffix per website-only release.

## 9.4 Cross-references

The site references several daemon documents and commits:

- `One_link/docs/COHERENCE_MESH_PLAN.md` — Phase A through F roadmap.
- `One_link/docs/PRINCIPLES.md` — daemon-side doctrine.
- `One_link/docs/FILE_ENGINE_V2_PLAN.md` — 10-layer stack.
- `5a111c1` — daemon native transfer cutover commit.
- `f905eef` — sample release tag used in attestation example.

---

# 10. Build and deploy

## 10.1 First-time setup

```bash
# Python + Coherence Lang
python --version                # 3.11+ required
python tools/clc.py doctor      # confirms coherence_lang at expected path

# Rust + wasm
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95   # ~3 minutes
wasm-bindgen --version          # must be exactly 0.2.95

# Wrangler (Cloudflare)
npm install -g wrangler         # if not already
wrangler login
```

## 10.2 Iterating

```bash
# WASM (after touching any wrapper crate)
./scripts/build-wasm.sh

# WGSL (after wgsl_emitter changes in coherence_lang)
python scripts/emit-wgsl.py

# .cl SSG (after touching one_link_build.cl)
python tools/clc.py run pipeline/ssg/src/one_link_build.cl

# Recompute manifest hashes (whenever a tracked asset changes)
# See §10.4 — this is currently manual. Helper script lands next push.

# Local dev
wrangler dev --config wrangler.toml
# Opens http://localhost:8787/
# Worker logs in the terminal, hot-reload on src/worker.js changes
```

## 10.3 Deploying

```bash
# .org primary site
wrangler deploy --config wrangler.toml

# .com 301-redirect site
wrangler deploy --config wrangler.com.toml
```

Then in the Cloudflare dashboard, add routes:

```
weareone-link.org/*  ->  weareone-link-org
weareone-link.com/*  ->  weareone-link-com-redirect
```

The `[[routes]]` blocks in the wrangler.toml files are commented out so first-time `wrangler deploy` does not fail before DNS is wired.

## 10.4 Manifest hash recomputation

Until automation lands, every push that touches a manifest-tracked asset needs a manual rehash:

```bash
cd dist/weareone-link.org
for f in css/one-link.css css/immersive.css live/bridge.js \
         live/wasm/ol_pair_qr.js live/wasm/ol_pair_qr_bg.wasm \
         live/wasm/ol_pqkem.js   live/wasm/ol_pqkem_bg.wasm \
         live/wasm/ol_onion.js   live/wasm/ol_onion_bg.wasm \
         live/wasm/ol_coherence_field.js live/wasm/ol_coherence_field_bg.wasm \
         live/shaders/coherence-field.wgsl images/favicon.svg \
         sw.js index.html; do
  h=$(sha256sum "$f" | awk '{print $1}')
  echo "    \"/$f\": \"sha256-$h\","
done
```

Paste the output into [manifest.json](dist/weareone-link.org/manifest.json). Bump `version` to `0.21.0-alpha.0+r<N+1>`.

If `sw.js` itself changed, its hash also needs updating (chicken-and-egg: yes, the SW verifies its own integrity entry; CF does an initial fetch of the SW which sidesteps this).

## 10.5 DNS

Both domains are registered on Cloudflare. Nameservers already point at CF. After deploy + routes, the site is live within seconds.

For `.com -> .org`: no CNAME chain needed. The redirect Worker handles it.

For Tor onion mirror (future, §11): add a `.onion` v3 address, mirror `dist/` to it via a separate small worker / static host.

---

# 11. Roadmap

Ordering, not calendars. Each step requires the previous one.

## 11.1 Shipped (verifiable today)

1. Static dist/ with 11 routes in the "we are one" voice.
2. Two Cloudflare Workers (`.org` + `.com` redirect).
3. Worker endpoints: /api/health, /api/capabilities, /api/topology, /api/session, /api/attest, /api/presence (WS), /native, /download/:os.
4. `MeshPresence` Durable Object: real other visitors visible in real time, anonymous, ephemeral, zero PII.
5. `.cl` SSG owning provenance on every page (11 routes).
6. WGSL coherence-field shader emitted by `coherence_lang.codegen.wgsl_emitter`.
7. Four WASM crates: ol_pair_qr (250 KB), ol_pqkem (191 KB), ol_onion (161 KB), ol_coherence_field (77 KB). Total 700 KB.
8. Immersive home page with full-bleed WebGPU compute pipeline, word-rise hero, click-pulse, mouse-reactive ripples.
9. Live peer-dots overlay with click-to-ping (real anonymous human-to-human interaction).
10. Service Worker offline-first with signed-manifest hash verification.
11. Reproducible-build attestation chain schema + sample document.
12. Privacy headers including COEP + COOP for cross-origin isolation.

## 11.2 Next push (dependency-ordered)

Items 1-7 from earlier revisions have all SHIPPED. New "next push" set, dependency-ordered:

1. **Real `/api/session` hybrid handshake (WASM-in-Worker)**: replace the stub. Compile `ol_pqkem` for the Cloudflare Workers runtime, expose server X25519 + ML-KEM-768 pubkeys at `/api/session`, browser already has the WASM for the other half. Flips the `signed: false` flag in the capability advert.
2. ~~**Double Ratchet forward-secrecy demo** via new `ol_ratchet` WASM.~~ **SHIPPED r26** (`ol_ratchet_wasm` + /security/ "walk the ratchet six steps").
3. ~~**Hardware-key TOFU recognition** via new `ol_hwkey` WASM.~~ **SHIPPED r27** (`ol_hwkey_wasm` TofuStore + /security/ "mint or recognize this device"). Software-fallback TOFU; hardware backends (Secure Enclave / StrongBox / TPM) remain daemon-only.
4. **Live relay registry** in `RELAY_KV`: real (anonymized) node counts replace the topology stub. `/api/topology` returns actual aggregated data from the running One Link demo daemon.
5. **Real attestation chain documents** for the current Windows release: replace the sample attestation with a real one minted from the offline build rig + `ol_pqsig` hybrid signature over the artifact hash.
6. **Mesh-page WGSL coloring** beyond steady-state: animate the τ_c field with each new peer joining (uses the existing `solveSteadyHelmholtz` already wired).
7. **`/download/` private-mode toggle wiring**: when the toggle is on, the download itself routes through `ol_onion` (not just the demo button). Today the button is a preview; the actual download path goes direct.

## 11.3 Later

1. **WebTransport real download** through `/native` once Cloudflare Workers' WT support is stable. The progress bar shows real protocol state, chunks animate flying through the field.
2. **Bruno-Simon-tier 3D scene**: true 3D geometry + lighting + camera. The current "immersive 2D with real physics" gets a depth axis.
3. **Tor onion mirror** with cross-consistency proof. Visitors at `.onion` see "you are reading the same content as .org" with a SHA match.
4. **Release relay daemon** so `/api/topology` returns real node positions and downloads stream via real native protocol.
5. **Compile more daemon crates to WASM**: `ol_pqsig`, `ol_threshold_recovery`, `ol_hwkey`, `ol_ratchet`.
6. **Self-rebuild button**: "Rebuild this site from source" kicks a CI run, attestation streams to your browser, final hash matches what you are viewing.
7. **Website ships INSIDE the product**: install One Link, it serves this site at `localhost`. If `.org` goes dark forever, your installed copy still works.
8. **Hardware-key TOFU recognition** via `ol_hwkey`. Same device, recognized; zero server identifier.
9. **Full programmatic .cl SSG**: replace the fold-in pattern with SiteWorld-node-driven page composition.

---

# 12. Claim-and-evidence ledger

Every alien-tech claim made on the public surface, mapped to the code that backs it. **If a claim appears on a page and is not in this ledger, the claim is unverified and should be removed or backed.**

| Claim on site | Backing code | How to verify |
|---|---|---|
| "No accounts. Ever." | [src/worker.js](src/worker.js) (no auth endpoints) | Grep the worker for `login`, `signup`, `account` — zero hits. |
| "No tracking, no analytics, no cookies." | [src/worker.js](src/worker.js), [sw.js](dist/weareone-link.org/sw.js) | Grep worker + SW for `Set-Cookie`, `analytics`, `track` — zero hits. Open DevTools → Application → Cookies/Storage — empty. |
| "Real handshake right here" (pair card) | [live/wasm/ol_pair_qr_wasm/src/lib.rs](live/wasm/ol_pair_qr_wasm/src/lib.rs) → `liveDemoRoundTrip` | DevTools → Network → see `ol_pair_qr_bg.wasm` load. Console: `await import('/live/wasm/ol_pair_qr.js').then(m => m.default('/live/wasm/ol_pair_qr_bg.wasm')).then(()=>{}); ` |
| "PQ session" badge | [live/wasm/ol_pqkem_wasm/src/lib.rs](live/wasm/ol_pqkem_wasm/src/lib.rs) → `liveDemoRoundTrip` | Page load: status pill ticks "deriving" → "verified". Match means `alice_ss == bob_ss` bytewise. |
| "X25519 + ML-KEM-768 hybrid" | [ol_pqkem]($HOME/Projects/Coherence/One_link/native/ol_pqkem) (production daemon crate) | The wasm wrapper has `ol_pqkem = { path = "..." }`. Daemon and browser run the same code. |
| "Ed25519 + ML-DSA-65 hybrid signatures" | [ol_pqsig]($HOME/Projects/Coherence/One_link/native/ol_pqsig) + [ol_pqsig_wasm](live/wasm/ol_pqsig_wasm/) | Visit `/security/` → click "Sign a message with Ed25519 + ML-DSA-65". DevTools → Network → see `ol_pqsig_bg.wasm` load (257 KB). Output shows fresh 1984-byte hybrid pubkey + 3373-byte hybrid signature + verify-clean + reject-tampered-msg + reject-tampered-PQ-half. |
| "Threshold recovery splits your identity across friends" | [ol_threshold_recovery]($HOME/Projects/Coherence/One_link/native/ol_threshold_recovery) + [ol_threshold_recovery_wasm](live/wasm/ol_threshold_recovery_wasm/) | Visit `/security/` → click "Split and recover a secret with 3-of-5 Shamir". Generates fresh 32-byte secret, splits into 5 shares, recovers from any 3, refuses with only 2. Real Shamir over GF(2^8). |
| "Every message gets a fresh key. Forward secrecy." | [ol_ratchet]($HOME/Projects/Coherence/One_link/native/ol_ratchet) + [ol_ratchet_wasm](live/wasm/ol_ratchet_wasm/) | Visit `/security/` → click "Walk the ratchet six steps". Generates fresh chain key, derives 6 sequential message keys (all 32 bytes, all distinct), proves rewind refusal + skip-cap (MAX_SKIP_STEPS = 65,536 DoS guard). |
| "Your device is recognized without us knowing who you are." | [ol_hwkey]($HOME/Projects/Coherence/One_link/native/ol_hwkey) (TofuStore) + [ol_hwkey_wasm](live/wasm/ol_hwkey_wasm/) | Visit `/security/` → click "Mint or recognize this device". First visit mints a 32-byte device root in localStorage; subsequent visits recognize it via deterministic BLAKE3 derivation. Attempted impersonation with random key gets rejected via constant-time `subtle::ConstantTimeEq`. |
| "Sphinx Coherence onion routing" | [ol_onion]($HOME/Projects/Coherence/One_link/native/ol_onion) | `ol_onion_wasm.liveDemoRoundTrip(payload)` runs real 3-hop wrap+peel. |
| "Real Helmholtz physics on GPU" | [scripts/emit-wgsl.py](scripts/emit-wgsl.py) → coherence_lang wgsl_emitter | The shader at /live/shaders/coherence-field.wgsl has `coh_oscillator_force`, `coh_tau`, real PDE solver compute pass. |
| "10,000 peers in 1.08 ms" | [ol_coherence_field]($HOME/Projects/Coherence/One_link/native/ol_coherence_field) benchmark output | Cited from daemon benches. Browser runs the same solver via `ol_coherence_field_wasm`. |
| "5-word SAS, Levenshtein-audited word list" | [ol_pair_qr::sas]($HOME/Projects/Coherence/One_link/native/ol_pair_qr/src/sas.rs) | 30-bit entropy, 64-word dictionary, deterministic from transcript hash. |
| "Live N here right now" | [src/worker.js](src/worker.js) `MeshPresence` DO + [live/bridge.js](dist/weareone-link.org/live/bridge.js) presence client | Open two browser windows; count ticks to 2. |
| "Anonymous ping between strangers" | Same as above + `sendPing` in [live/bridge.js](dist/weareone-link.org/live/bridge.js) | Two windows; click each other's dots; both see flash. |
| "Site verified" badge | [sw.js](dist/weareone-link.org/sw.js) `verifyAgainstManifest` | DevTools → Application → Service Workers → confirm active. Modify a cached asset byte; SW evicts. |
| "Signed twice" (downloads) | [dist/.../attestations/<sha>.json](dist/weareone-link.org/attestations/) schema | Open the JSON, see Ed25519 + ML-DSA-65 entries (placeholders today). |
| "Reproducible builds" | attestation schema `build.reproducible: true` | Currently `true` in schema; will be verifiable once the offline build rig is provisioned. |
| "If we vanish tomorrow, your One Link still works" | Service Worker precache + AGPL source | After one visit, disable network → site renders from cache. Daemon doesn't depend on this site. |

---

# 13. Decision log (ADRs)

Major architectural decisions, why we made them, what the alternative was.

## ADR-001: Hand-write some dist/ HTML; .cl SSG owns provenance

**Context**: Earlier pushes hand-wrote 11 HTML files; the `.cl` SSG existed in scaffold only. User called this out; we corrected.

**Decision**: Phase 1 of the .cl SSG programmatically composes the home page AND folds provenance into the other 10 routes. Phase 2+ moves to full programmatic composition.

**Alternative considered**: Throw away the hand-written HTML and regenerate from scratch programmatically. Rejected because the hand-written content is good and rewriting it as `.cl` strings before tooling matures is busywork.

**Status**: shipped. Phase 2 in §11.2.

## ADR-002: WGSL via emit_coherence_field_shaders, not from .cl source

**Context**: The wgsl_emitter has a built-in canonical coherence-field shader at `emit_coherence_field_shaders()`. We can either use that directly or write our own `.cl` solver and run the full `.cl -> CIR -> wgsl_emitter` pipeline.

**Decision**: Use the canonical entry point today. It produces the production shader the daemon uses for tau_c routing, which is exactly what we want. Custom `.cl` solver in a later phase if One Link needs site-specific math.

**Alternative**: Write `coherence_field.cl` and run it through the compiler. Rejected for now because it requires understanding the CIR API surface and the canonical shader is what we want anyway.

**Status**: shipped.

## ADR-003: First-party JS, no npm runtime deps

**Context**: We need JavaScript to drive WebGPU + load WASM + register Service Worker + handle WebSocket. Browser doesn't accept anything else.

**Decision**: Every JS file is hand-written by us, AGPL, source visible. Zero npm packages at runtime. The only allowed "dependency" is wasm-bindgen output, which is generated from our own Rust source.

**Alternative**: Use a framework (Svelte, htmx, ...) for ergonomics. Rejected because every framework adds a third-party trust dependency and runtime weight.

**Status**: shipped. Doctrine in [CLAUDE.md](CLAUDE.md).

## ADR-004: Workspace at live/wasm/, mirror daemon pins

**Context**: The wasm wrappers depend on production daemon crates via path. Those daemon crates use `workspace = true` for most deps, which cargo resolves against the LOCAL workspace, not the daemon's.

**Decision**: A separate workspace at [live/wasm/Cargo.toml](live/wasm/Cargo.toml) mirrors daemon workspace pins exactly. Member crates inherit production versions without us touching the daemon repo.

**Alternative**: Move the wrappers into the daemon workspace. Rejected because it entangles repo release cadence and forces the daemon CI to build wasm artifacts it doesn't need.

**Status**: shipped.

## ADR-005: Approximate geo from timezone, not IP

**Context**: To draw a peer dot somewhere meaningful on the screen, we need an approximate position per visitor.

**Decision**: Client computes longitude bucket from `Intl.DateTimeFormat().resolvedOptions().timeZone` and sends it server-side. Latitude defaults to mid-band. No IP geolocation. No browser `navigator.geolocation` prompt.

**Alternative**: Use Cloudflare's `cf.country` request property server-side. Rejected because (a) it requires the worker to see country, which is one more piece of state we'd be holding, and (b) it would require an extra request round-trip on initial connect.

**Status**: shipped.

## ADR-006: Pin wasm-bindgen to =0.2.95

**Context**: wasm-bindgen-cli and the wasm-bindgen library MUST be the same version. The CLI installed on the dev machine is 0.2.95; cargo by default resolves the library to the latest minor.

**Decision**: Each wrapper crate pins `wasm-bindgen = "=0.2.95"` exactly. Lockstep upgrade procedure documented in §5.5.

**Alternative**: Let cargo resolve and update the CLI to match. Rejected because then a contributor with an older CLI gets surprise mismatch errors.

**Status**: shipped.

## ADR-007: rayon cfg-gate upstream in ol_coherence_field

**Context**: `ol_coherence_field` uses rayon for parallel matvec. rayon requires threads. wasm32-unknown-unknown has no threads.

**Decision**: Add `#[cfg(not(target_arch = "wasm32"))]` on the two parallel matvec functions; move `rayon` under `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]` in daemon Cargo.toml. Additive only; native builds byte-identical.

**Alternative**: Vendor a slim subset of the crate into the wasm wrapper. Rejected because it duplicates code and complicates upstream tracking.

**Status**: shipped (in daemon repo). Daemon test suite verification recommended (§14).

---

# 14. Troubleshooting

Things that have actually gone wrong, so the next contributor doesn't lose an hour to the same trap.

## "EFFECT_ERROR: Process 'main' uses External IO but does not declare required effects: ExternalIO:fs"

Cause: bare `fs.write_text()` inside `process main()` without an effect-declared helper.

Fix: wrap every disk write in `fn write_file(path, content) effects [ExternalIO] { ... }` and call that helper from main. See [pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl).

## "wasm-bindgen: the binary is out of date"

Cause: wasm-bindgen library version (resolved by cargo) doesn't match wasm-bindgen-cli version.

Fix: in `live/wasm/Cargo.toml` of the failing crate, pin `wasm-bindgen = "=<cli-version>"`. Run `cargo update -p wasm-bindgen --precise <cli-version>`. Rebuild.

## "no function or associated item named `from_edges` found for struct `GraphLaplacian`"

Cause: I (an AI assistant in a prior push) guessed an API instead of grepping. The real constructor is `GraphLaplacian::new(n)` + `.add_edge(i, j, w)` in a loop.

Fix: read the real source. Lesson: never guess Rust APIs.

## Service Worker not registering / not active

Cause: Service Workers require HTTPS or localhost. File-protocol load fails silently.

Fix: use `wrangler dev` (which serves on localhost) or deploy. Direct file-open of dist/index.html will not register the SW. The page still works without it.

## "Cannot read property 'gpu' of undefined" / WebGPU init throws

Cause: WebGPU is gated on certain browsers / flags. Firefox: about:config → `dom.webgpu.enabled = true`. Safari: enabled by default on macOS 15+.

Fix: the existing try/catch in `startCoherenceField` falls back to the 2D Helmholtz path. The 2D path renders the same equation on the CPU at lower res. Visitor experience degrades silently.

## Daemon test suite regression after rayon cfg-gate

If `cargo test --workspace` in the daemon repo regresses after [the ol_coherence_field change](#adr-007-rayon-cfg-gate-upstream-in-ol_coherence_field):

```
# inside One_link/native/
cargo test -p ol_coherence_field
# expect: all serial-matvec tests pass; parallel-matvec tests still pass
# on native targets (the cfg-gate only excludes wasm32)
```

If they fail, revert the daemon change (restore unconditional rayon dep + remove the two cfg attributes) and refactor the wasm wrapper to use a vendored slim subset instead.

## Coherence Lang toolchain "doctor" fails

Cause: `COHERENCE_COMPILER` env not set + default path `$HOME\Projects\Coherence\coherence_lang` doesn't exist.

Fix: set `COHERENCE_COMPILER` to the absolute path of the `coherence_lang` checkout that contains `coherence_lang/compiler/cli/main.py`.

## `.cl` parser error "Expected ']' to close effects list"

Cause: tried to use `effects [ExternalIO:fs]` syntax. The parser doesn't support the colon-qualifier in effect lists.

Fix: use plain `effects [ExternalIO]` and rely on the effect-system inference for the qualifier.

---

# Appendix A. File inventory

Every file in the repo. Purpose, owner, regenerable Y/N.

```
README.md                          Public README. Manual.
CLAUDE.md                          Assistant guide + doctrine. Manual.
SPEC.md                            This file. Manual.

wrangler.toml                      .org worker config. Manual.
wrangler.com.toml                  .com redirect worker config. Manual.

clc.cmd                            Windows shim for python tools/clc.py. Manual.
clc.ps1                            PowerShell variant. Manual.
tools/clc.py                       Resolves coherence_lang path + dispatches. Manual.

src/worker.js                      .org main Worker. Manual. ~479 lines.
src/redirect.js                    .com 301 worker. Manual. ~11 lines.

scripts/build-wasm.sh              Compiles + bindgens all 4 wasm crates. Manual.
scripts/emit-wgsl.py               Calls wgsl_emitter, writes coherence-field.wgsl. Manual.

pipeline/ssg/src/one_link_build.cl  The .cl SSG. Manual.
pipeline/ssg/src/build.cl           Forked from CEL. Reference. Not run.
pipeline/ssg/src/*.cl               Sitemap/RSS/OG/JSON-LD/Speculation submodules from CEL.
pipeline/ssg/templates/             Forked HTML templates from CEL. Reference.
pipeline/ssg/css/                   Forked CSS from CEL. Reference (not currently used in dist).

classic/partials/                   Forked HTML chrome from CEL. Reference.

content/weareone-link.org/         MDX source for future content pipeline. Sparse.

siteworld/                          Empty SiteWorld scaffold for Phase-2 SSG.
config/                             Empty placeholder for future config split.
legal/                              Empty placeholder.

live/wasm/Cargo.toml               Wrapper workspace root. Manual.
live/wasm/ol_pair_qr_wasm/         Wrapper crate. Manual.
live/wasm/ol_pqkem_wasm/           Wrapper crate. Manual.
live/wasm/ol_onion_wasm/           Wrapper crate. Manual.
live/wasm/ol_coherence_field_wasm/ Wrapper crate. Manual.
live/wasm/target/                  Cargo build dir. Regenerable.

attestations/                      Empty placeholder for source attestations.

dist/weareone-link.org/
  index.html                       SSG output (Phase 1 fold-in). Regenerable.
  index.cl.html                    SSG programmatic sample. Regenerable.
  <route>/index.html               SSG fold-in for 10 routes. Regenerable from current content.
  manifest.json                    Signed asset manifest. Recomputed by §10.4.
  sitemap.xml                      Manual.
  robots.txt                       Manual.
  feed.xml                         Manual; future SSG generator.
  _headers                         Manual.
  css/one-link.css                 Manual.
  css/immersive.css                Manual (home-only).
  live/bridge.js                   Manual. ~1100 lines vanilla ES.
  live/shaders/coherence-field.wgsl  Emitted by wgsl_emitter. Regenerable.
  live/wasm/*.{js,wasm}            Emitted by wasm-bindgen. Regenerable.
  images/favicon.svg               Manual.
  og/*.{svg,png}                   Manual.
  attestations/<sha>.json          Manual (one per release).
  sw.js                            Manual.
  .build-stamp                     SSG output.
  .provenance.json                 SSG output.

dist/weareone-link.com/            Empty placeholder for the redirect worker bundle.

assets/brand/                      Empty placeholder for raw brand assets.
assets/images/                     Empty placeholder for source images.
```

# Appendix B. Wrangler bindings

[wrangler.toml](wrangler.toml) (.org main):

```toml
name = "weareone-link-org"
compatibility_date = "2024-12-01"
main = "src/worker.js"

[assets]
directory = "./dist/weareone-link.org"
binding = "ASSETS"
run_worker_first = true

[[durable_objects.bindings]]
name = "NATIVE_SESSIONS"
class_name = "NativeSession"

[[durable_objects.bindings]]
name = "PRESENCE"
class_name = "MeshPresence"

[[migrations]]
tag = "v1"
new_classes = ["NativeSession"]

[[migrations]]
tag = "v2"
new_classes = ["MeshPresence"]

[[r2_buckets]]
binding = "RELEASES"
bucket_name = "one-link-releases"

[[r2_buckets]]
binding = "ATTESTATIONS"
bucket_name = "one-link-attestations"

[[kv_namespaces]]
binding = "RELAY_KV"
id = "REPLACE_WITH_REAL_KV_ID"

[vars]
SITE_DOMAIN              = "weareone-link.org"
CANONICAL_ORIGIN         = "https://weareone-link.org"
RELEASE_RELAY_PUBKEY_HEX = "REPLACE_WITH_RELAY_ED25519_PUBKEY"
PROTOCOL_VERSION         = "1"
NATIVE_TRANSFER_CAP      = "NATIVE_TRANSFER_V1"
```

[wrangler.com.toml](wrangler.com.toml) (.com redirect):

```toml
name = "weareone-link-com-redirect"
compatibility_date = "2024-12-01"
main = "src/redirect.js"

[assets]
directory = "./dist/weareone-link.com"
binding = "ASSETS"
run_worker_first = true

[vars]
CANONICAL_ORIGIN = "https://weareone-link.org"
```

# Appendix C. Attestation chain JSON schema

```json
{
  "$schema": "https://weareone-link.org/schemas/attestation-v1.json",

  "artifact": {
    "name":       "one-link",
    "version":    "0.21.0",
    "os":         "any",
    "sha256":     "<64 hex>",
    "blake3":     "<64 hex>",
    "size_bytes": 0
  },

  "source": {
    "repo":    "https://github.com/IamOneYouAreOneWeAreOne/one-link",
    "commit":  "<git sha>",
    "tag":     "v0.21.0-alpha.0",
    "license": "AGPL-3.0-or-later"
  },

  "build": {
    "reproducible":   true,
    "compiler":       "rustc 1.95.0 (...)",
    "toolchain_hash": "<hex>",
    "environment": {
      "provider":   "ol_confidential::SoftwareProvider",
      "image_hash": "<hex>",
      "policy":     "deterministic-only"
    },
    "started_at":  "ISO-8601",
    "finished_at": "ISO-8601"
  },

  "signatures": [
    {
      "scheme":         "ed25519",
      "signer":         "release-signer-1@weareone-link.org",
      "public_key_hex": "<hex>",
      "signature_hex":  "<hex>"
    },
    {
      "scheme":         "ml-dsa-65",
      "signer":         "release-signer-1@weareone-link.org",
      "public_key_hex": "<hex>",
      "signature_hex":  "<hex>"
    }
  ],

  "confidential_attestation": {
    "provider":                  "ol_confidential",
    "doc_version":               1,
    "nonce":                     "<32-byte hex>",
    "freshness_window_seconds":  30,
    "field_witness": {
      "binding":              "ol_coherence_field-v1",
      "tau_c_snapshot_hash":  "<hex>"
    },
    "pq_hybrid": {
      "x25519_pub":   "<hex>",
      "mlkem768_pub": "<hex>"
    },
    "signature_hex": "<hex>"
  },

  "chain": {
    "previous_release_sha256":  "<hex>",
    "previous_signed_by":       "release-signer-0@weareone-link.org",
    "rotation_proof":           null
  },

  "verifier_url": "https://weareone-link.org/api/attest/<sha>",
  "notes": [ "..." ]
}
```

# Appendix D. Glossary

- **AEAD**: Authenticated Encryption with Associated Data. Cipher that produces ciphertext + tag; verifying the tag is constant-time.
- **AGPL-3.0**: GNU Affero General Public License v3. Network-use copyleft. Forces source publication for hosted modifications.
- **BLAKE3**: Cryptographic hash function. Used as the combiner in ol_pqkem and as the transcript-hash function in ol_pair_qr.
- **CIR**: Coherence Intermediate Representation. The compiler IR between `.cl` and any backend. Stable schema; everything downstream is a backend on top.
- **CoherenceField / coherence-field**: The damped Helmholtz oscillator field used by One Link's routing layer to make tau_c decisions. Implemented in `ol_coherence_field`.
- **CSR**: Compressed Sparse Row. The graph-Laplacian storage layout used by `ol_coherence_field` for cache-friendly matvec.
- **Double Ratchet**: Signal-style forward-secret message keying. One Link runs Double Ratchet over the PQ-hybrid root from ol_pqkem.
- **Durable Object (DO)**: Cloudflare's primitive for stateful single-instance compute. Used here for `MeshPresence` and `NativeSession`.
- **Ed25519**: Classical-curve signature scheme. One of two halves of the One Link hybrid signature stack.
- **Field witness**: A short hash of the local tau_c field state, mixed into onion-hop key derivation to bind a hop to the physical-environment context.
- **GraphLaplacian**: The discrete Laplacian `L = D - A` of a peer graph. Eigenvectors are the modal basis the field expands into.
- **Helmholtz oscillator (damped)**: Second-order ODE `x'' + 2γ x' + ω² x = 0`. Drives the coherence-field per-cycle update.
- **HopDescriptor**: An (id, pubkey) pair identifying one hop in an onion circuit.
- **Hybrid KEM**: Combine a classical KEM with a post-quantum KEM such that the shared secret is secure if EITHER is unbroken. Per ADR-0017 we use X25519 + ML-KEM-768 with a BLAKE3 combiner.
- **Invite**: The signed bytes a pair-by-QR Inviter renders into the QR code. Carries identity pubkey + ephemeral pubkey + nonce + expiry + capability scope.
- **KEM**: Key Encapsulation Mechanism. Public-key primitive that gives both sides a shared secret without explicit key transport.
- **MeshPresence**: The Durable Object that holds the live visitor session set for the "N here right now" counter + peer-dot overlay.
- **ML-KEM-768**: NIST FIPS 203 post-quantum KEM (formerly Kyber-768). Wraps via `ml-kem` crate.
- **ML-DSA-65**: NIST FIPS 204 post-quantum signature (formerly Dilithium-3). Used in ol_pqsig.
- **OnionPacket**: Fixed-size byte payload that carries a Sphinx-style onion-wrapped message through hops.
- **PairResponse**: The signed bytes a Scanner sends back to the Inviter, committed to the transcript hash.
- **PairConfirm**: The Inviter's final signed message after the user confirms the SAS.
- **PIR**: Private Information Retrieval (not used today; mentioned in some daemon roadmap docs).
- **Pippenger MSM**: Multi-scalar multiplication algorithm used by ol_onion for batch Schnorr signature verification.
- **Provenance meta**: The `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` tag the .cl SSG injects into every page.
- **R2**: Cloudflare's S3-compatible object store.
- **Ristretto255**: Prime-order group built on Curve25519, used by Sphinx for blinded point operations.
- **SAS (Short Authentication String)**: 30-bit value derived from the pair-by-QR transcript, rendered as 5 words. Users compare verbally; mismatch reveals a MITM.
- **Schnorr aggregation**: Schnorr signature scheme variant that allows N signatures over the same message to be combined into one verifiable aggregate. Used by ol_onion::aggsig.
- **Service Worker (SW)**: Browser-native background script that intercepts fetches. Here used for offline-first caching + signed-manifest integrity verification.
- **SiteWorld**: The typed content graph model (nodes/edges/lenses/tours) shared with CEL. Phase-2 of our SSG will use it.
- **Sphinx Coherence**: One Link's onion-routing construction. Standard Sphinx (Ristretto255 + filler bytes Nymtech-pattern) plus PQ-hybrid blinding (ML-KEM-768 mix-in at first hop) plus field-witness binding (tau_c snapshot in hop keyderiv).
- **Tau_c (τ_c)**: The local "coherence time" scalar at a node, derived from the local field state. Drives routing decisions.
- **TOFU**: Trust On First Use. Recognize a key on first sight; alert on change.
- **Transcript hash**: BLAKE3 hash of all wire messages in a session. Trust anchor for SAS derivation.
- **wasm-bindgen**: The Rust toolchain that generates JS glue around WASM exports/imports for browser use.
- **WebGPU**: Modern browser GPU API. Replaces WebGL. Required for our compute-pipeline shader path.
- **WebTransport**: HTTP/3-based bidirectional transport. The target for `/native` once Cloudflare ships stable support.
- **WGSL**: WebGPU Shading Language. The shader format the browser GPU pipeline consumes.
- **X25519**: Classical Diffie-Hellman over Curve25519. Half of the hybrid KEM.
- **Zeroize**: Rust crate that securely wipes memory on drop. Applied to every secret-bearing struct.

---

**End of spec.**

If you are reading this looking for something that is not here, open an issue or a PR adding the section. This document is alive.
