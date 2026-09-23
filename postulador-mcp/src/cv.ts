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
import type { PdfNube } from './pdf.ts';
import { b64, type Vault } from './vault.ts';

export type Pdf = (html: string, papel: 'Letter' | 'A4') => Promise<PdfNube>;

export class Postulador {
  constructor(
    private readonly vault: Vault,
    private readonly pdf: Pdf,
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
