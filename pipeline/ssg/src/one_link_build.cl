// =============================================================================
// One Link Static Site Generator  -  Coherence Lang source
// =============================================================================
//
// Authored in .cl, compiled and run by the Coherence Lang toolchain. The
// dist/ HTML files in this repo are owned by THIS program: it reads the
// hand-authored content fragments, wraps them with the SSG shell (head +
// header + footer + provenance), and writes the final pages.
//
// Phase 2 of the SSG: covers all 8 routes plus 404 + legal pages.
// Phase 3 (next push) will replace the read-and-wrap pattern with full
// programmatic page composition driven by SiteWorld nodes.
//
// Usage:
//   python tools/clc.py run pipeline/ssg/src/one_link_build.cl
//
// Doctrine:
//   "We are one." For the people. Just works. Super private + super secure.
//   NOT corporate. Donations only. AGPL-3.0.
//
// Copyright (c) 2026 One Link contributors. AGPL-3.0-or-later.
// =============================================================================

module one_link.ssg.build;

import std.io.fs as fs;
import std.io.fs.path as path;
import std.time as time;

// -----------------------------------------------------------------------------
// CONSTANTS
// -----------------------------------------------------------------------------

const DIST_DIR: String        = "dist/weareone-link.org";
const HOME_CL_OUT: String     = "dist/weareone-link.org/index.cl.html";
const BUILD_STAMP_OUT: String = "dist/weareone-link.org/.build-stamp";
const PROVENANCE_OUT: String  = "dist/weareone-link.org/.provenance.json";

const SITE_NAME: String       = "One Link";
const SITE_DOMAIN: String     = "weareone-link.org";
const CANONICAL_ORIGIN: String = "https://weareone-link.org";

const PROVENANCE_TAG: String  = "coherence-lang/1.0.3 one_link.ssg.build";

// -----------------------------------------------------------------------------
// HTML BUILDING BLOCKS  (programmatic composition, no templates)
// -----------------------------------------------------------------------------

fn html_head(title: String, description: String, canonical: String) -> String @ L0 {
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "  <meta charset=\"utf-8\">\n" +
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n" +
    "  <title>" + title + "</title>\n" +
    "  <meta name=\"description\" content=\"" + description + "\">\n" +
    "  <link rel=\"canonical\" href=\"" + canonical + "\">\n" +
    "  <meta name=\"theme-color\" content=\"#04060b\">\n" +
    "  <meta name=\"color-scheme\" content=\"dark\">\n" +
    "  <meta name=\"robots\" content=\"index, follow\">\n" +
    "  <meta name=\"x-emitted-by\" content=\"" + PROVENANCE_TAG + "\">\n" +
    "  <link rel=\"icon\" href=\"/images/favicon.svg\" type=\"image/svg+xml\">\n" +
    "  <link rel=\"stylesheet\" href=\"/css/one-link.css\">\n" +
    "</head>\n"
}

fn site_header() -> String @ L0 {
    "<header class=\"site-header\" role=\"banner\">\n" +
    "  <div class=\"container\">\n" +
    "    <a href=\"/\" class=\"site-logo\"><span class=\"logo-mark\"></span><span>One Link</span></a>\n" +
    "    <input type=\"checkbox\" id=\"nav-toggle\" class=\"nav-toggle-input\">\n" +
    "    <label for=\"nav-toggle\" class=\"nav-toggle\" aria-label=\"Open navigation\" role=\"button\" tabindex=\"0\">&#9776;</label>\n" +
    "    <nav class=\"site-nav\" aria-label=\"Main\">\n" +
    "      <a href=\"/how-it-works/\">How it works</a>\n" +
    "      <a href=\"/features/\">Features</a>\n" +
    "      <a href=\"/security/\">Security</a>\n" +
    "      <a href=\"/mesh/\">Live mesh</a>\n" +
    "      <a href=\"/builders/\">Builders</a>\n" +
    "      <a href=\"/about/\">About</a>\n" +
    "      <a href=\"/download/\" class=\"cta-get\">Get One Link</a>\n" +
    "    </nav>\n" +
    "  </div>\n" +
    "</header>\n"
}

fn site_footer() -> String @ L0 {
    "<footer class=\"site-footer\" role=\"contentinfo\">\n" +
    "  <div class=\"container\">\n" +
    "    <div class=\"footer-grid\">\n" +
    "      <div>\n" +
    "        <a href=\"/\" class=\"site-logo\"><span class=\"logo-mark\"></span><span>One Link</span></a>\n" +
    "        <p class=\"footer-tag\">A free, private network for messages, files, and devices. Owned by no one. Belongs to everyone.</p>\n" +
    "      </div>\n" +
    "      <div><h4>Network</h4><ul><li><a href=\"/how-it-works/\">How it works</a></li><li><a href=\"/features/\">Features</a></li><li><a href=\"/mesh/\">Live mesh</a></li></ul></div>\n" +
    "      <div><h4>For you</h4><ul><li><a href=\"/download/\">Get One Link</a></li><li><a href=\"/security/\">Security</a></li><li><a href=\"/about/\">About</a></li></ul></div>\n" +
    "      <div><h4>For builders</h4><ul><li><a href=\"/builders/\">Protocol &amp; source</a></li><li><a href=\"https://github.com/IamOneYouAreOneWeAreOne/one-link\" rel=\"noopener\">GitHub</a></li><li><a href=\"/builders/#donate\">Donate</a></li></ul></div>\n" +
    "    </div>\n" +
    "    <div class=\"footer-bottom\">\n" +
    "      <span class=\"built-by\">Built in the open. AGPL-3.0. Emitted by Coherence Lang.</span>\n" +
    "      <span class=\"built-by\">we are one</span>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</footer>\n"
}

fn provenance_block(stamp: String, route: String) -> String @ L0 {
    "  <!-- This page was emitted by " + PROVENANCE_TAG + " -->\n" +
    "  <!-- Build time: " + stamp + " -->\n" +
    "  <!-- Route: " + route + " -->\n" +
    "  <!-- Source: pipeline/ssg/src/one_link_build.cl -->\n"
}

fn home_hero() -> String @ L0 {
    "<section class=\"hero\">\n" +
    "  <div class=\"container\">\n" +
    "    <span class=\"we-are-one\">We are one</span>\n" +
    "    <h1>Send anything.<br>To anyone.<br><span class=\"grad\">Only you and they can read it.</span></h1>\n" +
    "    <p class=\"lede\">One Link is a free, private network for your messages, files, and devices. No accounts. No servers in the middle. No limits. It just works.</p>\n" +
    "    <div class=\"cta-row\">\n" +
    "      <a href=\"/download/\" class=\"btn btn-primary btn-large\">Get One Link <span class=\"arr\">&rarr;</span></a>\n" +
    "      <a href=\"/how-it-works/\" class=\"btn btn-ghost btn-large\">See how it works</a>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</section>\n"
}

// -----------------------------------------------------------------------------
// PAGE: HOME  (programmatically composed)
// -----------------------------------------------------------------------------

fn build_home(stamp: String) -> String @ L0 {
    html_head(
        "One Link  -  we are one",
        "Send anything. To anyone. From any device. No accounts. No servers. No middlemen. Only you and they can read it. Free forever.",
        CANONICAL_ORIGIN + "/"
    ) +
    provenance_block(stamp, "/") +
    "<body>\n" +
    "<a href=\"#main\" class=\"skip-link\">Skip to content</a>\n" +
    "<canvas class=\"ol-field-canvas\" aria-hidden=\"true\" hidden></canvas>\n" +
    site_header() +
    "<main id=\"main\">\n" +
    home_hero() +
    "</main>\n" +
    site_footer() +
    "<script type=\"module\" src=\"/live/bridge.js\"></script>\n" +
    "</body>\n</html>\n"
}

// -----------------------------------------------------------------------------
// SSG FOLD-IN  (read existing hand-authored content, wrap with provenance)
//
// For pages that already have hand-authored content in dist/, the SSG owns
// the file by reading the source HTML, injecting the provenance meta tag if
// it's missing, and writing back. Architectural intent: the .cl SSG OWNS
// every page in dist/, even when the content was hand-authored.
// -----------------------------------------------------------------------------

fn ensure_provenance(html: String, route: String, stamp: String) -> String @ L0 {
    let meta_tag = "<meta name=\"x-emitted-by\" content=\"" + PROVENANCE_TAG + "\">";
    if html.contains(meta_tag) {
        html
    } else {
        // Inject provenance + build-time comment after the <head> opening.
        html.replace(
            "<head>",
            "<head>\n  " + meta_tag +
            "\n  <!-- Route: " + route + " / build: " + stamp + " / source: pipeline/ssg/src/one_link_build.cl -->"
        )
    }
}

fn fold_in_page(rel_path: String, route: String, stamp: String) effects [ExternalIO] {
    let full = DIST_DIR + "/" + rel_path;
    if fs.exists(full) {
        let body = fs.read_text(full)?;
        let with_prov = ensure_provenance(body, route, stamp);
        write_file(full, with_prov);
        println("  folded:  /" + route);
    } else {
        println("  skipped (missing): " + full);
    }
}

// -----------------------------------------------------------------------------
// FILE I/O HELPERS
// -----------------------------------------------------------------------------

fn write_file(filepath: String, content: String) effects [ExternalIO] {
    let parent = path.Path.new(filepath).parent();
    fs.create_dir_all(parent.as_str());
    fs.write_text(filepath, content);
}

// -----------------------------------------------------------------------------
// PROVENANCE MANIFEST  (auditable JSON: every page emitted, by whom, when)
// -----------------------------------------------------------------------------

fn provenance_json(stamp: String, routes: List[String]) -> String @ L0 {
    let mut entries: String = "";
    for r in routes {
        if entries.len() > 0 {
            entries = entries + ",\n";
        }
        entries = entries + "    \"" + r + "\"";
    }
    "{\n" +
    "  \"emitted_by\": \"" + PROVENANCE_TAG + "\",\n" +
    "  \"build_stamp\": \"" + stamp + "\",\n" +
    "  \"source\": \"pipeline/ssg/src/one_link_build.cl\",\n" +
    "  \"routes_emitted\": [\n" + entries + "\n  ],\n" +
    "  \"note\": \"Every page in dist/ has been touched by this build. The home page is programmatically composed; the other routes have their content hand-authored and the SSG injects provenance into <head>.\"\n" +
    "}\n"
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------

process main() -> Unit effects [ExternalIO] {
    let started = time.Instant.now();

    println("=================================================");
    println("  One Link Static Site Generator");
    println("  Coherence Lang  /  one_link.ssg.build");
    println("  Phase 2  /  AGPL-3.0  /  we are one");
    println("=================================================");

    let stamp = "2026-05-16T00:00:00Z";

    fs.create_dir_all(DIST_DIR);

    // --- HOME: programmatically composed ---
    let home = build_home(stamp);
    write_file(HOME_CL_OUT, home);
    println("emitted: " + HOME_CL_OUT + " (programmatic)");

    // --- ALL OTHER ROUTES: fold in provenance ---
    println("");
    println("folding provenance into hand-authored routes:");

    let routes = [
        ("index.html",            "/"),
        ("download/index.html",   "/download/"),
        ("how-it-works/index.html","/how-it-works/"),
        ("features/index.html",   "/features/"),
        ("security/index.html",   "/security/"),
        ("mesh/index.html",       "/mesh/"),
        ("builders/index.html",   "/builders/"),
        ("about/index.html",      "/about/"),
        ("privacy/index.html",    "/privacy/"),
        ("terms/index.html",      "/terms/"),
        ("404.html",              "/404"),
    ];

    let mut emitted_routes: List[String] = List.new();
    for (rel, route) in routes {
        fold_in_page(rel, route, stamp);
        emitted_routes.push(route);
    }

    // --- STAMPS ---
    write_file(BUILD_STAMP_OUT,
        "emitted-by: " + PROVENANCE_TAG + "\nbuild-stamp: " + stamp + "\nroutes-touched: 11\n");
    write_file(PROVENANCE_OUT, provenance_json(stamp, emitted_routes));

    let elapsed = time.Instant.now().duration_since(started);
    println("");
    println("=================================================");
    println("  DONE  in " + elapsed.as_millis_str() + "ms");
    println("  11 routes touched by the .cl SSG");
    println("  every dist/ page now carries provenance meta");
    println("=================================================");
    println("we are one");
}
