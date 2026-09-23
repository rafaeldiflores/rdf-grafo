#!/usr/bin/env bash
# SessionStart — carga la nota del vault como contexto de la sesión.
#
# Todo lo que este script imprime por stdout entra al contexto de Claude.
# Además guarda el momento de inicio (timestamp + commit) para que end.sh sepa
# qué commits se hicieron durante la sesión.
#
# Instalado por grafo/tools/install-hooks.sh. Config en .claude/hooks/grafo.env.
set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"
STATE="$REPO/.claude/.session-start"

# shellcheck source=/dev/null
if ! source "$HOOK_DIR/grafo.env" 2>/dev/null; then
  echo "[grafo] Falta .claude/hooks/grafo.env: reinstala con tools/install-hooks.sh."
  exit 0
fi

# Motivo del inicio (startup | resume | clear | compact | fork), del JSON en stdin.
input="$(cat)"
reason="$(printf '%s' "$input" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')"

# Solo una sesión NUEVA reinicia el punto de partida. Al reanudar o compactar se
# conserva, para no perder los commits hechos antes en la misma sesión.
if [ "$reason" = "startup" ] || [ ! -f "$STATE" ]; then
  head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
  printf '%s\n%s\n' "$(date +%s)" "$head" > "$STATE"
fi

NOTE="$VAULT_PATH/$NOTA_REL"
if [ ! -f "$NOTE" ]; then
  echo "[grafo] No encuentro la nota \"$NOTA\" en $NOTE."
  exit 0
fi

echo "# Contexto del proyecto (nota \"$NOTA\" del vault de Rafa)"
echo
echo "Fuente de verdad del proyecto: stack, relaciones y Bitácora. Si durante la"
echo "sesión cambian tecnologías o decisiones importantes, sugiere correr /avance."
echo "No edites el frontmatter de la nota sin preguntar."
echo
echo '```markdown'
cat "$NOTE"
echo '```'
exit 0
