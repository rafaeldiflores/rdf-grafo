#!/usr/bin/env bash
# Instala en un repo de proyecto los hooks de Claude Code conectados al vault.
#
#   tools/install-hooks.sh [--shared] <ruta_repo> <nombre_nota>
#
#   <ruta_repo>    repo de git del proyecto (p. ej. ".../Maza/Maza-app")
#   <nombre_nota>  nombre de la nota en el vault, sin .md (p. ej. "MAZA")
#   --shared       escribe en .claude/settings.json (se commitea) en vez de
#                  .claude/settings.local.json (personal, recomendado: la
#                  config lleva la ruta absoluta del vault de esta máquina)
#
# Ruta del vault: variable GRAFO_VAULT, o ../../vault (estructura Grafo/{app,vault}).
# Idempotente: correrlo varias veces deja el mismo resultado.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_NAME="settings.local.json"
if [ "${1:-}" = "--shared" ]; then SETTINGS_NAME="settings.json"; shift; fi

if [ $# -ne 2 ]; then
  sed -n '4,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

REPO="$(cd "$1" && pwd)"
NOTA="$2"
VAULT="$(cd "${GRAFO_VAULT:-$TOOLS_DIR/../../vault}" && pwd)"

git -C "$REPO" rev-parse --is-inside-work-tree > /dev/null 2>&1 ||
  { echo "✗ $REPO no es un repo de git (los hooks registran commits)."; exit 1; }
command -v node > /dev/null || { echo "✗ Se necesita Node.js para fusionar settings."; exit 1; }

# Busca la nota por nombre en todo el vault (fuera de carpetas ocultas y plantillas).
mapfile -t found < <(cd "$VAULT" && find . -path ./.git -prune -o -path ./.obsidian -prune -o -path ./_plantillas -prune \
  -o -type f -name "$NOTA.md" -print | sed 's|^\./||')
if [ "${#found[@]}" -ne 1 ]; then
  echo "✗ Se esperaba exactamente una nota \"$NOTA.md\" en $VAULT y hay ${#found[@]}."
  exit 1
fi
NOTA_REL="${found[0]}"

mkdir -p "$REPO/.claude/hooks" "$REPO/.claude/commands"

# Scripts y comando: se copian siempre (idempotente: mismo contenido).
cp "$TOOLS_DIR/plantillas/hooks/start.sh" "$TOOLS_DIR/plantillas/hooks/end.sh" "$REPO/.claude/hooks/"
chmod +x "$REPO/.claude/hooks/start.sh" "$REPO/.claude/hooks/end.sh"
cp "$TOOLS_DIR/plantillas/commands/avance.md" "$REPO/.claude/commands/avance.md"

# Config de esta máquina (rutas absolutas): se regenera en cada instalación.
{
  echo "# Generado por grafo/tools/install-hooks.sh — específico de esta máquina."
  printf 'VAULT_PATH="%s"\n' "$VAULT"
  printf 'NOTA="%s"\n' "$NOTA"
  printf 'NOTA_REL="%s"\n' "$NOTA_REL"
} > "$REPO/.claude/hooks/grafo.env"

# En Windows Claude Code espera rutas tipo C:/...; en Linux/macOS cygpath no existe.
VAULT_NATIVE="$(cygpath -m "$VAULT" 2>/dev/null || echo "$VAULT")"
node "$TOOLS_DIR/lib/merge-settings.mjs" "$REPO/.claude/$SETTINGS_NAME" "$VAULT_NATIVE"

# .gitignore: estado de sesión, config local y log. En modo local (por defecto)
# también los scripts y el settings personal: llevan rutas de esta máquina y no
# deben commitearse por accidente. Solo agrega lo que falte.
IGNORE="$REPO/.gitignore"
touch "$IGNORE"
lines=(".claude/.session-start" ".claude/hooks/grafo.env" ".claude/hooks/grafo.log")
if [ "$SETTINGS_NAME" = "settings.local.json" ]; then
  lines+=(".claude/settings.local.json" ".claude/hooks/" ".claude/commands/avance.md")
fi
added=0
for line in "${lines[@]}"; do
  if ! grep -qxF "$line" "$IGNORE"; then
    [ "$added" -eq 0 ] && { [ -s "$IGNORE" ] && [ -n "$(tail -c1 "$IGNORE")" ] && echo >> "$IGNORE"; echo "# Hooks del grafo (Claude Code)" >> "$IGNORE"; }
    echo "$line" >> "$IGNORE"
    added=1
  fi
done

echo "✓ Hooks instalados en $REPO"
echo "  nota: $NOTA_REL  ·  vault: $VAULT  ·  settings: .claude/$SETTINGS_NAME"
