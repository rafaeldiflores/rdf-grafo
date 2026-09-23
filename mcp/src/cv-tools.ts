/**
 * Herramientas de CV y postulaciones para el MCP `grafo`.
 *
 * Lectura: BASE, CVs base, encabezado y postulaciones del vault.
 * Escritura ACOTADA (y nada más):
 *   - PDFs y su fuente .md, solo en  vault/cv/generados/
 *   - notas de postulación, solo en  vault/postulaciones/
 * Nunca escribe la BASE, los CVs base ni el encabezado. Todo nombre de archivo
 * se sanea y se verifica que la ruta final quede dentro de su carpeta.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { lintCv, type Hallazgo } from '../../cv/src/lint.ts';
import { parseCv, parseEncabezado } from '../../cv/src/parse.ts';
import { htmlAPdf } from '../../cv/src/pdf.ts';
import { renderHtml } from '../../cv/src/render.ts';
import { ESTADOS, fusionarPostulacion, hoy, leerPostulacion, nombreSeguro, rutaPostulacion, type PostulacionInput } from '../../cv/src/postulaciones.ts';

export { ESTADOS, hoy, nombreSeguro };

/** Ruta dentro de `carpeta`, o error si intenta salir de ella. */
function dentroDe(carpeta: string, archivo: string): string {
  const base = resolve(carpeta);
  const ruta = resolve(base, archivo);
  if (!ruta.startsWith(base + sep)) throw new Error(`Ruta fuera de ${base}`);
  return ruta;
}

export class CvStore {
  // Campo explícito (no "parameter property"): Node ejecuta TS solo quitando tipos.
  readonly vault: string;
  constructor(vault: string) {
    this.vault = vault;
  }

  private leer = (rel: string) => readFileSync(join(this.vault, rel), 'utf8');
  private encabezado = () => parseEncabezado(this.leer('cv/encabezado.md'));

  /** Todo lo que Claude necesita para adaptar un CV: BASE, CVs base y reglas. */
  contexto() {
    const enc = this.encabezado();
    const dir = join(this.vault, 'cv/base');
    const perfiles = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ perfil: f.replace(/\.md$/, ''), markdown: readFileSync(join(dir, f), 'utf8') }));
    return {
      base: this.leer('cv/BASE_Experiencia.md'),
      perfiles,
      reglas: { fechas_fijas: enc.fechas_fijas, nunca_incluir: enc.nunca_incluir, estados: ESTADOS },
    };
  }

  /** Lint + render + medición, sin escribir nada. Devuelve el HTML para la vista previa. */
  async validar(markdown: string) {
    const enc = this.encabezado();
    const cv = parseCv(markdown);
    const hallazgos: Hallazgo[] = lintCv(cv, enc);
    const html = renderHtml(cv, enc);
    const { paginas, lineasDeMas, lineasResumen } = await htmlAPdf(html, enc.papel);
    if (lineasResumen > 4) hallazgos.push({ nivel: 'aviso', regla: 'resumen', detalle: `El Resumen ocupa ${lineasResumen} líneas (máximo 4)` });
    if (paginas !== 1) hallazgos.push({ nivel: 'error', regla: 'una-pagina', detalle: `Ocupa ${paginas} páginas: sobran ~${lineasDeMas} líneas` });
    return { ok: !hallazgos.some((h) => h.nivel === 'error'), paginas, lineasDeMas, lineasResumen, hallazgos, html };
  }

  /** Genera el PDF SOLO si pasa todas las reglas y es 1 página. Escribe en cv/generados/. */
  async generarPdf(markdown: string, nombre: string) {
    const enc = this.encabezado();
    const cv = parseCv(markdown);
    const errores = lintCv(cv, enc).filter((h) => h.nivel === 'error');
    if (errores.length) throw new Error(`No se genera: ${errores.map((e) => e.detalle).join(' · ')}`);
    const { pdf, paginas, lineasDeMas } = await htmlAPdf(renderHtml(cv, enc), enc.papel);
    if (paginas !== 1) throw new Error(`No se genera: ocupa ${paginas} páginas (sobran ~${lineasDeMas} líneas)`);
    const dir = join(this.vault, 'cv/generados');
    mkdirSync(dir, { recursive: true });
    const base = nombreSeguro(nombre);
    const rutaPdf = dentroDe(dir, `${base}.pdf`);
    writeFileSync(dentroDe(dir, `${base}.md`), markdown);
    writeFileSync(rutaPdf, pdf);
    // base64: para que una interfaz sin acceso al disco (el artefacto) pueda ofrecer la descarga.
    return { pdf: rutaPdf, archivo: `${base}.pdf`, base64: pdf.toString('base64') };
  }

  /** Frontmatter de todas las postulaciones (para el Tracker del artefacto). */
  listarPostulaciones() {
    const dir = join(this.vault, 'postulaciones');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => leerPostulacion(f.slice(0, -'.md'.length), readFileSync(join(dir, f), 'utf8')))
      .filter((p): p is Record<string, unknown> => p !== null);
  }

  /**
   * Crea o actualiza una nota de postulación. Solo toca el frontmatter con los
   * campos recibidos; el cuerpo se conserva y `notas` se agrega al final con fecha.
   */
  guardarPostulacion(p: PostulacionInput) {
    const dir = join(this.vault, 'postulaciones');
    mkdirSync(dir, { recursive: true });
    const ruta = dentroDe(dir, rutaPostulacion(p.empresa, p.cargo).slice('postulaciones/'.length));
    const existe = existsSync(ruta);
    writeFileSync(ruta, fusionarPostulacion(existe ? readFileSync(ruta, 'utf8') : null, p));
    return { nota: ruta, creada: !existe };
  }
}
