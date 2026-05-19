#!/usr/bin/env bash
# =============================================================================
# weareone-link.org mirror bootstrap
# =============================================================================
#
# Reviewable, idempotent, self-verifying. Run via:
#
#   bash <(curl -sSL https://weareone-link.org/mirror.sh)
#
# OR (preferred for security-conscious operators):
#
#   curl -sSLO https://weareone-link.org/mirror.sh
#   less mirror.sh                # read it first
#   bash mirror.sh
#
# What it does:
#   1. Verify required tools are present (git, python3).
#   2. Clone or pull the one-link-website repo into ./one-link-website/.
#   3. Verify the signed manifest using the bundled verify-manifest.py.
#   4. Start a local HTTP server on http://localhost:8080.
#
# It does NOT:
#   - Modify any system files
#   - Touch /etc, /usr, /opt, ~/.bashrc, ~/.zshrc, sudo, or root
#   - Open any network port other than 8080 on localhost
#   - Send any telemetry anywhere
#   - Install global packages
#
# Everything happens in the current directory under ./one-link-website/.
# Press Ctrl+C to stop the server. The clone stays around so you can
# inspect it, host it via Caddy/nginx/Tor, or rm -rf it.
# =============================================================================

set -euo pipefail

REPO_URL="https://github.com/IamOneYouAreOneWeAreOne/one-link-website.git"
REPO_DIR="one-link-website"
PORT="${PORT:-8080}"

# ANSI color helpers (only used when stdout is a terminal).
if [ -t 1 ]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_GREEN="$(printf '\033[32m')"
  C_RED="$(printf '\033[31m')"
  C_CYAN="$(printf '\033[36m')"
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_CYAN=""
fi

info() { printf '%s::%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
ok()   { printf '%sOK %s   %s\n' "$C_GREEN" "$C_RESET" "$*"; }
err()  { printf '%sERR%s   %s\n' "$C_RED"   "$C_RESET" "$*" >&2; }

banner() {
  printf '\n%s%sweareone-link.org mirror bootstrap%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%sclone + verify + serve, in one command%s\n\n' "$C_DIM" "$C_RESET"
}

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "required tool not found in PATH: $1"
    err "install it and re-run."
    exit 1
  fi
}

clone_or_update() {
  if [ -d "$REPO_DIR/.git" ]; then
    info "found existing clone at ./$REPO_DIR, fetching latest"
    git -C "$REPO_DIR" fetch --quiet --tags origin master
    git -C "$REPO_DIR" reset --quiet --hard origin/master
    ok "updated to latest master"
  else
    info "cloning $REPO_URL"
    git clone --quiet --depth 1 "$REPO_URL" "$REPO_DIR"
    ok "cloned into ./$REPO_DIR"
  fi
}

verify_manifest() {
  local script="$REPO_DIR/scripts/verify-manifest.py"
  if [ ! -f "$script" ]; then
    err "verify-manifest.py missing from clone. Repo may be incomplete; aborting."
    exit 1
  fi
  info "verifying signed manifest (ed25519 sig + per-asset sha256)"
  if python3 "$script"; then
    ok "manifest signature verifies and every asset matches"
  else
    err "MANIFEST VERIFY FAILED. Do not host this bundle."
    err "Either the bundle was tampered with or the verify script needs help."
    err "Open an issue at $REPO_URL/issues."
    exit 1
  fi
}

serve() {
  local doc_root="$REPO_DIR/dist/weareone-link.org"
  if [ ! -d "$doc_root" ]; then
    err "document root not found at $doc_root"
    exit 1
  fi
  info "serving $doc_root on http://localhost:$PORT"
  printf '\n%sopen %shttp://localhost:%s/%s in your browser%s\n' \
    "$C_DIM" "$C_BOLD" "$PORT" "$C_RESET$C_DIM" "$C_RESET"
  printf '%spress Ctrl+C to stop. Clone stays at ./%s/ for further hosting.%s\n\n' \
    "$C_DIM" "$REPO_DIR" "$C_RESET"
  cd "$doc_root"
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
}

main() {
  banner
  require_tool git
  require_tool python3
  clone_or_update
  verify_manifest
  serve
}

main "$@"
