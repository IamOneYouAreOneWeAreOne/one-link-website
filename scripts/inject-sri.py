#!/usr/bin/env python3
"""
inject-sri.py
=============

For every static HTML page in dist/weareone-link.org/, rewrite the
<link rel="stylesheet" href="/...">  and  <script type="module" src="/...">
tags so they carry a Subresource Integrity hash that browsers will enforce
natively on first-load:

  <link rel="stylesheet" href="/css/one-link.css"
        integrity="sha384-..." crossorigin="anonymous">

  <script type="module" src="/live/bridge.js"
          integrity="sha384-..." crossorigin="anonymous"></script>

The hashes are SHA-384 base64 (not the SHA-256 hex form in manifest.json,
because SRI is keyed on base64). Tags that don't point at a local /-prefixed
path are skipped. Existing integrity= and crossorigin= attributes are
re-written if present.

Caveat:
  SRI on a <script type="module"> only protects the entry-point file, NOT
  the modules it dynamically imports. The WASM glue (ol_*.js +
  ol_*_bg.wasm) is covered by manifest.json's signed SHA-256s, which the
  Service Worker verifies on every cache read.

Run AFTER rehash-manifest.py + sign-manifest.py have finished and the
asset bytes are final. Idempotent: re-running is safe.

Usage:  python scripts/inject-sri.py
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from pathlib import Path
from typing import Optional


SRI_ALGO = "sha384"

# Match a self-closing <link rel="stylesheet" href="/..."> (any attribute order).
LINK_RE = re.compile(
    r'<link\b([^>]*?)\brel\s*=\s*["\']stylesheet["\']([^>]*?)>',
    re.IGNORECASE,
)
# Match a <script ... src="/..."> (self-closing or with body).
SCRIPT_RE = re.compile(
    r'<script\b([^>]*?)\bsrc\s*=\s*["\']([^"\']+)["\']([^>]*)>',
    re.IGNORECASE,
)
HREF_RE = re.compile(r'\bhref\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)


def sri_for(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    h = hashlib.new(SRI_ALGO)
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    b64 = base64.b64encode(h.digest()).decode("ascii")
    return f"{SRI_ALGO}-{b64}"


def strip_attr(attrs: str, name: str) -> str:
    """Drop  name="..."  /  name='...'  from an attribute fragment."""
    return re.sub(
        rf'\b{name}\s*=\s*["\'][^"\']*["\']',
        "",
        attrs,
        flags=re.IGNORECASE,
    )


def rewrite_link(match: re.Match, dist_root: Path) -> str:
    attrs_before = match.group(1) or ""
    attrs_after  = match.group(2) or ""
    full_attrs = attrs_before + attrs_after
    href_m = HREF_RE.search(full_attrs)
    if not href_m:
        return match.group(0)
    href = href_m.group(1)
    if not href.startswith("/") or href.startswith("//"):
        return match.group(0)
    local = dist_root / href.lstrip("/")
    if not local.exists():
        return match.group(0)
    sri = sri_for(local)
    if not sri:
        return match.group(0)

    cleaned = strip_attr(strip_attr(full_attrs, "integrity"), "crossorigin")
    cleaned = cleaned.strip()
    # Drop double spaces left behind by strip.
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return (
        f'<link rel="stylesheet" {cleaned} '
        f'integrity="{sri}" crossorigin="anonymous">'
    )


def rewrite_script(match: re.Match, dist_root: Path) -> str:
    attrs_before = match.group(1) or ""
    src          = match.group(2)
    attrs_after  = match.group(3) or ""
    full_attrs = (attrs_before + attrs_after).strip()
    if not src.startswith("/") or src.startswith("//"):
        return match.group(0)
    local = dist_root / src.lstrip("/")
    if not local.exists():
        return match.group(0)
    sri = sri_for(local)
    if not sri:
        return match.group(0)

    cleaned = strip_attr(strip_attr(full_attrs, "integrity"), "crossorigin")
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return (
        f'<script {cleaned} src="{src}" '
        f'integrity="{sri}" crossorigin="anonymous">'
    )


def process_html(path: Path, dist_root: Path) -> int:
    text = path.read_text(encoding="utf-8")
    orig = text
    text = LINK_RE.sub(lambda m: rewrite_link(m, dist_root), text)
    text = SCRIPT_RE.sub(lambda m: rewrite_script(m, dist_root), text)
    if text == orig:
        return 0
    path.write_text(text, encoding="utf-8")
    return 1


def main() -> int:
    site_root = Path(__file__).resolve().parent.parent
    dist = site_root / "dist" / "weareone-link.org"
    pages = list(dist.rglob("*.html"))
    changed = 0
    for p in pages:
        if process_html(p, dist):
            print(f":: rewrote {p.relative_to(site_root)}")
            changed += 1
    print(f":: scanned {len(pages)} pages, rewrote {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
