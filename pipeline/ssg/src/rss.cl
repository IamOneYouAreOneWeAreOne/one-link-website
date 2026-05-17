// =============================================================================
// CEL SSG — RSS/Atom Feed Generator
// =============================================================================
//
// Generates RSS 2.0 feeds using std.data.xml.
// One feed per domain (CEL gets research feed).
// =============================================================================

module cel.ssg.rss;

import std.data.xml as xml;
import std.core.option as opt;
import cel.ssg.build as build;

// =============================================================================
// RSS 2.0 GENERATION
// =============================================================================

pub fn generate(domain: String, items: List[build.Node]) -> String @ L0 {
    let base = "https://" + domain;
    let is_cel = domain == "coherenceenergylabs.com";
    let title = if is_cel { "Coherence Energy Labs — Research" } else { "OneUnity" };
    let description = if is_cel {
        "Latest research from Coherence Energy Labs — unified field theory, quantum gravity, dark matter, and the coherence field."
    } else {
        "Updates from OneUnity — where science meets the sacred."
    };

    let mut doc = xml.Document.new();
    doc = doc.set_version("1.0");
    doc = doc.set_encoding("UTF-8");

    let mut rss = xml.Element.new("rss");
    rss = rss.set_attribute("version", "2.0");
    rss = rss.set_attribute("xmlns:atom", "http://www.w3.org/2005/Atom");
    rss = rss.set_attribute("xmlns:content", "http://purl.org/rss/1.0/modules/content/");

    let mut channel = xml.Element.new("channel");

    // Channel metadata
    channel = channel.add_child(xml.Element.new("title").set_text(title));
    channel = channel.add_child(xml.Element.new("link").set_text(base));
    channel = channel.add_child(xml.Element.new("description").set_text(description));
    channel = channel.add_child(xml.Element.new("language").set_text("en-us"));
    channel = channel.add_child(xml.Element.new("lastBuildDate").set_text("Fri, 07 Mar 2026 00:00:00 GMT"));
    channel = channel.add_child(xml.Element.new("generator").set_text("CEL SSG (built in .cl)"));

    // Atom self-link
    let mut atom_link = xml.Element.new("atom:link");
    atom_link = atom_link.set_attribute("href", base + "/feed.xml");
    atom_link = atom_link.set_attribute("rel", "self");
    atom_link = atom_link.set_attribute("type", "application/rss+xml");
    channel = channel.add_child(atom_link);

    // Items
    for node in items {
        let url = base + ensure_trailing_slash(node.canonical_url);

        let mut item = xml.Element.new("item");
        item = item.add_child(xml.Element.new("title").set_text(escape_xml(node.title)));
        item = item.add_child(xml.Element.new("link").set_text(url.clone()));

        let mut guid = xml.Element.new("guid");
        guid = guid.set_attribute("isPermaLink", "true");
        guid = guid.set_text(url);
        item = item.add_child(guid);

        item = item.add_child(xml.Element.new("pubDate").set_text("Wed, 01 Jan 2025 00:00:00 GMT"));

        // Domain as category
        match node.domain {
            opt.Option.Some(ref d) => {
                item = item.add_child(xml.Element.new("category").set_text(d));
            }
            opt.Option.None => {}
        }

        channel = channel.add_child(item);
    }

    rss = rss.add_child(channel);
    doc = doc.set_root(rss);
    xml.serialize(doc)
}

fn ensure_trailing_slash(url: String) -> String @ L0 {
    if url == "/" { return "/"; }
    if url.ends_with("/") { url } else { url + "/" }
}

fn escape_xml(text: String) -> String @ L0 {
    text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
}
