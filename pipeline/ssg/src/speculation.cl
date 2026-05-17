// =============================================================================
// CEL SSG — Speculation Rules Generator
// =============================================================================
//
// Generates <script type="speculationrules"> JSON for Chrome/Edge prefetch
// and prerender. Pages are pre-loaded on hover for instant navigation.
// NOT executable JavaScript — declarative JSON only.
// =============================================================================

module cel.ssg.speculation;

import std.data.json as json;
import cel.ssg.build as build;

// =============================================================================
// SPECULATION RULES
// =============================================================================

pub fn generate_rules(domain: String, nav: List[build.NavItem]) -> String @ L0 {
    // Collect nav hrefs for prerender
    let mut prerender_hrefs = List.new();
    for item in nav {
        prerender_hrefs.push(json.JsonValue.String(item.href.clone()));
    }

    // Build rules object
    let mut rules = json.JsonValue.Object(List.new());

    // Prefetch: any same-origin link on hover
    let mut prefetch_rule = json.JsonValue.Object(List.new());
    let mut prefetch_where = json.JsonValue.Object(List.new());
    prefetch_where = json_set(prefetch_where, "href_matches", json.JsonValue.String("/*"));
    prefetch_rule = json_set(prefetch_rule, "source", json.JsonValue.String("document"));
    prefetch_rule = json_set(prefetch_rule, "where", prefetch_where);
    prefetch_rule = json_set(prefetch_rule, "eagerness", json.JsonValue.String("moderate"));

    // Prerender: nav links (most likely next pages)
    let mut prerender_rule = json.JsonValue.Object(List.new());
    prerender_rule = json_set(prerender_rule, "source", json.JsonValue.String("list"));
    prerender_rule = json_set(prerender_rule, "urls", json.JsonValue.Array(prerender_hrefs));
    prerender_rule = json_set(prerender_rule, "eagerness", json.JsonValue.String("moderate"));

    rules = json_set(rules, "prefetch", json.JsonValue.Array([prefetch_rule]));
    rules = json_set(rules, "prerender", json.JsonValue.Array([prerender_rule]));

    json.serialize(rules)
}

fn json_set(obj: json.JsonValue, key: String, val: json.JsonValue) -> json.JsonValue @ L0 {
    match obj {
        json.JsonValue.Object(mut pairs) => {
            pairs.push((key, val));
            json.JsonValue.Object(pairs)
        }
        _ => obj
    }
}
