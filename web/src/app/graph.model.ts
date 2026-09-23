/**
 * Forma de `graph.json` público (ver app/ingest/src/model.ts) y metadatos de
 * presentación: nombres legibles de tipos y relaciones.
 */

export type Scalar = string | number | boolean;

export interface GraphNode {
  id: string;
  tipo: string;
  props: Record<string, Scalar | Scalar[]>;
  body: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  props: Record<string, Scalar | Scalar[]>;
}

export interface PublicGraph {
  meta: { public: boolean; generatedAt: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Orden y nombre visible de cada tipo. El color vive en CSS (`--tipo-<tipo>`). */
export const TIPOS: readonly { id: string; label: string }[] = [
  { id: 'proyecto', label: 'Proyectos' },
  { id: 'tecnologia', label: 'Tecnologías' },
  { id: 'persona', label: 'Clientes y personas' },
  { id: 'canal', label: 'Canales' },
  { id: 'area', label: 'Áreas' },
  { id: 'aprendizaje', label: 'Aprendizaje' },
  { id: 'pendiente', label: 'Pendientes' },
];

/** Cómo se lee cada relación desde el origen (`out`) y desde el destino (`in`). */
export const RELATION_LABELS: Record<string, { out: string; in: string }> = {
  USA: { out: 'Usa', in: 'Usada en' },
  PARTE_DE: { out: 'Parte de', in: 'Incluye' },
  PARA_CLIENTE: { out: 'Cliente', in: 'Cliente de' },
  RELACIONADO_CON: { out: 'Relacionado con', in: 'Relacionado con' },
  CUBRE: { out: 'Cubre', in: 'Aprendida en' },
  EN_PLATAFORMA: { out: 'Plataforma', in: 'Plataforma de' },
  CON_EQUIPO: { out: 'Equipo', in: 'Equipo de' },
  MUESTRA: { out: 'Muestra', in: 'Aparece en' },
};

export const PROP_LABELS: Record<string, string> = {
  estado: 'Estado',
  rol: 'Rol',
  categoria: 'Categoría',
  nivel: 'Nivel',
  url: 'Sitio',
};
