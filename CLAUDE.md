# One Link Website — assistant guide

Read this before touching any file.

## Doctrine (binding)

1. **Voice.** "We are one." For the people. Just works. Private + secure. **NOT corporate.** No "Pricing," no "Enterprise," no "Contact sales." Donations only.
2. **UX.** Extremely easy. Every alien capability disappears behind ONE button. AirDrop-easy, not VPN-setup-easy. No settings on visible surface, no jargon, no setup wizard, no signup, no email.
3. **Copy rules.** Plain verbs (Get / Send / Open / Pair / Share). No em-dashes anywhere in user-facing copy (use periods, commas, parentheses). No timelines in roadmaps; ordering language only.
4. **No "deferred with rationalization."** If a feature exists on the page, it should be end-to-end wired in code. If it's a stub today, label the stub honestly in dev comments (NEVER hide it as "research only" or `#[doc(hidden)]`).
5. **No application tracking, analytics, advertising, or tracking cookies.** Do not add any. Do not turn this into the false claim that Cloudflare, GitHub, relays, or other infrastructure process no request metadata.

## Architecture

- Cloudflare Worker fronts both domains (one Worker each).
- `dist/weareone-link.org/` is the deployable static surface. Most route content is hand-authored today; the `.cl` SSG programmatically emits a home sample and folds provenance into 11 baseline routes. Do not describe that fold-in as full page generation.
- Live Mode is a single ES module (`live/bridge.js`) + a WGSL shader. Zero npm runtime deps. Keep it that way.
- All `/api/*` endpoints live in `src/worker.js`. Don't add a third-party SDK.

## When editing

- Add a page → write `dist/weareone-link.org/<route>/index.html` following the existing structure (skip-link → field canvas → header → main → footer → bridge.js).
- Add a feature → check the matrix on `/features/` is honest. The current `/api/capabilities` response is an unsigned Worker-maintained list, not a daemon attestation. Source an implemented claim from either authenticated, fresh daemon evidence or a manually reviewed, version-pinned acceptance artifact; never let the unsigned endpoint promote copy by itself.
- Add a Worker endpoint → add to the README endpoint list AND the route list in `src/worker.js`.
- Touch the visual identity → edit `dist/weareone-link.org/css/one-link.css` only. Don't reach back into the inherited CEL sheets.
- Add an external dependency → don't. The doctrine includes "no npm" for the runtime surface.

## What's wired vs. stub

See README for the dated inventory. Reviewed endpoint notes (2026-07-22):

- `/api/session` registers an ephemeral session and advertises a Worker X25519 public key. It performs no client ECDH, ML-KEM exchange, endpoint authentication, or traffic-key derivation. The PQ result shown in the UI is a local one-tab primitive self-test.
- `/api/capabilities` returns a hard-coded, unsigned Worker-maintained list. It is not sourced from a live daemon.
- `/api/topology` fails closed with `authoritative: false` and null topology fields until a relay registry is connected.
- `/native` returns JSON describing a future WebTransport protocol. `NativeSession` is a stub.
- `/api/share` encrypts in the browser, stores ciphertext in R2, and rate-limits uploads through `ShareRate`. Recognized IPv4/IPv6 values use /24-/48-derived bucket names, while unfamiliar input falls back to the full raw string; the Durable Object rate state has no application TTL. The URL-fragment key is not sent to the Worker. R2 `expires_at` metadata is checked only on GET; deletion is best-effort with ignored failures; concurrent GETs are not atomically consumed; and no in-repository background cleanup proves a 24-hour maximum retention bound.
- `/download/*` redirects supported desktop requests to mutable GitHub `auto-latest` artifacts by default. As of 2026-07-26 every one of those artifacts carries a GitHub build-provenance attestation (all 10 digests in `manifest.txt` return exactly one attestation, and `gh attestation verify` exits 0), published by `publish_rolling.yml`, which refuses to move the download unless `tests`, `security`, and the build matrix were green for that exact commit. Read it narrowly: it binds the bytes to that publishing workflow, so a third party cannot substitute an upload. Those artifacts still have no published artifact signature, code-signing proof, or reproducibility result, and no One Link signed artifact-bound attestation document, which is what `/api/attest/:sha` still correctly reports as `not-published`. The source archive served from R2 is NOT attested; the publisher attests only the binaries it builds.
- The static WASM pairing and PQ cards run both protocol roles locally. Never describe them as physical-device pairing or a secured network session.
- Peer chat encrypts message content in the browser after an `ol_pair_qr` exchange, but the UI does not require an out-of-band SAS comparison or authenticate a durable peer identity. Call it pseudonymous, relay-mediated, and opportunistically end-to-end encrypted; do not call it anonymous or resistant to an active relay MITM.
- Peer-dot clicks initiate pseudonymous website chat, not a network-routing action. Dots are connected website sessions, and relay-style halos are illustrative rather than daemon/relay telemetry.
- The Service Worker verifies an Ed25519-signed site manifest and per-asset hashes against a key pinned in same-origin Service Worker code. Scope that statement to cached site assets relative to that pin; it is not an independent application-release trust root, download signing, reproducible-build evidence, or a release attestation. Browser SRI is a separate control and is not injected into the current checked-in HTML.

## Memory

Historical project context: [`one_link_website_build_may16`]($HOME/.claude/projects/c--Users-Alex-Projects-Coherence-A-C-E/memory/one_link_website_build_may16.md). Use it for voice and design intent only; its 22-item surface and build ordering do not override the dated evidence ledger in this repository.
