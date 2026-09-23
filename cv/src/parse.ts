/**
 * Formato de un CV (Markdown restringido, pensado para ATS):
 *
 *   ---
 *   titulo: "Ingeniero en Informática | Desarrollador Full-Stack (…)"
 *   perfil: FullStack            # opcional, solo informativo
 *   ---
 *   ## RESUMEN PROFESIONAL
 *   Párrafo…
 *   ## HABILIDADES TÉCNICAS
 *   - **Frontend & Mobile:** TypeScript, Angular 22…
 *   ## EXPERIENCIA / PROYECTOS EN DESARROLLO FULL-STACK
 *   ### Fundador y Desarrollador Principal | MAZA (SaaS de Gestión) (May 2024 – Presente)
 *   - **Etiqueta:** Verbo + tecnología + resultado.
 *   ## EDUCACIÓN Y CERTIFICACIONES
 *   ### Ingeniería en Informática | Instituto Profesional Duoc UC (Mar 2021 – Dic 2025)
 *   - **Estado:** Titulado…
 *
 * Solo se admite esto: secciones (##), entradas (###), viñetas (-), párrafos y
 * **negrita**. Así el HTML resultante es siempre de una columna y lineal.
 */
import matter from 'gray-matter';

export interface Encabezado {
  nombre: string;
  ubicacion: string;
  telefono: string;
  email: string;
  links: { etiqueta: string; url: string }[];
  /** Fechas de inicio que deben coincidir en todos los CVs, p. ej. { MAZA: "May 2024" }. */
  fechas_fijas: Record<string, string>;
  /** Textos que jamás pueden aparecer en un CV (p. ej. proyectos que no se muestran). */
  nunca_incluir: string[];
  papel: 'Letter' | 'A4';
}

export interface Entrada {
  titulo: string;
  vinetas: string[];
}

export interface Seccion {
  titulo: string;
  parrafos: string[];
  vinetas: string[];
  entradas: Entrada[];
}

export interface Cv {
  titulo: string;
  perfil?: string;
  secciones: Seccion[];
}

export function parseCv(raw: string): Cv {
  const { data, content } = matter(raw.normalize('NFC'), {});
  if (typeof data.titulo !== 'string' || !data.titulo.trim()) {
    throw new Error('El CV necesita "titulo" en el frontmatter (subtítulo bajo el nombre).');
  }
  const cv: Cv = { titulo: data.titulo.trim(), perfil: data.perfil, secciones: [] };
  let seccion: Seccion | undefined;
  let entrada: Entrada | undefined;

  for (const [i, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const at = `línea ${i + 1} del cuerpo`;
    if (line.startsWith('## ')) {
      seccion = { titulo: line.slice(3).trim(), parrafos: [], vinetas: [], entradas: [] };
      cv.secciones.push(seccion);
      entrada = undefined;
    } else if (line.startsWith('### ')) {
      if (!seccion) throw new Error(`Entrada fuera de una sección (${at}).`);
      entrada = { titulo: line.slice(4).trim(), vinetas: [] };
      seccion.entradas.push(entrada);
    } else if (/^\s*[-*] /.test(line)) {
      if (!seccion) throw new Error(`Viñeta fuera de una sección (${at}).`);
      const texto = line.replace(/^\s*[-*] /, '').trim();
      (entrada ? entrada.vinetas : seccion.vinetas).push(texto);
    } else if (line.startsWith('#')) {
      throw new Error(`Encabezado no admitido "${line.slice(0, 20)}…" (${at}): usa ## o ###.`);
    } else {
      if (!seccion) throw new Error(`Texto fuera de una sección (${at}).`);
      if (entrada) throw new Error(`Párrafo dentro de una entrada (${at}): usa viñetas.`);
      seccion.parrafos.push(line.trim());
    }
  }
  return cv;
}

/** Lee `vault/cv/encabezado.md` (frontmatter). */
export function parseEncabezado(raw: string): Encabezado {
  const { data } = matter(raw.normalize('NFC'), {});
  for (const k of ['nombre', 'ubicacion', 'telefono', 'email']) {
    if (typeof data[k] !== 'string' || !data[k].trim()) throw new Error(`encabezado.md: falta "${k}"`);
  }
  return {
    nombre: data.nombre.trim(),
    ubicacion: data.ubicacion.trim(),
    telefono: data.telefono.trim(),
    email: data.email.trim(),
    links: Array.isArray(data.links) ? data.links : [],
    fechas_fijas: data.fechas_fijas ?? {},
    nunca_incluir: Array.isArray(data.nunca_incluir) ? data.nunca_incluir.map(String) : [],
    papel: data.papel === 'A4' ? 'A4' : 'Letter',
  };
}
