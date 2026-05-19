#!/usr/bin/env python3
"""
verify-manifest.py
==================

Verify the signed manifest at dist/weareone-link.org/manifest.json.

For mirror operators who want to confirm the bundle they just cloned
matches what the canonical site publishes:

  1. The Ed25519 signature on the canonical {version, assets} subset
     matches the public key embedded in the manifest's `signed_by` field.

  2. Every asset listed in the manifest exists on disk and its
     SHA-256 hash matches the value recorded in the manifest.

If both checks pass, the bundle is byte-equivalent to what was signed.
If either check fails, do not host the bundle. Pull a fresh clone or
open an issue.

This script has zero non-stdlib dependencies if a pure-Python ed25519
implementation is acceptable. It uses `cryptography` when available
(faster + constant-time) and falls back to a minimal RFC 8032
implementation otherwise so it runs on a vanilla Python install.

Exit codes:
  0  bundle verified
  1  signature did not verify, or asset hash mismatch, or manifest malformed
  2  manifest not found
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


# ----------------------------------------------------------------------------
# Canonical signing payload (must match sign-manifest.py exactly)
# ----------------------------------------------------------------------------

def canonical_bytes_for_signing(manifest: dict) -> bytes:
    payload = {
        "version": manifest.get("version", ""),
        "assets": {
            k: manifest["assets"][k]
            for k in sorted(manifest.get("assets", {}).keys())
        },
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ----------------------------------------------------------------------------
# Ed25519 verify (prefer cryptography; fall back to stdlib-only RFC 8032)
# ----------------------------------------------------------------------------

def _verify_ed25519(pubkey: bytes, sig: bytes, msg: bytes) -> bool:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
        pk = Ed25519PublicKey.from_public_bytes(pubkey)
        try:
            pk.verify(sig, msg)
            return True
        except InvalidSignature:
            return False
    except ImportError:
        return _verify_ed25519_pure(pubkey, sig, msg)


def _verify_ed25519_pure(pubkey: bytes, sig: bytes, msg: bytes) -> bool:
    """Minimal RFC 8032 Ed25519 verify, stdlib-only. Constant time NOT required
    for a verifier (we are not handling private keys here). Adapted from the
    spec's reference implementation."""
    if len(pubkey) != 32 or len(sig) != 64:
        return False

    p = 2**255 - 19
    L = 2**252 + 27742317777372353535851937790883648493
    d = (-121665 * pow(121666, p - 2, p)) % p

    def modp_inv(x):
        return pow(x, p - 2, p)

    def point_decompress(s: bytes):
        if len(s) != 32:
            return None
        y = int.from_bytes(s, "little") & ((1 << 255) - 1)
        sign_x = (s[31] >> 7) & 1
        if y >= p:
            return None
        x2 = (y * y - 1) * modp_inv(d * y * y + 1) % p
        if x2 == 0:
            if sign_x:
                return None
            x = 0
        else:
            x = pow(x2, (p + 3) // 8, p)
            if (x * x - x2) % p != 0:
                x = x * pow(2, (p - 1) // 4, p) % p
            if (x * x - x2) % p != 0:
                return None
            if (x & 1) != sign_x:
                x = p - x
        return (x, y, 1, x * y % p)

    def point_add(P, Q):
        A = (P[1] - P[0]) * (Q[1] - Q[0]) % p
        B = (P[1] + P[0]) * (Q[1] + Q[0]) % p
        C = 2 * P[3] * Q[3] * d % p
        D = 2 * P[2] * Q[2] % p
        E, F, G, H = B - A, D - C, D + C, B + A
        return (E * F % p, G * H % p, F * G % p, E * H % p)

    def point_mul(s, P):
        Q = (0, 1, 1, 0)
        while s > 0:
            if s & 1:
                Q = point_add(Q, P)
            P = point_add(P, P)
            s >>= 1
        return Q

    def point_equal(P, Q):
        if (P[0] * Q[2] - Q[0] * P[2]) % p != 0:
            return False
        if (P[1] * Q[2] - Q[1] * P[2]) % p != 0:
            return False
        return True

    Bx = 15112221349535400772501151409588531511454012693041857206046113283949847762202
    By = 46316835694926478169428394003475163141307993866256225615783033603165251855960
    Bpt = (Bx, By, 1, Bx * By % p)

    R_compressed = sig[:32]
    s_int = int.from_bytes(sig[32:64], "little")
    if s_int >= L:
        return False
    A = point_decompress(pubkey)
    if A is None:
        return False
    R = point_decompress(R_compressed)
    if R is None:
        return False
    h = int.from_bytes(
        hashlib.sha512(R_compressed + pubkey + msg).digest(),
        "little",
    ) % L
    sB = point_mul(s_int, Bpt)
    hA = point_mul(h, A)
    R_plus_hA = point_add(R, hA)
    return point_equal(sB, R_plus_hA)


# ----------------------------------------------------------------------------
# Main verification
# ----------------------------------------------------------------------------

def color(text: str, code: str) -> str:
    if not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


GREEN = "32"
RED = "31"
DIM = "2"
BOLD = "1"


def ok(msg: str) -> None:
    print(f"  {color('OK ', GREEN)} {msg}")


def fail(msg: str) -> None:
    print(f"  {color('FAIL', RED)} {msg}")


def info(msg: str) -> None:
    print(f"  {color('--', DIM)} {msg}")


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    manifest_path = here / "dist" / "weareone-link.org" / "manifest.json"

    if not manifest_path.exists():
        print(f"manifest not found at {manifest_path}")
        return 2

    print(color("verifying one-link-website bundle", BOLD))
    print(f"  manifest: {manifest_path.relative_to(here)}")
    print()

    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    # ------------------------------------------------------------------ sig
    signed_by = manifest.get("signed_by", "")
    signature = manifest.get("signature", "")

    if not signed_by.startswith("ed25519-pub-"):
        fail(f"signed_by missing or malformed: {signed_by!r}")
        return 1
    if not signature.startswith("ed25519-"):
        fail(f"signature missing or malformed: {signature!r}")
        return 1

    pubkey_hex = signed_by[len("ed25519-pub-"):]
    sig_hex = signature[len("ed25519-"):]

    try:
        pubkey = bytes.fromhex(pubkey_hex)
        sig = bytes.fromhex(sig_hex)
    except ValueError as e:
        fail(f"signed_by or signature has non-hex content: {e}")
        return 1

    if len(pubkey) != 32:
        fail(f"public key has wrong length ({len(pubkey)} bytes, expected 32)")
        return 1
    if len(sig) != 64:
        fail(f"signature has wrong length ({len(sig)} bytes, expected 64)")
        return 1

    payload = canonical_bytes_for_signing(manifest)
    payload_sha = hashlib.sha256(payload).hexdigest()

    if not _verify_ed25519(pubkey, sig, payload):
        fail("manifest signature did NOT verify")
        info(f"signed payload SHA-256: {payload_sha}")
        info(f"public key:             {pubkey_hex}")
        return 1

    ok(f"manifest signature (Ed25519 over canonical bytes)")
    info(f"public key: {pubkey_hex[:16]}…")
    info(f"signed SHA-256: {payload_sha[:16]}…")

    # ----------------------------------------------------------- assets check
    assets = manifest.get("assets") or {}
    if not assets:
        fail("manifest has no `assets` table")
        return 1

    bundle_root = manifest_path.parent
    matched = 0
    missing = 0
    mismatched = 0

    for rel_path, recorded_sha in assets.items():
        on_disk = bundle_root / rel_path.lstrip("/")
        if not on_disk.exists():
            fail(f"missing asset: {rel_path}")
            missing += 1
            continue
        actual_sha = hashlib.sha256(on_disk.read_bytes()).hexdigest()
        # The manifest stores sha256 prefixed with "sha256-" for legibility.
        if isinstance(recorded_sha, str) and recorded_sha.startswith("sha256-"):
            expected = recorded_sha[len("sha256-"):]
        else:
            expected = recorded_sha if isinstance(recorded_sha, str) else ""
        if actual_sha != expected:
            fail(f"hash mismatch: {rel_path}")
            info(f"  expected: {expected}")
            info(f"  on disk:  {actual_sha}")
            mismatched += 1
        else:
            matched += 1

    print()
    if missing == 0 and mismatched == 0:
        ok(f"all {matched} assets match the signed manifest")
        print()
        print(color("verdict: bundle integrity verified", GREEN + ";1"))
        return 0
    else:
        fail(f"{matched}/{len(assets)} assets verified, {missing} missing, {mismatched} mismatched")
        print()
        print(color("verdict: bundle integrity FAILED — do not host", RED + ";1"))
        return 1


if __name__ == "__main__":
    sys.exit(main())
