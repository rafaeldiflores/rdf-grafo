/**
 * Lectura de una nota de Obsidian: frontmatter, links y cuerpo.
 * Funciones puras (sin fs) para poder testearlas con strings.
 */
import matter from 'gray-matter';
import type { PropValue, Props, Scalar } from './model.ts';

export interface ParsedNote {
  /** Nombre del archivo sin extensión, NFC. */
  id: string;
  /** Ruta relativa al vault, solo para mensajes de error. */
  path: string;
  data: Record<string, unknown>;
  body: string;
}

/** Normaliza a NFC: macOS/Obsidian pueden escribir tildes descompuestas (NFD). */
export const nfc = (s: string): string => s.normalize('NFC');

/**
 * Parsea una nota. Devuelve `null` si no tiene frontmatter o no tiene `tipo`:
 * esas notas (p. ej. `00-Inicio.md`, dashboards) no son nodos.
 */
export function parseNote(relPath: string, raw: string): ParsedNote | null {
  const text = nfc(raw);
  if (!matter.test(text)) return null;
  // `{}` como opciones evita la caché interna de gray-matter, que comparte
  // objetos entre llamadas con el mismo contenido.
  const { data, content } = matter(text, {});
  if (typeof data.tipo !== 'string' || data.tipo.trim() === '') return null;
  const file = relPath.split(/[\\/]/).pop() ?? relPath;
  return { id: nfc(file.replace(/\.md$/i, '')), path: relPath, data, body: content };
}

// [[Destino]], [[Destino|alias]], [[Destino#Sección]], [[carpeta/Destino]]
const WIKILINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** Extrae el destino de un wikilink: sin alias, sin ancla y sin carpeta. */
const linkTarget = (inner: string): string => nfc(inner.trim().split('/').pop()!.trim());

export interface LinkExtraction {
  links: string[];
  /** Valores no vacíos que no contienen ningún `[[link]]` (probable error de tipeo). */
  invalid: string[];
}

/** Extrae los links de un valor de frontmatter (string, lista o vacío). */
export function extractLinks(value: unknown): LinkExtraction {
  const out: LinkExtraction = { links: [], invalid: [] };
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const s = String(v);
    const found = [...s.matchAll(WIKILINK)].map((m) => linkTarget(m[1]!));
    if (found.length === 0) out.invalid.push(s);
    for (const l of found) if (l && !out.links.includes(l)) out.links.push(l);
  }
  return out;
}

/**
 * Elimina la sección `Bitácora` (encabezado incluido) hasta el siguiente
 * encabezado de igual o mayor jerarquía. Es tolerante con la tilde, las
 * mayúsculas y el nivel del encabezado: si no reconociera una variante, la
 * bitácora privada se filtraría en la exportación pública.
 */
export function stripBitacora(body: string): string {
  const lines = nfc(body).split(/\r?\n/);
  const out: string[] = [];
  let skipLevel = 0; // 0 = no estamos dentro de una bitácora
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && /^bit[aá]cora\b/i.test(h[2]!.trim())) {
        skipLevel = level;
        continue;
      }
    }
    if (!skipLevel) out.push(line);
  }
  return out.join('\n').replace(/\s+$/, '') + '\n';
}

/**
 * Convierte un valor YAML a algo almacenable en Neo4j y JSON: escalares o
 * listas de escalares. Fechas → ISO; objetos anidados → JSON; vacíos → omitidos.
 */
export function toPropValue(value: unknown): PropValue | undefined {
  const scalar = (v: unknown): Scalar | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') return nfc(v);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    return JSON.stringify(v);
  };
  if (Array.isArray(value)) {
    const arr = value.map(scalar).filter((v): v is Scalar => v !== undefined);
    if (arr.length === 0) return undefined;
    // Neo4j exige listas homogéneas: si se mezclan tipos, todo a string.
    return arr.every((v) => typeof v === typeof arr[0]) ? arr : arr.map(String);
  }
  return scalar(value);
}

/** Frontmatter → props, excluyendo los campos indicados (relaciones, tipo…). */
export function toProps(data: Record<string, unknown>, exclude: ReadonlySet<string>): Props {
  const props: Props = {};
  for (const [k, v] of Object.entries(data)) {
    if (exclude.has(k)) continue;
    const pv = toPropValue(v);
    if (pv !== undefined) props[k] = pv;
  }
  return props;
}
