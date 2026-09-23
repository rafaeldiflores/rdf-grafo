/**
 * npm run cv -- <cv.md> [--out <carpeta>] [--html] [--forzar] [--encabezado <archivo>]
 *
 * Genera el PDF de un CV escrito en el formato de src/parse.ts:
 *   1. valida las reglas (lint) — con errores no genera, salvo --forzar;
 *   2. renderiza el HTML con la plantilla ATS;
 *   3. exporta a PDF con Chrome y exige que sea UNA página.
 * El encabezado (nombre, contacto, links, fechas fijas) sale de
 * <vault>/cv/encabezado.md, o del archivo indicado con --encabezado.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintCv } from './lint.ts';
import { parseCv, parseEncabezado } from './parse.ts';
import { htmlAPdf } from './pdf.ts';
import { renderHtml } from './render.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    html: { type: 'boolean', default: false },
    forzar: { type: 'boolean', default: false },
    encabezado: { type: 'string' },
  },
});

const archivo = positionals[0];
if (!archivo) {
  console.error('Uso: npm run cv -- <cv.md> [--out <carpeta>] [--html] [--forzar]');
  process.exit(1);
}

const vault = resolve(process.env.VAULT_PATH ?? resolve(import.meta.dirname, '../../../vault'));
const enc = parseEncabezado(readFileSync(values.encabezado ?? join(vault, 'cv/encabezado.md'), 'utf8'));
const cv = parseCv(readFileSync(archivo, 'utf8'));

const hallazgos = lintCv(cv, enc);
for (const h of hallazgos) console.log(`${h.nivel === 'error' ? '✗' : '⚠'} [${h.regla}] ${h.detalle}`);
const errores = hallazgos.filter((h) => h.nivel === 'error').length;
if (errores && !values.forzar) {
  console.error(`\n${errores} error(es): no se generó el PDF (usa --forzar para generarlo igual).`);
  process.exit(1);
}

const html = renderHtml(cv, enc);
const outDir = resolve(values.out ?? join(dirname(archivo), 'pdf'));
mkdirSync(outDir, { recursive: true });
const nombre = basename(archivo).replace(/\.md$/i, '');
if (values.html) writeFileSync(join(outDir, `${nombre}.html`), html);

const { pdf, paginas, lineasDeMas, lineasResumen } = await htmlAPdf(html, enc.papel);
if (lineasResumen > 4) console.log(`⚠ [resumen] el Resumen ocupa ${lineasResumen} líneas (máximo 4)`);
const destino = join(outDir, `${nombre}.pdf`);
writeFileSync(destino, pdf);

if (paginas !== 1) {
  console.error(`✗ El PDF tiene ${paginas} páginas: sobran ~${lineasDeMas} líneas. Recorta viñetas (se borran, nunca se agregan).`);
  console.error(`  Guardado igual para revisión: ${destino}`);
  process.exit(1);
}
const holgura = -lineasDeMas;
console.log(`✓ ${destino}\n  1 página · ${holgura >= 0 ? `quedan ~${holgura} líneas libres` : 'justo'} · ${hallazgos.length ? `${hallazgos.length} aviso(s)` : 'sin avisos'}`);
