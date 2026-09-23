#!/usr/bin/env bash
# Instala las skills de CV (/cv, /cv-check) a nivel de usuario de Claude Code,
# para usarlas desde cualquier carpeta (igual que el MCP `grafo`).
#
#   tools/install-skills.sh
#
# Copia tools/skills/<skill>/ en ~/.claude/skills/<skill>/ reemplazando {{VAULT}}
# por la ruta del vault de esta máquina (GRAFO_VAULT, o ../../vault).
# Destino: GRAFO_SKILLS_DIR, o $CLAUDE_CONFIG_DIR/skills, o ~/.claude/skills.
# Copia y no symlink: en Windows los symlinks exigen modo desarrollador, y la
# ruta del vault no debe quedar en el repo público. Tras editar una skill,
# volver a correrlo. Idempotente.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_DIR="$(cd "${GRAFO_VAULT:-$TOOLS_DIR/../../vault}" && { pwd -W 2> /dev/null || pwd; })"
DEST="${GRAFO_SKILLS_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills}"

[ -f "$VAULT_DIR/cv/BASE_Experiencia.md" ] ||
  { echo "✗ $VAULT_DIR no parece el vault (falta cv/BASE_Experiencia.md). Define GRAFO_VAULT."; exit 1; }

for src in "$TOOLS_DIR"/skills/*/; do
  name="$(basename "$src")"
  # El nombre de la carpeta es el comando: debe coincidir con `name:` del SKILL.md.
  grep -q "^name: $name$" "$src/SKILL.md" ||
    { echo "✗ $name/SKILL.md: falta 'name: $name' en el frontmatter."; exit 1; }
  mkdir -p "$DEST/$name"
  for f in "$src"*; do
    # | como separador: la ruta del vault trae barras.
    sed "s|{{VAULT}}|$VAULT_DIR|g" "$f" > "$DEST/$name/$(basename "$f")"
  done
  echo "✓ /$name → $DEST/$name"
done
