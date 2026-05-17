#!/usr/bin/env python3
"""
rehash-manifest.py
==================

Three-stage release pipeline for dist/weareone-link.org/, run in order:

  1. inject-sri.py     -  rewrite <link>/<script> tags in every HTML page
                          with SHA-384 SRI hashes of their target files
                          (so the browser enforces integrity natively on
                          first-load, before the SW has even installed).
  2. (this script)     -  recompute SHA-256 of every asset tracked in
                          manifest.json (including the just-mutated HTML)
                          and bump +rN -> +r(N+1).
  3. sign-manifest.py  -  ed25519-sign the new manifest with the offline
                          key in .keys/manifest-ed25519.sk, embedding the
                          pinned-pubkey signature the SW verifies.

If the signing key is missing, the manifest gets rehashed but unsigned and
this script exits non-zero (the SW will refuse the unsigned form, so
loud failure is correct).

Run after any change to a tracked asset (CSS/JS/WASM/WGSL/image/HTML).

Usage:  python scripts/rehash-manifest.py
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
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

    # ---- Stage 1: SRI injection (mutates HTML) -------------------------
    sri_script = site_root / "scripts" / "inject-sri.py"
    if sri_script.exists():
        print(":: stage 1: chaining into inject-sri.py")
        rc = subprocess.run(
            [sys.executable, str(sri_script)], cwd=str(site_root)
        ).returncode
        if rc != 0:
            print(f"!! inject-sri.py exited {rc}, aborting before rehash")
            return rc

    # ---- Stage 2: bump version + sync sw.js BEFORE we hash --------------
    print(":: stage 2: rehashing manifest")
    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    old_version = manifest.get("version", "0.0.0+r0")
    new_version = bump_revision(old_version)

    # Sync sw.js SW_VERSION to the NEW version FIRST so its bytes are final
    # before we hash it. Otherwise the manifest /sw.js entry would be stale.
    sw_path = dist / "sw.js"
    if sw_path.exists():
        sw_text = sw_path.read_text(encoding="utf-8")
        sw_new = re.sub(
            r"const SW_VERSION = '[^']+';",
            f"const SW_VERSION = '{new_version}';",
            sw_text,
            count=1,
        )
        if sw_new != sw_text:
            sw_path.write_text(sw_new, encoding="utf-8")
            print(f":: synced SW_VERSION in {sw_path.relative_to(site_root)} -> {new_version}")

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
    manifest["version"] = new_version
    manifest["issued_at"] = "2026-05-17T00:00:00Z"

    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f":: bumped version {old_version} -> {new_version}")
    print(f":: rehashed {len(updated)} assets in {manifest_path.relative_to(site_root)}")

    # ---- Stage 3: sign --------------------------------------------------
    signer = site_root / "scripts" / "sign-manifest.py"
    sk_path = site_root / ".keys" / "manifest-ed25519.sk"
    if not sk_path.exists():
        print(f"!! signing key missing at {sk_path.relative_to(site_root)}")
        print( "   run  python scripts/generate-signing-key.py  to mint one,")
        print( "   then re-run this script. The unsigned manifest you just")
        print( "   wrote will be REJECTED by the Service Worker.")
        return 2

    print(":: stage 3: chaining into sign-manifest.py")
    rc = subprocess.run([sys.executable, str(signer)], cwd=str(site_root)).returncode
    if rc != 0:
        print(f"!! sign-manifest.py exited {rc}; manifest is rehashed but not signed")
        return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
