#!/usr/bin/env python3
"""One-shot sweep: insert the new Verify download <li> between Security
and Roadmap (or, if Roadmap not yet present, between Security and the
next item) in the "For you" footer column of every translated page.

Idempotent: skips files where /<lang>/verify-download/ already appears
inside a "For you"-column-shaped <li>.

Languages and localized labels:
    es -> Verificar descarga
    fr -> Vérifier le téléchargement
    de -> Download verifizieren
    pt -> Verificar descarga
    it -> Verifica download
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

LANG_LABELS = {
    "es": "Verificar descarga",
    "fr": "Vérifier le téléchargement",
    "de": "Download verifizieren",
    "pt": "Verificar descarga",
    "it": "Verifica download",
}

ROOT = Path(__file__).resolve().parent.parent / "dist" / "weareone-link.org"


def make_li(lang: str) -> str:
    label = LANG_LABELS[lang]
    return f'<li><a href="/{lang}/verify-download/" hreflang="{lang}">{label}</a></li>'


# Match the security <li> in the For-you column. Security is the anchor
# we insert AFTER. Accept either localized /<lang>/security/ or the
# English-fallback /security/ form.
SECURITY_RE = re.compile(
    r'(<li><a\s+href="(?:/[a-z]{2})?/security/"[^>]*>[^<]*</a></li>)'
)


def sweep_file(path: Path) -> tuple[bool, str]:
    """Return (changed, reason). reason is for logging."""
    try:
        html = path.read_text(encoding="utf-8")
    except Exception as e:
        return False, f"read-error: {e}"

    rel = path.relative_to(ROOT)
    parts = rel.parts
    if not parts or parts[0] not in LANG_LABELS:
        return False, "not-translated"
    lang = parts[0]

    new_li = make_li(lang)

    # Idempotent: skip if our exact <li> already in file.
    if new_li in html:
        return False, "already-present"

    m = SECURITY_RE.search(html)
    if not m:
        return False, "no-security-li"

    sec_li = m.group(1)
    replacement = sec_li + new_li
    new_html = html.replace(sec_li, replacement, 1)
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
                elif reason in ("no-security-li", "not-translated"):
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
