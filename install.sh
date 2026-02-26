#!/usr/bin/env bash
set -euo pipefail

# ── nupo installer ────────────────────────────────────────────────────────────
NUPO_PACKAGE="@y4wee/nupo"
NODE_MIN_MAJOR=18
NVM_VERSION="v0.39.7"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# ── Helpers ───────────────────────────────────────────────────────────────────

bold()    { printf '\033[1m%s\033[0m\n' "$*"; }
info()    { printf '  \033[34m•\033[0m %s\n' "$*"; }
success() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()    { printf '  \033[33m!\033[0m %s\n' "$*"; }
error()   { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
die()     { error "$*"; exit 1; }

# ── OS detection ──────────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      die "Système non supporté : $(uname -s)" ;;
  esac
}

# ── Node.js version check ─────────────────────────────────────────────────────

node_major_version() {
  node --version 2>/dev/null | sed 's/v//' | cut -d. -f1
}

has_node() {
  command -v node &>/dev/null
}

node_is_recent_enough() {
  has_node || return 1
  local major
  major=$(node_major_version)
  [[ "$major" -ge "$NODE_MIN_MAJOR" ]] 2>/dev/null
}

# ── nvm install ───────────────────────────────────────────────────────────────

install_nvm() {
  info "Installation de nvm ${NVM_VERSION}…"
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash

  # Source nvm for the current shell session
  export NVM_DIR
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}

load_nvm() {
  export NVM_DIR
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
}

ensure_node() {
  if node_is_recent_enough; then
    success "Node.js $(node --version) détecté"
    return
  fi

  warn "Node.js >= ${NODE_MIN_MAJOR} requis (trouvé : $(has_node && node --version || echo 'absent'))"
  info "Installation de Node.js via nvm…"

  if [ ! -d "$NVM_DIR" ]; then
    install_nvm
  else
    load_nvm
  fi

  if ! command -v nvm &>/dev/null; then
    die "nvm introuvable après installation. Relancez votre terminal et réessayez."
  fi

  nvm install --lts
  nvm use --lts
  success "Node.js $(node --version) installé"
}

# ── npm global prefix (sans sudo) ─────────────────────────────────────────────

ensure_npm_prefix() {
  # If npm global would require sudo, redirect to ~/.npm-global
  if npm config get prefix 2>/dev/null | grep -q '^/usr'; then
    warn "npm global prefix nécessite sudo — redirection vers ~/.npm-global"
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"

    local profile=""
    if [ -f "$HOME/.zshrc" ]; then
      profile="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      profile="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
      profile="$HOME/.bash_profile"
    fi

    if [ -n "$profile" ]; then
      local export_line='export PATH="$HOME/.npm-global/bin:$PATH"'
      if ! grep -qF "$export_line" "$profile"; then
        printf '\n# npm global (nupo)\n%s\n' "$export_line" >> "$profile"
        info "PATH mis à jour dans $profile"
      fi
    fi

    export PATH="$HOME/.npm-global/bin:$PATH"
  fi
}

# ── Install nupo ──────────────────────────────────────────────────────────────

install_nupo() {
  info "Installation de nupo…"
  npm install -g "$NUPO_PACKAGE"
  success "nupo $(nupo --version 2>/dev/null || true) installé"
}

# ── Shell profile reload hint ─────────────────────────────────────────────────

print_next_steps() {
  echo ""
  bold "nupo est installé !"
  echo ""
  info "Lance nupo avec : nupo"
  echo ""
  if [ -n "${PROFILE_UPDATED:-}" ]; then
    warn "Rechargez votre shell ou lancez : source ~/.zshrc  (ou ~/.bashrc)"
    echo ""
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  bold "═══════════════════════════════════"
  bold "       Installation de nupo        "
  bold "═══════════════════════════════════"
  echo ""

  local os
  os=$(detect_os)
  info "Plateforme : $os ($(uname -m))"

  ensure_node
  ensure_npm_prefix
  install_nupo
  print_next_steps
}

main "$@"
