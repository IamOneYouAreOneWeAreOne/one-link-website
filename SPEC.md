# One Link Website - Living Specification and Evidence Ledger

**Version**: 0.21.0-alpha.0 + r95 manifest baseline; working tree ahead
**Status**: Living document reviewed 2026-07-22. “Implemented,” “demo,” and “deferred” are kept distinct; production release closure is not claimed.
**Domains**: `weareone-link.org` (primary) + `weareone-link.com` (301 redirect)
**License**: AGPL-3.0-or-later

This document records intended and observed website behavior. Executable code and passing tests establish current behavior; this document must be corrected when it disagrees and must never upgrade a demo or intent into production evidence.

---

## TABLE OF CONTENTS

- [0. Quick start for a new contributor](#0-quick-start)
- [1. Vision and doctrine](#1-vision-and-doctrine)
- [2. The alien-tech surface (status ledger)](#2-alien-tech-surface)
- [3. Architecture](#3-architecture)
- [4. Reviewed wire protocols](#4-reviewed-wire-protocols)
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
#   ol_pqsig.js + ol_pqsig_bg.wasm               (~257 KB)
#   ol_threshold_recovery.js + ol_threshold_recovery_bg.wasm (~80 KB)
#   ol_ratchet.js + ol_ratchet_bg.wasm           (~81 KB)
#   ol_hwkey.js + ol_hwkey_bg.wasm               (~94 KB)

# 4. Emit the WGSL shader via the Coherence Lang compiler
python scripts/emit-wgsl.py
# Writes dist/weareone-link.org/live/shaders/coherence-field.wgsl

# 5. Run the .cl SSG (touches all 11 routes, emits provenance manifest)
python tools/clc.py run pipeline/ssg/src/one_link_build.cl

# 6. Recompute manifest hashes (any time a tracked asset changes)
python scripts/rehash-manifest.py
# This mutates the manifest/version and chains into signing when the offline
# manifest key is present. See section 10.4; do not run it during a docs-only edit.

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

One Link is pre-release software for private messaging and file transfer. It prefers direct peer paths and uses encrypted relay or rendezvous infrastructure where required. The website is its public face. The website's job is to:

1. Convince a first-time visitor that One Link is real, useful, and trustworthy.
2. Hand them a binary they can install in one tap.
3. Show selected cryptographic primitives with local browser self-tests, while clearly separating those tests from device-to-device and network-path proof.
4. Earn trust through a precise data inventory: no application accounts or analytics, with Cloudflare, GitHub, relay, R2, and feature-specific processing disclosed.

The site is a pre-release product and protocol surface. It contains local primitive self-tests and infrastructure-backed demos; visiting it does not make the browser a production One Link node.

## 1.2 What this site is NOT

- **Not a SaaS product.** No accounts, no tiers, no enterprise pitch.
- **Not a venture-backed startup site.** No "trusted by," no investor logos, no pricing.
- **Not a marketing surveillance funnel.** No tracking pixels, no email capture, no remarketing.
- **Not an auth/CMS wrapper.** The checked-in site runtime has no third-party
  auth or CMS SDK; Cloudflare hosting and GitHub/R2 artifact delivery remain
  named infrastructure dependencies.
- **Not an "AI app."** No LLM integration anywhere on the public surface.
- **Not presented as production-proven.** The public surface is pre-release; local WASM self-tests reuse daemon crates but do not prove the network path or deployed daemon behavior.

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

> "Use a direct path when available; otherwise encrypted relay infrastructure may carry or temporarily store ciphertext."
> "The source and static site are mirrorable. Discovery, relay delivery, downloads, sharing, and updates still have explicit infrastructure dependencies."
> "Just install. It just works. It's already yours."
> "Content intended for recipients is encrypted before relay or share storage. Connection and request metadata still exist at the named infrastructure providers."

## 1.4 UX doctrine (binding)

**Extremely easy.** Every alien capability disappears behind ONE button. AirDrop-easy, not VPN-setup-easy.

- No settings on the visible surface. Defaults are correct. No "Advanced." No "Configure." No "Options."
- No jargon. "Only you and they can read it" beats "end-to-end encrypted."
- Keep actions simple, but distinguish the website's same-tab pairing self-test from a real scan, second device, transport, SAS comparison, and confirmation.
- No setup wizard. No first-run questionnaire. No signup. No email collection.
- Failure is visible, specific, and fail-closed for security-sensitive actions. A retry must not conceal missing proof or a changed transport.
- Publish measured latency targets only with a reproducible environment and acceptance gate; do not guarantee every interaction completes within a fixed time.

Corollary: **the alien tech is the engine, not the UI**. The UI is one tap. The engine is unspeakable.

## 1.5 Two domains, one site

```
   weareone-link.com  (registrar: Cloudflare)
            |
            | 301 (preserves path + query)
            v
   weareone-link.org  (canonical)
```

The `.com` Worker is a stateless 301 redirect ([src/redirect.js](src/redirect.js)).
The `.org` Worker serves the website and API surface ([src/worker.js](src/worker.js));
the repository defines no separate `.com` content surface.

---

# 2. Alien-tech surface

Implementation ledger reviewed 2026-07-22. “Shipped” below means the exact scoped behavior is present in this repository; it does not promote mutable artifacts to a production release.

| # | Item | Status | Crate / file | Section |
|---|---|---|---|---|
| 1 | Download IS the protocol (browser becomes a One Link node) | **deferred** | current routes are explicit GitHub/R2 artifact delivery; native transfer remains a future gate | §6.2 |
| 2 | Pairing primitive self-test (both roles in one tab) | **shipped as demo** | `ol_pair_qr` WASM; no camera, second device, or device transport | §5.1, §6.1 |
| 3 | Sphinx onion primitive self-test | **shipped as demo; download integration deferred** | `ol_onion` WASM; ordinary download routes do not use it | §5.3, §6.2 |
| 4 | Coherence-field background = real Helmholtz on GPU | **shipped** | WGSL emitted from `wgsl_emitter` | §3.6, §6.1 |
| 5 | Website-presence mesh visualization | **implemented for connected website sessions; network topology deferred** | `MeshPresence` sessions + illustrative regional anchors/halos + local Helmholtz coloring; no daemon, relay, or routing telemetry | §6.6 |
| 6 | Reproducible-build attestation UI | **deferred** (schema fixtures only) | fixtures are not current artifact proof; API fails closed until a versioned release is promoted | §4.5, §6.2, App C |
| 7 | Two-tab browser pairing demo | **shipped as demo** | same-origin `BroadcastChannel` + `ol_pair_qr` WASM; no daemon or independent device | §6.1 |
| 8 | Threshold recovery demo on page | **shipped** | `ol_threshold_recovery` WASM + /security/ | §6.5 |
| 9 | Capability banner from Worker-maintained advert | **partial** | `/api/capabilities` is hard-coded and unsigned; the static feature matrix is manually authored | §4.2 |
| 10 | Signed site-manifest and cached-asset verification | **implemented; bundle must pass the release-time verifier** | same-origin pinned Ed25519 key in [sw.js](dist/weareone-link.org/sw.js) + [manifest.json](dist/weareone-link.org/manifest.json); not artifact signing | §7.4 |
| 11 | Local PQ primitive self-test + browser session registration | **partial; not a secured network session** | local `ol_pqkem` round trip; `/api/session` only advertises a Worker X25519 key | §5.2, §4.4 |
| 12 | No application accounts, analytics, ads, or tracking cookies | **implemented with infrastructure disclosures** | Cloudflare and artifact hosts process request metadata; feature state is listed in §7.1 | §7.1 |
| 13 | "Rebuild this site from source" button | deferred | future CI surface | §11 |
| 14 | Website ships INSIDE the product (daemon serves it) | deferred | daemon work | §11 |
| 15 | Hardware-key TOFU recognition (software fallback) | **shipped** | `ol_hwkey` WASM (TofuStore) + /security/ "mint or recognize this device" | §6.5 |
| 16 | Feature-page capability banner | **partial** | unsigned hard-coded list above a static matrix; not a live daemon truth source | §4.2 |
| 17 | In-browser site-bundle verifier | **implemented; same-origin trust scope** | [sw.js](dist/weareone-link.org/sw.js) + Ed25519-signed manifest; no independent artifact/release trust root | §7.4 |
| 18 | Pseudonymous stranger chat between current visitors | **shipped as opportunistically encrypted site demo** | `MeshPresence` relay + `ol_pair_qr` exchange + AES-GCM; no required out-of-band SAS comparison or durable peer identity, and Cloudflare sees connection metadata | §3.2.2, §4.6, §6.1 |
| 19 | Onion-routed delivery for downloads | deferred | the local `ol_onion` preview does not carry download bytes | §11 |
| 20 | No paid tier on the current public surface | **implemented today; no future-pricing promise** | repo audit | §1.2 |
| 21 | "You just became 1 of N" live counter ticks up on connect | **shipped** | `MeshPresence` DO + presence bar | §4.6, §6.1 |
| 22 | Tor onion mirror with cross-consistency proof | deferred | infra work | §11 |
| 23 | In-browser PQ-hybrid signing (Ed25519 + ML-DSA-65) | **shipped** | `ol_pqsig` WASM + /security/ demo | §6.5 |
| 24 | Encrypted URL-fragment share demo | **implemented with retention caveats** | browser uploads ciphertext to R2; deletion is best-effort and expiry is enforced on read | §3.2.3 |
| 25 | CSP + HSTS + signed site-manifest defense-in-depth | **implemented with same-origin trust scope; browser SRI not injected in the current HTML** | Worker `PRIVACY_HEADERS` and Service Worker manifest checks are distinct; `inject-sri.py` exists but the release rehash path intentionally skips it | §7.4-§7.6 |
| 26 | Upload token-bucket rate limit on `/api/share` | **implemented with keying caveat** | recognized IPv4/IPv6 inputs use /24-/48-derived names; unfamiliar input falls back to the full raw string; `ShareRate` state has no application TTL | §3.2.3 |
| 27 | Per-chunk forward-secret ratchet demo | **shipped** | `ol_ratchet` WASM + /security/ "walk the ratchet" | §6.5 |
| 28 | In-browser release-attestation verifier | **deferred** | verifier is disabled until a current artifact-bound attestation is published | §6.2 |
| 29 | Authenticated artifact verification | **deferred** | local SHA-256 works; no signed artifact-bound reference is published for the rolling channel | §6.2 |
| 30 | PWA install metadata (Add to Home Screen can launch standalone) | **implemented on declared HTML surfaces** | `/app.webmanifest` + iOS/Android meta tags; browser installability remains platform-dependent | §6.1 |
| 31 | Worker X25519 public-key advertisement | **partial** | no client ECDH, shared secret, transcript authentication, or traffic key | §4.4 |
| 32 | Linux signed release | **deferred** | rolling AppImage/zip artifacts exist; artifact signing and attestation are not published | §6.2 |

**Release-truth correction (2026-07-22):** counts in older revisions conflated schema fixtures, local crypto demos, and mutable CI artifacts with production release proof. The table above is authoritative; production release closure remains deferred until the immutable-version gates in §6.2 pass.

**Deferred items + why each is deferred:**

| # | Item | Blocker |
|---|---|---|
| 13 | "Rebuild this site from source" button | needs CI surface; doable without external blockers, just hasn't shipped |
| 14 | Website ships INSIDE the product (daemon serves it) | daemon-side work; needs the daemon to bundle the static dist/ and serve it on localhost |
| 19 | Onion-routed delivery for downloads | needs transport integration that carries the requested artifact bytes; the current button runs only a local wrap/peel preview |
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

Holds the in-flight set of visitor sessions for the live "N here right now"
counter and peer-dot overlay. It is load-bearing for presence and browser chat.
`ShareRate` is separately load-bearing for upload rate limiting; `NativeSession`
remains a stub.

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

**Application-state boundary**: the session map retains a random id, client-supplied approximate `geo`, a socket, and a last-seen timestamp. The Worker forwards the upgrade request to the Durable Object, so do not claim the infrastructure never receives request headers or IP metadata. The application does not intentionally persist those headers. The approximate longitude is derived client-side from `Intl.DateTimeFormat().resolvedOptions().timeZone`, not from precise geolocation.

Wire protocol: §4.6.

### 3.2.3 `ShareRate` and encrypted share storage

`/api/share` is an infrastructure-backed convenience demo, not a peer-to-peer
transfer. The browser encrypts up to 25 MiB of plaintext and uploads the
ciphertext to the `RELEASES` R2 bucket. The decryption key and IV are placed in
the URL fragment and are not sent in the HTTP request.

The Worker reads `CF-Connecting-IP`. Recognized IPv4 inputs become a `/24`-style
key and recognized IPv6 inputs use the first three textual hextets as a
`/48`-style key. Missing input becomes `unknown`; any unfamiliar non-IP string
falls back to `raw:<full-string>`. The selected literal is passed to
`SHARE_RATE.idFromName()` without application-level hashing. The resulting
`ShareRate` Durable Object persists only token count and refill timestamp; the
application defines no deletion/TTL for that state. It does not store the R2
object, expiry, or deletion state. Cloudflare still processes the full
connection IP at the edge.

Each R2 share object carries an expiry timestamp in custom metadata; `ShareRate`
does not own share lifetime or deletion. The current code checks R2 expiry only
on GET and then attempts deletion; it has no in-repository background cleanup
or atomic consume operation. First-GET deletion is best-effort, and concurrent
reads can race while deletion failures are ignored. Public copy must say
“encrypted temporary storage with best-effort first retrieval,” not “never
stored,” “24-hour maximum retention,” or guaranteed one-shot deletion, until
R2 lifecycle enforcement and an atomic-consume acceptance test exist.

## 3.3 KV + R2 bindings

```
[[r2_buckets]]
binding = "RELEASES"        # configured: source artifacts + share ciphertext

# Not currently configured in wrangler.toml:
# ATTESTATIONS R2             # future promoted artifact-bound documents
# RELAY_KV                    # future authenticated relay registry
```

Today the public attestation endpoint is fail-closed. Static files under
`dist/.../attestations/` are schema fixtures only and are never served as
current release proof. The endpoint is enabled only when
`RELEASE_ATTESTATIONS_READY=true`, the `ATTESTATIONS` R2 binding exists, and a
small structurally valid document is bound to the requested artifact SHA-256.
The browser still verifies the document's Ed25519 signature against its pinned
release public key before showing an authenticated verdict.

## 3.4 Static `dist/` layout

```
dist/weareone-link.org/
  index.html                       Hand-authored canonical page; provenance-folded by .cl SSG
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
  css/
    one-link.css                   Visual identity, all routes
    immersive.css                  Home-only immersive layer

  live/
    bridge.js                      Multi-feature vanilla ES module
    shaders/
      coherence-field.wgsl         Emitted by wgsl_emitter
    wasm/
      ol_pair_qr.js                wasm-bindgen JS glue
      ol_pair_qr_bg.wasm           250 KB
      ol_pqkem.js
      ol_pqkem_bg.wasm             191 KB
      ol_onion.js
      ol_onion_bg.wasm             161 KB
      ol_coherence_field.js
      ol_coherence_field_bg.wasm   77 KB
      ol_pqsig.js
      ol_pqsig_bg.wasm             257 KB
      ol_threshold_recovery.js
      ol_threshold_recovery_bg.wasm 80 KB
      ol_ratchet.js
      ol_ratchet_bg.wasm           81 KB
      ol_hwkey.js
      ol_hwkey_bg.wasm             94 KB

  images/favicon.svg
  og/one-link.svg + one-link.png + download.png

  attestations/
    <sha256>.json                  Per-release attestation chain document

  sw.js                            Service Worker (offline + integrity)

  .build-stamp                     Plain text, emitted by .cl SSG
  .provenance.json                 Auditable JSON of every route touched
```

The canonical HTML pages are hand-authored. The `.cl` SSG emits the separate
`index.cl.html` programmatic sample and folds provenance into 11 baseline
canonical routes, including `index.html`; provenance fold-in is not full page
generation or ownership. See §8.

## 3.5 The Cloudflare Worker

[src/worker.js](src/worker.js) uses a single `fetch` handler that dispatches by path:

```
/api/health           GET   -> heartbeat JSON
/api/capabilities     GET   -> unsigned hard-coded Worker capability list
/api/topology         GET   -> non-authoritative status with null topology fields
/api/session          POST  -> session registration + X25519 public-key advertisement
/api/attest/:sha      GET   -> readiness-gated artifact attestation from R2
/api/presence         GET (Upgrade: websocket) -> MeshPresence DO
/api/share            POST  -> rate-limited R2 ciphertext upload
/api/share/:id        GET   -> expiry-on-read + best-effort, non-atomic deletion
/native               GET   -> JSON advertisement for a future WebTransport path
/download/:os         GET   -> explicit rolling/version-pinned artifact route + proof status
<everything else>     GET   -> env.ASSETS.fetch (static dist/)
```

The Worker applies the header pack defined in `PRIVACY_HEADERS` to its routed
responses and static-asset fallback. There is no checked-in `_headers` file:

```js
// Selected entries; §7.5 records the CSP and conditional behavior.
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(),
                    browsing-topics=(), join-ad-interest-group=(), run-ad-auction=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

The Worker source has no explicit request-logging or analytics call. That is not a
no-logs guarantee for the deployment: Cloudflare processes ordinary request and
connection metadata. The application also writes the documented pseudonymous
presence state, literal truncated-subnet rate state, and share ciphertext to its
Durable Object/R2 paths. Provider retention and operator access must be documented
and verified independently of this source review.

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

[scripts/build-wasm.sh](scripts/build-wasm.sh) drives `cargo build --release --target wasm32-unknown-unknown` over eight wrapper crates, then runs `wasm-bindgen --target web` on each to emit JS glue.

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

[pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl) is
Coherence Language source. Type-check it via `python tools/clc.py check` and run
it via `python tools/clc.py run`.

Phase-1 coverage:
- A separate `index.cl.html` home-page sample is programmatically composed.
- All 11 canonical baseline routes, including `index.html`, are read from existing dist HTML and rewritten only to inject `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` after `<head>`.
- Emits `.build-stamp` and `.provenance.json` (auditable JSON listing every route touched).

Phase-2 plan (§11):
- Full programmatic composition of all 11 routes from .cl source.
- SiteWorld-node-driven content model (nodes/edges/lenses like CEL).
- Generate `/features/` from either an authenticated, fresh daemon advert or a manually reviewed, version-pinned evidence record. The unsigned Worker endpoint cannot promote marketing claims.

---

# 4. Reviewed wire protocols

This section records the reviewed public endpoint contracts relevant to the
current website surface. `src/worker.js` remains authoritative, and this section
must be updated whenever its route table or failure behavior changes.

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

Unsigned Worker-maintained capability list. The `/features/` page shows this list in a banner, but its feature tiles are static HTML. This endpoint is not a live daemon attestation and cannot independently prove that an advertised capability is implemented.

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

Observed implementation: the response is hard-coded and `signed: false` in the
Worker. It may be displayed only as an unsigned advertisement. A capability may
be marketed as implemented only from either (a) an authenticated, fresh daemon
advert with replay/failure tests or (b) a manually reviewed, version-pinned
evidence record with an executable acceptance gate. The page must not silently
promote or fall back to this unsigned endpoint as proof.

## 4.3 `GET /api/topology`

Fail-closed topology availability status. It does not derive data from a relay
registry and returns `authoritative: false` with null inventory/field values,
rather than zeros that a client could mislabel as observed topology. The
response body contains no IPs or individual sessions; that response-body
property is not a claim that Cloudflare receives no request metadata.

**Response (200, application/json)**:
```json
{
  "schema": "topology-status-v1",
  "authoritative": false,
  "issued_at": "...",
  "active_nodes": null,
  "active_relays": null,
  "field_snapshot": null,
  "relay_health": null,
  "scope": "stub-not-production-inventory",
  "note": "No authoritative relay registry is deployed for this website build."
}
```

## 4.4 `POST /api/session`

Ephemeral browser-session registration plus an unauthenticated capability
advertisement. This endpoint does **not** currently establish an X25519 or
ML-KEM protected browser-to-Worker channel.

**Request (application/json)**:
```json
{
  "local_pq_self_test": {
    "matched": true,
    "public_key_bytes": 1216,
    "ciphertext_bytes": 1088
  },
  "protocol": "session-registration-v1"
}
```

**Response (200, application/json)**:
```json
{
  "server_x25519": "<32 bytes hex>",
  "server_mlkem768_pk": null,
  "session_id": "<32 hex chars>",
  "handshake_version": "session-registration-v1+x25519-advertised+mlkem768-pending",
  "note": "advertisement only; client ECDH and ML-KEM are not completed"
}
```

Current state: the Worker advertises a real, ephemeral X25519 public key, but
the browser does not derive a shared secret from it and the Worker has no
ML-KEM key. `ol_pqkem_wasm.liveDemoRoundTrip()` exercises Alice and Bob locally
inside one tab; the UI labels that result as a primitive self-test. A future
protocol revision must authenticate the endpoint, complete client ECDH and
ML-KEM, derive traffic keys, and add transcript-bound tests before this route
may be called a hybrid session.

## 4.5 `GET /api/attest/:sha`

Artifact-bound release attestation for a given SHA-256, available only after
the versioned release pipeline explicitly enables and uploads it.

`sha` must match `/^[a-f0-9]{64}$/i` or 400 is returned.

Publication gates:
1. `RELEASE_ATTESTATIONS_READY` must equal the exact string `true`.
2. R2 `ATTESTATIONS` bucket must contain key `<sha>.json`.
3. The object must be valid JSON, no larger than 256 KiB, with
   `artifact.sha256` equal to the requested SHA and a structurally valid
   Ed25519 signature entry.
4. Missing documents return 404; missing bindings, storage failures, malformed
   JSON, oversized documents, and SHA mismatches return 503. There is no static
   fallback.

The sample document under [dist/weareone-link.org/attestations/](dist/weareone-link.org/attestations/)
is a development fixture, not proof for a routed artifact. Full schema in Appendix C.

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
{ "type": "chat-request", "to": "<peer-session-id>", "invite_hex": "..." }
{ "type": "chat-accept", "to": "<peer-session-id>", "response_hex": "..." }
{ "type": "chat-confirm", "to": "<peer-session-id>", "confirm_hex": "..." }
{ "type": "chat-msg", "to": "<peer-session-id>", "iv_b64": "...", "ct_b64": "..." }
{ "type": "chat-decline|chat-leave", "to": "<peer-session-id>" }
```

**Server -> Client messages**:

```json
{ "type": "welcome",    "self_id": "<32 hex chars>", "population": 7 }
{ "type": "population", "n": 8 }
{ "type": "peers", "peers": [ { "id": "...", "lat": 0.5, "lng": 0.5 }, ... ] }
{ "type": "chat-request|chat-accept|chat-confirm|chat-decline|chat-leave", "from": "<sender-session-id>", "...": "forwarded handshake field when applicable" }
{ "type": "chat-msg", "from": "<sender-session-id>", "iv_b64": "...", "ct_b64": "...", "ts": 0 }
```

The Worker still accepts a legacy `ping` frame, but peer-dot clicks in the
current UI initiate the `chat-*` exchange. Handshake payloads are relayed as
opaque hex. After confirmation, browsers relay AES-GCM ciphertext; there is no
mandatory out-of-band SAS comparison or durable peer identity authentication.

Throttling: `population` broadcasts fire on every join/leave. `peers` broadcasts are throttled to one per 1500ms server-side. Idle sweep evicts sessions whose `lastSeen` is older than 90 seconds; on eviction, the server pushes a fresh `population` to all remaining sessions.

**Application-state invariant**: the presence implementation stores and broadcasts only the fields documented above; it does not intentionally log request headers or set a tracking cookie. Cloudflare receives ordinary connection metadata, the Worker forwards the upgrade request to the Durable Object, and peers receive the client-supplied approximate `geo`. This is pseudonymity within the UI, not network-level anonymity.

## 4.7 `GET /native` (WebTransport, planned)

Today returns a JSON advertisement of the proposed wire protocol. `NativeSession` is a non-load-bearing stub. A real transport requires runtime support, endpoint authentication, session-key derivation, stream handling, resource limits, and end-to-end tests before this route may be called WebTransport.

**Response (today, 200, application/json)**:
```json
{
  "transport": "webtransport-h3",
  "status": "advertised",
  "accepted_caps": [ "NATIVE_TRANSFER_V1", "PAIR_QR_V1", "SPHINX_ONION_V1", "PQ_HYBRID_V1" ],
  "note": "advertisement only; no WebTransport stream or NativeSession lifecycle is established"
}
```

## 4.8 `GET /download/:os`

Artifact route. `:os` accepts explicit platform and architecture forms such as
`windows-x86_64`, `windows-arm64`, `macos-arm64`, `linux-x86_64`, and
`linux-arm64`. Supported desktop routes redirect to the rolling GitHub
`auto-latest` prerelease unless `VERSIONED_RELEASE_TAG` pins an explicit v* tag.
macOS Intel routes return a clear unavailable response and never substitute an
Apple Silicon artifact.

Programmatic clients requesting JSON receive the channel, tag, mutability, and
proof status. The current default is:

```
{
  "release": { "channel": "continuous", "tag": "auto-latest", "mutable": true },
  "integrity": {
    "sha256": null,
    "signature": "not-published",
    "attestation": "not-published",
    "reproducible_build": "not-verified"
  }
}
```

R2 source downloads may expose an unsigned transport SHA-256 when object
metadata contains one. A checksum alone is never described as a signature.

## 4.9 `POST /api/share` and `GET /api/share/:id`

The browser caps plaintext at 25 MiB; `POST /api/share` permits a ciphertext
body up to the Worker's 26 MiB transport cap after the `ShareRate` Durable
Object consumes an upload token for the bucket key described in §3.2.3.
The Worker writes the ciphertext to `RELEASES` under `shares/<id>`
with `created_at` and nominal 24-hour `expires_at` custom metadata. The browser
keeps the AES-GCM key and IV in the URL fragment, outside the HTTP request.

`GET /api/share/:id` reads the R2 object, checks `expires_at`, and attempts an R2
delete both for an expired object and after reading a non-expired body. Delete
errors are ignored. The read and delete are not an atomic consume operation, so
concurrent GETs may both obtain a body. No scheduled handler, R2 lifecycle rule,
or cleanup acceptance evidence is present in this repository. Therefore the
nominal 24-hour timestamp is an expiry-on-read policy, not proof of a 24-hour
maximum storage-retention bound or exactly-once retrieval.

---

# 5. WASM crates

Eight wrapper crates compile One Link Rust crates to WebAssembly. Each local
demo exercises the named crate in the browser; that is primitive-level evidence,
not proof that current website traffic, downloads, updates, or releases use it.

## 5.1 `ol_pair_qr_wasm`

**Wraps**: [`ol_pair_qr`](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_pair_qr) (Phase F2 of Coherence Mesh Plan)
**Output**: `ol_pair_qr.js` (25 KB) + `ol_pair_qr_bg.wasm` (250 KB)
**Demo on site**: home-page same-tab pairing primitive self-test. Inviter and Scanner both execute locally; this is not a camera scan, second-device pairing, transport test, or human SAS confirmation.

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

**Wraps**: [`ol_pqkem`](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_pqkem) (PQ-hybrid KEM per ADR-0017)
**Output**: `ol_pqkem.js` (21 KB) + `ol_pqkem_bg.wasm` (191 KB)
**Demo on site**: hero PQ primitive self-test badge ("running" -> local result). It proves only that two local WASM roles derived the same secret; it does not authenticate or protect `/api/session`.

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

**Wraps**: [`ol_onion`](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_onion) (Phase F3, Sphinx-style routing)
**Output**: `ol_onion.js` (16 KB) + `ol_onion_bg.wasm` (161 KB)
**Demo on site**: the `/download/` private-route demo button runs a local
three-hop wrap/peel. It does not route the requested download bytes.

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

**Wraps**: [`ol_coherence_field`](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_coherence_field) (Phase E, Helmholtz solver)
**Output**: `ol_coherence_field.js` (10 KB) + `ol_coherence_field_bg.wasm` (77 KB)
**Demo on site**: local solver visualization. Live relay-derived mesh data remains deferred.

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

## 5.5 Additional local-demo wrappers

| Wrapper | Production crate | Checked-in WASM | Evidence scope |
|---|---|---:|---|
| `ol_pqsig_wasm` | `ol_pqsig` | ~257 KB | Local Ed25519 + ML-DSA-65 sign/verify/tamper demo; not application-release signing |
| `ol_threshold_recovery_wasm` | `ol_threshold_recovery` | ~80 KB | Local Shamir split/recover demo; not a deployed recovery service |
| `ol_ratchet_wasm` | `ol_ratchet` | ~81 KB | Local chain-key stepping demo; not evidence that website chat or transfers use the ratchet |
| `ol_hwkey_wasm` | `ol_hwkey` | ~94 KB | Browser `localStorage` software-TOFU demo; not hardware-backed identity |

Together with §§5.1-5.4, these are the eight members listed in
[live/wasm/Cargo.toml](live/wasm/Cargo.toml) and built by
[scripts/build-wasm.sh](scripts/build-wasm.sh).

## 5.6 Build and version pinning

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
|  [● N sessions]   [● site bundle checked] [● pq self-test] |
|                                                             |
|    [v]  click to send a pulse                               |
+------------------------------------------------------------+
   ↕  full-bleed WebGPU coherence field, mouse-reactive
      glowing peer dots overlay (connected website sessions)
      self dot in amber
   ↕

   Three promises, three tiles
   Pairing primitive self-test card (both WASM roles in one tab)
   "Why this exists" closer
   Footer
```

**Observed, scope-limited website behaviors**:

- **WebGPU coherence-field** fills the viewport. Real damped Helmholtz on GPU via compiler-emitted shader (§3.6). Cursor moves ripple the field. Click sends a pulse.
- **Word-rise hero**: each word in the headline has a staggered `--d` CSS custom-property delay, gets blur(14px) → blur(0) + translateY(18px) → 0 + opacity 0 → 1 over 1.1s. The line "Only you can read it." uses the cyan-violet gradient text.
- **Live presence ribbon** top-right displays the `MeshPresence` Durable Object's
  current connected-session count. It is not a count of authenticated people or
  One Link network nodes.
- **Glowing peer dots overlay** floats over the field. Each connected website session gets a deterministic-per-session-id hue. Clicking a dot requests a pseudonymous website chat over the Cloudflare-hosted presence WebSocket. It is not a network-node display or network-level anonymity.
- **Self dot** is amber, larger, crowned with "you" label.
- **Status pills** under CTAs: visitors here (presence count), site-bundle check (Service Worker state), and local PQ primitive self-test. None of these is a production-network or release-artifact attestation.
- **Pairing card** runs both `ol_pair_qr` Inviter and Scanner locally in one tab, renders an SVG QR, and compares the locally derived SAS and chain key. Real-device pairing additionally requires a second device, transport, QR scan, user comparison, and confirmation.
- **Ambient audio toggle** bottom-right (Web Audio: 55Hz drone + 220Hz triangle shimmer + 0.07Hz LFO). Off by default.
- **Scroll hint** bottom of hero, smooth scrolls to next section.
- **Reduced-motion**: word-rise animation collapses to instant readability.

## 6.2 `/download/`

Get One Link. The destination from every CTA.

Hero: "One tap. It just works."

The page requires an exact platform choice. Windows and Linux architecture can
be inferred for the convenience route. Ordinary macOS User-Agent strings do
not reliably distinguish Intel from Apple Silicon, so ambiguous macOS routes
show a choice instead of guessing.

Alternates row: all 7 platforms + "Source (build it yourself)".

**Current proof strip beneath the button**:
```
channel       auto-latest (mutable continuous alpha)
version       not pinned
sha256        no authenticated artifact-bound reference published
signature     not published
attestation   not published
build         reproducibility not independently verified
verify        local SHA-256 only; UI must say NOT VERIFIED without a reference
```

Three truth tiles distinguish local hashing, artifact signatures, and
reproducibility/provenance without collapsing them into one claim.

Current downloads use ordinary GitHub/R2 delivery. Native transfer remains a
separate future feature and is not claimed by the release route.

The private-route button calls `window.olRunOnionPreview()` and displays a
browser-local Sphinx wrap/peel self-test. Current artifact downloads still use
ordinary GitHub/R2 delivery; no download route defaults to or traverses Sphinx.

## 6.3 `/how-it-works/`

Four-step walkthrough in plain verbs:

1. Open the app.
2. Pair with someone.
3. Send something.
4. Done.

“If they are offline” content must distinguish implemented transport behavior from design goals. Do not claim guaranteed seven-day retention, atomic deletion, volunteer-relay selection, or automatic failover without release-specific acceptance evidence.

“If you want to hide your trail” may describe the local three-hop onion primitive self-test. Daemon transport wiring remains deferred. Even when integrated, copy must say the design limits what any single relay learns, not promise full anonymity or defeat of a global observer.

The update section must distinguish an availability/checksum check from
publisher authentication and installation. Frozen desktop bundles disable
automatic, silent, and in-place installation at the runtime boundary; replacing
one is an explicit user or operator action. The current surface must never claim
that auto-install is enabled by default or that a Settings control can enable it.
A checksum obtained from the same mutable `auto-latest` channel can detect
accidental corruption but does not prove who produced the bytes. Historical
changelog text may record an earlier auto-install experiment only inside an
explicitly scoped, superseded correction that also states the current frozen
boundary. Until an immutable version and independently trusted signed manifest
are verified, update copy must not use “verified,” “authenticated,” or “the
bytes we signed.”

"The math if you want it" — collapsible `.ol-proof` panel with the full crypto stack:

```
identity              Ed25519 + ML-DSA-65 hybrid signature
session keys          daemon/protocol design: X25519 + ML-KEM-768; website /api/session does not complete this exchange
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

The capability matrix is static, manually reviewed copy. It must use “implemented,” “local demo,” and “planned” per feature and cite an executable acceptance gate. The unsigned hard-coded `/api/capabilities` response is not proof that the daemon ships a feature.

Categories:
- For people: messages, files, calls, shared folders, pairing, devices-as-one.
- For privacy: 3-hop routing, hardware-key TOFU, threshold recovery, field-bound binding, duress mode, confidential builds.

Capability badge: “unsigned Worker-maintained list.” Do not label it “live from the daemon” until the Worker verifies an authenticated, fresh daemon advert and the matrix is actually derived from it.

## 6.5 `/security/`

Honest threat model. Two columns:

**What we defend against**:
- Passive eavesdropping on specifically identified E2EE paths. The website's browser-to-Worker session is not PQ-protected; do not generalize the local PQ self-test to network traffic.
- Active impersonation (5-word SAS detects MITM).
- Server compromise: servers may hold ciphertext and metadata; the intended property is that they do not hold plaintext keys.
- Traffic analysis: local onion primitive exists; daemon transport integration and global-observer resistance are not shipped.
- Lost device (threshold recovery).
- Coerced unlock (duress mode).

**What we cannot fix**:
- A camera over your shoulder.
- A compromised operating system.
- The other person leaking it.
- Global passive adversaries on private mode (timing padding helps, doesn't perfect).

**The receipts**: link each exact claim to current test output. No external audit, artifact-bound reproducibility result, or authenticated rolling release is currently published.

## 6.6 `/mesh/`

Bigger website-presence visualization. The hero count and peer dots represent
connected browser sessions, not authenticated people, daemon nodes, or relays.
The regional anchors and relay-style halos are illustrative, and the Worker
topology response remains a non-authoritative status with null fields. No routing decisions or
relay health are visualized.

"What you are seeing" — explainer for the tau_c routing field. Code block showing the per-frame solver call.

"What we do NOT show" — no IPs, no usernames, no precise locations.

## 6.7 `/builders/`

For developers. Lists 12 of the 38 native crates with one-line explanations. Run-your-own-relay one-liner. Donation block (BTC / Lightning / Monero — addresses are placeholders, fill before mainnet).

## 6.8 `/about/`

The covenant. What One Link is, what it is not, who is behind it (anyone who picks it up; no company, no founders), and the relationship to the coherence-field research program the protocol grew out of.

## 6.9 `/privacy/` and `/terms/`

Short, precise, one-page each. Privacy inventories application state and infrastructure processing: Cloudflare request metadata, presence session id/approximate geo/timestamp, truncated-subnet rate state, R2 ciphertext, and redirected GitHub downloads. “No application accounts or analytics” is acceptable; “we collect nothing” is not.

## 6.10 `/404.html`

Minimal. "Nothing here. Try the network." with home + download CTAs. Coherence field background still runs.

---

# 7. Security model

## 7.1 What we collect

The application has no account database, analytics integration, advertising,
tracking pixels, or tracking cookies. That is not zero processing: Cloudflare
receives request metadata, presence holds ephemeral pseudonymous session state,
`ShareRate` persists a deterministic bucket identity plus rate state (normally
/24- or /48-derived, with a raw-string fallback), R2 stores share ciphertext,
and GitHub receives requests after artifact redirects.

This is by construction, not by policy:

- The Worker code (visible at [src/worker.js](src/worker.js)) has no `console.log(request)`, no analytics tap, no fetch to a third party.
- The Service Worker (visible at [sw.js](dist/weareone-link.org/sw.js)) has no push API, no Periodic Background Sync, no message channel to a server.
- The presence session map holds a random id, socket, approximate client-supplied geo, and last-seen timestamp. The Worker forwards the original upgrade request to the Durable Object; do not claim the infrastructure never receives IP-bearing headers.
- The reviewed HTML pages have no third-party `<script src>` or `<img src>`.
  Worker CSP and the Service Worker's signed-manifest cache checks are separate
  controls. A Service Worker manifest check is not browser Subresource Integrity.

The application does not maintain an account-to-download or global pairing database. Infrastructure providers, artifact hosts, peers, and network observers may still hold or infer request and connection metadata; this document makes no impossibility claim.

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
        | sees ciphertext on |        | tries to ride a real
        | implemented E2EE   |        | device QR flow; local
        | paths              |        | self-test is not proof
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
   | ciphertext + metadata|  |   |  signed site manifest|
   | may still be exposed |  |   | checks site bytes only|
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

[sw.js](dist/weareone-link.org/sw.js) implements the cache and manifest checks.

**Three jobs**:

1. **Offline support**. Precaches the configured core shell in `PRECACHE_URLS`;
   secondary pages and WASM are cached on demand. Navigations are network-first
   with cache fallback; static assets are cache-first with manifest verification
   when a trusted manifest is available.

2. **Signed site-manifest verification**. Reads [/manifest.json](dist/weareone-link.org/manifest.json) on install + on demand, verifies its Ed25519 signature against the public key pinned in the Service Worker, then compares each tracked cached asset's SHA-256 before serving it. Mismatch: evict, refetch, re-verify.

3. **Cryptographic site-bundle integrity**. A valid manifest signature plus matching
   asset hashes detects cache corruption and asset substitution relative to the
   Service Worker's pinned key. The Service Worker and key are delivered by the
   same origin, so this authenticates only relative to a key delivered and pinned
   by that same-origin Service Worker. It is not an independent application-release
   trust root and says nothing about downloadable application artifacts.

**Manifest schema (illustrative values; inspect the checked-in manifest for the
current revision)**:

```json
{
  "version": "0.21.0-alpha.0+r7",
  "issued_at": "2026-05-17T00:00:00Z",
  "signed_by": "ed25519-pub-<hex>",
  "signature": "ed25519-<hex>",     // signature of the assets map
  "assets": { "/css/...": "sha256-...", ... }
}
```

The public key is pinned in `sw.js`, and the Service Worker verifies each candidate
manifest with WebCrypto Ed25519 before trusting its asset map. Key rotation is not
implemented. Every asset mutation requires rehashing, re-signing, and a clean
`scripts/verify-manifest.py` run before the bundle is releasable.

## 7.5 Headers

The Worker applies this pack to routed responses and to its static-asset
fallback. No `dist/weareone-link.org/_headers` file is checked in; Worker code is
the response-header implementation for this deployment:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval' <pinned speculation-rules SHA-256>;
  style-src 'self';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self';
  worker-src 'self';
  manifest-src 'self';
  media-src 'self' blob:;
  object-src 'none';
  frame-ancestors 'none';
  frame-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests

Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(),
                    interest-cohort=(), browsing-topics=(),
                    join-ad-interest-group=(), run-ad-auction=()
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
NEL: {"report_to":"","max_age":0,"success_fraction":0,"failure_fraction":0}
Report-To: {"group":"","max_age":0,"endpoints":[]}
```

The Worker also sets `Access-Control-Allow-Origin: *` on non-HTML responses and
removes it from HTML in `applyHeaders()`. The exact speculation-rules hash is
kept in `src/worker.js`; the placeholder above avoids duplicating a volatile
digest in this document.

**COEP: require-corp + COOP: same-origin** establishes cross-origin isolation in
compatible browsers when these headers are served, enabling `SharedArrayBuffer`
for future multi-thread WASM.

## 7.6 Browser SRI versus Service Worker manifest checks

Subresource Integrity (SRI) is enforced by the browser from `integrity="sha384-..."`
attributes on individual `<script>` and `<link>` tags. The separate
[scripts/inject-sri.py](scripts/inject-sri.py) utility can add those attributes,
but the current checked-in HTML has none and `scripts/rehash-manifest.py`
intentionally skips SRI injection. SRI therefore is not a current bundle claim.

The Service Worker instead verifies an Ed25519-signed same-origin manifest and
then checks cached assets against that manifest's SHA-256 map. That covers
tracked dynamic imports and WASM after the Service Worker is installed, but it
has a different lifecycle and trust boundary from browser SRI. Neither mechanism
is independent application-artifact signing.

## 7.7 Robots and AI scrapers

[robots.txt](dist/weareone-link.org/robots.txt) explicitly denies GPTBot, ClaudeBot, PerplexityBot, Google-Extended, anthropic-ai, Bytespider, CCBot. We have nothing to hide but we are not your training corpus.

---

# 8. Coherence Language integration

## 8.1 Why .cl

The user wrote One Link's daemon in Rust + Python. They wrote the Coherence Lang compiler / WGSL emitter / capability system as the substrate behind it. Writing the website's SSG and GPU shader in our own language is the only honest stack story for a project that ships its own crypto AND its own routing math.

## 8.2 The SSG program

[pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl).

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
  // 2. for each of 11 canonical routes, including index.html:
  //    fold in <meta x-emitted-by ...>
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
- The 11 baseline canonical HTML routes, including `index.html`, are
  provenance-folded with `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` after `<head>`. Their page bodies remain hand-authored.
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
                     $COHERENCE_COMPILER (env var)
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

Eight production crates from [`https://github.com/coherence-energy-labs/one-link/tree/master/native/`](https://github.com/coherence-energy-labs/one-link/tree/master/native/) are pulled by path-dependency into our WASM wrappers:

| Wrapper | Production crate | Daemon role |
|---|---|---|
| `ol_pair_qr_wasm` | `ol_pair_qr` | Phase F2 in-person pairing |
| `ol_pqkem_wasm` | `ol_pqkem` | ADR-0017 PQ-hybrid KEM |
| `ol_pqsig_wasm` | `ol_pqsig` | Hybrid signature primitive |
| `ol_threshold_recovery_wasm` | `ol_threshold_recovery` | Threshold recovery primitive |
| `ol_ratchet_wasm` | `ol_ratchet` | Ratchet primitive |
| `ol_hwkey_wasm` | `ol_hwkey` | Software TOFU demo surface |
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
python scripts/rehash-manifest.py
# This bumps the website revision, updates cache-busting URLs and HTML hashes,
# and invokes sign-manifest.py when the offline manifest key is present.
# Then verify the exact bundle with scripts/verify-manifest.py. The result is a
# same-origin pinned-key site-bundle check, not application-release signing.

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

The repository includes [scripts/rehash-manifest.py](scripts/rehash-manifest.py).
It discovers HTML, recomputes tracked hashes, bumps the `+rN` website revision,
updates cache-busting URLs, rehashes the rewritten HTML, and invokes
`scripts/sign-manifest.py` when the offline manifest key exists:

```bash
python scripts/rehash-manifest.py
python scripts/verify-manifest.py
```

This is a release mutation, not a read-only check: it rewrites the manifest,
`sw.js` version, and cache-busted HTML references. Its SRI-injection stage is
currently disabled by design. Do not run it during an unrelated or docs-only
change, and do not treat its same-origin manifest signature as independent
application-release authentication.

## 10.5 DNS

Both domains are registered on Cloudflare. Nameservers already point at CF. After deploy + routes, the site is live within seconds.

For `.com -> .org`: no CNAME chain needed. The redirect Worker handles it.

For Tor onion mirror (future, §11): add a `.onion` v3 address, mirror `dist/` to it via a separate small worker / static host.

---

# 11. Roadmap

This is a reviewed status ledger, not a release promise. "Implemented" means the
named code path exists and is directly testable; it does not imply a production
security audit, release attestation, operational SLO, or end-to-end deployment.

## 11.1 Implemented or locally demonstrable

1. Static `dist/` routes and the `.org` Worker, plus the `.com` redirect Worker.
2. Worker routes for health, presence, encrypted share storage, downloads, and the
   currently limited capability, topology, session, attestation, and native APIs
   documented in §§3.2-3.5.
3. `MeshPresence` real-time pseudonymous browser sessions and click-to-chat. The
   application state omits account identity and full IP addresses; Cloudflare still
   processes request metadata, and the browser supplies approximate region data.
4. Browser-local WASM primitive demonstrations for pairing, ML-KEM, signatures,
   threshold recovery, ratcheting, TOFU, onion wrapping, and the coherence field.
   These demonstrations are not evidence that those primitives protect a current
   browser-to-Worker or browser-to-device transport.
5. WebGPU/2D coherence-field visuals and the emitted WGSL shader.
6. Service Worker offline caching with asset hashes checked against the fetched
   site manifest. This is site-bundle integrity checking, not publisher-signed
   release authentication.
7. Release-attestation schema fixtures. They are test material, not proof for a
   rolling download artifact.
8. Browser-encrypted URL-fragment sharing with the storage, expiry, deletion, and
   rate-limit caveats in §3.2.3.
9. Response security headers, including COEP and COOP where configured.

## 11.2 Required production closure (dependency-ordered)

1. Complete `/api/session`: authenticate the server key material, accept client
   key material, perform the advertised X25519/ML-KEM exchange, derive traffic
   keys, bind the transcript, and prove failure behavior with interop tests.
2. Replace the unsigned hard-coded `/api/capabilities` response and unavailable,
   non-authoritative `/api/topology` status with authenticated, fresh daemon/relay data
   and tested stale-data/fallback behavior.
3. Replace `/native` and `NativeSession` stubs with a real, authenticated,
   flow-controlled native transport and measurable fallback behavior.
4. Harden encrypted sharing with an atomic consume policy if one-time semantics are
   advertised, scheduled expiry cleanup, verified deletion, abuse controls,
   observability, and retention acceptance tests.
5. Publish immutable versioned artifacts, an independently trusted signed update
   manifest, platform code signing, artifact-bound attestations, SBOM/provenance,
   and reproducible-build evidence before enabling or advertising authenticated
   automatic updates.
6. Exercise pairing across two independent devices with camera/manual transfer,
   a real transport, transcript binding, human SAS comparison, cancellation, and
   adversarial MITM/replay tests.
7. Integrate onion routing into an actual transport/download path and document its
   measured threat-model limits; the local wrap/peel self-test alone is insufficient.
8. Finish SiteWorld-driven programmatic page composition and prove deterministic
   generation for every route.

## 11.3 Later product goals

1. A measured native/WebTransport download path once the selected deployment
   platform supports the required semantics.
2. A richer 3D coherence-field scene, with accessibility and performance budgets.
3. A Tor onion mirror with independently verifiable cross-consistency evidence.
4. A self-rebuild experience backed by a reproducible, isolated build pipeline.
5. A locally bundled website UI whose offline guarantees explicitly exclude any
   Worker, relay, rendezvous, update, or artifact-host service it cannot provide.
6. Hardware-backed device keys with explicit platform fallback and migration rules.

---

# 12. Claim-and-evidence ledger

Reviewed alien-tech claims are mapped below to the code that backs them. This is
not presumed exhaustive: **if a claim appears on a page and is not in this
ledger, the claim is unverified and should be removed or backed.**

| Claim on site | Backing code | How to verify |
|---|---|---|
| "No application accounts" | [src/worker.js](src/worker.js) (no account routes) | Review the Worker route table and browser storage use. This claim is scoped to the website application; it says nothing about infrastructure-provider accounts or request logs. |
| "No first-party analytics, ads, tracking cookies, or profiling" | [src/worker.js](src/worker.js), [sw.js](dist/weareone-link.org/sw.js) | Review response headers, scripts, storage, and outbound requests. Cloudflare and artifact hosts still process ordinary connection/request metadata as disclosed in §§6.4-6.5. |
| "Pairing primitive self-test" | [live/wasm/ol_pair_qr_wasm/src/lib.rs](live/wasm/ol_pair_qr_wasm/src/lib.rs) → `liveDemoRoundTrip` | Confirm `ol_pair_qr_bg.wasm` loads and the same-tab inviter/scanner round trip passes. This does not test a camera, second device, device transport, or human SAS comparison. |
| "Local PQ primitive self-test" | [live/wasm/ol_pqkem_wasm/src/lib.rs](live/wasm/ol_pqkem_wasm/src/lib.rs) → `liveDemoRoundTrip` | Confirm the browser-local encapsulation/decapsulation result matches. `/api/session` is a separate registration/X25519-advertisement path and does not establish an ML-KEM session. |
| "X25519 + ML-KEM-768 hybrid" | [ol_pqkem](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_pqkem) and the local WASM wrapper | Verify the primitive implementation and its unit/self-tests. Do not infer that the current website session, Worker, download, share, or presence traffic uses the hybrid exchange. |
| "Ed25519 + ML-DSA-65 hybrid signatures" | [ol_pqsig](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_pqsig) + [ol_pqsig_wasm](live/wasm/ol_pqsig_wasm/) | Visit `/security/` → click "Sign a message with Ed25519 + ML-DSA-65". DevTools → Network → see `ol_pqsig_bg.wasm` load (257 KB). Output shows fresh 1984-byte hybrid pubkey + 3373-byte hybrid signature + verify-clean + reject-tampered-msg + reject-tampered-PQ-half. |
| "Threshold recovery splits your identity across friends" | [ol_threshold_recovery](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_threshold_recovery) + [ol_threshold_recovery_wasm](live/wasm/ol_threshold_recovery_wasm/) | Visit `/security/` → click "Split and recover a secret with 3-of-5 Shamir". Generates fresh 32-byte secret, splits into 5 shares, recovers from any 3, refuses with only 2. Real Shamir over GF(2^8). |
| "Local ratchet primitive self-test" | [ol_ratchet](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_ratchet) + [ol_ratchet_wasm](live/wasm/ol_ratchet_wasm/) | Run the `/security/` six-step demonstration and its rewind/skip-cap checks. This does not prove that current website messages or transfers use the ratchet. |
| "Local software TOFU self-test" | [ol_hwkey](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_hwkey) (TofuStore) + [ol_hwkey_wasm](live/wasm/ol_hwkey_wasm/) | Run the `/security/` mint/recognize demonstration and inspect its `localStorage` state. It is not hardware-backed identity and does not prove server unlinkability. |
| "Sphinx Coherence onion primitive self-test" | [ol_onion](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_onion) | `ol_onion_wasm.liveDemoRoundTrip(payload)` exercises local three-hop wrap/peel. The website transport and download path are not wired through it. |
| "Real Helmholtz physics on GPU" | [scripts/emit-wgsl.py](scripts/emit-wgsl.py) → coherence_lang wgsl_emitter | The shader at /live/shaders/coherence-field.wgsl has `coh_oscillator_force`, `coh_tau`, real PDE solver compute pass. |
| "10,000 peers in 1.08 ms" | [ol_coherence_field](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_coherence_field) benchmark output | Cited from daemon benches. Browser runs the same solver via `ol_coherence_field_wasm`. |
| "5-word SAS primitive" | [ol_pair_qr::sas](https://github.com/coherence-energy-labs/one-link/tree/master/native/ol_pair_qr/src/sas.rs) | Verify the 30-bit, 64-word deterministic transcript mapping. The same-tab card does not prove that two humans compared the words. |
| "Live N browser sessions here right now" | [src/worker.js](src/worker.js) `MeshPresence` DO + [live/bridge.js](dist/weareone-link.org/live/bridge.js) presence client | Open two browser windows and confirm the connected-session count changes. It is not a count of authenticated people or network nodes. |
| "Pseudonymous chat between connected browser sessions" | Same as above + the `chat-*` relay path in [live/bridge.js](dist/weareone-link.org/live/bridge.js) and [src/worker.js](src/worker.js) | Use two windows and click their rotating peer dots. Confirm the invite/accept/confirm flow and encrypted message relay. This does not prove durable peer identity, a required out-of-band SAS comparison, or network anonymity. |
| "Site bundle checked" badge | [sw.js](dist/weareone-link.org/sw.js) `verifyAgainstManifest` | Confirm the Service Worker verifies the manifest against its same-origin pinned key, checks cached bytes, and evicts mismatches. This trust scope is not an independent application-release root and does not authenticate downloadable artifacts. |
| "Signed twice" (downloads) | No current artifact-bound proof | Prohibited for the rolling downloads until an immutable artifact has verified Ed25519 and ML-DSA-65 signatures rooted in independently trusted release metadata. Schema fixtures are not evidence. |
| "Reproducible builds" | independent rebuild evidence + artifact-bound attestation | Deferred. A schema field or stated intent is not verification. |
| "The previously cached static site may render offline" | Service Worker precache | After one complete visit, disable the network and test cached routes. This does not preserve Worker APIs, presence, relays, rendezvous, updates, artifact hosting, or any other unavailable service. |

---

# 13. Decision log (ADRs)

Major architectural decisions, why we made them, what the alternative was.

## ADR-001: Hand-author canonical HTML; .cl emits a sample and folds provenance

**Context**: Earlier pushes hand-wrote 11 HTML files; the `.cl` SSG existed in scaffold only. User called this out; we corrected.

**Decision**: Phase 1 programmatically composes the separate `index.cl.html`
sample. It folds provenance into all 11 hand-authored canonical baseline routes,
including `index.html`. Phase 2+ moves canonical pages to full programmatic
composition.

**Alternative considered**: Throw away the hand-written HTML and regenerate from scratch programmatically. Rejected because the hand-written content is good and rewriting it as `.cl` strings before tooling matures is busywork.

**Status**: partial. The sample and provenance fold exist; canonical page
composition remains in §11.2.

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

**Decision**: Each wrapper crate pins `wasm-bindgen = "=0.2.95"` exactly. Lockstep upgrade procedure documented in §5.6.

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

Cause: `COHERENCE_COMPILER` env not set + default path `$COHERENCE_COMPILER (env var)` doesn't exist.

Fix: set `COHERENCE_COMPILER` to the absolute path of the `coherence_lang` checkout that contains `coherence_lang/compiler/cli/main.py`.

## `.cl` parser error "Expected ']' to close effects list"

Cause: tried to use `effects [ExternalIO:fs]` syntax. The parser doesn't support the colon-qualifier in effect lists.

Fix: use plain `effects [ExternalIO]` and rely on the effect-system inference for the qualifier.

---

# Appendix A. File inventory

Selected architecture inventory. This is not an exhaustive file listing; use
`rg --files` for the working tree.

```
README.md                          Public README. Manual.
CLAUDE.md                          Assistant guide + doctrine. Manual.
SPEC.md                            This file. Manual.

wrangler.toml                      .org worker config. Manual.
wrangler.com.toml                  .com redirect worker config. Manual.

clc.cmd                            Windows shim for python tools/clc.py. Manual.
clc.ps1                            PowerShell variant. Manual.
tools/clc.py                       Resolves coherence_lang path + dispatches. Manual.

src/worker.js                      .org main Worker. Manual.
src/redirect.js                    .com 301 worker. Manual.

scripts/build-wasm.sh              Compiles + bindgens all 8 WASM crates. Manual.
scripts/emit-wgsl.py               Calls wgsl_emitter, writes coherence-field.wgsl. Manual.
scripts/rehash-manifest.py         Rehashes/version-bumps/cache-busts and invokes signer. Manual release mutation.
scripts/inject-sri.py              Optional browser-SRI injector; not called by current rehash path.

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
live/wasm/ol_pqsig_wasm/           Wrapper crate. Manual.
live/wasm/ol_threshold_recovery_wasm/ Wrapper crate. Manual.
live/wasm/ol_ratchet_wasm/         Wrapper crate. Manual.
live/wasm/ol_hwkey_wasm/           Wrapper crate. Manual.
live/wasm/ol_onion_wasm/           Wrapper crate. Manual.
live/wasm/ol_coherence_field_wasm/ Wrapper crate. Manual.
live/wasm/target/                  Cargo build dir. Regenerable.

attestations/                      Empty placeholder for source attestations.

dist/weareone-link.org/
  index.html                       Hand-authored canonical page; SSG provenance fold-in.
  index.cl.html                    SSG programmatic sample. Regenerable.
  <route>/index.html               Hand-authored canonical pages; SSG provenance fold-in.
  manifest.json                    Signed asset manifest. Recomputed by §10.4.
  sitemap.xml                      Manual.
  robots.txt                       Manual.
  feed.xml                         Manual; future SSG generator.
  css/one-link.css                 Manual.
  css/immersive.css                Manual (home-only).
  live/bridge.js                   Manual vanilla ES module.
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

[[durable_objects.bindings]]
name = "SHARE_RATE"
class_name = "ShareRate"

[[migrations]]
tag = "v1"
new_classes = ["NativeSession"]

[[migrations]]
tag = "v2"
new_classes = ["MeshPresence"]

[[migrations]]
tag = "v3"
new_classes = ["ShareRate"]

[[r2_buckets]]
binding = "RELEASES"
bucket_name = "one-link-releases"

# ATTESTATIONS and RELAY_KV are intentionally commented out until provisioned.
# The attestation route remains fail-closed, and topology remains synthetic.

[vars]
SITE_DOMAIN         = "weareone-link.org"
CANONICAL_ORIGIN    = "https://weareone-link.org"
PROTOCOL_VERSION    = "1"
NATIVE_TRANSFER_CAP = "NATIVE_TRANSFER_V1"
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
    "repo":    "https://github.com/coherence-energy-labs/one-link",
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
- **Durable Object (DO)**: Cloudflare's primitive for stateful single-instance compute. Used here for load-bearing `MeshPresence` and `ShareRate` classes plus the currently stubbed `NativeSession` class.
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
- **Provenance meta**: The `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` tag the .cl SSG folds into the 11 baseline canonical routes. It proves that the SSG touched the file, not that it generated the page body.
- **R2**: Cloudflare's S3-compatible object store.
- **Ristretto255**: Prime-order group built on Curve25519, used by Sphinx for blinded point operations.
- **SAS (Short Authentication String)**: 30-bit value derived from the pair-by-QR transcript, rendered as 5 words. Users compare verbally; mismatch reveals a MITM.
- **Schnorr aggregation**: Schnorr signature scheme variant that allows N signatures over the same message to be combined into one verifiable aggregate. Used by ol_onion::aggsig.
- **Service Worker (SW)**: Browser-native background script that intercepts fetches. Here used for core-shell caching, on-demand cache fallback, and same-origin signed-manifest verification.
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
