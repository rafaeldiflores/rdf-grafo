---
name: cv-check
description: Revisa un CV de Rafa sin modificarlo — verificador ATS del MCP del grafo (1 página, título, fechas, vetos, secciones) más una revisión de hechos contra la BASE y, si hay oferta, cobertura de keywords. Úsala para "revisa este CV", "¿este CV está bien?" o antes de enviar uno. Argumento: ruta o nombre del CV (opcional) y oferta (opcional).
argument-hint: [ruta | nombre en cv/generados | perfil base] [oferta]
---

# /cv-check — revisión de un CV

Solo lectura: diagnostica y propone correcciones. No escribe nada salvo que Rafa
lo pida explícitamente después del informe.

## Herramientas

MCP local `grafo` (`mcp__grafo__cv_contexto`, `mcp__grafo__cv_validar`); si no
está, el conector remoto `postulador` (`mcp__claude_ai_postulador__*`). Sin
ninguno, detente y dilo.

## Qué CV

Según `$ARGUMENTS`:
- Una ruta a un `.md` → léelo.
- Un nombre o parte de él → búscalo en `{{VAULT}}/cv/generados/`.
- Un perfil (`FullStack`, `Mobile`, `Datos`, `IA_LLM`, `AIEngineer`…) → el CV
  base de `cv_contexto.perfiles`.
- Markdown pegado en el mensaje → ese.
- Nada → el `.md` más reciente de `{{VAULT}}/cv/generados/`; di cuál tomaste.

Solo se revisan CVs en el formato markdown de `app/cv`. Si es un PDF, busca su
`.md` hermano; si no existe, dilo.

Si además viene una oferta (texto o URL), se revisa también la cobertura.

## Revisión

1. **Verificador** — `cv_validar(markdown)`. Reporta `ok`, páginas,
   `lineasDeMas`, `lineasResumen` y cada hallazgo (error/aviso) tal cual. Es la
   regla dura: con un error no hay PDF.

2. **Hechos** — con `cv_contexto.base` (la BASE y sus REGLAS DE USO) y
   `cv_contexto.instrucciones`, recorre cada viñeta y el resumen:
   - ¿A qué logro `[id]` corresponde? Una afirmación sin logro que la respalde
     es un **error de hechos**.
   - ¿Cada cifra existe en ese logro? ¿Se imprimió alguna métrica ESTIMADA?
   - ¿Respeta el `contexto` del logro (lo que se puede y no se puede decir,
     p. ej. proyectos no desplegados) y las reglas de uso (cadenas canónicas,
     cifras que no se repiten, lo que nunca va en un CV, lo que nunca se omite
     en cierto perfil)?
   - Fechas, cargos y empresas coherentes con la BASE.
   El verificador no ve nada de esto: es lo que más vale de esta revisión.

3. **Redacción** — contra `instrucciones`: viñetas con verbo en pasado y
   tecnología concreta, cifra cuando la BASE la tiene, subtítulo con
   `titulo_profesional | cargo exacto (3-4 tecnologías)`, sin relleno.

4. **Oferta** (si la hay) — keywords de la oferta en forma literal: cubiertas,
   cubiertas con otra forma (sugerir la literal si la BASE lo respalda) y
   faltantes. Las faltantes que la BASE sí respalda son mejoras; las que no,
   brechas (no se rellenan).

## Informe

Breve, en este orden:
- **Veredicto** en una línea: listo para enviar / corregir antes / no enviar.
- **Verificador**: resultado y hallazgos.
- **Hechos**: tabla viñeta → `[id]` → ✓ o problema. Solo detalla las que fallan.
- **Redacción** y **Oferta**: solo lo accionable.
- **Correcciones**: cada una como texto actual → propuesto, citando el `[id]`.

Luego pregunta si aplicar las correcciones. Si Rafa dice que sí:
- CV de `cv/generados/`: edita su `.md`, vuelve a validar y, con OK,
  `cv_generar_pdf` con el mismo nombre (sobrescribe el PDF).
- CV base (`cv/base/`): son datos del vault; muestra el cambio y aplícalo solo
  con confirmación explícita de ese cambio.
- Nunca se edita `BASE_Experiencia.md` ni `encabezado.md`.
