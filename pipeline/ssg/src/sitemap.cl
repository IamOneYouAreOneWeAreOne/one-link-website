// =============================================================================
// CEL SSG — Sitemap Generator
// =============================================================================
//
// Generates XML sitemaps using std.data.xml for type-safe XML construction.
// Properly namespaced, W3C compliant, with lastmod and priority.
// =============================================================================

module cel.ssg.sitemap;

import std.data.xml as xml;

// =============================================================================
// SITEMAP GENERATION
// =============================================================================

pub fn generate(domain: String, urls: List[String]) -> String @ L0 {
    let base = "https://" + domain;
    let ns = "http://www.sitemaps.org/schemas/sitemap/0.9";

    // Build XML document
    let mut doc = xml.Document.new();
    doc = doc.set_version("1.0");
    doc = doc.set_encoding("UTF-8");

    let mut urlset = xml.Element.new("urlset");
    urlset = urlset.set_attribute("xmlns", ns);

    for u in urls {
        let url = ensure_trailing_slash(u);
        let priority = compute_priority(url);

        let mut url_elem = xml.Element.new("url");

        let mut loc = xml.Element.new("loc");
        loc = loc.set_text(base + url);
        url_elem = url_elem.add_child(loc);

        let mut lastmod = xml.Element.new("lastmod");
        lastmod = lastmod.set_text("2026-03-07");
        url_elem = url_elem.add_child(lastmod);

        let mut changefreq = xml.Element.new("changefreq");
        changefreq = changefreq.set_text(if url == "/" { "weekly" } else { "monthly" });
        url_elem = url_elem.add_child(changefreq);

        let mut prio = xml.Element.new("priority");
        prio = prio.set_text(priority);
        url_elem = url_elem.add_child(prio);

        urlset = urlset.add_child(url_elem);
    }

    doc = doc.set_root(urlset);
    xml.serialize(doc)
}

fn ensure_trailing_slash(url: String) -> String @ L0 {
    if url == "/" { return "/"; }
    if url.ends_with("/") { url } else { url + "/" }
}

fn compute_priority(url: String) -> String @ L0 {
    if url == "/" {
        "1.0"
    } else if url == "/research/" || url == "/coherence-lang/" || url == "/applications/" {
        "0.9"
    } else if url == "/research/framework/" || url == "/research/validation/" || url == "/about/" {
        "0.8"
    } else if url == "/updates/" {
        "0.7"
    } else if url.starts_with("/research/") {
        "0.7"
    } else {
        "0.5"
    }
}
