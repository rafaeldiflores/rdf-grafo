---
description: Registra en la Bitácora del vault las decisiones, cambios y pendientes de esta sesión
allowed-tools: Read, Edit, Bash(git:*), Bash(cat:*)
---

Registra el avance de esta sesión en la nota del proyecto en el vault de Rafa.

1. Lee `.claude/hooks/grafo.env`: `VAULT_PATH` es la ruta del vault y `NOTA_REL`
   la ruta de la nota dentro de él. Lee la nota completa.
2. Redacta, en español y con frases cortas, un resumen de ESTA sesión:
   - **Decisiones**: qué se decidió y **por qué** (alternativas descartadas si las hubo).
   - **Cambios**: qué se implementó o modificó (archivos o módulos, no diffs).
   - **Pendientes**: lo que quedó abierto o se acordó hacer después.
   Solo hechos de esta conversación; no inventes métricas ni resultados.
3. Agrégalo al final de la sección `## Bitácora` como una entrada nueva:
   ```
   ### AAAA-MM-DD HH:MM · /avance
   **Decisiones**
   - …
   **Cambios**
   - …
   **Pendientes**
   - …
   ```
   Si la sección no existe, créala al final. **No modifiques el frontmatter** ni
   el resto de la nota.
4. Si en la sesión se adoptó una tecnología que no está en el `stack` de la nota,
   menciónalo y pregunta antes de tocar el frontmatter.
5. Haz commit y push del vault solo de esa nota:
   `git -C "$VAULT_PATH" add -- "$NOTA_REL"`,
   `git -C "$VAULT_PATH" commit -m "bitácora(<nota>): avance de sesión" -- "$NOTA_REL"`,
   `git -C "$VAULT_PATH" push`.
6. Muestra la entrada que agregaste.
