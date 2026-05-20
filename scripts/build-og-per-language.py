#!/usr/bin/env python3
"""
build-og-per-language.py
========================

Generate per-language Open Graph share-card images by string-substituting
the English headline lines in dist/weareone-link.org/og/one-link.svg, then
rasterizing each variant to PNG (since the OG protocol officially accepts
only PNG/JPEG/GIF).

Outputs:
  dist/weareone-link.org/og/one-link-<code>.svg   (one per non-en language)
  dist/weareone-link.org/og/one-link-<code>.png   (rasterized; needs cairosvg
                                                   or Inkscape on PATH)

After running, sweep the translated HTML pages so each <meta property="og:image">
points to the language-matched PNG. The companion sweep step (a one-line sed
in build-i18n.py once this lands) is intentionally left out until a renderer
is available — generating only the SVG ships a card that Facebook + LinkedIn
will refuse to scrape, which is worse than the current English fallback.

Runtime dependency: ONE of
  - `pip install resvg-py`     (preferred; Rust resvg, no native cairo dep)
  - `pip install cairosvg`     (needs system libcairo)
  - `inkscape` on PATH         (Linux/macOS package, Windows installer)

Usage:  python scripts/build-og-per-language.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


# Headline triplet per language. Source English: "Send anything. / To anyone. /
# Only you can read it." — flag for native-translator review before ship.
# Mantra "WE ARE ONE" stays in each language's spelling matching the rest of
# the surface ("somos uno", "nous sommes un", etc., uppercased).
TRANSLATIONS = {
    "es": {
        "mantra": "SOMOS UNO",
        "line1": "Envía cualquier cosa.",
        "line2": "A cualquiera.",
        "line3": "Solo tú puedes leerlo.",
    },
    "fr": {
        "mantra": "NOUS SOMMES UN",
        "line1": "Envoyez n'importe quoi.",
        "line2": "À n'importe qui.",
        "line3": "Vous seul pouvez le lire.",
    },
    "de": {
        "mantra": "WIR SIND EINS",
        "line1": "Sende alles.",
        "line2": "An jeden.",
        "line3": "Nur du kannst es lesen.",
    },
    "pt": {
        "mantra": "SOMOS UM",
        "line1": "Envia qualquer coisa.",
        "line2": "A qualquer pessoa.",
        "line3": "Só tu podes lê-lo.",
    },
    "it": {
        "mantra": "SIAMO UNO",
        "line1": "Invia qualsiasi cosa.",
        "line2": "A chiunque.",
        "line3": "Solo tu puoi leggerlo.",
    },
}

# English source strings to replace. Keep in sync with og/one-link.svg.
SOURCE_MANTRA = "WE ARE ONE"
SOURCE_LINE1 = "Send anything."
SOURCE_LINE2 = "To anyone."
SOURCE_LINE3 = "Only you can read it."


def rasterize(svg_path: Path, png_path: Path) -> bool:
    """Best-effort SVG -> PNG conversion. Returns True if a renderer ran."""
    # 1. resvg-py: pure-Rust renderer wheel, no native cairo needed.
    try:
        import resvg_py  # type: ignore
        svg = svg_path.read_text(encoding="utf-8")
        png_bytes = resvg_py.svg_to_bytes(
            svg_string=svg, width=1200, height=630
        )
        png_path.write_bytes(bytes(png_bytes))
        return True
    except ImportError:
        pass
    except Exception as e:
        print(f"   resvg-py failed on {svg_path.name}: {e}")

    # 2. cairosvg: pure-Python with a libcairo shared-lib dep.
    try:
        import cairosvg  # type: ignore
        cairosvg.svg2png(
            url=str(svg_path),
            write_to=str(png_path),
            output_width=1200,
            output_height=630,
        )
        return True
    except (ImportError, OSError):
        pass

    # 3. Inkscape CLI fallback.
    if shutil.which("inkscape"):
        subprocess.run(
            ["inkscape", str(svg_path),
             "--export-type=png",
             "--export-filename", str(png_path),
             "--export-width=1200",
             "--export-height=630"],
            check=True,
        )
        return True

    return False


def main() -> int:
    root = Path(__file__).resolve().parent.parent / "dist" / "weareone-link.org"
    og_dir = root / "og"
    src = og_dir / "one-link.svg"
    if not src.exists():
        print(f"!! source SVG missing: {src.relative_to(root.parent.parent)}")
        return 1

    src_svg = src.read_text(encoding="utf-8")

    rendered_any = False
    rasterized_any = False
    for code, t in TRANSLATIONS.items():
        svg = (src_svg
               .replace(SOURCE_MANTRA, t["mantra"])
               .replace(SOURCE_LINE1, t["line1"])
               .replace(SOURCE_LINE2, t["line2"])
               .replace(SOURCE_LINE3, t["line3"]))
        out_svg = og_dir / f"one-link-{code}.svg"
        out_svg.write_text(svg, encoding="utf-8")
        rendered_any = True
        print(f":: wrote {out_svg.relative_to(root.parent.parent)}")

        out_png = og_dir / f"one-link-{code}.png"
        ok = rasterize(out_svg, out_png)
        if ok:
            rasterized_any = True
            print(f":: rasterized {out_png.relative_to(root.parent.parent)}")

    if rendered_any and not rasterized_any:
        print()
        print("!! no SVG renderer found. SVGs are written but PNGs were not.")
        print("   install cairosvg (`pip install cairosvg`) or Inkscape,")
        print("   then re-run this script. Do not flip the og:image refs in")
        print("   the HTML to the SVGs alone — Facebook/LinkedIn will refuse.")
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
