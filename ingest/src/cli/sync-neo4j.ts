/**
 * npm run sync-neo4j [-- --public] [--vault <ruta>]
 *
 * Sincroniza el grafo con Neo4j AuraDB. Por defecto sube el grafo COMPLETO:
 * la base es privada (credenciales en .env) y la usa el MCP local. Con
 * --public sube solo lo exportable, por si algún día la base se expone.
 */
import neo4j from 'neo4j-driver';
import { parseArgs } from 'node:util';
import { loadEnv, resolveVaultPath } from '../config.ts';
import { syncToNeo4j } from '../neo4j-sync.ts';
import { graphFromVault } from '../pipeline.ts';

loadEnv();
const { values } = parseArgs({
  options: { public: { type: 'boolean', default: false }, vault: { type: 'string' } },
});

const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = process.env;
const missing = Object.entries({ NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Faltan variables en app/ingest/.env: ${missing.join(', ')} (ver .env.example)`);
  process.exit(1);
}

const { graph } = graphFromVault(resolveVaultPath(values.vault), { public: values.public! });
const driver = neo4j.driver(NEO4J_URI!, neo4j.auth.basic(NEO4J_USERNAME!, NEO4J_PASSWORD!));
try {
  await driver.getServerInfo(); // falla rápido si la URI o las credenciales están mal
  await syncToNeo4j(driver, graph, NEO4J_DATABASE || undefined);
  console.log(`Neo4j sincronizado (${values.public ? 'público' : 'completo'}): ${graph.nodes.length} nodos, ${graph.edges.length} aristas.`);
} catch (err) {
  console.error('Error al sincronizar con Neo4j:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await driver.close();
}
