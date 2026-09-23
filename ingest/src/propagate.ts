/**
 * Propagación: regenera bloques marcados en archivos de otros repos a partir
 * del vault (QUÉ tecnologías) y del package.json del proyecto (QUÉ versión).
 *
 * Un bloque es:   <!-- grafo:<formato> <Proyecto> -->  …  <!-- /grafo -->
 * Solo se reescribe lo que está entre los marcadores; el resto del archivo no
 * se toca. Formatos:
 *   - chips:  <span>etiqueta</span>… con el `stack_destacado` (portafolio)
 *   - tabla:  tabla markdown Tecnología | Versión | Uso con todo el `stack`,
 *             destacadas primero; conserva el "Uso" escrito a mano (README)
 *
 * Funciones puras: el I/O vive en cli/propagar.ts.
 */
import { extractLinks, type ParsedNote } from './parser.ts';

/** Versiones instaladas del proyecto, por nombre de paquete npm. */
export type Versions = Record<string, string>;

export interface Block {
  format: string;
  project: string;
  /** Posición del contenido entre marcadores (sin incluirlos). */
  start: number;
  end: number;
  inner: string;
}

const BLOCK = /<!--\s*grafo:(\w+)\s+(.+?)\s*-->([\s\S]*?)<!--\s*\/grafo\s*-->/g;

export function findBlocks(text: string): Block[] {
  return [...text.matchAll(BLOCK)].map((m) => {
    const start = m.index! + m[0].indexOf('-->') + 3; // justo después del marcador de apertura
    return { format: m[1]!, project: m[2]!.trim(), start, end: start + m[3]!.length, inner: m[3]! };
  });
}

/** Reemplaza el contenido de cada bloque; `render` devuelve el nuevo contenido. */
export function replaceBlocks(text: string, render: (b: Block) => string): string {
  let out = '';
  let last = 0;
  for (const b of findBlocks(text)) {
    out += text.slice(last, b.start) + render(b);
    last = b.end;
  }
  return out + text.slice(last);
}

/** "^22.1.5" → "22.1.5"; versión mayor de "22.1.5" → "22". */
export const cleanVersion = (v: string): string => v.replace(/^[\^~>=<\s]+/, '');
export const major = (v: string): string => cleanVersion(v).split('.')[0] ?? v;

export interface TechInfo {
  name: string;
  paquete?: string;
  etiqueta?: string;
}

/** Etiqueta visible: `etiqueta` con {mayor}, {version}, {mayor:pkg}, {version:pkg}, o el nombre. */
export function label(tech: TechInfo, versions: Versions): string {
  if (!tech.etiqueta) return tech.name;
  return tech.etiqueta.replace(/\{(mayor|version)(?::([^}]+))?\}/g, (_m, kind: string, pkg?: string) => {
    const v = versions[pkg ?? tech.paquete ?? ''];
    if (!v) throw new Error(`"${tech.name}": no hay versión instalada de ${pkg ?? tech.paquete ?? '(sin paquete)'}`);
    return kind === 'mayor' ? major(v) : cleanVersion(v);
  });
}

export interface ProjectStack {
  project: string;
  stack: TechInfo[];
  /** Subconjunto destacado, en el orden de la nota. */
  destacado: TechInfo[];
}

/**
 * Lee el stack de un proyecto desde las notas. Falla si el proyecto no es
 * público: el contenido propagado termina en sitios públicos (fail-closed).
 */
export function projectStack(notes: ParsedNote[], project: string): ProjectStack {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const note = byId.get(project);
  if (!note) throw new Error(`No existe la nota "${project}"`);
  const vis = String(note.data.visibilidad ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  if (vis !== 'publico') throw new Error(`"${project}" no es público: no se propaga`);

  const info = (id: string): TechInfo => {
    const d = byId.get(id)?.data ?? {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return { name: id, paquete: str(d.paquete), etiqueta: str(d.etiqueta) };
  };
  const stack = extractLinks(note.data.stack).links;
  const destacado = extractLinks(note.data.stack_destacado).links.filter((t) => stack.includes(t));
  return { project, stack: stack.map(info), destacado: destacado.map(info) };
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderChips(ps: ProjectStack, versions: Versions): string {
  return ps.destacado.map((t) => `<span>${escapeHtml(label(t, versions))}</span>`).join('');
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

interface Row {
  name: string;
  version: string;
  uso: string;
}

function parseTable(inner: string): Row[] {
  return inner
    .split('\n')
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|\s*$/.test(l))
    .slice(1) // encabezado
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .map(([name = '', version = '', uso = '']) => ({ name, version, uso }));
}

export interface TableResult {
  table: string;
  /** Filas que existían y ya no corresponden a ninguna tecnología del stack. */
  dropped: string[];
}

/**
 * Tabla del stack. Versión: la instalada si la nota tiene `paquete`; si no,
 * la que ya estaba escrita. Uso: el que ya estaba (se busca por nombre exacto,
 * luego por prefijo y luego por primera palabra), o "_por completar_".
 */
export function renderTable(ps: ProjectStack, versions: Versions, inner: string): TableResult {
  const rows = parseTable(inner);
  const used = new Set<number>();
  /** Filas previas de una tecnología: exacta, o todas las que empiezan igual
   *  ("Firebase" → "Firebase Auth", "Firebase Storage"…), o misma primera palabra. */
  const match = (t: TechInfo): Row[] => {
    const n = norm(t.name);
    const free = (test: (r: string) => boolean) =>
      rows.map((r, i) => ({ r, i })).filter(({ r, i }) => !used.has(i) && test(norm(r.name)));
    const levels: [(r: string) => boolean, number][] = [
      [(r) => r === n, 1],
      [(r) => r.startsWith(n + ' ') || n.startsWith(r + ' '), Infinity],
      // Primera palabra: débil, así que solo UNA fila (Cloudflare KV ≠ Cloudflare Workers).
      [(r) => r.split(' ')[0] === n.split(' ')[0], 1],
    ];
    for (const [test, max] of levels) {
      const found = free(test).slice(0, max);
      if (found.length) {
        for (const { i } of found) used.add(i);
        return found.map(({ r }) => r);
      }
    }
    return [];
  };

  const ordered = [...ps.destacado, ...ps.stack.filter((t) => !ps.destacado.some((d) => d.name === t.name))];
  const lines = ['| Tecnología | Versión | Uso |', '|---|---|---|'];
  for (const t of ordered) {
    const prev = match(t);
    const installed = t.paquete ? versions[t.paquete] : undefined;
    const version = installed ? cleanVersion(installed) : prev[0]?.version || '—';
    const uso = [...new Set(prev.map((r) => r.uso).filter(Boolean))].join('; ');
    lines.push(`| ${t.name} | ${version} | ${uso || '_por completar_'} |`);
  }
  const dropped = rows.filter((_r, i) => !used.has(i)).map((r) => r.name);
  return { table: `\n${lines.join('\n')}\n`, dropped };
}
