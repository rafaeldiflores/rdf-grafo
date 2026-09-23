/**
 * npm run impacto -- <nodo> [--profundidad 3] [--json] [--vault <ruta>]
 *
 * Lista todo lo que hay que revisar cuando cambia un nodo, usando el grafo
 * completo (privado): es una herramienta personal, no se publica.
 */
import { parseArgs } from 'node:util';
import { loadEnv, resolveVaultPath } from '../config.ts';
import { findNode, formatImpact, impactOf } from '../impact.ts';
import { graphFromVault } from '../pipeline.ts';

loadEnv();
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profundidad: { type: 'string', default: '3' },
    json: { type: 'boolean', default: false },
    vault: { type: 'string' },
  },
});

const query = positionals.join(' ');
if (!query) {
  console.error('Uso: npm run impacto -- <nombre del nodo>');
  process.exit(1);
}

const { graph } = graphFromVault(resolveVaultPath(values.vault), { public: false });
const found = findNode(graph, query);
if ('suggestions' in found) {
  console.error(`No existe "${query}".${found.suggestions.length ? ` ¿Quisiste decir: ${found.suggestions.join(', ')}?` : ''}`);
  process.exit(1);
}

const result = impactOf(graph, found.id, Number(values.profundidad));
console.log(values.json ? JSON.stringify(result, null, 2) : formatImpact(result));
