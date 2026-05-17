#!/usr/bin/env python3
"""
rehash-manifest.py
==================

Recomputes the SHA-256 of every asset tracked in
dist/weareone-link.org/manifest.json and rewrites the manifest in place.
Also bumps the version suffix +rN -> +r(N+1).

Run after any change to a tracked asset (CSS/JS/WASM/WGSL/image/HTML).

Usage:  python scripts/rehash-manifest.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


def sha256_hex(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def bump_revision(version: str) -> str:
    m = re.match(r"^(.+\+r)(\d+)$", version)
    if not m:
        return version + "+r1"
    return f"{m.group(1)}{int(m.group(2)) + 1}"


def main() -> int:
    site_root = Path(__file__).resolve().parent.parent
    dist = site_root / "dist" / "weareone-link.org"
    manifest_path = dist / "manifest.json"

    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    updated = {}
    missing = []
    for asset_path in list(manifest.get("assets", {}).keys()):
        local = dist / asset_path.lstrip("/")
        if not local.exists():
            missing.append(asset_path)
            continue
        updated[asset_path] = f"sha256-{sha256_hex(local)}"

    if missing:
        print(f"!! missing assets, dropping from manifest: {missing}")
    manifest["assets"] = updated
    old_version = manifest.get("version", "0.0.0+r0")
    new_version = bump_revision(old_version)
    manifest["version"] = new_version
    manifest["issued_at"] = "2026-05-17T00:00:00Z"

    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f":: bumped version {old_version} -> {new_version}")
    print(f":: rehashed {len(updated)} assets in {manifest_path.relative_to(site_root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
