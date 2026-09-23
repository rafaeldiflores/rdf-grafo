/**
 * Servidor MCP (stdio) de solo lectura sobre el grafo de proyectos en Neo4j.
 *
 *   claude mcp add --scope user grafo -- node "<ruta>/app/mcp/src/server.ts"
 *
 * Credenciales: las mismas de app/ingest/.env (o el archivo que indique
 * GRAFO_ENV). No se copian a la config de Claude Code.
 * Solo lectura: todas las consultas corren en transacciones READ; Neo4j
 * rechaza cualquier escritura dentro de ellas.
 *
 * Importante: en stdio, stdout es el canal del protocolo. Los logs van a stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import neo4j from 'neo4j-driver';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buscar, impacto, proyectosQueUsan, resumenProyecto, vecinos, type Runner } from './queries.ts';

const envFile = process.env.GRAFO_ENV ?? resolve(import.meta.dirname, '../../ingest/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = process.env;
if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  console.error(`[grafo-mcp] Faltan credenciales de Neo4j (buscadas en ${envFile}).`);
  process.exit(1);
}

// Enteros de Neo4j como number de JS (el grafo es chico, no hay riesgo de desborde).
const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD), {
  disableLosslessIntegers: true,
});

const run: Runner = async (cypher, params = {}) => {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ, ...(NEO4J_DATABASE ? { database: NEO4J_DATABASE } : {}) });
  try {
    const result = await session.executeRead((tx) => tx.run(cypher, params));
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
};

/** Envuelve una consulta: errores legibles (p. ej. AuraDB Free pausada) en vez de excepciones. */
const tool = (fn: () => Promise<string>) => async () => {
  try {
    return { content: [{ type: 'text' as const, text: await fn() }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /ServiceUnavailable|connect|ENOTFOUND|routing/i.test(msg)
      ? ' Si la instancia AuraDB Free estuvo 3 días sin uso, se pausa: reanúdala en console.neo4j.io.'
      : '';
    return { content: [{ type: 'text' as const, text: `Error consultando Neo4j: ${msg}.${hint}` }], isError: true };
  }
};

const server = new McpServer({ name: 'grafo', version: '0.1.0' });
const readOnly = { readOnlyHint: true, openWorldHint: false };

server.registerTool(
  'proyectos_que_usan',
  {
    title: 'Proyectos que usan una tecnología',
    description: 'Lista los proyectos y áreas del grafo de Rafa que usan una tecnología (acepta nombres aproximados, sin tildes).',
    inputSchema: { tecnologia: z.string().describe('Nombre de la tecnología, p. ej. "Firebase"') },
    annotations: readOnly,
  },
  ({ tecnologia }) => tool(() => proyectosQueUsan(run, tecnologia))(),
);

server.registerTool(
  'vecinos',
  {
    title: 'Vecinos de un nodo',
    description: 'Nodos conectados a un proyecto, tecnología, persona, etc., agrupados por distancia, y sus relaciones directas.',
    inputSchema: {
      nodo: z.string().describe('Nombre del nodo, p. ej. "MAZA"'),
      profundidad: z.number().int().min(1).max(3).default(1).describe('Saltos a recorrer (1 a 3)'),
    },
    annotations: readOnly,
  },
  ({ nodo, profundidad }) => tool(() => vecinos(run, nodo, profundidad))(),
);

server.registerTool(
  'resumen_proyecto',
  {
    title: 'Resumen de un proyecto',
    description: 'Datos del proyecto (estado, rol, url, repo…), todas sus relaciones y el texto de su nota, incluida la Bitácora.',
    inputSchema: { nombre: z.string().describe('Nombre del proyecto, p. ej. "MedInfo"') },
    annotations: readOnly,
  },
  ({ nombre }) => tool(() => resumenProyecto(run, nombre))(),
);

server.registerTool(
  'impacto',
  {
    title: 'Impacto de un cambio',
    description:
      'Qué hay que revisar si cambia un nodo (portafolio, sitios, CV que lo muestran; proyectos que usan una tecnología), con el camino de cada dependencia y el estado del stack.',
    inputSchema: { nodo: z.string().describe('Nombre del nodo que cambió, p. ej. "MAZA" o "Angular"') },
    annotations: readOnly,
  },
  ({ nodo }) => tool(() => impacto(run, nodo))(),
);

server.registerTool(
  'buscar_nodo',
  {
    title: 'Buscar en el grafo',
    description: 'Busca nodos cuyo nombre contenga el texto (sin distinguir tildes ni mayúsculas).',
    inputSchema: { texto: z.string() },
    annotations: readOnly,
  },
  ({ texto }) => tool(() => buscar(run, texto))(),
);

await server.connect(new StdioServerTransport());
const shutdown = async () => {
  await driver.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
