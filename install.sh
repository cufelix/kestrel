#!/usr/bin/env bash
# Kestrel — an autonomous desktop agent that learns.
#
# Installs the agent and the desktop layer it drives, and puts `kestrel` on
# your PATH. Nothing here needs root except the system packages, and it says
# which ones before asking.
set -euo pipefail

BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; OFF=$'\e[0m'
say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$BOLD" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${KESTREL_BIN:-$HOME/.local/bin}"

step "Checking what is here"

if ! command -v bun >/dev/null 2>&1; then
  warn "bun is not installed — it is what Kestrel runs on"
  say "  ${DIM}curl -fsSL https://bun.sh/install | bash${OFF}"
  exit 1
fi
ok "bun $(bun --version)"

# The hands. A Linux desktop agent needs X11, an accessibility bridge, OCR and
# a screen it can have to itself; those live in a Python package.
if command -v lai >/dev/null 2>&1; then
  ok "desktop layer $(lai --version 2>/dev/null || echo present)"
else
  warn "the desktop layer is not installed — Kestrel will run without hands"
  say "  ${DIM}pipx install 'lai[tui,mcp] @ git+https://github.com/cufelix/lai.git'${OFF}"
  say "  ${DIM}or: pip install --user 'lai[tui,mcp] @ git+https://github.com/cufelix/lai.git'${OFF}"
fi

step "Installing dependencies"
(cd "$ROOT" && bun install >/dev/null)
ok "dependencies installed"

step "Putting kestrel on your PATH"
mkdir -p "$BIN"
ln -sf "$ROOT/bin/kestrel" "$BIN/kestrel"
ok "$BIN/kestrel"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN is not on your PATH — add it to your shell profile" ;;
esac

step "Checking it runs"
if "$BIN/kestrel" --version >/dev/null 2>&1; then
  ok "kestrel runs"
else
  warn "kestrel did not start cleanly; run it directly to see why"
fi

say ""
say "${BOLD}Kestrel is installed.${OFF}"
say ""
say "  ${DIM}kestrel${OFF}                        talk to it"
say "  ${DIM}kestrel run \"open the calculator and work out 45 + 78\"${OFF}"
say "  ${DIM}kestrel serve${OFF}                  the same agent over HTTP"
say ""
say "It works on a desktop of its own, so it never takes your mouse. Set"
say "${DIM}KESTREL_SCREEN=here${OFF} to put it on yours instead."
