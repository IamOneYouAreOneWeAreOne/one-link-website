# Contributing - One Link Website

The site is the public face of One Link. Every line ships open. If
something is wrong, broken, ugly, slow, or off-doctrine, open a PR
or a quiet email to weareone@oneunity.earth.

## Doctrine (binding)

1. **"We are one."** Not a slogan, a worldview. The site exists to
   help people reconnect, not to sell anything. No marketing speak,
   no founders to put on a slide, no metrics-driven copy. Read
   [the about page](https://weareone-link.org/about/) for the
   covenant.
2. **No tracking, no analytics, no cookies, no third-party requests.**
   Architectural, not policy. The Cloudflare Worker logs nothing.
   The Service Worker observes nothing. No npm runtime deps. No
   external scripts ever.
3. **Every alien-tech claim must run in the visitor's tab.** If a
   page says "real Ed25519 + ML-DSA-65 hybrid signature," there is
   a button next to it that mints one and shows the bytes. Marketing
   text without backing code is a bug.
4. **No em-dashes in user-facing copy.** Use periods, commas,
   parentheses, or hyphens. Em-dashes are fine in code comments and
   commit messages.
5. **No personal identifiers in shipped files.** No names, no
   personal emails, no individual attribution. Use "One Link
   contributors" or `weareone@oneunity.earth`. This is "for the
   people," not "by a person."

## Repository layout

```
src/worker.js                    Cloudflare Worker entrypoint
src/redirect.js                  .com -> .org 301-redirect worker
dist/weareone-link.org/          The site itself (static, signed)
  index.html                       hand-edited HTML, SSG-folded provenance
  live/bridge.js                 vanilla JS, no framework, AGPL
  live/wasm/                     compiled WASM bundles (one per crate)
  manifest.json                  ed25519-signed asset manifest
  sw.js                          Service Worker (offline + integrity)
live/wasm/                       Rust source for the WASM crates
pipeline/ssg/src/                Coherence Lang SSG that owns provenance
scripts/                         build + sign + rehash pipeline
.keys/                           OFFLINE signing keys (gitignored)
wrangler.toml                    Cloudflare Worker config (.org)
wrangler.com.toml                Cloudflare Worker config (.com redirect)
SPEC.md                          Living spec - the source of truth
```

## Setup

```bash
# Rust + wasm toolchain
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100

# Python deps
pip install cryptography blake3

# Cloudflare
npm install -g wrangler
wrangler login
```

## Build the WASM bundle

```bash
bash scripts/build-wasm.sh
```

Emits `dist/weareone-link.org/live/wasm/*.{js,wasm}` for every crate.

## Release pipeline (one command)

```bash
python scripts/rehash-manifest.py
```

This chains four stages:

1. `inject-sri.py` rewrites every `<link>` and `<script>` tag with
   a SHA-384 SRI hash of its target.
2. Bumps the manifest version (`+rN -> +r(N+1)`) and syncs
   `SW_VERSION` in `dist/.../sw.js` so the Service Worker re-installs.
3. Rehashes every tracked asset's SHA-256 into `manifest.json`.
4. `sign-manifest.py` ed25519-signs the canonical manifest payload
   with the offline release key in `.keys/manifest-ed25519.sk`.

## Deploy

```bash
wrangler deploy --config wrangler.toml         # .org primary site
wrangler deploy --config wrangler.com.toml     # .com -> .org redirect
```

Both domains are Cloudflare custom-domain routes; first deploy
auto-creates the DNS records.

## Adding a new WASM-backed in-browser demo

1. Write a new wrapper crate at `live/wasm/ol_<name>_wasm/` that
   takes a dependency on the production crate from
   `Coherence/One_link/native/ol_<name>`.
2. Expose a `liveDemoRoundTrip` function that takes minimal input
   and returns a JS object with verifiable structured output.
3. Add the crate to `live/wasm/Cargo.toml` `[workspace] members`
   and to `scripts/build-wasm.sh` `crates=(...)`.
4. Add the new `.js` + `.wasm` to `manifest.json` `assets` and to
   `sw.js` `PRECACHE_URLS`.
5. Wire `bridge.js`: write `runFooDemo()` + `wireFooDemo()`,
   register the wire in the boot sequence.
6. Add the UI section to the relevant HTML page (button + status
   pill + `<pre class="ol-code">` output).
7. Update SPEC.md alien-tech ledger.
8. Run `python scripts/rehash-manifest.py && wrangler deploy`.

## Commit + PR doctrine

- Small, focused commits. One conceptual change per commit.
- Commit messages: imperative voice, short subject line, body
  explains the why. Em-dashes ARE fine in commit messages.
- PRs against `master`. Link to a SPEC.md update if the change
  affects shipped behavior.
- AI co-authorship trailers (`Co-Authored-By: Claude ...`) are
  welcome and encouraged.

## Reporting bugs / vulnerabilities

- Functional bugs: open an issue at
  https://github.com/IamOneYouAreOneWeAreOne/one-link-website/issues
- Security issues: see [SECURITY.md](SECURITY.md).

## License

AGPL-3.0-or-later. Every contribution gets relicensed under
AGPL-3.0-or-later on merge. Fork freely; the license keeps the
fork open too.

We are one.
