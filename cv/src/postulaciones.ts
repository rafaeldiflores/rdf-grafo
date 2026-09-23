/**
 * Notas de postulación (vault/postulaciones/*.md): lógica pura, sin I/O.
 * La usan el MCP local (disco) y el Worker remoto (GitHub), así que las
 * reglas —estados válidos, nombres seguros, siempre privada— viven en un solo lugar.
 */
import matter from 'gray-matter';

export const ESTADOS = ['Postulado', 'Contacto', 'Prueba tecnica', 'Entrevista', 'Oferta', 'Descartado', 'No enviada'] as const;
export type Estado = (typeof ESTADOS)[number];

/** Fecha de hoy (AAAA-MM-DD) en Chile: en UTC, de noche ya sería mañana. */
export const hoy = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

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

/** Ruta relativa al vault de la nota "Empresa - Cargo". */
export const rutaPostulacion = (empresa: string, cargo: string) => `postulaciones/${nombreSeguro(`${empresa} - ${cargo}`)}.md`;

export interface PostulacionInput {
  empresa: string;
  cargo: string;
  estado: Estado;
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
}

/** Valida una entrada; lanza con un mensaje legible si algo no cumple. */
export function validarPostulacion(p: PostulacionInput): void {
  if (!p.empresa?.trim() || !p.cargo?.trim()) throw new Error('Empresa y cargo son obligatorios');
  if (!ESTADOS.includes(p.estado)) throw new Error(`Estado inválido: ${p.estado}`);
  for (const f of ['fecha', 'proxima_fecha'] as const) {
    if (p[f] && !/^\d{4}-\d{2}-\d{2}$/.test(p[f]!)) throw new Error(`${f} debe ser AAAA-MM-DD`);
  }
}

/**
 * Nueva versión de la nota: solo cambia los campos recibidos, conserva el
 * cuerpo y agrega `notas` al final con fecha. Siempre `tipo: postulacion` y
 * `visibilidad: privado`, diga lo que diga la versión previa.
 */
export function fusionarPostulacion(previo: string | null, p: PostulacionInput, fecha = hoy()): string {
  validarPostulacion(p);
  const prev = previo ? matter(previo, {}) : { data: {}, content: `# ${p.cargo} — ${p.empresa}\n` };
  const { notas, ...campos } = p;
  const data: Record<string, unknown> = { tipo: 'postulacion', visibilidad: 'privado', ...prev.data };
  // gray-matter lee las fechas YAML como Date y las reescribiría como timestamp completo.
  for (const [k, v] of Object.entries(data)) if (v instanceof Date) data[k] = v.toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== '') data[k] = v;
  if (!data.fecha) data.fecha = fecha;
  data.tipo = 'postulacion';
  data.visibilidad = 'privado';
  let content = prev.content.replace(/\s+$/, '') + '\n';
  if (notas?.trim()) content += `\n- ${fecha}: ${notas.trim()}\n`;
  return matter.stringify(content, data);
}

/** Frontmatter de una nota para el Tracker (sin campos internos, fechas como texto). */
export function leerPostulacion(nota: string, raw: string): Record<string, unknown> | null {
  const { data } = matter(raw, {});
  if (data.tipo !== 'postulacion') return null;
  const { tipo: _t, visibilidad: _v, ...rest } = data as Record<string, unknown>;
  for (const [k, v] of Object.entries(rest)) if (v instanceof Date) rest[k] = v.toISOString().slice(0, 10);
  return { nota, ...rest };
}
