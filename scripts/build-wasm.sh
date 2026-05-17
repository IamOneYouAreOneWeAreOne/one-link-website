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
#   cargo install wasm-bindgen-cli --version 0.2.95
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
cargo build --release --target wasm32-unknown-unknown

mkdir -p "${WASM_OUT}"

# Iterate each member crate listed in the workspace Cargo.toml.
crates=(
  "ol_pair_qr_wasm:ol_pair_qr"
  "ol_pqkem_wasm:ol_pqkem"
  "ol_pqsig_wasm:ol_pqsig"
  "ol_threshold_recovery_wasm:ol_threshold_recovery"
  "ol_ratchet_wasm:ol_ratchet"
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

echo ":: done"
ls -la "${WASM_OUT}"
