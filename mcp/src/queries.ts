/**
 * Consultas de solo lectura sobre el grafo en Neo4j y su formato en texto.
 *
 * No dependen del driver: reciben un `Runner` (una función que ejecuta Cypher
 * y devuelve filas), así se pueden testear con datos en memoria.
 */
import { brechasDe, formatBrechas } from '../../ingest/src/brechas.ts';
import { formatImpact, impactOf } from '../../ingest/src/impact.ts';
import type { Graph } from '../../ingest/src/model.ts';

export type Row = Record<string, unknown>;
export type Runner = (cypher: string, params?: Record<string, unknown>) => Promise<Row[]>;

/** Normaliza para comparar nombres sin tildes ni mayúsculas. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Resuelve un nombre aproximado al id exacto de un nodo.
 * Primero coincidencia exacta (sin tildes/mayúsculas) con el id o uno de sus
 * `aliases` de Obsidian ("Firestore" → Firebase), luego "contiene" en el id.
 */
export async function resolveNode(run: Runner, name: string, tipo?: string): Promise<{ id: string } | { suggestions: string[] }> {
  const rows = await run(
    `MATCH (n:Nodo) ${tipo ? 'WHERE n.tipo = $tipo' : ''} RETURN n.id AS id, n.aliases AS aliases ORDER BY id`,
    { tipo },
  );
  const ids = rows.map((r) => String(r.id));
  const q = norm(name);
  const exact = ids.find((id) => norm(id) === q);
  if (exact) return { id: exact };
  const alias = rows.find((r) => [r.aliases ?? []].flat().some((a) => norm(String(a)) === q));
  if (alias) return { id: String(alias.id) };
  const partial = ids.filter((id) => norm(id).includes(q));
  return partial.length === 1 ? { id: partial[0]! } : { suggestions: partial.slice(0, 10) };
}

const notFound = (what: string, name: string, suggestions: string[]) =>
  `No encontré ${what} "${name}".` + (suggestions.length ? ` ¿Quisiste decir: ${suggestions.join(', ')}?` : '');

export async function proyectosQueUsan(run: Runner, tecnologia: string): Promise<string> {
  const r = await resolveNode(run, tecnologia, 'tecnologia');
  if ('suggestions' in r) return notFound('la tecnología', tecnologia, r.suggestions);
  const rows = await run(
    `MATCH (p:Nodo)-[u:USA]->(t:Nodo {id: $id})
     RETURN p.id AS id, p.tipo AS tipo, p.estado AS estado, p.visibilidad AS visibilidad, coalesce(u.destacado, false) AS destacado
     ORDER BY destacado DESC, id`,
    { id: r.id },
  );
  if (!rows.length) return `Ningún proyecto usa "${r.id}" en el grafo.`;
  const lines = rows.map(
    (x) =>
      `- ${x.id} (${x.tipo}${x.estado ? `, ${x.estado}` : ''}${x.visibilidad === 'publico' ? ', público' : ', privado'})${x.destacado ? ' ★ destacada' : ''}`,
  );
  return `"${r.id}" se usa en ${rows.length}:\n${lines.join('\n')}`;
}

export async function vecinos(run: Runner, nodo: string, profundidad: number): Promise<string> {
  const r = await resolveNode(run, nodo);
  if ('suggestions' in r) return notFound('el nodo', nodo, r.suggestions);
  // La longitud variable no se puede parametrizar en Cypher: se valida y se interpola.
  const depth = Math.min(3, Math.max(1, Math.trunc(profundidad)));
  const rows = await run(
    `MATCH path = (n:Nodo {id: $id})-[*1..${depth}]-(m:Nodo)
     WHERE m <> n
     WITH m, min(length(path)) AS dist
     RETURN m.id AS id, m.tipo AS tipo, dist ORDER BY dist, tipo, id`,
    { id: r.id },
  );
  const direct = await run(
    `MATCH (n:Nodo {id: $id})-[rel]-(m:Nodo)
     RETURN type(rel) AS rel, startNode(rel) = n AS sale, m.id AS id ORDER BY rel, id`,
    { id: r.id },
  );
  const rels = direct.map((x) => `- ${x.sale ? `${r.id} -${x.rel}-> ${x.id}` : `${x.id} -${x.rel}-> ${r.id}`}`);
  const byDist = new Map<number, string[]>();
  for (const x of rows) byDist.set(Number(x.dist), [...(byDist.get(Number(x.dist)) ?? []), `${x.id} (${x.tipo})`]);
  const levels = [...byDist].map(([d, ids]) => `A distancia ${d} (${ids.length}): ${ids.join(', ')}`);
  return [`Vecinos de "${r.id}" hasta profundidad ${depth}:`, ...levels, '', 'Relaciones directas:', ...rels].join('\n');
}

export async function resumenProyecto(run: Runner, nombre: string): Promise<string> {
  const r = await resolveNode(run, nombre, 'proyecto');
  if ('suggestions' in r) return notFound('el proyecto', nombre, r.suggestions);
  const [node] = await run(`MATCH (n:Nodo {id: $id}) RETURN properties(n) AS props`, { id: r.id });
  const props = (node?.props ?? {}) as Row;
  const rels = await run(
    `MATCH (n:Nodo {id: $id})-[rel]-(m:Nodo)
     RETURN type(rel) AS rel, startNode(rel) = n AS sale, m.id AS id, coalesce(rel.destacado, false) AS destacado
     ORDER BY rel, destacado DESC, id`,
    { id: r.id },
  );
  const groups = new Map<string, string[]>();
  const nLogros = rels.filter((x) => x.rel === 'LOGRO_DE').length;
  for (const x of rels) {
    if (x.rel === 'LOGRO_DE') continue; // pueden ser decenas: se resumen abajo
    const key = x.sale ? String(x.rel) : `← ${x.rel}`;
    groups.set(key, [...(groups.get(key) ?? []), `${x.id}${x.destacado ? ' ★' : ''}`]);
  }
  const skip = new Set(['id', 'tipo', 'body']);
  const fields = Object.entries(props)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== '')
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  return [
    `# ${r.id}`,
    ...fields,
    '',
    '## Relaciones',
    ...[...groups].map(([k, ids]) => `- ${k}: ${ids.join(', ')}`),
    ...(nLogros ? [`- ← LOGRO_DE: ${nLogros} logros de la BASE (detalle con la herramienta logros)`] : []),
    '',
    '## Nota',
    String(props.body ?? '').trim() || '(sin cuerpo)',
  ].join('\n');
}

/** Carga el grafo completo desde Neo4j con la forma que usa ingest. */
export async function loadGraph(run: Runner): Promise<Graph> {
  const nodes = await run(`MATCH (n:Nodo) RETURN n.id AS id, n.tipo AS tipo, properties(n) AS props, n.body AS body`);
  const edges = await run(
    `MATCH (a:Nodo)-[r]->(b:Nodo) RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS props`,
  );
  return {
    meta: { public: false, generatedAt: new Date().toISOString() },
    nodes: nodes.map((n) => {
      const { id: _i, tipo: _t, body: _b, ...props } = n.props as Record<string, never>;
      return { id: String(n.id), tipo: String(n.tipo), props, body: String(n.body ?? '') };
    }),
    edges: edges.map((e) => ({
      source: String(e.source),
      target: String(e.target),
      type: String(e.type),
      props: e.props as Record<string, never>,
    })),
  };
}

export async function impacto(run: Runner, nodo: string): Promise<string> {
  const r = await resolveNode(run, nodo);
  if ('suggestions' in r) return notFound('el nodo', nodo, r.suggestions);
  return formatImpact(impactOf(await loadGraph(run), r.id));
}

export async function buscar(run: Runner, texto: string): Promise<string> {
  const rows = await run(`MATCH (n:Nodo) RETURN n.id AS id, n.tipo AS tipo ORDER BY id`);
  const q = norm(texto);
  const hits = rows.filter((x) => norm(String(x.id)).includes(q));
  return hits.length ? hits.map((x) => `- ${x.id} (${x.tipo})`).join('\n') : `Sin coincidencias para "${texto}".`;
}

export interface FiltroLogros {
  tecnologia?: string;
  proyecto?: string;
  /** Texto libre: se busca en título, tec, métrica y contexto (sin tildes ni mayúsculas). */
  texto?: string;
}

/**
 * Logros de la BASE (nodos `logro`, ver ingest/src/logros.ts) filtrados por
 * tecnología, proyecto y/o texto. Sin filtros, un resumen: logros por proyecto y
 * tecnologías con más logros que las respaldan (lo demostrable, no lo declarado).
 */
export async function logros(run: Runner, f: FiltroLogros): Promise<string> {
  let tecnologia: string | null = null;
  let proyecto: string | null = null;
  if (f.tecnologia?.trim()) {
    const r = await resolveNode(run, f.tecnologia, 'tecnologia');
    if ('suggestions' in r) return notFound('la tecnología', f.tecnologia, r.suggestions);
    tecnologia = r.id;
  }
  if (f.proyecto?.trim()) {
    const r = await resolveNode(run, f.proyecto, 'proyecto');
    if ('suggestions' in r) return notFound('el proyecto', f.proyecto, r.suggestions);
    proyecto = r.id;
  }

  const rows = await run(
    `MATCH (l:Nodo {tipo: 'logro'})
     OPTIONAL MATCH (l)-[:LOGRO_DE]->(p:Nodo)
     WITH l, p
     WHERE ($proyecto IS NULL OR p.id = $proyecto)
       AND ($tecnologia IS NULL OR EXISTS { (l)-[:DEMUESTRA]->(:Nodo {id: $tecnologia}) })
     OPTIONAL MATCH (l)-[:DEMUESTRA]->(t:Nodo)
     WITH l, p, t ORDER BY t.id
     RETURN l.id AS id, l.titulo AS titulo, l.tema AS tema, l.tec AS tec, l.metrica AS metrica,
            l.contexto AS contexto, p.id AS proyecto, collect(t.id) AS tecnologias
     ORDER BY proyecto, id`,
    { tecnologia, proyecto },
  );
  const q = f.texto?.trim() ? norm(f.texto) : '';
  const hits = q ? rows.filter((x) => [x.titulo, x.tec, x.metrica, x.contexto].some((v) => typeof v === 'string' && norm(v).includes(q))) : rows;
  const filtros = [tecnologia && `tecnología "${tecnologia}"`, proyecto && `proyecto "${proyecto}"`, q && `texto "${f.texto!.trim()}"`].filter(Boolean);

  if (!rows.length && !filtros.length) return 'No hay logros en el grafo. ¿Se corrió sync-neo4j después de agregar la BASE?';
  if (!filtros.length) return resumenLogros(rows);
  if (!hits.length) return `Ningún logro con ${filtros.join(' y ')}.`;

  const lineas = hits.map((x) => {
    const tecs = (x.tecnologias as string[]).length ? ` · demuestra: ${(x.tecnologias as string[]).join(', ')}` : '';
    const extra = [x.tec && `  tec: ${x.tec}`, x.metrica && `  metrica: ${x.metrica}`, x.contexto && `  contexto: ${x.contexto}`].filter(Boolean);
    return [`- [${x.id}] ${x.titulo} (${x.proyecto ?? 'sin proyecto'}${x.tema ? ` / ${x.tema}` : ''})${tecs}`, ...extra].join('\n');
  });
  const aviso = hits.some((x) => typeof x.metrica === 'string' && /ESTIMADA/i.test(x.metrica))
    ? ['', 'Ojo: una métrica ESTIMADA es solo para entrevista; en un CV se omite el número y la palabra.']
    : [];
  return [`${hits.length} logro(s) con ${filtros.join(' y ')}:`, ...lineas, ...aviso].join('\n');
}

function resumenLogros(rows: Row[]): string {
  const porProyecto = Object.entries(Object.groupBy(rows, (x) => String(x.proyecto ?? 'sin proyecto')))
    .map(([p, xs]) => [p, xs!.length] as const)
    .sort((a, b) => b[1] - a[1]);
  const porTec = new Map<string, number>();
  for (const x of rows) for (const t of x.tecnologias as string[]) porTec.set(t, (porTec.get(t) ?? 0) + 1);
  const tecs = [...porTec].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sinTec = rows.filter((x) => !(x.tecnologias as string[]).length).length;
  return [
    `${rows.length} logros en la BASE.`,
    '',
    'Por proyecto:',
    ...porProyecto.map(([p, n]) => `- ${p}: ${n}`),
    '',
    'Tecnologías respaldadas por logros (cuántos las demuestran):',
    ...tecs.map(([t, n]) => `- ${t}: ${n}`),
    ...(sinTec ? [`- (${sinTec} logros no nombran una tecnología del grafo)`] : []),
    '',
    'Filtra con tecnologia, proyecto o texto para ver el detalle.',
  ].join('\n');
}

/** Brechas frente a una oferta: clasifica lo que pide contra el grafo (ver ingest/src/brechas.ts). */
export async function brechas(run: Runner, requisitos: string[], oferta?: string): Promise<string> {
  return formatBrechas(brechasDe(await loadGraph(run), requisitos, oferta ?? ''));
}
