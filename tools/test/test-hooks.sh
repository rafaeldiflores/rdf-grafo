#!/usr/bin/env bash
# Prueba de punta a punta de install-hooks.sh, start.sh y end.sh en un entorno
# desechable: vault falso (con remoto "bare" para probar el push) y repo falso.
# No toca ningún repo real.   Uso: tools/test/test-hooks.sh
set -uo pipefail

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$(mktemp -d)"
TMP="$BASE/con espacio"   # las rutas reales tienen espacios ("Proyectos IT")
mkdir -p "$TMP"
trap 'rm -rf "$BASE"' EXIT
fails=0
ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }
g() { git -c user.name=test -c user.email=test@test -c commit.gpgsign=false "$@"; }
# end.sh commitea en el vault falso con el git de la máquina: sin esto, falla
# donde no hay identidad global (runners de CI).
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@test
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@test

# --- Vault falso con remoto ---------------------------------------------------
git init -q --bare "$TMP/vault-remote.git"
mkdir -p "$TMP/vault/proyectos"
cat > "$TMP/vault/proyectos/Demo.md" <<'EOF'
---
tipo: proyecto
stack: ["[[Angular]]"]
---
# Demo
Descripción.

## Bitácora
EOF
g -C "$TMP/vault" init -q -b main && g -C "$TMP/vault" add -A && g -C "$TMP/vault" commit -qm init
g -C "$TMP/vault" remote add origin "$TMP/vault-remote.git" && g -C "$TMP/vault" push -q -u origin main
FM_BEFORE="$(sed -n '1,4p' "$TMP/vault/proyectos/Demo.md")"

# --- Repo de proyecto falso ---------------------------------------------------
mkdir -p "$TMP/repo/.claude"
echo '{"dependencies":{"a":"1"}}' > "$TMP/repo/package.json"
echo '{ "permissions": { "allow": ["Bash(npm test)"] }, "model": "x" }' > "$TMP/repo/.claude/settings.local.json"
g -C "$TMP/repo" init -q -b main && g -C "$TMP/repo" add -A && g -C "$TMP/repo" commit -qm base

echo "install-hooks"
export GRAFO_VAULT="$TMP/vault"
bash "$TOOLS/install-hooks.sh" "$TMP/repo" Demo > /dev/null
S1="$(cat "$TMP/repo/.claude/settings.local.json" "$TMP/repo/.gitignore" | md5sum)"
bash "$TOOLS/install-hooks.sh" "$TMP/repo" Demo > /dev/null
S2="$(cat "$TMP/repo/.claude/settings.local.json" "$TMP/repo/.gitignore" | md5sum)"
check "idempotente (2 instalaciones = 1)" '[ "$S1" = "$S2" ]'
check "conserva claves previas del settings" 'grep -q "Bash(npm test)" "$TMP/repo/.claude/settings.local.json" && grep -q "\"model\"" "$TMP/repo/.claude/settings.local.json"'
check "un solo SessionStart y un solo SessionEnd" '[ "$(grep -c start.sh "$TMP/repo/.claude/settings.local.json")" = 1 ] && [ "$(grep -c end.sh "$TMP/repo/.claude/settings.local.json")" = 1 ]'
check "vault en additionalDirectories" 'grep -q additionalDirectories "$TMP/repo/.claude/settings.local.json"'
check ".session-start en .gitignore (una vez)" '[ "$(grep -cxF .claude/.session-start "$TMP/repo/.gitignore")" = 1 ]'
check "modo local ignora settings y scripts personales" 'grep -qxF .claude/settings.local.json "$TMP/repo/.gitignore" && grep -qxF .claude/hooks/ "$TMP/repo/.gitignore"'
check "comando /avance instalado" '[ -f "$TMP/repo/.claude/commands/avance.md" ]'
check "nota inexistente → error" '! bash "$TOOLS/install-hooks.sh" "$TMP/repo" NoExiste > /dev/null 2>&1'

export CLAUDE_PROJECT_DIR="$TMP/repo"
H="$TMP/repo/.claude/hooks"

echo "start.sh"
OUT="$(echo '{"reason":"startup"}' | bash "$H/start.sh")"
check "imprime la nota como contexto" 'grep -q "^# Demo" <<< "$OUT"'
check "guarda timestamp y commit de inicio" '[ "$(wc -l < "$TMP/repo/.claude/.session-start")" = 2 ]'
START1="$(cat "$TMP/repo/.claude/.session-start")"
echo '{"reason":"compact"}' | bash "$H/start.sh" > /dev/null
check "compact/resume no reinicia el punto de partida" '[ "$(cat "$TMP/repo/.claude/.session-start")" = "$START1" ]'

echo "end.sh sin commits"
VC="$(g -C "$TMP/vault" rev-list --count HEAD)"
echo '{"reason":"prompt_input_exit"}' | bash "$H/end.sh"
check "no toca la nota" '! grep -q "^### " "$TMP/vault/proyectos/Demo.md"'
check "no commitea el vault" '[ "$(g -C "$TMP/vault" rev-list --count HEAD)" = "$VC" ]'

echo "end.sh con commits"
echo x > "$TMP/repo/x.txt" && g -C "$TMP/repo" add -A && g -C "$TMP/repo" commit -qm "feat: primer cambio"
echo '{"dependencies":{"a":"1","@nueva/lib":"2"}}' > "$TMP/repo/package.json"
g -C "$TMP/repo" add -A && g -C "$TMP/repo" commit -qm "chore: agrega @nueva/lib"
echo '{"reason":"prompt_input_exit"}' | bash "$H/end.sh"
NOTE="$(cat "$TMP/vault/proyectos/Demo.md")"
check "registra los 2 commits bajo Bitácora" 'grep -q "primer cambio" <<< "$NOTE" && grep -q "agrega @nueva/lib" <<< "$NOTE"'
check "avisa dependencias nuevas" 'grep -q "Dependencias nuevas: @nueva/lib" <<< "$NOTE"'
check "frontmatter intacto" '[ "$(sed -n "1,4p" "$TMP/vault/proyectos/Demo.md")" = "$FM_BEFORE" ]'
check "commit en el vault" '[ "$(g -C "$TMP/vault" rev-list --count HEAD)" = "$((VC + 1))" ]'
check "push al remoto del vault" '[ "$(g -C "$TMP/vault" rev-parse HEAD)" = "$(g -C "$TMP/vault-remote.git" rev-parse main)" ]'

echo "end.sh repetido (resume/clear)"
echo '{"reason":"clear"}' | bash "$H/end.sh"
check "no duplica la entrada" '[ "$(grep -c "primer cambio" "$TMP/vault/proyectos/Demo.md")" = 1 ]'

echo "Bitácora que no es la última sección"
printf '\n## Links\n- algo\n' >> "$TMP/vault/proyectos/Demo.md"
echo y > "$TMP/repo/y.txt" && g -C "$TMP/repo" add -A && g -C "$TMP/repo" commit -qm "fix: tercero"
echo '{}' | bash "$H/end.sh"
check "inserta antes de la sección siguiente" 'awk "/tercero/{t=NR} /^## Links/{l=NR} END{exit !(t && l && t < l)}" "$TMP/vault/proyectos/Demo.md"'

echo
if [ "$fails" -eq 0 ]; then echo "Todo OK"; else echo "$fails prueba(s) fallaron"; exit 1; fi
