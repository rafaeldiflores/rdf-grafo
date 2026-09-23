/**
 * Modelo del grafo y configuración del mapeo frontmatter → grafo.
 * Es la única fuente de estas reglas: parser, filtro público y sync a Neo4j
 * leen de aquí, así que agregar una relación nueva es un cambio de una línea.
 */

/** Valor escalar admitido como propiedad (compatible con Neo4j y JSON). */
export type Scalar = string | number | boolean;
export type PropValue = Scalar | Scalar[];
export type Props = Record<string, PropValue>;

export interface GraphNode {
  /** Nombre del archivo sin `.md`, normalizado a NFC. Único en el vault. */
  id: string;
  /** Campo `tipo` del frontmatter (o `pendiente` para links sin nota). */
  tipo: string;
  props: Props;
  /** Cuerpo markdown de la nota (sin frontmatter). */
  body: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Tipo de relación, p. ej. `USA`. Siempre uno de RELATIONS. */
  type: string;
  props: Props;
}

export interface Graph {
  meta: { public: boolean; generatedAt: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Campos del frontmatter cuyos `[[links]]` se convierten en aristas. */
export const RELATIONS = {
  stack: 'USA',
  parte_de: 'PARTE_DE',
  cliente: 'PARA_CLIENTE',
  relacionado: 'RELACIONADO_CON',
  cubre: 'CUBRE',
  plataforma: 'EN_PLATAFORMA',
  equipo: 'CON_EQUIPO',
  muestra: 'MUESTRA',
} as const satisfies Record<string, string>;

export type RelationField = keyof typeof RELATIONS;
export const RELATION_TYPES: readonly string[] = Object.values(RELATIONS);

/**
 * Subconjunto curado de `stack`. No crea aristas propias: marca
 * `destacado: true` en la arista USA correspondiente.
 */
export const HIGHLIGHT_FIELD = 'stack_destacado';

/** Tipos de nodo conocidos → label de Neo4j. */
export const NODE_LABELS: Record<string, string> = {
  proyecto: 'Proyecto',
  area: 'Area',
  canal: 'Canal',
  tecnologia: 'Tecnologia',
  aprendizaje: 'Aprendizaje',
  persona: 'Persona',
  pendiente: 'Pendiente',
  postulacion: 'Postulacion',
};

/**
 * Tipos que NUNCA se exportan en público, aunque la nota diga `visibilidad: publico`
 * (postulaciones: empresas, sueldos y estados de procesos de selección).
 */
export const NEVER_PUBLIC_TIPOS: readonly string[] = ['postulacion'];

export const PENDING_TIPO = 'pendiente';

/** Id estable de una arista; también sirve para deduplicar. */
export const edgeKey = (e: Pick<GraphEdge, 'source' | 'type' | 'target'>): string =>
  `${e.source}|${e.type}|${e.target}`;
