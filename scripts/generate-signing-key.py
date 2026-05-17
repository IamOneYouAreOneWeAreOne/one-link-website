#!/usr/bin/env python3
"""
generate-signing-key.py
=======================

One-shot: mint an ed25519 keypair for manifest signing. Writes:

  .keys/manifest-ed25519.sk   (RAW 32-byte seed, chmod 600)
  .keys/manifest-ed25519.pk   (RAW 32-byte pub, hex on stdout)

The private key NEVER leaves .keys/ (which is gitignored). The public key
gets pinned as a constant in dist/weareone-link.org/sw.js the first time
sign-manifest.py runs.

Run ONCE per signing-key rotation event. Future rotations should sign the
new-pubkey transition with the OLD key (chain of trust) - that handler
isn't built yet because we haven't rotated.

Usage:  python scripts/generate-signing-key.py
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    keys = root / ".keys"
    keys.mkdir(exist_ok=True)

    sk_path = keys / "manifest-ed25519.sk"
    pk_path = keys / "manifest-ed25519.pk"

    if sk_path.exists():
        print(f"!! refusing to overwrite existing key at {sk_path}")
        print(f"   delete it manually if you intend to rotate (and update sw.js pin)")
        return 1

    sk = Ed25519PrivateKey.generate()
    sk_raw = sk.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pk_raw = sk.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    sk_path.write_bytes(sk_raw)
    pk_path.write_bytes(pk_raw)

    # Best-effort tighten permissions (no-op on Windows; sets 600 on POSIX).
    try:
        os.chmod(sk_path, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        pass

    print(f":: wrote {sk_path.relative_to(root)} ({len(sk_raw)} bytes)")
    print(f":: wrote {pk_path.relative_to(root)} ({len(pk_raw)} bytes)")
    print()
    print(f"   pubkey hex: {pk_raw.hex()}")
    print()
    print( "   NEXT STEPS:")
    print( "   1. paste that pubkey hex into dist/weareone-link.org/sw.js as MANIFEST_PUBKEY_HEX")
    print( "   2. run  python scripts/sign-manifest.py  after every rehash-manifest run")
    print( "   3. .gitignore already excludes .keys/  -  keep it that way")
    return 0


if __name__ == "__main__":
    sys.exit(main())
