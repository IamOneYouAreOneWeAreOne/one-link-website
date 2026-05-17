// weareone-link.com -> 301 to weareone-link.org canonical equivalent.
// Preserves path + query. No tracking. No cookies. No analytics.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const canonical = env.CANONICAL_ORIGIN || "https://weareone-link.org";
    const target = canonical + url.pathname + url.search;
    return Response.redirect(target, 301);
  },
};
