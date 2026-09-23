/**
 * Sincroniza un grafo con Neo4j de forma idempotente.
 *
 * - Todos los nodos llevan el label `:Nodo` (clave única `id`) más un label
 *   por tipo (`:Proyecto`, `:Tecnologia`…).
 * - MERGE por id; `SET n = row` reemplaza todas las propiedades, así que un
 *   campo borrado en el vault también desaparece en Neo4j.
 * - Lo que ya no está en el vault se elimina (solo dentro de `:Nodo`, sin
 *   tocar otros datos de la base).
 * - Todo corre en UNA transacción: o se aplica el grafo completo o nada.
 *
 * Labels y tipos de relación no pueden ir como parámetros en Cypher, así que
 * se interpolan SOLO desde listas blancas (NODE_LABELS, RELATION_TYPES).
 */
import type { Driver } from 'neo4j-driver';
import { edgeKey, NODE_LABELS, RELATION_TYPES, type Graph } from './model.ts';

export interface Statement {
  query: string;
  params: Record<string, unknown>;
}

export const CONSTRAINT = 'CREATE CONSTRAINT nodo_id IF NOT EXISTS FOR (n:Nodo) REQUIRE n.id IS UNIQUE';

const ALL_LABELS = Object.values(NODE_LABELS).join(':');

export function buildSyncStatements(graph: Graph): Statement[] {
  const statements: Statement[] = [];

  // Nodos, agrupados por label (el label no es parametrizable).
  const byTipo = Object.groupBy(graph.nodes, (n) => n.tipo);
  for (const [tipo, nodes] of Object.entries(byTipo)) {
    const label = NODE_LABELS[tipo]; // tipo desconocido → solo :Nodo
    // Las claves reservadas van al final para que ningún campo del frontmatter las pise.
    const rows = nodes!.map((n) => ({ ...n.props, id: n.id, tipo: n.tipo, body: n.body }));
    statements.push({
      query: [
        'UNWIND $rows AS row',
        'MERGE (n:Nodo {id: row.id})',
        'SET n = row',
        `REMOVE n:${ALL_LABELS}`,
        label ? `SET n:${label}` : '',
      ].filter(Boolean).join('\n'),
      params: { rows },
    });
  }

  // Aristas, agrupadas por tipo de relación.
  const byType = Object.groupBy(graph.edges, (e) => e.type);
  for (const [type, edges] of Object.entries(byType)) {
    if (!RELATION_TYPES.includes(type)) throw new Error(`Tipo de relación no permitido: ${type}`);
    statements.push({
      query: [
        'UNWIND $rows AS row',
        'MATCH (a:Nodo {id: row.source})',
        'MATCH (b:Nodo {id: row.target})',
        `MERGE (a)-[r:${type}]->(b)`,
        'SET r = row.props',
      ].join('\n'),
      params: { rows: edges!.map((e) => ({ source: e.source, target: e.target, props: e.props })) },
    });
  }

  // Limpieza: aristas y nodos que ya no existen en el vault.
  statements.push({
    query: "MATCH (a:Nodo)-[r]->(b:Nodo) WHERE NOT (a.id + '|' + type(r) + '|' + b.id) IN $keys DELETE r",
    params: { keys: graph.edges.map(edgeKey) },
  });
  statements.push({
    query: 'MATCH (n:Nodo) WHERE NOT n.id IN $ids DETACH DELETE n',
    params: { ids: graph.nodes.map((n) => n.id) },
  });

  return statements;
}

export async function syncToNeo4j(driver: Driver, graph: Graph, database?: string): Promise<void> {
  const session = driver.session(database ? { database } : {});
  try {
    // Las restricciones de esquema no pueden ir en la misma transacción que las escrituras.
    await session.run(CONSTRAINT);
    const statements = buildSyncStatements(graph);
    await session.executeWrite(async (tx) => {
      for (const s of statements) await tx.run(s.query, s.params);
    });
  } finally {
    await session.close();
  }
}
