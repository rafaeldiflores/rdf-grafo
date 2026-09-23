#!/usr/bin/env bash
# Prueba install-skills.sh en carpetas desechables: instala, reemplaza {{VAULT}},
# es idempotente y rechaza un vault inválido.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "✗ $1"; exit 1; }

mkdir -p "$TMP/vault/cv" && touch "$TMP/vault/cv/BASE_Experiencia.md"
export GRAFO_VAULT="$TMP/vault" GRAFO_SKILLS_DIR="$TMP/skills"

"$TOOLS_DIR/install-skills.sh" > /dev/null
for s in cv cv-check; do
  f="$TMP/skills/$s/SKILL.md"
  [ -f "$f" ] || fail "no se instaló /$s"
  grep -q '{{VAULT}}' "$f" && fail "/$s conserva {{VAULT}}"
  head -1 "$f" | grep -q '^---$' || fail "/$s sin frontmatter"
  grep -q "^name: $s$" "$f" || fail "/$s: name incorrecto"
  grep -q '^description: .\{40,\}' "$f" || fail "/$s: description vacía o muy corta"
done
grep -q "cv/generados" "$TMP/skills/cv-check/SKILL.md" || fail "cv-check sin ruta de generados"

first="$(cat "$TMP/skills/cv/SKILL.md")"
"$TOOLS_DIR/install-skills.sh" > /dev/null
[ "$first" = "$(cat "$TMP/skills/cv/SKILL.md")" ] || fail "no es idempotente"

GRAFO_VAULT="$TMP" "$TOOLS_DIR/install-skills.sh" > /dev/null 2>&1 && fail "aceptó un vault sin BASE"

echo "✓ install-skills: 4 comprobaciones OK"
