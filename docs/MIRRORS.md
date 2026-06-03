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

| Region | URL | Operator | Verified hash chain | Note |
|---|---|---|---|---|
| _(no mirrors registered yet)_ | | | | |

## What a mirror is

A mirror serves the same `dist/weareone-link.org/` bytes from a
different URL — useful for users whose ISP blocks Cloudflare, who
want to verify reproducibility, or who prefer a different CDN. A
mirror SHOULD:

- Serve the same `manifest.json` + signed hash chain as the
  canonical site.
- Update on the same cadence (every push to `master`).
- Carry the same security headers + privacy posture.

A mirror SHOULD NOT:

- Inject analytics, ads, or tracking.
- Modify the content.
- Add cookies.

The `/api/health` endpoint of a mirror should return the same
`{ "version": "..." }` value as the canonical site within ~5 minutes
of a push.
