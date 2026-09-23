/**
 * Logros como nodos, derivados de `cv/BASE_Experiencia.md` (la única fuente de
 * hechos del CV). No se duplican en notas: la ingesta los lee de la BASE en
 * cada build, así el Postulador y el grafo nunca se desincronizan.
 *
 * Formato esperado en la BASE:
 *   ## MAZA - SaaS de gestion de talleres (May 2024 - presente)
 *   Nodo: [[MAZA]]                  ← opcional; si falta, se usa el nombre de la sección
 *   ### Recuperacion y RAG           ← subsección (se guarda como `tema`)
 *   - [maza-rag-01] Título
 *     tec: texto libre              ← se cruza con las notas de tecnología (nombre + aliases)
 *     metrica: …
 *     contexto: …
 *     verificable: si
 *
 * Funciones puras (sin fs) para poder testearlas con strings.
 */
import { nfc } from './parser.ts';

export const RUTA_BASE = 'cv/BASE_Experiencia.md';

export interface Logro {
  id: string;
  titulo: string;
  /** Encabezado `##` completo de la sección, p. ej. "MAZA - SaaS de gestion…". */
  seccion: string;
  /** Subsección `###`, si la hay. */
  tema?: string;
  /** Destino del `Nodo: [[…]]` de la sección, o su nombre si no lo tiene. */
  proyecto: string;
  /** true si el proyecto viene de `Nodo:` (explícito) y no del nombre de la sección. */
  proyectoExplicito: boolean;
  /** Campos `clave: valor` del logro (tec, metrica, contexto, verificable…). Vacíos se omiten. */
  campos: Record<string, string>;
}

const SECCION = /^##\s+(.+?)\s*$/;
const TEMA = /^###\s+(.+?)\s*$/;
const NODO = /^Nodo:\s*\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]\s*$/i;
const LOGRO = /^-\s+\[([a-z0-9][a-z0-9-]*)\]\s+(.+?)\s*$/i;
const CAMPO = /^\s+([a-z_]+):\s*(.*?)\s*$/i;

/** "MAZA - SaaS de… (May 2024 - presente)" → "MAZA"; "Sistema de postulaciones (2026)" → "Sistema de postulaciones". */
export const nombreDeSeccion = (titulo: string): string => titulo.split(' - ')[0]!.replace(/\s*\([^)]*\)\s*$/, '').trim();

export function parseLogros(raw: string): { logros: Logro[]; warnings: string[] } {
  const logros: Logro[] = [];
  const warnings: string[] = [];
  const vistos = new Set<string>();
  let seccion: { titulo: string; proyecto: string; explicito: boolean } | null = null;
  let tema: string | undefined;
  let actual: Logro | null = null;

  for (const linea of nfc(raw).replaceAll('\r\n', '\n').split('\n')) {
    let m: RegExpMatchArray | null;
    if ((m = linea.match(SECCION))) {
      seccion = { titulo: m[1]!, proyecto: nombreDeSeccion(m[1]!), explicito: false };
      tema = undefined;
      actual = null;
    } else if ((m = linea.match(TEMA))) {
      tema = m[1]!;
      actual = null;
    } else if ((m = linea.match(NODO)) && seccion) {
      // `Nodo:` debe ir antes del primer logro para que aplique a toda la sección.
      if (logros.some((l) => l.seccion === seccion!.titulo)) warnings.push(`BASE: "Nodo:" de "${seccion.titulo}" va después de sus logros`);
      seccion.proyecto = nfc(m[1]!.trim());
      seccion.explicito = true;
      for (const l of logros) if (l.seccion === seccion.titulo) Object.assign(l, { proyecto: seccion.proyecto, proyectoExplicito: true });
    } else if ((m = linea.match(LOGRO))) {
      const id = m[1]!.toLowerCase();
      actual = null;
      if (!seccion) {
        warnings.push(`BASE: logro [${id}] fuera de una sección ##`);
        continue;
      }
      if (vistos.has(id)) {
        warnings.push(`BASE: id de logro duplicado [${id}]`);
        continue;
      }
      vistos.add(id);
      actual = { id, titulo: m[2]!, seccion: seccion.titulo, ...(tema ? { tema } : {}), proyecto: seccion.proyecto, proyectoExplicito: seccion.explicito, campos: {} };
      logros.push(actual);
    } else if ((m = linea.match(CAMPO)) && actual) {
      if (m[2]) actual.campos[m[1]!.toLowerCase()] = m[2];
    } else if (linea.trim() === '') {
      // Línea en blanco: el logro puede seguir (los campos van indentados).
    } else {
      actual = null;
    }
  }
  return { logros, warnings };
}

/** Minúsculas y sin tildes, para comparar "Vectorize" con "vectorize" o "Busqueda" con "Búsqueda". */
const plano = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Termino {
  /** Id del nodo de tecnología. */
  tecnologia: string;
  /** Texto a buscar: el nombre de la nota o uno de sus aliases. */
  texto: string;
}

/**
 * Tecnologías mencionadas en un texto libre. Busca cada término como palabra
 * completa; el más largo gana y consume su tramo, así "Cloudflare Workers AI"
 * no cuenta además como "Cloudflare Workers". Nada se infiere: solo coincidencias.
 */
export function tecnologiasEn(texto: string, terminos: readonly Termino[]): string[] {
  let resto = plano(texto);
  const encontradas = new Set<string>();
  const porLargo = [...terminos].filter((t) => t.texto.trim()).sort((a, b) => b.texto.length - a.texto.length);
  for (const t of porLargo) {
    // Límites por letra/dígito en vez de \b: \b no conoce tildes y "js" calzaría dentro de "Node.js" igual.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapar(plano(t.texto.trim()))}(?![\\p{L}\\p{N}])`, 'gu');
    if (re.test(resto)) {
      encontradas.add(t.tecnologia);
      resto = resto.replace(re, (x) => ' '.repeat(x.length));
    }
  }
  return [...encontradas].sort();
}
