#!/usr/bin/env bash
# =============================================================================
# build-wasm.sh
# =============================================================================
#
# Builds every wasm-bindgen crate in live/wasm/ and emits the bindings into
# dist/weareone-link.org/live/wasm/.
#
# Idempotent. Safe to run from any working directory.
#
# Prerequisites (one-time, ~1 minute):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.100
#
# License: AGPL-3.0-or-later
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_SRC="${ROOT}/live/wasm"
WASM_OUT="${ROOT}/dist/weareone-link.org/live/wasm"

echo ":: building wasm crates from ${WASM_SRC}"
cd "${WASM_SRC}"

# Rust records absolute source paths (panic locations, debug info) into the
# binary, so an unremapped build ships the builder's home directory to every
# visitor. That leaked a real username in the deployed wasm. Remap the two
# roots that appear (this workspace and the cargo registry) so the emitted
# bytes carry no machine-specific path, and so two builders' outputs agree.
# Remap the HOME root, in whichever form the compiler records. Two details
# matter and both were learned the hard way:
#   1. FORM. On Windows the toolchain records a drive-letter path with
#      backslashes while this shell reports a msys-style one, so a prefix
#      taken from `pwd` never matches and the remap silently does nothing.
#      (Spelling either form literally here would trip the deployed-surface
#      local-path gate, which is generic on purpose.)
#   2. SCOPE. These crates depend on sources OUTSIDE this repository (the
#      One Link native crates) plus the cargo registry, so remapping only the
#      wasm workspace leaves most of the paths intact. Remapping HOME covers
#      the workspace, the sibling checkout, and ~/.cargo in one rule.
CARGO_HOME_DIR="${CARGO_HOME:-${HOME}/.cargo}"
REMAPS=""
for candidate in "${HOME}" "${CARGO_HOME_DIR}"; do
  [ -n "${candidate}" ] || continue
  REMAPS="${REMAPS} --remap-path-prefix=${candidate}=/build"
  if command -v cygpath >/dev/null 2>&1; then
    win_form="$(cygpath -w "${candidate}" 2>/dev/null || true)"
    [ -n "${win_form}" ] && REMAPS="${REMAPS} --remap-path-prefix=${win_form}=/build"
  fi
done
export RUSTFLAGS="${RUSTFLAGS:-}${REMAPS}"
cargo build --release --target wasm32-unknown-unknown

mkdir -p "${WASM_OUT}"

# Iterate each member crate listed in the workspace Cargo.toml.
crates=(
  "ol_pair_qr_wasm:ol_pair_qr"
  "ol_pqkem_wasm:ol_pqkem"
  "ol_pqsig_wasm:ol_pqsig"
  "ol_threshold_recovery_wasm:ol_threshold_recovery"
  "ol_ratchet_wasm:ol_ratchet"
  "ol_hwkey_wasm:ol_hwkey"
  "ol_onion_wasm:ol_onion"
  "ol_coherence_field_wasm:ol_coherence_field"
)

for spec in "${crates[@]}"; do
  src_name="${spec%%:*}"
  out_name="${spec##*:}"
  wasm_in="${WASM_SRC}/target/wasm32-unknown-unknown/release/${src_name}.wasm"
  if [[ ! -f "${wasm_in}" ]]; then
    echo "!! missing build artifact: ${wasm_in}"
    exit 1
  fi
  echo ":: wasm-bindgen ${src_name} -> ${out_name}"
  wasm-bindgen \
    --target web \
    --out-dir "${WASM_OUT}" \
    --out-name "${out_name}" \
    --no-typescript \
    "${wasm_in}"
done

# Strip the custom name/producers sections. wasm-bindgen keeps them, and they
# are where any residual path string would survive. Execution is unaffected.
if command -v wasm-strip >/dev/null 2>&1; then
  for spec in "${crates[@]}"; do
    out_name="${spec##*:}"
    wasm-strip "${WASM_OUT}/${out_name}_bg.wasm"
    echo ":: stripped ${out_name}_bg.wasm"
  done
else
  echo "!! wasm-strip not found; shipped wasm keeps its name section"
fi

echo ":: done"
ls -la "${WASM_OUT}"
