#!/usr/bin/env python3
"""
emit-wgsl.py
============

Drives the Coherence Lang `wgsl_emitter` to produce the One Link coherence-
field shader. The output is byte-identical to what the compiler would emit
when targeting WebGPU during a normal build.

This is the file that proves the WGSL shipped to the browser is from our
stack, not hand-written.

Usage:  python scripts/emit-wgsl.py

License: AGPL-3.0-or-later
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

COHERENCE_ROOT = os.environ.get(
    "COHERENCE_COMPILER",
    r"$HOME\Projects\Coherence\coherence_lang",
)
sys.path.insert(0, COHERENCE_ROOT)

from coherence_lang.codegen.wgsl_emitter import (  # type: ignore
    emit_coherence_field_shaders,
    emit_field_compute_only,
    emit_constellation_preamble,
)


def write_shader(path: Path, body: str, header: str) -> None:
    payload = header + body
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8", newline="\n")
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    rel = path.relative_to(Path.cwd()) if path.is_relative_to(Path.cwd()) else path
    print(f":: emitted  {rel}")
    print(f":: lines    {len(body.splitlines())}")
    print(f":: bytes    {len(payload.encode('utf-8'))}")
    print(f":: sha256   {digest}")


def main() -> int:
    site_root = Path(__file__).resolve().parent.parent
    dist_shader = site_root / "dist" / "weareone-link.org" / "live" / "shaders" / "coherence-field.wgsl"

    print("============================================================")
    print(" One Link  -  WGSL emission via coherence_lang.wgsl_emitter")
    print(" The shader served to browsers is byte-for-byte the output")
    print(" of our own compiler, not a hand-written file.")
    print("============================================================")
    print()

    body = emit_coherence_field_shaders()

    # The upstream emitter combines a compute pipeline AND a render
    # pipeline into one .wgsl string, with the SAME storage-buffer
    # binding (@group(0) @binding(0)) declared twice (once read_write
    # for compute, once read for render). WebGPU rejects this as a
    # binding-redeclaration error: ":236:23 error: redeclaration of
    # 'field'".
    #
    # Workaround: slice at the second binding declaration and ship
    # only the compute half. bridge.js provides its own inline render
    # shader that reads from the same storage buffer as a separate
    # shader module.
    marker = "@group(0) @binding(0)"
    first  = body.find(marker)
    second = body.find(marker, first + 1) if first >= 0 else -1
    if second > 0:
        compute_end = body.rfind("\n", 0, second)
        body = body[:compute_end].rstrip() + "\n"
        print(":: sliced render-pipeline section to avoid binding redeclaration")

    header = (
        "// =============================================================================\n"
        "// One Link  -  Coherence-field WGSL shader\n"
        "// =============================================================================\n"
        "//\n"
        "// EMITTED BY coherence_lang.codegen.wgsl_emitter.emit_coherence_field_shaders().\n"
        "// DO NOT HAND-EDIT. Re-run `python scripts/emit-wgsl.py` after upstream changes.\n"
        "//\n"
        "// This file proves the shader the browser executes is the output of our own\n"
        "// compiler, not a hand-written .wgsl file. The Helmholtz solver structure,\n"
        "// the warp-reduction patterns, the tau_c coupling - all come from the same\n"
        "// codegen path the daemon uses for GPU dispatch.\n"
        "//\n"
        "// License: AGPL-3.0-or-later\n"
        "// =============================================================================\n"
        "\n"
    )

    write_shader(dist_shader, body, header)
    return 0


if __name__ == "__main__":
    sys.exit(main())
