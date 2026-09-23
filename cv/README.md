# cv — CV ATS de 1 página: Markdown → HTML → PDF

Genera el PDF de un CV escrito en Markdown restringido (4 secciones ancla ATS,
entradas `### Cargo | Empresa (Mes Año – Mes Año)`, viñetas `- **Etiqueta:** …`).
Los datos personales (encabezado) y los CVs viven en el vault privado; aquí solo
está el generador.

```bash
npm install
npm run cv -- "<vault>/cv/base/FullStack.md"          # → <carpeta del CV>/pdf/FullStack.pdf
npm run cv -- <cv.md> --html --out <carpeta>          # también deja el HTML
npm test
```

1. **Lint** con las reglas de la BASE: 4 anclas ATS en orden, fechas con mes y año
   en una línea, fechas fijas (MAZA = May 2024…), sin `ESTIMADA`, sin fechas de
   verificación, sin `[[marcadores]]`, sin "C1"; aviso sobre 8 viñetas de experiencia.
2. **Render** con la especificación de la plantilla: una columna, márgenes 1,27 cm,
   interlineado 1,2, Arial, azul `#0B5394` + negro puro, 17/11,5/9/11,5/10,5/10 pt.
3. **PDF** con el Chrome instalado (`playwright-core`, sin descargar navegadores):
   texto seleccionable; falla si no es **exactamente 1 página** y dice cuántas líneas
   sobran. También mide el Resumen (máximo 4 líneas).
