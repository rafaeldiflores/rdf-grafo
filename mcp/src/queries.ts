/**
 * Consultas de solo lectura sobre el grafo en Neo4j y su formato en texto.
 *
 * No dependen del driver: reciben un `Runner` (una función que ejecuta Cypher
 * y devuelve filas), así se pueden testear con datos en memoria.
 */
import { formatImpact, impactOf } from '../../ingest/src/impact.ts';
import type { Graph } from '../../ingest/src/model.ts';

export type Row = Record<string, unknown>;
export type Runner = (cypher: string, params?: Record<string, unknown>) => Promise<Row[]>;

/** Normaliza para comparar nombres sin tildes ni mayúsculas. */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Resuelve un nombre aproximado al id exacto de un nodo.
 * Primero coincidencia exacta (sin tildes/mayúsculas), luego "contiene".
 */
export async function resolveNode(run: Runner, name: string, tipo?: string): Promise<{ id: string } | { suggestions: string[] }> {
  const rows = await run(
    `MATCH (n:Nodo) ${tipo ? 'WHERE n.tipo = $tipo' : ''} RETURN n.id AS id ORDER BY id`,
    { tipo },
  );
  const ids = rows.map((r) => String(r.id));
  const q = norm(name);
  const exact = ids.find((id) => norm(id) === q);
  if (exact) return { id: exact };
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
  for (const x of rels) {
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
