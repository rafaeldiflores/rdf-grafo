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
import matter from 'gray-matter';
import { lintCv, type Hallazgo } from '../../cv/src/lint.ts';
import { parseCv, parseEncabezado } from '../../cv/src/parse.ts';
import { htmlAPdf } from '../../cv/src/pdf.ts';
import { renderHtml } from '../../cv/src/render.ts';

/** Fecha de hoy (AAAA-MM-DD) en Chile: en UTC, de noche ya sería mañana. */
export const hoy = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

export const ESTADOS = ['Postulado', 'Contacto', 'Prueba tecnica', 'Entrevista', 'Oferta', 'Descartado', 'No enviada'] as const;

/** Nombre de archivo válido en Windows, sin rutas ni caracteres raros. */
export function nombreSeguro(s: string): string {
  const limpio = s
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 120)
    .trim();
  if (!limpio) throw new Error('Nombre vacío');
  return limpio;
}

/** Ruta dentro de `carpeta`, o error si intenta salir de ella. */
function dentroDe(carpeta: string, archivo: string): string {
  const base = resolve(carpeta);
  const ruta = resolve(base, archivo);
  if (!ruta.startsWith(base + sep)) throw new Error(`Ruta fuera de ${base}`);
  return ruta;
}

export class CvStore {
  constructor(readonly vault: string) {}

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
    return { pdf: rutaPdf, archivo: `${base}.pdf` };
  }

  /** Frontmatter de todas las postulaciones (para el Tracker del artefacto). */
  listarPostulaciones() {
    const dir = join(this.vault, 'postulaciones');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const { data } = matter(readFileSync(join(dir, f), 'utf8'), {});
        return { nota: f.replace(/\.md$/, ''), ...data } as Record<string, unknown>;
      })
      .filter((p) => p.tipo === 'postulacion')
      .map(({ tipo: _t, visibilidad: _v, ...rest }) => {
        // Fechas YAML → texto ISO (día).
        for (const [k, v] of Object.entries(rest)) if (v instanceof Date) rest[k] = v.toISOString().slice(0, 10);
        return rest;
      });
  }

  /**
   * Crea o actualiza una nota de postulación. Solo toca el frontmatter con los
   * campos recibidos; el cuerpo se conserva y `notas` se agrega al final con fecha.
   */
  guardarPostulacion(p: {
    empresa: string;
    cargo: string;
    estado: (typeof ESTADOS)[number];
    area?: string;
    fecha?: string;
    canal?: string;
    cv_perfil?: string;
    cv_pdf?: string;
    keywords_cubiertas?: string;
    proxima_accion?: string;
    proxima_fecha?: string;
    motivo_descarte?: string;
    url?: string;
    notas?: string;
  }) {
    if (!ESTADOS.includes(p.estado)) throw new Error(`Estado inválido: ${p.estado}`);
    for (const f of ['fecha', 'proxima_fecha'] as const) {
      if (p[f] && !/^\d{4}-\d{2}-\d{2}$/.test(p[f]!)) throw new Error(`${f} debe ser AAAA-MM-DD`);
    }
    const dir = join(this.vault, 'postulaciones');
    mkdirSync(dir, { recursive: true });
    const ruta = dentroDe(dir, `${nombreSeguro(`${p.empresa} - ${p.cargo}`)}.md`);
    const existe = existsSync(ruta);
    const previo = existe ? matter(readFileSync(ruta, 'utf8'), {}) : { data: {}, content: `# ${p.cargo} — ${p.empresa}\n` };
    const { notas, ...campos } = p;
    const data: Record<string, unknown> = { tipo: 'postulacion', visibilidad: 'privado', ...previo.data };
    // gray-matter lee las fechas YAML como Date y las reescribiría como timestamp completo.
    for (const [k, v] of Object.entries(data)) if (v instanceof Date) data[k] = v.toISOString().slice(0, 10);
    for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== '') data[k] = v;
    if (!data.fecha) data.fecha = hoy();
    // Nunca pública, aunque el frontmatter previo dijera otra cosa.
    data.tipo = 'postulacion';
    data.visibilidad = 'privado';
    let content = previo.content.replace(/\s+$/, '') + '\n';
    if (notas?.trim()) content += `\n- ${hoy()}: ${notas.trim()}\n`;
    writeFileSync(ruta, matter.stringify(content, data));
    return { nota: ruta, creada: !existe };
  }
}
