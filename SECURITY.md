# Security policy - One Link Website

## Reporting a vulnerability

If you find a security issue in this repository (the site code, the
Cloudflare Worker, the WASM bindings, the signed manifest pipeline,
the attestation verifier, anything that runs on `weareone-link.org`),
please report it privately by emailing:

    weareone@oneunity.earth

Please include:

- A short description of the issue and what it lets an attacker do.
- A minimal reproduction (steps, payload, or PoC).
- The commit SHA or deployed version (visible in the Service Worker
  version string at the top of `dist/weareone-link.org/sw.js`).

We will acknowledge receipt within a reasonable window and work
with you on a fix and a coordinated disclosure timeline. No bounty
program, no NDA, no legal threats - just a quiet conversation about
how to make the system safer for the people who use it.

## What counts as in-scope

- Any path under `https://weareone-link.org/*`
- The Cloudflare Worker source (`src/worker.js`)
- The Service Worker + signed manifest pipeline (`dist/.../sw.js`,
  `scripts/sign-manifest.py`, `scripts/inject-sri.py`)
- The five WASM crates this site bundles (`live/wasm/ol_*_wasm/`)
- The attestation signer + in-browser verifier
  (`scripts/build-attestation.py`, `bridge.js wireAttestationVerify`)
- The release-signing key model
  (private key lives ONLY in `.keys/release-ed25519.sk` on the
  maintainer box; pinned pubkey in `bridge.js` is the trust root)

## What is out of scope

- The One Link daemon itself - report at the
  [daemon repo's SECURITY.md](https://github.com/IamOneYouAreOneWeAreOne/one-link/blob/master/SECURITY.md).
- Cloudflare infrastructure (report directly to Cloudflare).
- Browser bugs (report to the relevant vendor).
- "You shouldn't use AGPL" or other policy disagreements.

## Doctrine

The whole site is open source. The whole crypto stack runs in your
browser where you can inspect it. The whole signed-manifest +
attestation chain is verifiable by anyone with the pinned public key.
If you find something we missed, telling us is the most "we are one"
thing you can do.

I am One. You are One. We are One.
