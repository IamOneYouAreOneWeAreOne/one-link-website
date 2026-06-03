"""Sync the download/index.html page across all locales with the
current ship-state of every platform binary.

Replaces the existing ``ol-platform-row`` tile block + the
``ol-attest-dim`` honest-status sentence + (English only) the
attestation panel with the post-6-arch reality:

  * Windows x86_64 + arm64 — Inno installer + portable zip, today
  * macOS arm64 + x86_64   — .dmg + portable zip, today
  * Linux x86_64 + arm64   — .AppImage + portable zip, today
  * Android / iOS          — in flight
  * OpenBSD                — source build, today
  * Source                 — AGPL, today

Each locale keeps its own short status copy ("today" / "heute" /
"hoy" / ...) — only the technical labels are shared across locales,
mirroring how the prior page was already authored.

Idempotent: re-running rewrites the same rows.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST = REPO_ROOT / "dist" / "weareone-link.org"

LOCALES = {
    "en": {
        "today": "today",
        "in_flight": "in flight",
        "source_build": "source build, today",
        "agpl": "AGPL, today",
        "honest_status": (
            "honest status: all six mainstream desktop architectures ship today &mdash; "
            "Windows + macOS + Linux, each in Intel and ARM flavors. Android + iOS are next. "
            "building from source works on every platform."
        ),
        "portable_note": (
            "want the portable zip instead of the native installer? append "
            "<code>-zip</code> to any URL above (e.g. <code>/download/windows-arm64-zip</code>). "
            "same binary, different packaging."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows on ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux on ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "Source",
    },
    "de": {
        "today": "heute",
        "in_flight": "in Arbeit",
        "source_build": "aus Quelltext bauen, heute",
        "agpl": "AGPL, heute",
        "honest_status": (
            "ehrlicher Stand: alle sechs g&auml;ngigen Desktop-Architekturen sind heute verf&uuml;gbar &mdash; "
            "Windows + macOS + Linux, jeweils f&uuml;r Intel und ARM. Android + iOS folgen. "
            "der Bau aus dem Quelltext funktioniert auf jeder Plattform."
        ),
        "portable_note": (
            "lieber das portable ZIP statt der nativen Installation? h&auml;nge "
            "<code>-zip</code> an jede URL oben an (z.&nbsp;B. <code>/download/windows-arm64-zip</code>). "
            "gleiches Bin&auml;rprogramm, andere Verpackung."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows auf ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux auf ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "Quelltext",
    },
    "es": {
        "today": "hoy",
        "in_flight": "en camino",
        "source_build": "compilar desde el c&oacute;digo, hoy",
        "agpl": "AGPL, hoy",
        "honest_status": (
            "estado honesto: las seis arquitecturas de escritorio mayoritarias ya est&aacute;n disponibles hoy &mdash; "
            "Windows + macOS + Linux, cada uno en versi&oacute;n Intel y ARM. Android + iOS son los siguientes. "
            "compilar desde el c&oacute;digo funciona en todas las plataformas."
        ),
        "portable_note": (
            "&iquest;prefieres el ZIP port&aacute;til en lugar del instalador nativo? a&ntilde;ade "
            "<code>-zip</code> a cualquier URL anterior (p. ej. <code>/download/windows-arm64-zip</code>). "
            "el mismo binario, distinto empaquetado."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows en ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux en ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "C&oacute;digo fuente",
    },
    "fr": {
        "today": "aujourd&rsquo;hui",
        "in_flight": "en cours",
        "source_build": "compilation depuis les sources, aujourd&rsquo;hui",
        "agpl": "AGPL, aujourd&rsquo;hui",
        "honest_status": (
            "&eacute;tat honn&ecirc;te&nbsp;: les six architectures de bureau majoritaires sont disponibles aujourd&rsquo;hui &mdash; "
            "Windows + macOS + Linux, chacun en version Intel et ARM. Android + iOS suivent. "
            "compiler depuis les sources fonctionne sur chaque plateforme."
        ),
        "portable_note": (
            "vous pr&eacute;f&eacute;rez le ZIP portable plut&ocirc;t que l&rsquo;installeur natif&nbsp;? ajoutez "
            "<code>-zip</code> &agrave; toute URL ci-dessus (p.&nbsp;ex. <code>/download/windows-arm64-zip</code>). "
            "m&ecirc;me binaire, autre empaquetage."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows sur ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux sur ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "Sources",
    },
    "pt": {
        "today": "hoje",
        "in_flight": "em curso",
        "source_build": "compila&ccedil;&atilde;o a partir do c&oacute;digo, hoje",
        "agpl": "AGPL, hoje",
        "honest_status": (
            "estado honesto: todas as seis arquiteturas de desktop principais est&atilde;o dispon&iacute;veis hoje &mdash; "
            "Windows + macOS + Linux, cada um em vers&atilde;o Intel e ARM. Android + iOS s&atilde;o os pr&oacute;ximos. "
            "compilar a partir do c&oacute;digo funciona em todas as plataformas."
        ),
        "portable_note": (
            "prefere o ZIP port&aacute;til em vez do instalador nativo? adicione "
            "<code>-zip</code> a qualquer URL acima (ex. <code>/download/windows-arm64-zip</code>). "
            "o mesmo bin&aacute;rio, embalagem diferente."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows em ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux em ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "C&oacute;digo fonte",
    },
    "it": {
        "today": "oggi",
        "in_flight": "in arrivo",
        "source_build": "compilazione dai sorgenti, oggi",
        "agpl": "AGPL, oggi",
        "honest_status": (
            "stato onesto: tutte le sei architetture desktop principali sono disponibili oggi &mdash; "
            "Windows + macOS + Linux, ciascuna in versione Intel e ARM. Android + iOS sono i prossimi. "
            "compilare dai sorgenti funziona su ogni piattaforma."
        ),
        "portable_note": (
            "preferisci lo ZIP portatile invece dell&rsquo;installer nativo? aggiungi "
            "<code>-zip</code> a qualsiasi URL sopra (es. <code>/download/windows-arm64-zip</code>). "
            "stesso binario, packaging diverso."
        ),
        "win_intel": "Windows (Intel/AMD)",
        "win_arm": "Windows su ARM",
        "mac_arm": "macOS (Apple Silicon)",
        "mac_intel": "macOS (Intel)",
        "linux_intel": "Linux (Intel/AMD)",
        "linux_arm": "Linux su ARM (Pi)",
        "android": "Android",
        "ios": "iOS",
        "openbsd": "OpenBSD",
        "source": "Sorgenti",
    },
}


def render_rows(L: dict) -> str:
    """Build the platform-row tile block for a given locale dictionary."""
    return f'''<div class="alts ol-tag-grid" aria-label="Other devices">
          <a href="/download/windows"       class="ol-platform-row">{L["win_intel"]} <span class="ol-platform-status ready">.exe installer, {L["today"]}</span></a>
          <a href="/download/windows-arm64" class="ol-platform-row">{L["win_arm"]}      <span class="ol-platform-status ready">.exe installer, {L["today"]}</span></a>
          <a href="/download/macos"         class="ol-platform-row">{L["mac_arm"]}    <span class="ol-platform-status ready">.dmg, {L["today"]}</span></a>
          <a href="/download/macos-x86_64"  class="ol-platform-row">{L["mac_intel"]}            <span class="ol-platform-status ready">.dmg, {L["today"]}</span></a>
          <a href="/download/linux"         class="ol-platform-row">{L["linux_intel"]} <span class="ol-platform-status ready">.AppImage, {L["today"]}</span></a>
          <a href="/download/linux-arm64"   class="ol-platform-row">{L["linux_arm"]} <span class="ol-platform-status ready">.AppImage, {L["today"]}</span></a>
          <a href="/download/android"       class="ol-platform-row">{L["android"]} <span class="ol-platform-status">{L["in_flight"]}</span></a>
          <a href="/download/ios"           class="ol-platform-row">{L["ios"]}     <span class="ol-platform-status">{L["in_flight"]}</span></a>
          <a href="/download/openbsd"       class="ol-platform-row">{L["openbsd"]} <span class="ol-platform-status">{L["source_build"]}</span></a>
          <a href="/download/source"        class="ol-platform-row">{L["source"]}  <span class="ol-platform-status ready">{L["agpl"]}</span></a>
        </div>
        <p class="ol-attest-dim">
          {L["honest_status"]}
        </p>
        <p class="ol-attest-dim">
          {L["portable_note"]}
        </p>'''


# Regex finds the existing <div class="alts ...>...</div> through the
# trailing <p class="ol-attest-dim">...</p> so a single substitution
# replaces the whole stale block per locale.
BLOCK_RE = re.compile(
    r'<div class="alts ol-tag-grid"[\s\S]+?</div>\s*<p class="ol-attest-dim">[\s\S]+?</p>',
    re.MULTILINE,
)


def page_path(locale: str) -> Path:
    if locale == "en":
        return DIST / "download" / "index.html"
    return DIST / locale / "download" / "index.html"


def main() -> int:
    rewrites = 0
    for locale, strings in LOCALES.items():
        p = page_path(locale)
        if not p.exists():
            print(f"[skip] {locale}: {p} missing")
            continue
        original = p.read_text(encoding="utf-8")
        replacement = render_rows(strings)
        new_text, n = BLOCK_RE.subn(replacement, original, count=1)
        if n == 0:
            print(f"[warn] {locale}: BLOCK_RE found no match")
            continue
        if new_text == original:
            print(f"[ok]   {locale}: already up to date")
            continue
        p.write_text(new_text, encoding="utf-8")
        rewrites += 1
        print(f"[wrote] {locale}: {p}")
    print(f"\nrewrote {rewrites} page(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
