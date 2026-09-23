/**
 * npm run check-public -- <graph.public.json>
 *
 * Segunda barrera antes de publicar, independiente del filtro que generó el
 * archivo: vuelve a verificar las invariantes sobre el JSON final y falla (exit 1)
 * si alguna no se cumple. Solo imprime conteos: en CI el log es público.
 */
import { readFileSync } from 'node:fs';
import type { Graph } from '../model.ts';
import { PUBLIC_EDGE_PROPS, PUBLIC_NODE_PROPS } from '../visibility.ts';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run check-public -- <graph.public.json>');
  process.exit(1);
}

const graph = JSON.parse(readFileSync(file, 'utf8')) as Graph;
const errors: string[] = [];
const ids = new Set(graph.nodes.map((n) => n.id));

if (graph.meta?.public !== true) errors.push('meta.public no es true');
for (const n of graph.nodes) {
  if (n.tipo === 'pendiente') errors.push('hay un nodo pendiente');
  for (const k of Object.keys(n.props)) if (!PUBLIC_NODE_PROPS.includes(k)) errors.push(`propiedad no permitida: ${k}`);
  if (/^#{1,6}\s*bit[aá]cora/im.test(n.body.normalize('NFC'))) errors.push('un cuerpo contiene la sección Bitácora');
}
for (const e of graph.edges) {
  if (!ids.has(e.source) || !ids.has(e.target)) errors.push('una arista apunta a un nodo no incluido');
  for (const k of Object.keys(e.props)) if (!PUBLIC_EDGE_PROPS.includes(k)) errors.push(`propiedad de arista no permitida: ${k}`);
}

if (errors.length) {
  // Sin nombres de nodos: solo el tipo de falla.
  console.error(`check-public FALLÓ (${errors.length}):\n${[...new Set(errors)].map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`check-public OK: ${graph.nodes.length} nodos, ${graph.edges.length} aristas.`);
