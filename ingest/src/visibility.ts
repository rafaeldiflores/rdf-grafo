/**
 * Filtro de visibilidad para la exportación pública. CRÍTICO: todo lo que
 * devuelve este módulo termina en un sitio público.
 *
 * Principio: fail-closed. Nada sale salvo que una regla lo permita
 * explícitamente (nodos, aristas, propiedades y texto del cuerpo).
 */
import type { Graph, GraphEdge, GraphNode, Props } from './model.ts';
import { stripBitacora } from './parser.ts';

/** Propiedades de nodo exportables (lista blanca). `repo` queda fuera a propósito. */
export const PUBLIC_NODE_PROPS: readonly string[] = ['estado', 'url', 'rol', 'categoria', 'nivel'];
/** Propiedades de arista exportables. */
export const PUBLIC_EDGE_PROPS: readonly string[] = ['destacado'];

/** `publico` o `público`, sin importar mayúsculas ni espacios. Todo lo demás es privado. */
export function isMarkedPublic(n: GraphNode): boolean {
  const v = n.props.visibilidad;
  if (typeof v !== 'string') return false;
  return v.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase() === 'publico';
}

/**
 * Las tecnologías no llevan `visibilidad`: se incluyen si están conectadas a
 * un nodo público, salvo que la nota declare explícitamente otra visibilidad.
 */
function isIncludableTech(n: GraphNode): boolean {
  if (n.tipo !== 'tecnologia') return false;
  return n.props.visibilidad === undefined || isMarkedPublic(n);
}

const pick = (props: Props, allowed: readonly string[]): Props => {
  const out: Props = {};
  for (const k of allowed) if (props[k] !== undefined) out[k] = props[k];
  return out;
};

/**
 * Los wikilinks del cuerpo hacia nodos no incluidos se reemplazan por su alias
 * o, si no tienen, por "(privado)": el nombre de una nota privada escrito en
 * una nota pública también es una filtración.
 */
export function redactBodyLinks(body: string, included: ReadonlySet<string>): { body: string; redacted: string[] } {
  const redacted: string[] = [];
  const out = body.replace(/\[\[([^\]|#^]+)([#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (match, inner: string, _anchor, alias?: string) => {
    const target = inner.trim().split('/').pop()!.trim().normalize('NFC');
    if (included.has(target)) return match;
    redacted.push(target);
    return alias?.trim() ? alias.trim() : '(privado)';
  });
  return { body: out, redacted };
}

export interface PublicFilterResult {
  graph: Graph;
  /** Links del cuerpo de notas públicas que apuntaban a nodos privados. */
  redactions: { node: string; target: string }[];
}

export function filterPublic(full: Graph): PublicFilterResult {
  const byId = new Map(full.nodes.map((n) => [n.id, n]));
  const publicIds = new Set(full.nodes.filter(isMarkedPublic).map((n) => n.id));

  // Tecnologías vecinas de un nodo público (en cualquier dirección). Se mira
  // solo el conjunto público base: una tecnología no "arrastra" a otra.
  const included = new Set(publicIds);
  for (const e of full.edges) {
    for (const [from, to] of [[e.source, e.target], [e.target, e.source]] as const) {
      const other = byId.get(to);
      if (publicIds.has(from) && other && isIncludableTech(other)) included.add(to);
    }
  }

  const redactions: PublicFilterResult['redactions'] = [];
  const nodes: GraphNode[] = full.nodes
    .filter((n) => included.has(n.id))
    .map((n) => {
      const { body, redacted } = redactBodyLinks(stripBitacora(n.body), included);
      for (const target of redacted) redactions.push({ node: n.id, target });
      return { id: n.id, tipo: n.tipo, props: pick(n.props, PUBLIC_NODE_PROPS), body };
    });

  // Una arista sale solo si AMBOS extremos salen.
  const edges: GraphEdge[] = full.edges
    .filter((e) => included.has(e.source) && included.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, type: e.type, props: pick(e.props, PUBLIC_EDGE_PROPS) }));

  return { graph: { meta: { ...full.meta, public: true }, nodes, edges }, redactions };
}
