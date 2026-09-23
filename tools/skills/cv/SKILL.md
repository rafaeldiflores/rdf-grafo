---
name: cv
description: Adapta el CV de Rafa a una oferta laboral con el MCP del grafo (BASE → CV → verificador ATS → PDF de 1 página → Tracker). Úsala cuando Rafa pegue una oferta, un link de oferta, o pida "hazme el CV para…". Argumento: el texto o la URL de la oferta.
argument-hint: <texto o URL de la oferta>
---

# /cv — CV adaptado a una oferta

Mismo flujo que el artefacto Postulador, pero conversado: Rafa revisa antes de
cada escritura. El código que valida y genera es el de `app/cv` (vía MCP), así
que un CV que sale de aquí cumple exactamente las mismas reglas.

## Herramientas

Usa el MCP local `grafo` (`mcp__grafo__cv_contexto`, `cv_validar`,
`cv_generar_pdf`, `postulacion_guardar`, `postulaciones_listar`). Si no está
disponible, usa el conector remoto `postulador` (`mcp__claude_ai_postulador__*`,
mismas herramientas y argumentos). Si no hay ninguno, detente y dilo: sin el
verificador no se entrega un CV.

## Pasos

1. **Oferta.** Usa `$ARGUMENTS`. Si es una URL, intenta leerla (WebFetch); si
   falla o no trae el texto completo (LinkedIn suele bloquear), pide a Rafa que
   pegue el texto. Sin argumento, pídela. Extrae: empresa, cargo **exacto** (tal
   cual lo escribe la oferta), área corta y las palabras clave (herramientas,
   lenguajes, metodologías, dominio) en su forma literal.

2. **Duplicados.** `postulaciones_listar`: si ya hay una nota para la misma
   empresa y un cargo equivalente, avisa (estado y fecha) y pregunta si seguir.

3. **Contexto.** `cv_contexto` devuelve `base` (BASE_Experiencia: única fuente
   de hechos, con sus REGLAS DE USO), `perfiles` (CVs base), `instrucciones`
   (reglas de redacción que Rafa edita en el vault) y `reglas` (título, fechas
   fijas, vetos, secciones). En `instrucciones` reemplaza `{TITULO}`, `{FECHAS}`
   y `{VETOS}` con los valores de `reglas`. Si `instrucciones` es null, dilo y
   guíate por las REGLAS DE USO de la BASE y el formato de los CVs base.
   Las reglas de la BASE y de `instrucciones` son obligatorias; no las repitas
   aquí de memoria: léelas cada vez (cambian).

4. **Perfil.** Elige el CV base que mejor calza (FullStack, Mobile, Datos,
   IA_LLM, AIEngineer…, según `perfiles`) y di en una línea por qué.

5. **Redacción.** Adapta ese CV base a la oferta:
   - Solo hechos de la BASE. Para cada viñeta ten claro de qué logro sale
     (`[id]`) y no uses cifras que la BASE no tenga para ese logro.
   - Respeta el formato y los estados que imponen la BASE y las instrucciones
     (métricas ESTIMADA, certificaciones en curso, proyectos no desplegados,
     cadenas canónicas, qué nunca va en un CV).
   - Palabras clave: la forma literal de la oferta cuando la BASE la respalda;
     nunca un término que la BASE no respalda.

6. **Verificar.** `cv_validar` con el markdown. Si hay errores o avisos
   (páginas, líneas de más, resumen > 4 líneas, > 8 viñetas), corrige y vuelve
   a validar. Para acortar se borran viñetas o palabras, nunca se agrega texto.
   Máximo ~4 vueltas; si no converge, muestra el problema y pregunta.

7. **Mostrar a Rafa** (no escribas nada todavía):
   - Perfil elegido, empresa y cargo.
   - El CV completo en un bloque de código markdown.
   - Resultado del verificador (1 página, líneas del resumen, avisos).
   - Trazabilidad: tabla viñeta → `[id]` de la BASE.
   - Keywords cubiertas / faltantes (`cubiertas/total`, %). Las faltantes son
     términos que la oferta pide y la BASE no respalda: brechas reales, no se
     rellenan.
   Pregunta si genera el PDF o qué ajustar. Itera los ajustes volviendo al paso 6.

8. **PDF** (solo con el OK). `cv_generar_pdf` con
   `nombre = CV_RDF_<Empresa>_<Cargo>_<AAAAMMDD>` (Empresa y Cargo sin tildes,
   no alfanuméricos → `_`, máx. 40 caracteres cada uno; fecha de hoy en Chile).
   Escribe el `.md` y el `.pdf` en `{{VAULT}}/cv/generados/` y rechaza el CV si no
   pasa el verificador. Informa la ruta.

9. **Tracker.** Pregunta estado (por defecto `Postulado`; `No enviada` si aún
   no postula), canal y próxima acción (sugiere seguimiento a 14 días). Luego
   `postulacion_guardar` con empresa, cargo, estado, area, fecha (hoy),
   canal, `cv_perfil`, `cv_pdf` (nombre del archivo), `keywords_cubiertas`
   (`"NN% (k1, k2, …)"`), `proxima_accion`, `proxima_fecha`, `url` (si hubo) y
   `notas` (brechas, en una línea).

10. **Vault.** Con el MCP local los archivos quedan sin commitear en el vault
    (`{{VAULT}}`).
    Muestra `git -C "{{VAULT}}" status --short` y ofrece commitear y pushear con
    mensajes `postulador: CV <nombre>` y `postulador: postulación <Empresa - Cargo>`.
    Solo con el OK de Rafa. (El conector remoto ya commitea solo.)

## Nunca

- Inventar, redondear hacia arriba ni "suavizar" un hecho; si falta un dato,
  preguntar.
- Editar `BASE_Experiencia.md`, `encabezado.md`, `instrucciones.md` ni los CVs
  base. Si un hecho nuevo debería estar en la BASE, proponerlo; lo escribe Rafa.
- Generar el PDF o registrar la postulación sin confirmación.
