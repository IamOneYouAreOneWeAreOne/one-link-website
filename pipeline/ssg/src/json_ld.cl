// =============================================================================
// CEL SSG — JSON-LD Structured Data Generator
// =============================================================================
//
// Generates Schema.org JSON-LD for every page type:
// - Organization (home pages)
// - WebPage (static pages)
// - ItemList (index pages)
// - Article/ScholarlyArticle (research)
// - Product (products)
// - SoftwareApplication (developer tools)
// - CreativeWork (demos)
//
// Uses std.data.json for type-safe JSON construction — no string templating.
// =============================================================================

module cel.ssg.json_ld;

import std.data.json as json;
import std.core.option as opt;

// Re-import the Node type from build
import cel.ssg.build as build;

// =============================================================================
// CONSTANTS
// =============================================================================

const FOUNDING_DATE: String = "2024-01-01";
const FOUNDER_NAME: String = "One Link contributor";

// =============================================================================
// JSON HELPERS — type-safe construction via std.data.json
// =============================================================================

fn obj() -> json.JsonValue @ L0 {
    json.JsonValue.Object(List.new())
}

fn set(jv: json.JsonValue, key: String, val: json.JsonValue) -> json.JsonValue @ L0 {
    match jv {
        json.JsonValue.Object(mut pairs) => {
            pairs.push((key, val));
            json.JsonValue.Object(pairs)
        }
        _ => jv
    }
}

fn str(s: String) -> json.JsonValue @ L0 {
    json.JsonValue.String(s)
}

fn arr(items: List[json.JsonValue]) -> json.JsonValue @ L0 {
    json.JsonValue.Array(items)
}

fn num(n: Int) -> json.JsonValue @ L0 {
    json.JsonValue.Number(n as f64)
}

fn base_url(domain: String) -> String @ L0 {
    "https://" + domain
}

// =============================================================================
// ORGANIZATION (home pages)
// =============================================================================

pub fn organization(domain: String) -> String @ L0 {
    let is_cel = domain == "coherenceenergylabs.com";
    let name = if is_cel { "Coherence Energy Labs" } else { "OneUnity" };
    let description = if is_cel {
        "Research laboratory developing unified field theory and the Coherence Lang programming language."
    } else {
        "Where science meets the sacred. A unified field theory that honors both the equations and the experience."
    };

    let mut o = obj();
    o = set(o, "@context", str("https://schema.org"));
    o = set(o, "@type", str("Organization"));
    o = set(o, "name", str(name));
    o = set(o, "url", str(base_url(domain)));
    o = set(o, "description", str(description));
    o = set(o, "foundingDate", str(FOUNDING_DATE));

    let mut founder = obj();
    founder = set(founder, "@type", str("Person"));
    founder = set(founder, "name", str(FOUNDER_NAME));
    o = set(o, "founder", founder);

    if is_cel {
        o = set(o, "sameAs", arr([
            str("https://github.com/Jphilbrick10"),
        ]));

        // Known research areas
        o = set(o, "knowsAbout", arr([
            str("Unified Field Theory"),
            str("Coherence Field Theory"),
            str("Dark Matter Rotation Curves"),
            str("Programming Language Design"),
            str("Quantum Computing"),
            str("Formal Verification"),
        ]));
    }

    json.serialize(o)
}

// =============================================================================
// WEBPAGE (static pages)
// =============================================================================

pub fn webpage(domain: String, title: String, url_path: String) -> String @ L0 {
    let is_cel = domain == "coherenceenergylabs.com";
    let site_name = if is_cel { "Coherence Energy Labs" } else { "OneUnity" };

    let mut o = obj();
    o = set(o, "@context", str("https://schema.org"));
    o = set(o, "@type", str("WebPage"));
    o = set(o, "name", str(title));
    o = set(o, "url", str(base_url(domain) + url_path));

    let mut site = obj();
    site = set(site, "@type", str("WebSite"));
    site = set(site, "name", str(site_name));
    site = set(site, "url", str(base_url(domain)));
    o = set(o, "isPartOf", site);

    json.serialize(o)
}

// =============================================================================
// ITEM LIST (index pages — products, research, demos)
// =============================================================================

pub fn item_list(domain: String, name: String, items: List[build.Node]) -> String @ L0 {
    let mut list_items = List.new();
    let mut pos = 1;
    for item in items {
        let mut li = obj();
        li = set(li, "@type", str("ListItem"));
        li = set(li, "position", num(pos));
        li = set(li, "name", str(item.title));
        li = set(li, "url", str(base_url(domain) + ensure_trailing_slash(item.canonical_url)));
        list_items.push(li);
        pos = pos + 1;
    }

    let mut o = obj();
    o = set(o, "@context", str("https://schema.org"));
    o = set(o, "@type", str("ItemList"));
    o = set(o, "name", str(name));
    o = set(o, "numberOfItems", num(items.len()));
    o = set(o, "itemListElement", arr(list_items));

    json.serialize(o)
}

fn ensure_trailing_slash(url: String) -> String @ L0 {
    if url == "/" { return "/"; }
    if url.ends_with("/") { url } else { url + "/" }
}

// =============================================================================
// DETAIL PAGE (research, product, demo)
// =============================================================================

pub fn detail_page(domain: String, node: build.Node) -> String @ L0 {
    let is_cel = domain == "coherenceenergylabs.com";
    let url = base_url(domain) + ensure_trailing_slash(node.canonical_url);

    let mut o = obj();
    o = set(o, "@context", str("https://schema.org"));

    match node.node_type.as_str() {
        "Research" => {
            o = set(o, "@type", arr([str("Article"), str("ScholarlyArticle")]));
            o = set(o, "headline", str(node.title));
            o = set(o, "url", str(url));
            o = set(o, "datePublished", str(FOUNDING_DATE));

            let mut author = obj();
            author = set(author, "@type", str("Person"));
            author = set(author, "name", str(FOUNDER_NAME));
            o = set(o, "author", author);

            let mut publisher = obj();
            publisher = set(publisher, "@type", str("Organization"));
            publisher = set(publisher, "name", str("Coherence Energy Labs"));
            publisher = set(publisher, "url", str("https://coherenceenergylabs.com"));
            o = set(o, "publisher", publisher);

            match node.domain {
                opt.Option.Some(ref d) => {
                    o = set(o, "about", str(d));
                }
                opt.Option.None => {}
            }
        }

        "Product" => {
            o = set(o, "@type", str("SoftwareApplication"));
            o = set(o, "name", str(node.title));
            o = set(o, "url", str(url));
            o = set(o, "applicationCategory", str("DeveloperApplication"));
            o = set(o, "operatingSystem", str("Cross-platform"));
            o = set(o, "offers", set(set(set(obj(),
                "@type", str("Offer")),
                "price", str("0")),
                "priceCurrency", str("USD")));

            let mut author = obj();
            author = set(author, "@type", str("Organization"));
            author = set(author, "name", str("Coherence Energy Labs"));
            o = set(o, "author", author);
        }

        "Demo" => {
            o = set(o, "@type", str("CreativeWork"));
            o = set(o, "name", str(node.title));
            o = set(o, "url", str(url));

            match node.subtype {
                opt.Option.Some(ref st) => {
                    o = set(o, "genre", str(st));
                }
                opt.Option.None => {}
            }

            let mut author = obj();
            author = set(author, "@type", str("Organization"));
            author = set(author, "name", str("Coherence Energy Labs"));
            o = set(o, "author", author);
        }

        _ => {
            o = set(o, "@type", str("WebPage"));
            o = set(o, "name", str(node.title));
            o = set(o, "url", str(url));
        }
    }

    json.serialize(o)
}
