/**
 * Análisis de impacto: "si cambia X, ¿qué más hay que actualizar?".
 *
 * Reglas de propagación (quién se ve afectado cuando cambia Y):
 *   A -MUESTRA-> Y          → A   (el portafolio muestra MAZA)
 *   A -USA-> Y              → A   (cambia una tecnología → los proyectos que la usan)
 *   L -DEMUESTRA-> Y        → L   (… y los logros del CV que la mencionan)
 *   A -RELACIONADO_CON- Y   → A   (en ambos sentidos)
 *   Y -PARTE_DE-> P         → P   (el padre resume a sus partes)
 * Se recorre en anchura hasta `maxDepth`, guardando el camino para explicar
 * por qué cada nodo aparece.
 */
import { HIGHLIGHT_FIELD, LOGRO_RELATIONS, PENDING_TIPO, RELATIONS, type Graph, type GraphNode } from './model.ts';

export interface AffectedNode {
  id: string;
  tipo: string;
  depth: number;
  /** Cadena de ids desde el nodo origen hasta este. */
  path: string[];
  /** Relación que conecta con el paso anterior (p. ej. `MUESTRA`). */
  via: string;
}

export interface StackItem {
  id: string;
  destacado: boolean;
  /** Aprendizajes que la cubren (arista CUBRE). */
  aprendizajes: string[];
  sinNivel: boolean;
  pendiente: boolean;
}

export interface ImpactResult {
  node: GraphNode;
  affected: AffectedNode[];
  /** Solo para proyectos: estado de su stack. */
  stack: StackItem[];
  /** El proyecto tiene stack pero ninguna tecnología destacada (sin curaduría). */
  sinCuraduria: boolean;
}

export function findNode(graph: Graph, query: string): GraphNode | { suggestions: string[] } {
  const q = query.normalize('NFC').trim();
  const exact = graph.nodes.find((n) => n.id === q) ?? graph.nodes.find((n) => n.id.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  return { suggestions: graph.nodes.filter((n) => n.id.toLowerCase().includes(q.toLowerCase())).map((n) => n.id) };
}

export function impactOf(graph: Graph, id: string, maxDepth = 3): ImpactResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) throw new Error(`No existe el nodo "${id}"`);

  /** Vecinos afectados cuando cambia `y`, con la relación que los une. */
  const affectedBy = (y: string): [string, string][] => {
    const out: [string, string][] = [];
    for (const e of graph.edges) {
      if (e.target === y && (e.type === RELATIONS.muestra || e.type === RELATIONS.stack || e.type === RELATIONS.relacionado || e.type === LOGRO_RELATIONS.tecnologia)) {
        out.push([e.source, e.type]);
      }
      if (e.source === y && (e.type === RELATIONS.parte_de || e.type === RELATIONS.relacionado)) {
        out.push([e.target, e.type]);
      }
    }
    return out;
  };

  const affected: AffectedNode[] = [];
  const seen = new Set([id]);
  let frontier: AffectedNode[] = [{ id, tipo: node.tipo, depth: 0, path: [id], via: '' }];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: AffectedNode[] = [];
    for (const f of frontier) {
      for (const [other, via] of affectedBy(f.id)) {
        if (seen.has(other)) continue;
        seen.add(other);
        const a = { id: other, tipo: byId.get(other)?.tipo ?? PENDING_TIPO, depth, path: [...f.path, other], via };
        affected.push(a);
        next.push(a);
      }
    }
    frontier = next;
  }

  const stackEdges = graph.edges.filter((e) => e.source === id && e.type === RELATIONS.stack);
  const stack: StackItem[] = stackEdges.map((e) => {
    const tech = byId.get(e.target);
    return {
      id: e.target,
      destacado: e.props.destacado === true,
      aprendizajes: graph.edges.filter((c) => c.target === e.target && c.type === RELATIONS.cubre).map((c) => c.source),
      sinNivel: tech?.tipo === 'tecnologia' && tech.props.nivel === undefined,
      pendiente: !tech || tech.tipo === PENDING_TIPO,
    };
  });

  return { node, affected, stack, sinCuraduria: stack.length > 0 && !stack.some((s) => s.destacado) };
}

/** Texto legible para la terminal. */
export function formatImpact(r: ImpactResult): string {
  const lines = [`Impacto de un cambio en "${r.node.id}" (${r.node.tipo})`, ''];
  if (!r.affected.length) lines.push('Nada depende de este nodo en el grafo.');
  else {
    lines.push('Hay que revisar:');
    for (const a of r.affected) lines.push(`  ${'  '.repeat(a.depth - 1)}- ${a.id} (${a.tipo}) ← ${a.via}   [${a.path.join(' → ')}]`);
  }
  if (r.stack.length) {
    lines.push('', 'Stack:');
    for (const s of r.stack) {
      const flags = [
        s.destacado && '★ destacado',
        s.pendiente && '⚠ sin nota',
        s.sinNivel && 'sin nivel',
        !s.pendiente && (s.aprendizajes.length ? `aprendizaje: ${s.aprendizajes.join(', ')}` : 'sin aprendizaje'),
      ].filter(Boolean);
      lines.push(`  - ${s.id}${flags.length ? `  (${flags.join(' · ')})` : ''}`);
    }
    if (r.sinCuraduria) lines.push('', `⚠ Sin curaduría: agrega "${HIGHLIGHT_FIELD}" a la nota para elegir qué se muestra en el portafolio.`);
  }
  return lines.join('\n');
}
