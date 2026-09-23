# tools — hooks de Claude Code conectados al vault

Instala en un repo de proyecto tres piezas que mantienen su nota del vault al día:

| Pieza | Evento | Qué hace |
|---|---|---|
| `.claude/hooks/start.sh` | `SessionStart` | Imprime la nota del proyecto (entra al contexto de Claude) y guarda el punto de partida de la sesión |
| `.claude/hooks/end.sh` | `SessionEnd` | Si hubo commits, los agrega bajo `## Bitácora` con fecha, avisa de dependencias nuevas y hace commit + push del vault |
| `.claude/commands/avance.md` | `/avance` | Resume decisiones (con su porqué), cambios y pendientes, y los agrega a la Bitácora |

```bash
tools/install-hooks.sh <ruta_repo> <nombre_nota>            # config en .claude/settings.local.json
tools/install-hooks.sh --shared <ruta_repo> <nombre_nota>   # o en .claude/settings.json (commiteado)
tools/test/test-hooks.sh                                     # prueba de punta a punta en un entorno desechable
```

- **Idempotente**: correrlo de nuevo no duplica hooks, permisos ni líneas del `.gitignore`.
- **Merge, no reemplazo**: conserva todo lo que ya tenga el `settings` del repo.
- **Sin rutas fijas**: el vault se toma de `GRAFO_VAULT` o de `../../vault`; los hooks usan `$CLAUDE_PROJECT_DIR`.
- `SessionEnd` tiene poco tiempo (1,5 s por defecto): se sube a 45 s y el push tiene su propio límite.
  Nunca bloquea el cierre; los errores quedan en `.claude/hooks/grafo.log`.
