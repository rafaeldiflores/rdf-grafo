/** Construcción del grafo completo (privado) a partir de notas parseadas. */
import {
  edgeKey,
  HIGHLIGHT_FIELD,
  NODE_LABELS,
  PENDING_TIPO,
  RELATIONS,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type RelationField,
} from './model.ts';
import { extractLinks, toProps, type ParsedNote } from './parser.ts';

export interface BuildReport {
  /** Links a notas inexistentes: destino → notas que lo referencian. */
  pendientes: Record<string, string[]>;
  warnings: string[];
}

export interface BuildResult {
  graph: Graph;
  report: BuildReport;
}

/** Campos que no se copian como propiedades porque ya son estructura. */
const STRUCTURAL = new Set<string>(['tipo', HIGHLIGHT_FIELD, ...Object.keys(RELATIONS)]);

export function buildGraph(notes: ParsedNote[], now = new Date()): BuildResult {
  const report: BuildReport = { pendientes: {}, warnings: [] };
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const n of notes) {
    const tipo = String(n.data.tipo).trim().toLowerCase();
    if (!NODE_LABELS[tipo]) report.warnings.push(`${n.path}: tipo desconocido "${tipo}"`);
    nodes.set(n.id, { id: n.id, tipo, props: toProps(n.data, STRUCTURAL), body: n.body });
  }

  for (const n of notes) {
    for (const [field, type] of Object.entries(RELATIONS) as [RelationField, string][]) {
      const { links, invalid } = extractLinks(n.data[field]);
      for (const v of invalid) report.warnings.push(`${n.path}: "${field}" tiene un valor sin [[link]]: ${v}`);
      for (const target of links) {
        if (target === n.id) {
          report.warnings.push(`${n.path}: "${field}" se enlaza a sí misma`);
          continue;
        }
        if (!nodes.has(target)) {
          // Link roto: se crea un nodo `pendiente` para no perder la relación.
          nodes.set(target, { id: target, tipo: PENDING_TIPO, props: {}, body: '' });
        }
        if (nodes.get(target)!.tipo === PENDING_TIPO) {
          (report.pendientes[target] ??= []).push(n.id);
        }
        const edge: GraphEdge = { source: n.id, target, type, props: {} };
        edges.set(edgeKey(edge), edge);
      }
    }

    // stack_destacado: marca aristas USA existentes; no crea aristas nuevas.
    const { links: highlighted, invalid } = extractLinks(n.data[HIGHLIGHT_FIELD]);
    for (const v of invalid) report.warnings.push(`${n.path}: "${HIGHLIGHT_FIELD}" tiene un valor sin [[link]]: ${v}`);
    for (const target of highlighted) {
      const usa = edges.get(edgeKey({ source: n.id, type: RELATIONS.stack, target }));
      if (usa) usa.props.destacado = true;
      else report.warnings.push(`${n.path}: "${target}" está en ${HIGHLIGHT_FIELD} pero no en stack`);
    }
  }

  for (const refs of Object.values(report.pendientes)) refs.sort();

  // Orden estable: el mismo vault produce siempre el mismo JSON (diffs limpios).
  const graph: Graph = {
    meta: { public: false, generatedAt: now.toISOString() },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b))),
  };
  return { graph, report };
}
