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

/**
 * Primer párrafo del cuerpo en texto plano, cortado en frase completa: es la
 * leyenda del recorrido. Sin título, listas, énfasis ni wikilinks.
 */
export function resumenBreve(body: string, max = 220): string {
  const parrafo = body
    .replace(/^\s*#\s+[^\n]*\n?/, '')
    .trim()
    .split(/\n\s*\n|\n\s*[-*]\s/)[0]!
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => (a ?? t).trim())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (parrafo.length <= max) return parrafo;
  // Se corta en la última frase que cabe; si ninguna cabe, en la última palabra.
  const frases = parrafo.match(/[^.!?]+[.!?]+/g) ?? [];
  let out = '';
  for (const f of frases) {
    if ((out + f).trim().length > max) break;
    out += f;
  }
  return out.trim() || parrafo.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * Lente "Enfoque IA": tecnologías de categoría `ia` y los proyectos que las
 * usan. Sale de datos públicos del grafo (la categoría de cada tecnología).
 */
export function nodosIA(graph: PublicGraph): Set<string> {
  const ia = new Set(graph.nodes.filter((n) => n.tipo === 'tecnologia' && n.props['categoria'] === 'ia').map((n) => n.id));
  const out = new Set(ia);
  for (const e of graph.edges) if (e.type === 'USA' && ia.has(e.target)) out.add(e.source);
  return out;
}

export interface Parada {
  /** Nodo al que vuela la cámara; `null` es la vista general final. */
  id: string | null;
  titulo: string;
  texto: string;
  /** Herramientas y técnicas de IA que usa el proyecto (perfil AI Engineer). */
  ia: string[];
}

/**
 * Paradas del recorrido guiado: los proyectos más conectados que tienen una
 * descripción real (una nota "Pendiente: …" no se presenta a un reclutador),
 * y al final la vista general. Todo sale del grafo público: nada se inventa.
 */
export function recorrido(graph: PublicGraph, max = 4): Parada[] {
  const grado = new Map<string, number>();
  for (const e of graph.edges) {
    grado.set(e.source, (grado.get(e.source) ?? 0) + 1);
    grado.set(e.target, (grado.get(e.target) ?? 0) + 1);
  }
  // Perfil AI Engineer: primero los proyectos que usan más tecnologías de IA;
  // a igualdad, los más conectados.
  const ia = new Set(graph.nodes.filter((n) => n.tipo === 'tecnologia' && n.props['categoria'] === 'ia').map((n) => n.id));
  const usosIA = new Map<string, number>();
  for (const e of graph.edges) if (e.type === 'USA' && ia.has(e.target)) usosIA.set(e.source, (usosIA.get(e.source) ?? 0) + 1);
  const peso = (id: string) => (usosIA.get(id) ?? 0) * 100 + (grado.get(id) ?? 0);
  const paradas = graph.nodes
    .filter((n) => n.tipo === 'proyecto')
    .map((n) => ({ n, texto: resumenBreve(n.body) }))
    .filter((x) => x.texto && !/^pendiente\b/i.test(x.texto))
    .sort((a, b) => peso(b.n.id) - peso(a.n.id) || a.n.id.localeCompare(b.n.id))
    .slice(0, max)
    .map(({ n, texto }): Parada => ({
      id: n.id,
      titulo: n.id,
      texto,
      ia: graph.edges
        .filter((e) => e.type === 'USA' && e.source === n.id && ia.has(e.target))
        .map((e) => e.target)
        .sort((a, b) => a.localeCompare(b)),
    }));
  const proyectos = graph.nodes.filter((n) => n.tipo === 'proyecto').length;
  const tecnologias = graph.nodes.filter((n) => n.tipo === 'tecnologia').length;
  return [
    ...paradas,
    {
      id: null,
      titulo: 'Todo conectado',
      ia: [],
      texto: `${proyectos} proyectos y ${tecnologias} tecnologías, generados desde notas reales. Toca cualquier planeta para explorar.`,
    },
  ];
}
