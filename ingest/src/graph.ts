/** Construcción del grafo completo (privado) a partir de notas parseadas. */
import { tecnologiasEn, type Logro, type Termino } from './logros.ts';
import {
  edgeKey,
  HIGHLIGHT_FIELD,
  LOGRO_RELATIONS,
  LOGRO_TIPO,
  NODE_LABELS,
  PENDING_TIPO,
  RELATIONS,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Props,
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

export interface LogrosReport {
  total: number;
  /** Logros cuyo proyecto no es una nota `tipo: proyecto`: id → proyecto buscado. */
  sinProyecto: Record<string, string>;
  /** Logros sin ninguna tecnología reconocida en `tec:` ni en el título. */
  sinTecnologia: string[];
  warnings: string[];
}

/**
 * Agrega al grafo los logros de la BASE: un nodo `logro` por id, con
 * LOGRO_DE → proyecto y DEMUESTRA → cada tecnología mencionada (nombre o
 * `aliases` de su nota). No crea nodos pendientes: lo que no calza se reporta.
 */
export function addLogros(graph: Graph, logros: readonly Logro[]): LogrosReport {
  const report: LogrosReport = { total: 0, sinProyecto: {}, sinTecnologia: [], warnings: [] };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const terminos: Termino[] = graph.nodes
    .filter((n) => n.tipo === 'tecnologia')
    .flatMap((n) => [n.id, ...aliasesDe(n)].map((texto) => ({ tecnologia: n.id, texto })));

  for (const l of logros) {
    if (byId.has(l.id)) {
      report.warnings.push(`El id de logro [${l.id}] choca con una nota del vault; se omite`);
      continue;
    }
    const props: Props = { titulo: l.titulo, seccion: l.seccion, ...(l.tema ? { tema: l.tema } : {}), ...l.campos };
    const node: GraphNode = { id: l.id, tipo: LOGRO_TIPO, props, body: '' };
    graph.nodes.push(node);
    byId.set(l.id, node);
    report.total++;

    if (byId.get(l.proyecto)?.tipo === 'proyecto') {
      graph.edges.push({ source: l.id, target: l.proyecto, type: LOGRO_RELATIONS.proyecto, props: {} });
    } else {
      report.sinProyecto[l.id] = l.proyecto;
    }

    const techs = tecnologiasEn(`${l.titulo}\n${l.campos.tec ?? ''}`, terminos);
    for (const t of techs) graph.edges.push({ source: l.id, target: t, type: LOGRO_RELATIONS.tecnologia, props: {} });
    if (!techs.length) report.sinTecnologia.push(l.id);
  }

  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));
  return report;
}

/** `aliases` de Obsidian: lista o texto suelto. */
function aliasesDe(n: GraphNode): string[] {
  const a = n.props.aliases;
  return (Array.isArray(a) ? a : a === undefined ? [] : [a]).map(String).filter((s) => s.trim());
}
