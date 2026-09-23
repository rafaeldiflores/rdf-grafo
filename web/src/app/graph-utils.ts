/** Funciones puras sobre el grafo: búsqueda, vecinos y cuerpo en HTML. */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { RELATION_LABELS, type GraphNode, type PublicGraph } from './graph.model';

/** Minúsculas y sin tildes: "tecnologia" encuentra "Tecnología". */
export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Nodos cuyo nombre contiene la búsqueda; primero los que empiezan con ella. */
export function searchNodes(nodes: readonly GraphNode[], query: string, limit = 8): GraphNode[] {
  const q = normalize(query);
  if (!q) return [];
  return nodes
    .map((n) => ({ n, i: normalize(n.id).indexOf(q) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i || a.n.id.localeCompare(b.n.id))
    .slice(0, limit)
    .map((x) => x.n);
}

export interface NeighborGroup {
  /** Etiqueta legible, p. ej. "Usa" o "Usada en". */
  label: string;
  items: { node: GraphNode; destacado: boolean }[];
}

/** Vecinos de un nodo agrupados por relación y sentido, destacados primero. */
export function neighborGroups(graph: PublicGraph, id: string): NeighborGroup[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, NeighborGroup>();
  for (const e of graph.edges) {
    const dir = e.source === id ? 'out' : e.target === id ? 'in' : null;
    if (!dir) continue;
    const other = byId.get(dir === 'out' ? e.target : e.source);
    if (!other) continue;
    const label = RELATION_LABELS[e.type]?.[dir] ?? e.type;
    const g = groups.get(label) ?? { label, items: [] };
    g.items.push({ node: other, destacado: e.props['destacado'] === true });
    groups.set(label, g);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => Number(b.destacado) - Number(a.destacado) || a.node.id.localeCompare(b.node.id));
  }
  return [...groups.values()];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Markdown del cuerpo → HTML saneado. Quita el `# Título` inicial (el panel ya
 * lo muestra) y convierte `[[Nota|alias]]` en enlaces internos cuando la nota
 * existe en el grafo; si no, deja solo el texto.
 */
export function bodyToHtml(body: string, existing: ReadonlySet<string>): string {
  const md = body
    .replace(/^\s*#\s+[^\n]*\n?/, '')
    .replace(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
      const id = target.trim();
      const text = escapeHtml((alias ?? id).trim());
      return existing.has(id) ? `<a href="#${encodeURIComponent(id)}" data-node="${escapeHtml(id)}">${text}</a>` : text;
    });
  const html = marked.parse(md, { async: false, gfm: true });
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-node'] });
}
