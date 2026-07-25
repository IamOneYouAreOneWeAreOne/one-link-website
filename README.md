# One Link Website

Public pre-release site for One Link. Two domains, one codebase:

- `weareone-link.org` (primary)
- `weareone-link.com` (301 → .org)

## Doctrine

- **We are one.** For the people. Just works. Private + secure.
- **Extremely easy.** Every alien capability disappears behind one button.
- **NOT corporate.** No pricing, no enterprise, no contact-sales. Donations only.
- **No application accounts, analytics, advertising, or tracking cookies.** Cloudflare and redirected artifact hosts still process ordinary request metadata; feature-specific ephemeral state and encrypted storage are documented on `/transparency/`.
- AGPL-3.0.

## Stack

- **Hosting:** Cloudflare Workers (one Worker per domain).
- **Site format:** static HTML/CSS + a vanilla ES module for Live Mode. Zero npm runtime deps.
- **SSG (partially regenerable path):** forked from `Coherence_Energy_Labs_Website/pipeline/ssg/` (sibling repo, not always co-checked-out in CI). It programmatically composes a home-page sample and folds provenance into 11 baseline English routes; full SiteWorld-driven page composition is not complete.
- **Live Mode:** WGSL coherence-field background + 2D mesh-viz canvas + ephemeral session registration, a local PQ primitive self-test, and a fail-closed topology-status poller. Vanilla JS, no frameworks.

## Layout

```
src/                          Cloudflare Worker source
  worker.js                   weareone-link.org Worker (assets + /api/* + /native)
  redirect.js                 weareone-link.com → .org Worker

wrangler.toml                 .org Worker config (DO + R2 + KV bindings)
wrangler.com.toml             .com redirect Worker config

dist/weareone-link.org/       Built site (deployed as Worker static assets)
  index.html                  Home
  download/                   Get One Link (OS-detected)
  how-it-works/               4-step walkthrough
  features/                   Capability matrix + comparison table
  security/                   Threat model + audits
  mesh/                       Website-presence visualization (not network topology)
  builders/                   Crates + run your own relay + donate
  about/                      Covenant
  privacy/  terms/            Legal (short, honest)
  404.html
  robots.txt  sitemap.xml  feed.xml
  css/one-link.css            Single visual-identity sheet
  live/
    bridge.js                 Live Mode ES module
    shaders/coherence-field.wgsl  Real damped Helmholtz background
  images/favicon.svg
  og/                         Open Graph cards

pipeline/                     SSG sources (forked from CEL, future regeneration path)
classic/partials/             Reusable HTML chrome
content/weareone-link.org/    MDX source for future content pipeline
siteworld/                    Typed content graph (nodes/edges/lenses)
config/                       Domain + nav + SEO + security-headers config
live/                         Rust WASM wrapper workspace; deployed JS/WASM lives under dist/live/
attestations/                 Development schema fixtures (not current release proof)
legal/                        Long-form legal source
assets/                       Brand + image source
scripts/                      Helper scripts
```

## Develop locally

```
wrangler dev --config wrangler.toml
```

Then open `http://localhost:8787/`.

## Deploy

```
wrangler deploy --config wrangler.toml         # .org
wrangler deploy --config wrangler.com.toml     # .com redirect
```

DNS for both domains already lives on Cloudflare. Add the route after first deploy:

```
weareone-link.org/*    →  weareone-link-org Worker
weareone-link.com/*    →  weareone-link-com-redirect Worker
```

## Worker endpoints

- `GET  /api/health`          — heartbeat
- `GET  /api/capabilities`    — unsigned Worker-maintained capability list; not a live daemon attestation
- `GET  /api/topology`        — non-authoritative availability status with null topology fields
- `GET  /api/attest/:sha`     — versioned release attestation (fail-closed until explicitly published)
- `POST /api/session`         — session registration + ephemeral X25519 public-key advertisement; no client ECDH or ML-KEM
- `GET  /api/presence`        — WebSocket presence and relay-mediated browser chat
- `POST /api/share`           — rate-limited, length-bounded upload of browser-encrypted ciphertext through a per-object Durable Object to R2
- `GET  /api/share/:id`       — serialized single-consumer claim; ciphertext is returned only after the R2 delete acknowledges
- `GET  /native`              — JSON protocol advertisement; no WebTransport session today
- `GET  /download/:os`        — platform-aware rolling/version-pinned artifact route with explicit proof status
- everything else             — static assets from `dist/weareone-link.org/`

The unsigned `/api/capabilities` response is not marketing evidence. Until an
authenticated, fresh daemon advert exists, an implemented capability claim
requires a manually reviewed, version-pinned acceptance artifact.

Each share has durable lifecycle state and an expiry alarm. Concurrent retrievals
for the same object are serialized, and the Worker buffers the bounded ciphertext,
waits for the R2 delete to acknowledge, records a tombstone, and only then returns
the body to the winning request. Expiry and deletion failures are retried. This is
an application-level single-consumer and cleanup guarantee, not proof of physical
erasure from provider logs, caches, backups, or unavailable infrastructure at an
exact wall-clock deadline.

`ShareRate` separately persists token/refill state under a deterministic Durable
Object name. Recognized IPv4/IPv6 inputs use /24-/48-derived names; unfamiliar
input falls back to the full raw string, and no application TTL deletes that
rate state.

## Current website behavior

The home page is now a **full-bleed immersive cosmic scene**:
- WebGPU coherence-field fills the entire viewport (no boxed hero).
- Cursor moves ripple the field (soft perturbation per frame).
- **Click anywhere sends a real pulse** that propagates through the field via the compiler-emitted `field_step` compute shader.
- Hero text **materializes word-by-word from the substrate** (blur+rise+fade-in CSS animation tied to staggered delays).
- **Live "N here right now" presence ribbon** top-right, driven by a WebSocket to the `MeshPresence` Durable Object. Other visitors see rotating pseudonymous IDs and approximate client-supplied region; Cloudflare still receives ordinary connection metadata including IP.
- **Pseudonymous peer-dot chat** is relayed through the presence service. Message content is AES-GCM encrypted in the browser after an `ol_pair_qr` exchange, and typing remains locked until both tabs report comparing all five SAS words over a separate trusted channel. Authentication depends on users actually performing that comparison; there is no durable peer identity, and the feature is not network-level anonymity.
- **PQ primitive self-test badge** reports whether an Alice/Bob `ol_pqkem` round trip succeeded locally in one tab. It does not verify or secure the browser-to-Worker session.
- **Optional ambient audio toggle** bottom-right: Web Audio drone + slow shimmer + LFO, off by default, one tap on, one tap off, zero third-party samples.
- **Scroll hint** at the bottom of the hero scrolls smoothly into the practical sections.
- Honors `prefers-reduced-motion`: word-rise animation collapses to instant readability.

## Implementation inventory

The WASM workspace currently contains eight wrapper crates; their browser demos
are primitive-level evidence, not proof that the corresponding network or
release path is deployed.

| Layer | Status | Lives at |
|---|---|---|
| `.cl` SSG home sample + provenance fold-in for 11 baseline routes | partial; full page composition deferred | [pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl) |
| WGSL coherence-field shader (compiler-emitted) | ✓ | [dist/.../live/shaders/coherence-field.wgsl](dist/weareone-link.org/live/shaders/coherence-field.wgsl) |
| WebGPU compute+render driving the emitted shader | ✓ | [dist/.../live/bridge.js](dist/weareone-link.org/live/bridge.js) |
| `ol_pair_qr` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_pair_qr_bg.wasm](dist/weareone-link.org/live/wasm/) (250 KB) |
| `ol_pqkem` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_pqkem_bg.wasm](dist/weareone-link.org/live/wasm/) (191 KB) |
| `ol_onion` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_onion_bg.wasm](dist/weareone-link.org/live/wasm/) (161 KB) |
| `ol_coherence_field` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_coherence_field_bg.wasm](dist/weareone-link.org/live/wasm/) (75 KB) |
| `ol_pqsig` Rust crate compiled to WASM | local primitive demo | [dist/.../live/wasm/ol_pqsig_bg.wasm](dist/weareone-link.org/live/wasm/) |
| `ol_threshold_recovery` Rust crate compiled to WASM | local primitive demo | [dist/.../live/wasm/ol_threshold_recovery_bg.wasm](dist/weareone-link.org/live/wasm/) |
| `ol_ratchet` Rust crate compiled to WASM | local primitive demo | [dist/.../live/wasm/ol_ratchet_bg.wasm](dist/weareone-link.org/live/wasm/) |
| `ol_hwkey` Rust crate compiled to WASM | local software-TOFU demo | [dist/.../live/wasm/ol_hwkey_bg.wasm](dist/weareone-link.org/live/wasm/) |
| Live peer-dots overlay + click-to-chat | relay-mediated encryption with a peer-authentication caveat | [dist/.../live/bridge.js](dist/weareone-link.org/live/bridge.js) |
| Service Worker with core-shell caching + Ed25519-signed site manifest | code path implemented; exact bundle still requires a clean release-time verifier result | [dist/.../sw.js](dist/weareone-link.org/sw.js) |
| Release-attestation schema fixtures | schema only, not current release proof | [dist/.../attestations/](dist/weareone-link.org/attestations/) |
| `weareone-link.com` 301 to `.org` | ✓ | [src/redirect.js](src/redirect.js) |
| Cloudflare Worker with `/api/*` + `/native` + R2 + KV | ✓ | [src/worker.js](src/worker.js) |

## The .cl stack is wired

This repo genuinely uses the Coherence Lang toolchain. Two concrete proofs:

1. **`pipeline/ssg/src/one_link_build.cl`** — a real `.cl` source file that type-checks and runs through the Coherence Lang runtime. It programmatically emits `index.cl.html`, then reads and rewrites 11 existing baseline routes to inject provenance. Those fold-ins do not mean the route content was generated from SiteWorld or `.cl`; that remains closure work.

2. **`dist/weareone-link.org/live/shaders/coherence-field.wgsl`** — emitted by `coherence_lang.codegen.wgsl_emitter.emit_coherence_field_shaders()` and shipped verbatim. It contains a `CoherenceFieldState` struct, damped Helmholtz oscillator (`coh_oscillator_force`/`coh_oscillator_energy`), tau coupling (`coh_tau`), KL divergence + maintenance power + Damkohler number helpers, Ebbinghaus + power-law forgetting curves, fBm noise, `@compute fn field_step` for per-frame state advancement, and `@compute fn inject_perturbation` for mouse interaction. Regenerable via `python scripts/emit-wgsl.py`; compare the emitted file byte-for-byte rather than relying on a volatile line count.

Run the SSG locally:
```
python tools/clc.py check pipeline/ssg/src/one_link_build.cl
python tools/clc.py run   pipeline/ssg/src/one_link_build.cl
python scripts/emit-wgsl.py
```

## What's wired vs. what's next

Wired now, with scope called out explicitly:
- The baseline English product routes use the shared "we are one" visual surface; additional routes and translations must be audited separately.
- **`ol_pair_qr` Rust crypto compiled to WASM (250 KB) and loaded on the home page.** Both Inviter and Scanner run locally in one tab. The card is a primitive self-test; it does not scan a camera, pair a phone, exercise a device transport, or prove a human SAS comparison.
- **Service Worker (`/sw.js`) with an Ed25519-signed site manifest and asset-hash checking.** The code precaches the configured core assets, verifies a candidate manifest against the public key pinned in the same-origin Service Worker, checks tracked cached bytes against that manifest's SHA-256 values, and evicts mismatches. Do not describe a mutated working tree or deployment as verified until `scripts/verify-manifest.py` passes for the exact bundle. Even then, this authenticates only relative to the same-origin pin; it is not an independent application-release trust root or proof for downloadable artifacts, reproducible builds, or release attestations.
- **Release-attestation schema fixtures.** Files under `/attestations/<sha>.json` exercise the document schema only. They are not proof for the rolling artifacts. `/api/attest/:sha` fails closed until `RELEASE_ATTESTATIONS_READY=true` and the matching document exists in the dedicated R2 binding; there is no static-fixture fallback.
- Coherence-field background canvas (WebGPU primary + 2D Helmholtz fallback).
- Website-presence canvas with approximate regional anchors, illustrative relay-style halos, and a visitor "you" marker. Its dots are connected website sessions and its halos are visual decoration, not daemon, relay, or routing telemetry.
- Worker route surface with R2, Durable Object, and KV bindings. Several routes remain deliberately partial as listed above; release attestations require an explicit readiness gate and matching R2 object.
- OS detection rewrites the download button to the visitor's platform.
- Topology poller refreshes the fail-closed, non-authoritative status response every 12 s; null counts are not live relay evidence.

WASM build:
```
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100
./scripts/build-wasm.sh
```

Known closure work, reviewed 2026-07-22:
1. Authenticate and complete `/api/session`: client X25519 ECDH, Worker ML-KEM, transcript binding, traffic-key derivation, and adversarial tests.
2. Replace the unsigned hard-coded capability list and unavailable topology status with authenticated daemon/relay data.
3. Implement and test a real `/native` transport before describing the JSON advertisement as WebTransport.
4. Add provider-retention evidence, cleanup/dead-letter observability, injected outage and power-loss tests, and a malware-safe download UX before describing temporary sharing as physically erased on an exact deadline.
5. Publish immutable versioned artifacts with independently trusted signatures, platform code signing, SBOM/provenance, and reproducibility evidence before enabling authenticated updates or attestations.
6. Test real two-device pairing separately from the same-tab and two-tab browser self-tests, and require an authenticated SAS/identity decision for peer chat.
7. Complete the SiteWorld-driven `.cl` regeneration path without overstating current generator ownership.

## License

AGPL-3.0. See LICENSE in `One_link/`.
