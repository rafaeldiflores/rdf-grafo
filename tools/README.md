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

## Skills de CV: `/cv` y `/cv-check`

Skills de Claude Code a nivel de usuario (sirven desde cualquier carpeta, como el MCP `grafo`):

| Skill | Qué hace |
|---|---|
| `/cv <oferta>` | Oferta → perfil base → CV con hechos de la BASE → `cv_validar` hasta 1 página → revisión de Rafa → PDF → nota en el Tracker → commit del vault (cada escritura con OK) |
| `/cv-check [cv] [oferta]` | Solo lectura: verificador ATS + revisión de cada viñeta contra su logro `[id]` de la BASE + cobertura de keywords; propone correcciones |

```bash
tools/install-skills.sh           # copia tools/skills/* a ~/.claude/skills/ (volver a correrlo tras editar)
tools/test/test-skills.sh         # instalación en carpetas desechables
```

- Las reglas de contenido **no** están en las skills: se leen cada vez desde la BASE y
  `cv/instrucciones.md` (vía `cv_contexto`), y el verificador (`app/cv/src/lint.ts`) sigue mandando.
- `{{VAULT}}` se reemplaza al instalar (`GRAFO_VAULT` o `../../vault`): la ruta local no queda en el repo.
- Usan el MCP local `grafo`; si no está, el conector remoto `postulador`.
