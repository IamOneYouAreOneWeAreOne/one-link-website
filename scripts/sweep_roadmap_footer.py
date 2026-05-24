#!/usr/bin/env python3
"""One-shot sweep: insert the new Roadmap <li> between Security and
Accessibility in the "For you" footer column of every translated page.

Idempotent: skips files where /<lang>/roadmap/ already appears.

Languages and localized labels:
    es -> Hoja de ruta
    fr -> Feuille de route
    de -> Roadmap
    pt -> Roteiro
    it -> Tabella di marcia
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

LANG_LABELS = {
    "es": "Hoja de ruta",
    "fr": "Feuille de route",
    "de": "Roadmap",
    "pt": "Roteiro",
    "it": "Tabella di marcia",
}

ROOT = Path(__file__).resolve().parent.parent / "dist" / "weareone-link.org"


def make_li(lang: str) -> str:
    label = LANG_LABELS[lang]
    return f'<li><a href="/{lang}/roadmap/" hreflang="{lang}">{label}</a></li>'


# Match the accessibility <li> in the For-you column. Accept either:
#   /<lang>/accessibility/  (localized)
#   /accessibility/         (English fallback link inside translated footer)
ACCESS_RE = re.compile(
    r'(<li><a\s+href="(?:/[a-z]{2})?/accessibility/"[^>]*>[^<]*</a></li>)'
)


def sweep_file(path: Path) -> tuple[bool, str]:
    """Return (changed, reason). reason is for logging."""
    try:
        html = path.read_text(encoding="utf-8")
    except Exception as e:
        return False, f"read-error: {e}"

    # Determine lang from the path: dist/weareone-link.org/<lang>/...
    rel = path.relative_to(ROOT)
    parts = rel.parts
    if not parts or parts[0] not in LANG_LABELS:
        return False, "not-translated"
    lang = parts[0]

    new_li = make_li(lang)

    # Idempotent check: any href to /<lang>/roadmap/ already?
    if f'/{lang}/roadmap/' in html and 'hreflang="' + lang + '"' in html:
        # Only skip if the roadmap link is in the footer For-you column.
        # We confirm by checking the exact <li>...</li> snippet exists.
        if new_li in html:
            return False, "already-present"
        # Could be footer "Read in:" alt-language link, not the For-you li.
        # Fall through to potentially still insert the For-you li.

    # Find the accessibility li (either /<lang>/accessibility/ or /accessibility/).
    m = ACCESS_RE.search(html)
    if not m:
        return False, "no-accessibility-li"

    access_li = m.group(1)
    replacement = new_li + access_li
    new_html = html.replace(access_li, replacement, 1)
    if new_html == html:
        return False, "no-change"

    path.write_text(new_html, encoding="utf-8")
    return True, "inserted"


def main() -> int:
    changed = 0
    skipped = 0
    errors = 0

    for lang in LANG_LABELS:
        lang_root = ROOT / lang
        if not lang_root.exists():
            continue
        for html_file in sorted(lang_root.rglob("*.html")):
            ok, reason = sweep_file(html_file)
            rel = html_file.relative_to(ROOT)
            if ok:
                changed += 1
                print(f"  changed  {rel}  ({reason})")
            else:
                if reason in ("already-present",):
                    skipped += 1
                elif reason in ("no-accessibility-li", "not-translated"):
                    skipped += 1
                    print(f"  skip     {rel}  ({reason})")
                else:
                    errors += 1
                    print(f"  ERROR    {rel}  ({reason})")

    print()
    print(f"Total changed: {changed}")
    print(f"Total skipped: {skipped}")
    print(f"Total errors:  {errors}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
