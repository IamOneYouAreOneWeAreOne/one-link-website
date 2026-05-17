# One Link Website — assistant guide

Read this before touching any file.

## Doctrine (binding)

1. **Voice.** "We are one." For the people. Just works. Private + secure. **NOT corporate.** No "Pricing," no "Enterprise," no "Contact sales." Donations only.
2. **UX.** Extremely easy. Every alien capability disappears behind ONE button. AirDrop-easy, not VPN-setup-easy. No settings on visible surface, no jargon, no setup wizard, no signup, no email.
3. **Copy rules.** Plain verbs (Get / Send / Open / Pair / Share). No em-dashes anywhere in user-facing copy (use periods, commas, parentheses). No timelines in roadmaps; ordering language only.
4. **No "deferred with rationalization."** If a feature exists on the page, it should be end-to-end wired in code. If it's a stub today, label the stub honestly in dev comments (NEVER hide it as "research only" or `#[doc(hidden)]`).
5. **No tracking, analytics, or cookies.** Architectural, not policy. Don't add any.

## Architecture

- Cloudflare Worker fronts both domains (one Worker each).
- `dist/weareone-link.org/` is the canonical surface that ships. It's hand-authored HTML/CSS today; the forked `.cl` SSG at `pipeline/ssg/` is the future regeneration path. Don't generate to `dist/` from a tool that strips the alien-tech framing.
- Live Mode is a single ES module (`live/bridge.js`) + a WGSL shader. Zero npm runtime deps. Keep it that way.
- All `/api/*` endpoints live in `src/worker.js`. Don't add a third-party SDK.

## When editing

- Add a page → write `dist/weareone-link.org/<route>/index.html` following the existing structure (skip-link → field canvas → header → main → footer → bridge.js).
- Add a feature → check the matrix on `/features/` is honest. If the daemon doesn't ship it, don't list it.
- Add a Worker endpoint → add to the README endpoint list AND the route list in `src/worker.js`.
- Touch the visual identity → edit `dist/weareone-link.org/css/one-link.css` only. Don't reach back into the inherited CEL sheets.
- Add an external dependency → don't. The doctrine includes "no npm" for the runtime surface.

## What's wired vs. stub

See README. The session handshake, capability advert, topology feed, and download endpoint all round-trip but return placeholder data until the relevant Rust crates are compiled to WASM (next-session work). The static pages are real.

## Memory

Project context: [`one_link_website_build_may16`]($HOME/.claude/projects/c--Users-Alex-Projects-Coherence-A-C-E/memory/one_link_website_build_may16.md). Voice + UX doctrine, the full 22-item alien-tech surface, and the build ordering all live there.
