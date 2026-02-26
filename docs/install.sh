#!/usr/bin/env bash
set -euo pipefail

# ── nupo installer ────────────────────────────────────────────────────────────
NUPO_PACKAGE="@y4wee/nupo"
NODE_MIN_MAJOR=18
NVM_VERSION="v0.39.7"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
PROFILE_UPDATED=0

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

# ── nvm ───────────────────────────────────────────────────────────────────────

load_nvm() {
  export NVM_DIR
  set +u  # nvm utilise des variables potentiellement non définies
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  set -u
}

install_nvm() {
  info "Installation de nvm ${NVM_VERSION}…"
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  load_nvm
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

  set +u
  nvm install --lts
  nvm use --lts
  set -u
  success "Node.js $(node --version) installé"
}

# ── npm global prefix (sans sudo) ─────────────────────────────────────────────

ensure_no_sudo_npm() {
  local prefix
  prefix=$(npm config get prefix 2>/dev/null || true)

  if echo "$prefix" | grep -q '^/usr'; then
    warn "npm global prefix nécessite sudo — redirection vers ~/.npm-global"
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"
  fi
}

# ── PATH persistence ──────────────────────────────────────────────────────────

add_to_profiles() {
  local bin_dir="$1"
  local export_line="export PATH=\"$bin_dir:\$PATH\""
  local profiles=()

  [ -f "$HOME/.zshrc" ]        && profiles+=("$HOME/.zshrc")
  [ -f "$HOME/.bashrc" ]       && profiles+=("$HOME/.bashrc")
  [ -f "$HOME/.bash_profile" ] && profiles+=("$HOME/.bash_profile")

  # Fallback si aucun profil trouvé
  if [ ${#profiles[@]} -eq 0 ]; then
    profiles+=("$HOME/.profile")
  fi

  for profile in "${profiles[@]}"; do
    if ! grep -qF "$bin_dir" "$profile" 2>/dev/null; then
      printf '\n# nupo — ajouté par install.sh\n%s\n' "$export_line" >> "$profile"
      info "PATH ($bin_dir) ajouté dans $profile"
      PROFILE_UPDATED=1
    fi
  done
}

ensure_bin_in_path() {
  local npm_bin
  npm_bin="$(npm prefix -g)/bin"

  # Disponible dans la session courante
  export PATH="$npm_bin:$PATH"

  # Persister dans les profils shell pour les futures sessions
  add_to_profiles "$npm_bin"
}

# ── Install nupo ──────────────────────────────────────────────────────────────

install_nupo() {
  info "Installation de nupo…"
  npm install -g "$NUPO_PACKAGE"

  # S'assurer que le bin est dans PATH avant de tester la commande
  ensure_bin_in_path

  if command -v nupo &>/dev/null; then
    success "nupo installé dans $(command -v nupo)"
  else
    warn "nupo installé mais introuvable dans PATH — redémarrez votre terminal"
  fi
}

# ── Fin ───────────────────────────────────────────────────────────────────────

print_next_steps() {
  echo ""
  bold "nupo est installé !"
  echo ""
  info "Lance nupo avec : nupo"
  echo ""
  if [ "$PROFILE_UPDATED" -eq 1 ]; then
    warn "Rechargez votre shell pour appliquer les changements de PATH :"
    warn "  source ~/.zshrc   (zsh)"
    warn "  source ~/.bashrc  (bash)"
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
  ensure_no_sudo_npm
  install_nupo
  print_next_steps
}

main "$@"
