# Security policy - One Link Website

## Reporting a vulnerability

If you find a security issue in this repository (the site code, the
Cloudflare Worker, the WASM bindings, the same-origin signed site-manifest pipeline,
the attestation verifier, anything that runs on `weareone-link.org`),
please report it privately by emailing:

    weareone@oneunity.earth

Please include:

- A short description of the issue and what it lets an attacker do.
- A minimal reproduction (steps, payload, or PoC).
- The commit SHA or deployed version (visible in the Service Worker
  version string at the top of `dist/weareone-link.org/sw.js`).

This is a contributor-run, best-effort inbox, not a staffed 24/7 security
operation. There is no response-time SLA, funded bounty, promised payment,
guaranteed CVE assignment, or guaranteed credit. Contributors intend to
coordinate disclosure and welcome good-faith, authorized, proportionate
research, but that intent is not a legal safe-harbor guarantee and cannot bind
hosting providers, users, individual maintainers, rightsholders, law
enforcement, or other third parties. Ask for written authorization when scope
is uncertain. The non-guaranteed response targets and the desired formal
safe-harbor and bounty program are documented on the public security page.

## What counts as in-scope

- Any path under `https://weareone-link.org/*`
- The Cloudflare Worker source (`src/worker.js`)
- The Service Worker + same-origin signed site-manifest pipeline
  (`dist/.../sw.js`, `scripts/sign-manifest.py`,
  `scripts/verify-manifest.py`). The optional `scripts/inject-sri.py` utility is
  also in scope, but browser SRI is distinct from Service Worker manifest checks
  and is not injected into the current checked-in HTML.
- The eight WASM wrapper crates this site bundles (`live/wasm/ol_*_wasm/`)
- The attestation signer + in-browser verifier
  (`scripts/build-attestation.py`, `bridge.js wireAttestationVerify`). These code
  paths are in scope even though no current rolling artifact has a promoted,
  artifact-bound attestation.
- The release-signing key-handling design and pinned verifier key. Repository
  fixtures, an unselected key pin, or verifier source alone are not evidence that
  a downloadable application release was signed or authenticated.

## What is out of scope

- The One Link daemon itself - report at the
  [daemon repo's SECURITY.md](https://github.com/coherence-energy-labs/one-link/blob/master/SECURITY.md).
- Cloudflare infrastructure (report directly to Cloudflare).
- Browser bugs (report to the relevant vendor).
- "You shouldn't use AGPL" or other policy disagreements.

## Doctrine

The whole site is open source. Browser-side crypto can be inspected locally.
The site asset-manifest code checks a candidate manifest against a public key
pinned in the same-origin Service Worker; an exact bundle has no positive
release verdict unless `scripts/verify-manifest.py` passes after all mutations.
That mechanism protects tracked site assets relative to the pin; it is not an
independent application-release trust root. Release
attestation files in this repository are development fixtures, not proof for the
rolling artifacts; the public attestation API fails closed until matching
versioned documents are explicitly promoted and independently verified.
If you find something we missed, telling us is the most "we are one"
thing you can do.

I am One. You are One. We are One.
