/**
 * Las 5 operaciones del Postulador sobre el vault remoto. Mismas reglas que el
 * MCP local (app/mcp/src/cv-tools.ts): el verificador, el render y las notas de
 * postulación vienen de app/cv; aquí solo cambia dónde se lee/escribe (GitHub)
 * y con qué se genera el PDF (Browser Run).
 */
import { lintCv, SECCIONES, type Hallazgo } from '../../cv/src/lint.ts';
import { parseCv, parseEncabezado } from '../../cv/src/parse.ts';
import { ESTADOS, fusionarPostulacion, leerPostulacion, nombreSeguro, rutaPostulacion, type PostulacionInput } from '../../cv/src/postulaciones.ts';
import { extraerInstrucciones, RUTA_INSTRUCCIONES } from '../../cv/src/instrucciones.ts';
import { renderHtml } from '../../cv/src/render.ts';
import { auditar } from '../../ingest/src/auditoria.ts';
import { brechasDe } from '../../ingest/src/brechas.ts';
import { addLogros, buildGraph } from '../../ingest/src/graph.ts';
import { parseLogros, RUTA_BASE } from '../../ingest/src/logros.ts';
import type { Graph } from '../../ingest/src/model.ts';
import { parseNote, type ParsedNote } from '../../ingest/src/parser.ts';
import { agregarSugerencias, type Embedder } from '../../ingest/src/sugerencias.ts';
import type { PdfNube } from './pdf.ts';
import { b64, type Vault } from './vault.ts';

export type Pdf = (html: string, papel: 'Letter' | 'A4') => Promise<PdfNube>;

export class Postulador {
  constructor(
    private readonly vault: Vault,
    private readonly pdf: Pdf,
    /** Opcional: sin él, `brechas` sigue funcionando solo con matching léxico. */
    private readonly embed?: Embedder,
  ) {}

  private async encabezado() {
    const raw = await this.vault.leer('cv/encabezado.md');
    if (!raw) throw new Error('Falta cv/encabezado.md en el vault');
    return parseEncabezado(raw);
  }

  async contexto() {
    const [enc, base, nombres, instrucciones] = await Promise.all([
      this.encabezado(),
      this.vault.leer('cv/BASE_Experiencia.md'),
      this.vault.listar('cv/base'),
      this.vault.leer(RUTA_INSTRUCCIONES),
    ]);
    const perfiles = await Promise.all(
      nombres.map(async (n) => ({ perfil: n.slice(0, -'.md'.length), markdown: (await this.vault.leer(`cv/base/${n}`)) ?? '' })),
    );
    return { base: base ?? '', perfiles, instrucciones: extraerInstrucciones(instrucciones), reglas: { titulo_profesional: enc.titulo_profesional, fechas_fijas: enc.fechas_fijas, nunca_incluir: enc.nunca_incluir, secciones: SECCIONES, estados: ESTADOS } };
  }

  async validar(markdown: string) {
    const enc = await this.encabezado();
    const cv = parseCv(markdown);
    const hallazgos: Hallazgo[] = lintCv(cv, enc);
    const html = renderHtml(cv, enc);
    const { paginas, lineasDeMas, lineasResumen } = await this.pdf(html, enc.papel);
    if (lineasResumen > 4) hallazgos.push({ nivel: 'aviso', regla: 'resumen', detalle: `El Resumen ocupa ${lineasResumen} líneas (máximo 4)` });
    if (paginas !== 1) hallazgos.push({ nivel: 'error', regla: 'una-pagina', detalle: `Ocupa ${paginas} páginas: sobran ~${lineasDeMas} líneas` });
    return { ok: !hallazgos.some((h) => h.nivel === 'error'), paginas, lineasDeMas, lineasResumen, hallazgos, html };
  }

  async generarPdf(markdown: string, nombre: string) {
    const enc = await this.encabezado();
    const cv = parseCv(markdown);
    const errores = lintCv(cv, enc).filter((h) => h.nivel === 'error');
    if (errores.length) throw new Error(`No se genera: ${errores.map((e) => e.detalle).join(' · ')}`);
    const { pdf, paginas, lineasDeMas } = await this.pdf(renderHtml(cv, enc), enc.papel);
    if (paginas !== 1) throw new Error(`No se genera: ocupa ${paginas} páginas (sobran ~${lineasDeMas} líneas)`);
    const base = nombreSeguro(nombre);
    await this.vault.escribir(`cv/generados/${base}.md`, markdown, `postulador: fuente de ${base}`);
    await this.vault.escribir(`cv/generados/${base}.pdf`, pdf, `postulador: PDF ${base}`);
    return { archivo: `${base}.pdf`, ruta: `cv/generados/${base}.pdf`, base64: b64.encode(pdf) };
  }

  /**
   * Grafo mínimo para brechas y auditoría: proyectos, tecnologías y aprendizajes
   * (solo frontmatter, ver Vault.frontmatters) + logros de la BASE. 4 subrequests.
   * `tecnologias` es id → "nombre + aliases" para la capa semántica de brechas.
   */
  private async grafo(): Promise<{ graph: Graph; tecnologias: Map<string, string> }> {
    const carpetas = ['proyectos', 'tecnologias', 'aprendizaje'] as const;
    const [base, ...notas] = await Promise.all([this.vault.leer(RUTA_BASE), ...carpetas.map((c) => this.vault.frontmatters(c))]);
    const parsed = notas.flatMap((xs, i) => xs.map((x) => parseNote(`${carpetas[i]}/${x.nombre}`, x.frontmatter))).filter((n): n is ParsedNote => n !== null);
    const { graph } = buildGraph(parsed);
    addLogros(graph, parseLogros(base ?? '').logros);
    const tecnologias = new Map(
      parsed
        .filter((n) => n.data.tipo === 'tecnologia')
        .map((n) => [n.id, [n.id, ...([n.data.aliases ?? []].flat().map(String))].join(' ')] as const),
    );
    return { graph, tecnologias };
  }

  /**
   * Qué pide una oferta frente a lo que el grafo respalda (ver ingest/src/brechas.ts).
   * Requisitos vacíos y oferta ausente son válidos: devuelve una lista vacía.
   * Con el binding AI disponible, suma sugerencias semánticas para lo que quede en
   * 'brecha' (ver ingest/src/sugerencias.ts); sin él o si falla, sigue solo con léxico.
   * `busqueda` declara si la capa semántica corrió de verdad ('hibrida') o no ('lexica').
   */
  async brechas(requisitos: string[] = [], oferta = '') {
    const { graph, tecnologias } = await this.grafo();
    const { requisitos: reqs, hibrida } = await agregarSugerencias(brechasDe(graph, requisitos, oferta), tecnologias, this.embed);
    const respaldadas = reqs.filter((r) => r.nivel === 'demostrada' || r.nivel === 'declarada' || r.nivel === 'mencionada').length;
    return { requisitos: reqs, cobertura: { respaldadas, total: reqs.length }, busqueda: hibrida ? ('hibrida' as const) : ('lexica' as const) };
  }

  /**
   * Auditoría de frescura sin repos locales: el Worker no ve los repos de los
   * proyectos, así que las reglas de versión quedan fuera y se dice explícitamente.
   */
  async auditar() {
    const [{ graph }, base, nombres] = await Promise.all([this.grafo(), this.vault.leer(RUTA_BASE), this.vault.listar('cv/base')]);
    const cvs = Object.fromEntries(await Promise.all(nombres.map(async (n) => [n.slice(0, -'.md'.length), (await this.vault.leer(`cv/base/${n}`)) ?? ''] as const)));
    const hallazgos = auditar({ graph, base: base ?? '', cvs, repos: {} }).map(({ donde: _d, ...h }) => h);
    return {
      hallazgos,
      omitidas: ['versión del proyecto vs su repo', 'versión mayor de cada tecnología vs la instalada'],
      nota: 'Las reglas de versión necesitan los repos locales: corren con `npm run auditar-cv` en el PC de Rafa.',
    };
  }

  async listarPostulaciones() {
    const nombres = await this.vault.listar('postulaciones');
    const notas = await Promise.all(nombres.map(async (n) => leerPostulacion(n.slice(0, -'.md'.length), (await this.vault.leer(`postulaciones/${n}`)) ?? '')));
    return notas.filter((p): p is Record<string, unknown> => p !== null);
  }

  async guardarPostulacion(p: PostulacionInput) {
    const ruta = rutaPostulacion(p.empresa, p.cargo);
    const previo = await this.vault.leer(ruta);
    const contenido = fusionarPostulacion(previo, p);
    await this.vault.escribir(ruta, contenido, `postulador: ${previo ? 'actualiza' : 'registra'} ${p.empresa} - ${p.cargo} (${p.estado})`);
    return { nota: ruta, creada: !previo };
  }
}
