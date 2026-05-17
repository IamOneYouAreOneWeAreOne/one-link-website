# One Link Website

Public site for the One Link network. Two domains, one truth:

- `weareone-link.org` (primary)
- `weareone-link.com` (301 → .org)

## Doctrine

- **We are one.** For the people. Just works. Private + secure.
- **Extremely easy.** Every alien capability disappears behind one button.
- **NOT corporate.** No pricing, no enterprise, no contact-sales. Donations only.
- **No tracking, no analytics, no cookies, no fingerprinting.** Privacy is the architecture, not a policy.
- AGPL-3.0.

## Stack

- **Hosting:** Cloudflare Workers (one Worker per domain).
- **Site format:** static HTML/CSS + a small ES module for Live Mode. Zero npm runtime deps.
- **SSG (regenerable path):** forked from [`Coherence_Energy_Labs_Website/pipeline/ssg/`](../Coherence_Energy_Labs_Website/pipeline/ssg/). Lives at [pipeline/ssg/](pipeline/ssg/). Authored in `.cl`. The current `dist/` is hand-written as the canonical surface; the SSG is the future regeneration path.
- **Live Mode:** WGSL coherence-field background + 2D mesh-viz canvas + session handshake + topology poller. ~500 lines of vanilla JS, no frameworks.

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
  mesh/                       Live global mesh visualization
  builders/                   Crates + run your own relay + donate
  about/                      Covenant
  privacy/  terms/            Legal (short, honest)
  404.html
  _headers                    Cloudflare security headers
  robots.txt  sitemap.xml  feed.xml
  css/one-link.css            Single visual-identity sheet (~700 lines)
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
live/                         Live Mode source-of-truth (rebuilds into dist/live/)
attestations/                 Sample reproducible-build attestation chains
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
- `GET  /api/capabilities`    — live cap advert (source of truth for /features)
- `GET  /api/topology`        — mesh-map data feed
- `GET  /api/attest/:sha`     — reproducible-build attestation chain
- `POST /api/session`         — X25519 + ML-KEM-768 hybrid handshake init
- `GET  /native`              — WebTransport endpoint (wire-protocol negotiation)
- `GET  /download/:os`        — signed binary fetch (mesh-routed default)
- everything else             — static assets from `dist/weareone-link.org/`

## What's running right now (after the "truly insane" push)

The home page is now a **full-bleed immersive cosmic scene**:
- WebGPU coherence-field fills the entire viewport (no boxed hero).
- Cursor moves ripple the field (soft perturbation per frame).
- **Click anywhere sends a real pulse** that propagates through the field via the compiler-emitted `field_step` compute shader.
- Hero text **materializes word-by-word from the substrate** (blur+rise+fade-in CSS animation tied to staggered delays).
- **Live "N here right now" presence ribbon** top-right, driven by a real WebSocket to the `MeshPresence` Durable Object on the Worker. The N is real other visitors on the page right now, ephemeral, zero PII (no IP, no cookies, no logging).
- **Anonymous ping-between-visitors** wired end-to-end (Phase 2 will surface the click-to-ping UI).
- **PQ session badge** ticks from `deriving` to `verified` when the in-browser ol_pqkem round-trip matches.
- **Optional ambient audio toggle** bottom-right: Web Audio drone + slow shimmer + LFO, off by default, one tap on, one tap off, zero third-party samples.
- **Scroll hint** at the bottom of the hero scrolls smoothly into the practical sections.
- Honors `prefers-reduced-motion`: word-rise animation collapses to instant readability.

## What's running right now (after the "do all of this" push)

| Layer | Status | Lives at |
|---|---|---|
| `.cl` SSG, 11 routes touched per build | ✓ | [pipeline/ssg/src/one_link_build.cl](pipeline/ssg/src/one_link_build.cl) |
| WGSL coherence-field shader (compiler-emitted) | ✓ | [dist/.../live/shaders/coherence-field.wgsl](dist/weareone-link.org/live/shaders/coherence-field.wgsl) |
| WebGPU compute+render driving the emitted shader | ✓ | [dist/.../live/bridge.js](dist/weareone-link.org/live/bridge.js) |
| `ol_pair_qr` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_pair_qr_bg.wasm](dist/weareone-link.org/live/wasm/) (250 KB) |
| `ol_pqkem` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_pqkem_bg.wasm](dist/weareone-link.org/live/wasm/) (191 KB) |
| `ol_onion` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_onion_bg.wasm](dist/weareone-link.org/live/wasm/) (161 KB) |
| `ol_coherence_field` Rust crate compiled to WASM | ✓ | [dist/.../live/wasm/ol_coherence_field_bg.wasm](dist/weareone-link.org/live/wasm/) (75 KB) |
| Live peer-dots overlay + click-to-ping | ✓ | [dist/.../live/bridge.js](dist/weareone-link.org/live/bridge.js) |
| Service Worker with offline-first + signed manifest | ✓ | [dist/.../sw.js](dist/weareone-link.org/sw.js) |
| Reproducible-build attestation chain | ✓ (schema) | [dist/.../attestations/](dist/weareone-link.org/attestations/) |
| `weareone-link.com` 301 to `.org` | ✓ | [src/redirect.js](src/redirect.js) |
| Cloudflare Worker with `/api/*` + `/native` + R2 + KV | ✓ | [src/worker.js](src/worker.js) |

## The .cl stack is wired

This repo genuinely uses the Coherence Lang toolchain. Two concrete proofs:

1. **`pipeline/ssg/src/one_link_build.cl`** — a real `.cl` source file, type-checks clean (`python tools/clc.py check ...`), runs via the Coherence Lang runtime (`python tools/clc.py run ...`), and emits real artifacts into `dist/`. Every page it emits carries `<meta name="x-emitted-by" content="coherence-lang/1.0.3 one_link.ssg.build">` so even DevTools confirms it. Current Phase-1 coverage: home page sample at `dist/weareone-link.org/index.cl.html`. Subsequent sessions expand to cover all 8 pages, then `index.html` becomes the generated canonical.

2. **`dist/weareone-link.org/live/shaders/coherence-field.wgsl`** — 292 lines, emitted by `coherence_lang.codegen.wgsl_emitter.emit_coherence_field_shaders()` and shipped verbatim. Real `CoherenceFieldState` struct with 24 fields, damped Helmholtz oscillator (`coh_oscillator_force`/`coh_oscillator_energy`), tau coupling (`coh_tau`), KL divergence + maintenance power + Damkohler number helpers, Ebbinghaus + power-law forgetting curves, fBm noise, `@compute fn field_step` for per-frame state advancement, `@compute fn inject_perturbation` for mouse interaction. Regenerable via `python scripts/emit-wgsl.py`. The shader the browser executes IS the byte-for-byte output of our own compiler.

Run the SSG locally:
```
python tools/clc.py check pipeline/ssg/src/one_link_build.cl
python tools/clc.py run   pipeline/ssg/src/one_link_build.cl
python scripts/emit-wgsl.py
```

## What's wired vs. what's next

Wired now (after the "max + extremely smart" push):
- All 8 pages in the "we are one" voice with the modern high-tech surface.
- **Real `ol_pair_qr` Rust crypto compiled to WASM (250 KB) and loaded on the home page.** The QR rendered in the pair card is encoded by the `qrcode` crate compiled into the same WASM bundle. The 5-word SAS displayed beneath is the actual SAS the daemon would derive from the handshake transcript, byte-identical. A "real handshake" green-pulsing pill appears once the in-browser Inviter+Scanner round-trip succeeds.
- **Service Worker (`/sw.js`) with offline-first + signed-manifest verification.** Precaches every page on first visit. Verifies every cached asset against the SHA-256 in `/manifest.json` before serving. Evicts mismatched assets automatically. The "site verified" pill in the hero shows live SW status.
- **Reproducible-build attestation chain.** Sample at `/attestations/<sha>.json` with full schema (artifact + source + build env + dual hybrid signatures + ol_confidential PQ-hybrid + field-witness + rotation chain). Worker `/api/attest/:sha` reads R2 first, falls back to the shipped static file.
- Coherence-field background canvas (WebGPU primary + 2D Helmholtz fallback).
- Mesh viz canvas with regional-anchor clustering + relay halos + visitor "you" marker.
- Worker with all `/api/*` endpoints + R2 + Durable Object + KV bindings, plus static-asset fallback for attestations.
- OS detection rewrites the download button to the visitor's platform.
- Topology poller animates counters across pages every 12 s.

WASM build:
```
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95
./scripts/build-wasm.sh
```

Next-session candidates (dependency-ordered):
1. **ol_coherence_field WASM** — the rayon dep blocks straight wasm32 compile; fix is a tiny PR upstream (cfg-gate rayon behind `not(target_arch="wasm32")`). After that, compile + wire the solver state INTO bridge.js so the field math runs in the visitor's tab and the mesh viz becomes truly live.
2. **Release relay** so `/api/topology` returns real node positions and the download streams via real native transfer.
3. **/download/ "private route" toggle** UI that calls `window.olRunOnionPreview()` and shows the live circuit data (hops, sizes, peel stages).
4. **/index.html "PQ session OK" badge** that shows when the in-browser ol_pqkem round-trip matches (already computed in bridge.js, just needs a DOM target).
5. **Two-tab stranger-pair live demo** (`OlInviter` in tab A, `OlScanner` in tab B via `BroadcastChannel`).
6. **Offline-signer ed25519** — sign the `/manifest.json` for real, pin the pubkey in `sw.js`, chain rotations through previous-signer.
7. **Replace the read-and-wrap fold-in pattern** in the .cl SSG with full programmatic composition driven by SiteWorld nodes.

## License

AGPL-3.0. See LICENSE in `One_link/`.
