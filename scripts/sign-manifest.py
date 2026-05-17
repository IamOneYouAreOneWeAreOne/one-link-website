#!/usr/bin/env python3
"""
sign-manifest.py
================

Re-sign dist/weareone-link.org/manifest.json with the offline ed25519 key
in .keys/manifest-ed25519.sk. Updates the manifest in place:

  - "signed_by"  -> "ed25519-pub-<hex>"  (matches the pin in sw.js)
  - "signature"  -> "ed25519-<hex>"      (RAW 64-byte ed25519 sig)

The signature covers the canonical SHA-256 digest of the SORTED assets
dict + the version field. (We deliberately do NOT sign the signature
field itself, obviously, and we do not sign the issued_at timestamp so
re-running this script with a different clock yields the same signature
when assets are unchanged - useful for reproducibility.)

Run AFTER rehash-manifest.py every time.

Usage:  python scripts/sign-manifest.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def canonical_bytes_for_signing(manifest: dict) -> bytes:
    """Deterministic byte representation of the signed subset of the manifest."""
    payload = {
        "version": manifest.get("version", ""),
        "assets": {
            k: manifest["assets"][k]
            for k in sorted(manifest.get("assets", {}).keys())
        },
    }
    # sort_keys + separators give a single canonical byte string regardless of
    # how the on-disk JSON happened to be laid out.
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    sk_path = root / ".keys" / "manifest-ed25519.sk"
    manifest_path = root / "dist" / "weareone-link.org" / "manifest.json"

    if not sk_path.exists():
        print(f"!! signing key missing at {sk_path}")
        print( "   run  python scripts/generate-signing-key.py  first")
        return 1

    sk_raw = sk_path.read_bytes()
    if len(sk_raw) != 32:
        print(f"!! signing key has wrong length ({len(sk_raw)} != 32)")
        return 1

    sk = Ed25519PrivateKey.from_private_bytes(sk_raw)
    pk_raw = sk.public_key().public_bytes_raw()

    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    payload = canonical_bytes_for_signing(manifest)
    sig = sk.sign(payload)

    # Also include the canonical-payload SHA-256 so a verifier can sanity-check
    # what bytes were signed without having to re-derive the canonical form.
    payload_digest = hashlib.sha256(payload).hexdigest()

    manifest["signed_by"]   = f"ed25519-pub-{pk_raw.hex()}"
    manifest["signature"]   = f"ed25519-{sig.hex()}"
    manifest["signed_sha256"] = f"sha256-{payload_digest}"
    manifest["sig_payload_spec"] = (
        "json({version, assets}) with sorted asset keys, "
        "separators (',',':') -> ed25519 sign(raw 32-byte seed) -> 64-byte sig"
    )

    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f":: signed manifest version {manifest.get('version')}")
    print(f"   pubkey hex   : {pk_raw.hex()}")
    print(f"   payload sha  : {payload_digest}")
    print(f"   signature    : {sig.hex()[:32]}... ({len(sig)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
