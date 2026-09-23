/**
 * CV → HTML con la especificación ATS de Rafa (SKILL ats-cv-generator §1):
 * una columna, márgenes de 1,27 cm, interlineado 1,2, sin espacio entre
 * párrafos, paleta de alto contraste (azul #0B5394 y negro puro, sin grises),
 * Arial. Tamaños: nombre 17 pt · subtítulo 11,5 · contacto 9 · secciones 11,5 ·
 * cargos 10,5 · cuerpo 10.
 */
import type { Cv, Encabezado } from './parse.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Solo **negrita**; el resto se escapa. */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export const AZUL = '#0B5394';

export const CSS = (papel: 'Letter' | 'A4') => `
@page { size: ${papel}; margin: 1.27cm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.2; color: #000; background: #fff; }
h1 { font-size: 17pt; font-weight: bold; text-align: center; }
.subtitulo { font-size: 11.5pt; font-weight: bold; text-align: center; color: ${AZUL}; margin-top: 2pt; }
.contacto { font-size: 9pt; text-align: center; margin-top: 2pt; }
.contacto a { color: #000; text-decoration: none; }
hr { border: 0; border-top: 1.2pt solid ${AZUL}; margin: 5pt 0 0; }
h2 { font-size: 11.5pt; font-weight: bold; text-transform: uppercase; color: ${AZUL}; margin-top: 7pt; margin-bottom: 2pt; }
h3 { font-size: 10.5pt; font-weight: bold; margin-top: 4pt; }
p { text-align: justify; }
ul { padding-left: 12pt; }
li { margin: 0; }
li + li { margin-top: 1pt; }
`;

export function renderHtml(cv: Cv, enc: Encabezado): string {
  const contacto = [enc.ubicacion, enc.telefono, `<a href="mailto:${esc(enc.email)}">${esc(enc.email)}</a>`].join(' · ');
  const links = enc.links
    .map((l) => `${esc(l.etiqueta)}: <a href="${esc(l.url.startsWith('http') ? l.url : `https://${l.url}`)}">${esc(l.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`)
    .join(' · ');

  const secciones = cv.secciones
    .map((s) => {
      const parrafos = s.parrafos.map((p) => `<p>${inline(p)}</p>`).join('');
      const vinetas = s.vinetas.length ? `<ul>${s.vinetas.map((v) => `<li>${inline(v)}</li>`).join('')}</ul>` : '';
      const entradas = s.entradas
        .map((e) => `<h3>${inline(e.titulo)}</h3>${e.vinetas.length ? `<ul>${e.vinetas.map((v) => `<li>${inline(v)}</li>`).join('')}</ul>` : ''}`)
        .join('');
      return `<section><h2>${inline(s.titulo)}</h2>${parrafos}${vinetas}${entradas}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${esc(enc.nombre)} — ${esc(cv.titulo)}</title>
<style>${CSS(enc.papel)}</style></head>
<body>
<h1>${esc(enc.nombre)}</h1>
<div class="subtitulo">${inline(cv.titulo)}</div>
<div class="contacto">${contacto}</div>
${links ? `<div class="contacto">${links}</div>` : ''}
<hr>
${secciones}
</body></html>`;
}
