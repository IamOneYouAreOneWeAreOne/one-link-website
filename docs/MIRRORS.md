# One Link mirror registry

This file lists public mirrors of `weareone-link.org` that have asked
to be listed. **No mirrors are registered yet.**

## How to add a mirror

If you run a public mirror and want to be listed:

1. Fork this repo.
2. Add a row to the table below.
3. Open a pull request.

We don't endorse any particular mirror; we just publish the
registry. Listed mirrors are independently operated.

## Registry

| Region | URL | Operator | Byte-match evidence | API mode | Note |
|---|---|---|---|---|---|
| _(no mirrors registered yet)_ | | | | | |

## What a mirror is

A mirror serves the same `dist/weareone-link.org/` bytes from a different URL.
Matching those bytes can detect divergence between deployments, but it does not
prove that either deployment was reproducibly built from source. Reproducibility
requires independent clean rebuilds and a documented build comparison. A mirror
SHOULD:

- Serve the same version-pinned static files and `manifest.json` as the reviewed
  canonical bundle, and publish the comparison procedure and timestamp.
- Preserve the manifest signature exactly. The current site-manifest format has
  one same-origin pinned key and no implemented key-rotation or hash-chain
  protocol; a registry row must not claim either.
- Update on a documented cadence.
- Carry equivalent security headers and privacy posture, configured in its own
  hosting layer or by a compatible Worker.

A mirror SHOULD NOT:

- Inject analytics, ads, or tracking.
- Modify the content.
- Add cookies.

A static-only mirror has no `/api/health`, presence, share, session, topology,
attestation, download-routing, or native API parity. It must say so explicitly.
Only a mirror that also operates a compatible Worker may advertise API health;
that operator must test each API separately and report its own deployment
version rather than infer health from static-byte equality.
