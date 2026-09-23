#!/usr/bin/env bash
# SessionEnd — registra en la Bitácora de la nota los commits de la sesión.
#
# Si no hubo commits desde el inicio de la sesión, no hace nada. Si los hubo:
#   1. agrega una entrada fechada bajo "## Bitácora" (nunca toca el frontmatter),
#   2. avisa si cambiaron las dependencias (posibles tecnologías nuevas),
#   3. hace commit + push del vault (solo de esa nota).
# SessionEnd no puede bloquear el cierre y tiene tiempo limitado: el push tiene
# su propio timeout y cualquier error queda en .claude/hooks/grafo.log.
#
# Instalado por grafo/tools/install-hooks.sh. Config en .claude/hooks/grafo.env.
set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"
STATE="$REPO/.claude/.session-start"
LOG="$HOOK_DIR/grafo.log"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

cat > /dev/null # consume el JSON de stdin (no se usa)
# shellcheck source=/dev/null
source "$HOOK_DIR/grafo.env" 2>/dev/null || { log "falta grafo.env"; exit 0; }
[ -f "$STATE" ] || exit 0

start_ts="$(sed -n 1p "$STATE")"
start_sha="$(sed -n 2p "$STATE")"
head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || exit 0

# Rango de la sesión: por commit si el inicio es ancestro de HEAD (lo normal);
# si se cambió de rama o se reescribió historia, por fecha.
if [ -n "$start_sha" ] && git -C "$REPO" merge-base --is-ancestor "$start_sha" "$head" 2>/dev/null; then
  range=("$start_sha..$head")
else
  range=("--since=@$start_ts" "$head")
fi

commits="$(git -C "$REPO" log --reverse --no-merges --format='- `%h` %s' "${range[@]}")"
[ -n "$commits" ] || exit 0

# Dependencias agregadas en package.json (posibles tecnologías nuevas para `stack`).
deps=""
if [ -n "$start_sha" ] && git -C "$REPO" diff --quiet "$start_sha" "$head" -- package.json 2>/dev/null; then
  :
elif [ -n "$start_sha" ] && [ -f "$REPO/package.json" ]; then
  deps="$(cd "$REPO" && node -e '
    const read = (s) => { try { const p = JSON.parse(s); return new Set(Object.keys({ ...p.dependencies, ...p.devDependencies })); } catch { return new Set(); } };
    const [before, after] = [read(process.argv[1]), read(process.argv[2])];
    console.log([...after].filter((d) => !before.has(d)).join(", "));
  ' "$(git show "$start_sha:package.json" 2>/dev/null)" "$(cat package.json)" 2>/dev/null)"
fi

NOTE="$VAULT_PATH/$NOTA_REL"
[ -f "$NOTE" ] || { log "no existe la nota $NOTE"; exit 0; }

branch="$(git -C "$REPO" branch --show-current 2>/dev/null)"
entry="### $(date '+%Y-%m-%d %H:%M') · $(basename "$REPO")${branch:+ ($branch)}
$commits"
[ -n "$deps" ] && entry="$entry
- ⚠ Dependencias nuevas: $deps — ¿agregar al \`stack\` de la nota?"

# Inserta la entrada al final de la sección Bitácora (antes del siguiente "## "),
# o crea la sección al final del archivo si no existe. El frontmatter no se toca.
ENTRY="$entry" awk '
  BEGIN { entry = ENVIRON["ENTRY"] }
  /^## Bit(a|á)cora[[:space:]]*$/ { inb = 1; found = 1; print; next }
  inb && /^## / { print entry; print ""; inb = 0; done = 1 }
  { print }
  END {
    if (inb) { print ""; print entry }
    else if (!found) { print ""; print "## Bitácora"; print entry }
  }
' "$NOTE" > "$NOTE.tmp" && mv "$NOTE.tmp" "$NOTE"

# El punto de partida avanza: si la sesión se reanuda, no se repiten commits.
printf '%s\n%s\n' "$(date +%s)" "$head" > "$STATE"

n="$(printf '%s\n' "$commits" | wc -l | tr -d ' ')"
if git -C "$VAULT_PATH" add -- "$NOTA_REL" &&
   git -C "$VAULT_PATH" commit -q -m "bitácora($NOTA): $n commit(s) de $(basename "$REPO")" -- "$NOTA_REL"; then
  timeout 25 git -C "$VAULT_PATH" push -q 2>> "$LOG" || log "push del vault falló (quedó el commit local)"
else
  log "no se pudo commitear la nota en el vault"
fi
exit 0
