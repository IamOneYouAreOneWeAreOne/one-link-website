#!/usr/bin/env python3
"""
build-i18n.py
=============

Idempotent i18n maintenance pass.

For every page that exists in the canonical English tree, find which
languages have a translation, then sync:

  1. hreflang <link rel="alternate"> tags in <head> of every version of
     the page (English canonical + each translated copy). Every version
     lists every available translation + x-default.

  2. Footer language switcher block on each translated page (only on
     pages that have the switcher pattern; English pages keep their
     existing footer).

  3. sitemap.xml: one <url> entry per translated page with full
     <xhtml:link rel="alternate"> declarations.

Adding a new language to /<code>/index.html (or any other page) and
re-running this script propagates the change everywhere. No HTML
boilerplate to maintain by hand.

Run after writing or updating any translated page. Idempotent: running
it twice produces the same output.

Usage:  python scripts/build-i18n.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent / "dist" / "weareone-link.org"

# Pages we want hreflang infrastructure for. Each entry is the page's
# RELATIVE path from the doc root (without leading slash), pointing to
# the English canonical file. The /<lang>/<same-path> version is the
# translated copy.
TRACKED_PAGES = [
    "index.html",
    "how-it-works/index.html",
    "features/index.html",
    "security/index.html",
    "share/index.html",
    "download/index.html",
    "about/index.html",
    "one/index.html",
    "mesh/index.html",
    "builders/index.html",
    "audits/index.html",
    "mirror/index.html",
    "transparency/index.html",
    "accessibility/index.html",
    "releases/index.html",
    "changelog/index.html",
    "privacy/index.html",
    "terms/index.html",
]


def load_languages() -> list[dict]:
    """Return the language registry from /i18n/languages.json."""
    data = json.loads((ROOT / "i18n" / "languages.json").read_text(encoding="utf-8"))
    return data["languages"]


def english_url(rel: str) -> str:
    """Canonical English URL for a relative path."""
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def translated_url(lang_prefix: str, rel: str) -> str:
    """URL of the translated version of a page in the given language."""
    base = english_url(rel)
    # /es/ + /security/ -> /es/security/
    if base == "/":
        return lang_prefix
    return lang_prefix.rstrip("/") + base


def find_translations(rel: str, langs: list[dict]) -> list[dict]:
    """Return the language entries that actually have /<code>/<rel> on disk
    (English always counts as translated since it's the canonical)."""
    out = []
    for L in langs:
        if L["code"] == "en":
            if (ROOT / rel).exists():
                out.append(L)
            continue
        # Translated path: /<prefix>/<rel> where prefix is "/es/" etc.
        prefix = L["prefix"].strip("/")
        if (ROOT / prefix / rel).exists():
            out.append(L)
    return out


def build_hreflang_block(available: list[dict], rel: str) -> str:
    """The <link rel='alternate'> block for a page's <head>."""
    lines = []
    for L in available:
        url = translated_url(L["prefix"], rel)
        lines.append(
            f'  <link rel="alternate" hreflang="{L["code"]}" href="https://weareone-link.org{url}">'
        )
    lines.append(
        '  <link rel="alternate" hreflang="x-default" '
        f'href="https://weareone-link.org{english_url(rel)}">'
    )
    return "\n".join(lines)


def build_switcher_links(available: list[dict], rel: str) -> str:
    """Footer language-switcher anchor chain for a page."""
    parts = []
    for L in available:
        url = translated_url(L["prefix"], rel)
        parts.append(
            f'<a class="ol-cyan-text" hreflang="{L["code"]}" '
            f'href="{url}">{L["name"]}</a>'
        )
    return " &middot;\n          ".join(parts)


HREFLANG_RE = re.compile(
    rb'(  <link rel="alternate" hreflang="[^"]+" href="[^"]+">\n)+'
    rb'  <link rel="alternate" hreflang="x-default" href="https://weareone-link\.org[^"]*">'
)

# For new pages with no existing hreflang block: insert after the canonical link.
CANONICAL_RE = re.compile(
    rb'(  <link rel="canonical" href="[^"]+">\n)'
)

SWITCHER_RE = re.compile(
    rb'(<p class="ol-mt-md ol-soft-text ol-mono">\s*<strong>[^<]+</strong>\s*\n\s*)'
    rb'((?:<a class="ol-cyan-text"[^<]+</a>(?:\s*&middot;\s*)?)+)'
    rb'(\s*</p>)',
    re.DOTALL,
)

# For new pages with the "Read in:" label but no anchor chain yet: inject
# the chain between </strong> and </p>.
SWITCHER_EMPTY_RE = re.compile(
    rb'(<p class="ol-mt-md ol-soft-text ol-mono">\s*<strong>[^<]+</strong>)'
    rb'(\s*</p>)',
    re.DOTALL,
)


def sync_page(rel: str, langs: list[dict]) -> int:
    """Update hreflang + switcher on every version of one page.
    Returns count of files edited."""
    available = find_translations(rel, langs)
    if len(available) <= 1:
        # Nothing to sync — only English exists for this page.
        return 0

    hreflang_block = build_hreflang_block(available, rel).encode("utf-8")
    switcher_links = build_switcher_links(available, rel).encode("utf-8")

    edited = 0
    for L in available:
        if L["code"] == "en":
            path = ROOT / rel
        else:
            path = ROOT / L["prefix"].strip("/") / rel
        raw = path.read_bytes()
        if HREFLANG_RE.search(raw):
            new = HREFLANG_RE.sub(hreflang_block, raw, count=1)
        else:
            # No existing block: insert after canonical link.
            new = CANONICAL_RE.sub(
                lambda m: m.group(1) + hreflang_block + b"\n",
                raw,
                count=1,
            )
        if SWITCHER_RE.search(new):
            new = SWITCHER_RE.sub(
                lambda m: m.group(1) + switcher_links + m.group(3),
                new,
                count=1,
            )
        else:
            # New page with "Read in:" label but no anchors yet.
            new = SWITCHER_EMPTY_RE.sub(
                lambda m: (
                    m.group(1)
                    + b"\n          "
                    + switcher_links
                    + m.group(2)
                ),
                new,
                count=1,
            )
        if new != raw:
            path.write_bytes(new)
            edited += 1
    return edited


def update_sitemap(langs: list[dict]) -> int:
    """Rewrite the <!-- i18n-begin --> .. <!-- i18n-end --> block in
    sitemap.xml with one <url> entry per (translated page) covering all
    available languages."""
    sitemap = ROOT / "sitemap.xml"
    sm = sitemap.read_text(encoding="utf-8")
    sm = re.sub(
        r"\s*<!-- i18n-begin -->.*?<!-- i18n-end -->\s*\n",
        "\n",
        sm,
        flags=re.DOTALL,
    )
    # Strip any old per-language URL entries that may have been added by
    # earlier versions of this script before the markers existed.
    for L in langs:
        if L["code"] == "en":
            continue
        prefix = L["prefix"]
        sm = re.sub(
            rf'\s*<url>\s*<loc>https://weareone-link\.org{re.escape(prefix)}[^<]*</loc>.*?</url>\s*',
            "",
            sm,
            flags=re.DOTALL,
        )

    block_lines = ["  <!-- i18n-begin -->"]
    n_urls = 0
    for rel in TRACKED_PAGES:
        available = find_translations(rel, langs)
        if len(available) <= 1:
            continue
        for L in available:
            if L["code"] == "en":
                continue
            url = translated_url(L["prefix"], rel)
            entry = [
                "  <url>",
                f"    <loc>https://weareone-link.org{url}</loc>",
                "    <changefreq>weekly</changefreq>",
                "    <priority>0.7</priority>",
            ]
            for M in available:
                m_url = translated_url(M["prefix"], rel)
                entry.append(
                    f'    <xhtml:link rel="alternate" hreflang="{M["code"]}" '
                    f'href="https://weareone-link.org{m_url}"/>'
                )
            entry.append(
                '    <xhtml:link rel="alternate" hreflang="x-default" '
                f'href="https://weareone-link.org{english_url(rel)}"/>'
            )
            entry.append("  </url>")
            block_lines.append("\n".join(entry))
            n_urls += 1
    block_lines.append("  <!-- i18n-end -->")

    sm = sm.replace("</urlset>", "\n".join(block_lines) + "\n</urlset>")
    sitemap.write_text(sm, encoding="utf-8")
    return n_urls


def main() -> int:
    langs = load_languages()
    print(f":: {len(langs)} languages declared in i18n/languages.json")

    total_edits = 0
    for rel in TRACKED_PAGES:
        if not (ROOT / rel).exists():
            print(f"   skip (missing English source): {rel}")
            continue
        n_edits = sync_page(rel, langs)
        if n_edits:
            print(f":: synced {n_edits} files for {rel}")
            total_edits += n_edits

    print(f":: total page-version files synced: {total_edits}")

    n_sitemap = update_sitemap(langs)
    print(f":: sitemap.xml: {n_sitemap} translated <url> entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
