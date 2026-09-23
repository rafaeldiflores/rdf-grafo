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
import { auditarVault } from '../../ingest/src/auditar-vault.ts';
import { CvStore, ESTADOS } from './cv-tools.ts';
import { brechas, buscar, impacto, logros, proyectosQueUsan, resumenProyecto, vecinos, type Runner } from './queries.ts';

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
    return { content: [{ type: 'text' as const, text: `Error: ${msg}.${hint}` }], isError: true };
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
  'logros',
  {
    title: 'Logros de la BASE',
    description:
      'Logros de la BASE de experiencia de Rafa (hechos con métricas, fuente única del CV) como nodos del grafo: filtra por tecnología que demuestran, proyecto y/o texto. Sin filtros, resume logros por proyecto y qué tecnologías están respaldadas por logros. Las reglas de uso en un CV (ESTIMADA, Sistema de postulaciones) están en la BASE.',
    inputSchema: {
      tecnologia: z.string().optional().describe('Tecnología que demuestra, p. ej. "Angular"'),
      proyecto: z.string().optional().describe('Proyecto, p. ej. "MedInfo"'),
      texto: z.string().optional().describe('Texto a buscar en título, tec, métrica y contexto, p. ej. "RAG"'),
    },
    annotations: readOnly,
  },
  (f) => tool(() => logros(run, f))(),
);

server.registerTool(
  'brechas',
  {
    title: 'Brechas frente a una oferta',
    description:
      'Clasifica lo que pide una oferta laboral contra el grafo de Rafa: demostrado con logros de la BASE, solo declarado en el stack de un proyecto, mencionado en logros sin nota de tecnología, conocido sin uso, o brecha. Extrae tú los requisitos de la oferta (tecnologías, herramientas, metodologías) y pásalos en `requisitos`; pasa también el texto en `oferta` para detectar tecnologías conocidas que se te escapen. No inventa respaldo: solo cuenta lo que está en el grafo.',
    inputSchema: {
      requisitos: z.array(z.string()).describe('Términos que pide la oferta, tal como aparecen, p. ej. ["React", "Docker", "Scrum"]'),
      oferta: z.string().optional().describe('Texto completo de la oferta (opcional)'),
    },
    annotations: readOnly,
  },
  ({ requisitos, oferta }) => tool(() => brechas(run, requisitos, oferta))(),
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

// ── CVs y postulaciones (vault local). Escrituras acotadas: ver cv-tools.ts. ──
const cv = new CvStore(resolve(process.env.VAULT_PATH ?? resolve(import.meta.dirname, '../../../vault')));
const json = (fn: () => unknown | Promise<unknown>) => tool(async () => JSON.stringify(await fn()));

server.registerTool(
  'cv_contexto',
  {
    title: 'Contexto para adaptar un CV',
    description: 'BASE de experiencia (fuente única de logros), los CVs base por perfil en Markdown, las instrucciones de redacción editables del vault (null si no hay) y las reglas (fechas fijas, textos vetados, estados del Tracker).',
    inputSchema: {},
    annotations: readOnly,
  },
  () => json(() => cv.contexto())(),
);

server.registerTool(
  'auditar_cv',
  {
    title: 'Auditoría de frescura del CV',
    description:
      '¿Están al día la BASE y los CVs base con los proyectos, sus stacks y sus repos? Reporta versiones desfasadas (del proyecto y de sus tecnologías), proyectos sin logros, tecnologías del stack que la BASE no nombra y tecnologías demostradas que ningún CV base muestra, con la acción sugerida. Lee el vault local; no escribe nada. Úsala antes de generar CVs o cuando Rafa pregunte si su CV está actualizado.',
    inputSchema: {},
    annotations: readOnly,
  },
  () => tool(async () => auditarVault(cv.vault).texto)(),
);

server.registerTool(
  'cv_validar',
  {
    title: 'Validar y previsualizar un CV',
    description: 'Aplica el verificador (reglas de la BASE y ATS), renderiza con la plantilla y mide: páginas, líneas de más, líneas del Resumen. Devuelve el HTML para vista previa. No escribe nada.',
    inputSchema: { markdown: z.string().describe('CV en el formato de app/cv (frontmatter titulo + 4 secciones)') },
    annotations: readOnly,
  },
  ({ markdown }) => json(() => cv.validar(markdown))(),
);

server.registerTool(
  'cv_generar_pdf',
  {
    title: 'Generar el PDF del CV',
    description: 'Genera el PDF solo si pasa todas las reglas y cabe en 1 página. Escribe únicamente en vault/cv/generados/ (el .md y el .pdf).',
    inputSchema: {
      markdown: z.string(),
      nombre: z.string().describe('Nombre del archivo sin extensión, p. ej. "CV_RDF_Getdata_Mobile_20260923"'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ({ markdown, nombre }) => json(() => cv.generarPdf(markdown, nombre))(),
);

server.registerTool(
  'postulaciones_listar',
  {
    title: 'Listar postulaciones',
    description: 'Todas las postulaciones del Tracker (frontmatter de vault/postulaciones).',
    inputSchema: {},
    annotations: readOnly,
  },
  () => json(() => cv.listarPostulaciones())(),
);

server.registerTool(
  'postulacion_guardar',
  {
    title: 'Crear o actualizar una postulación',
    description: 'Crea o actualiza la nota "Empresa - Cargo" en vault/postulaciones (siempre privada). Solo cambia los campos enviados; "notas" se agrega al cuerpo con fecha.',
    inputSchema: {
      empresa: z.string(),
      cargo: z.string(),
      estado: z.enum(ESTADOS),
      area: z.string().optional(),
      fecha: z.string().optional().describe('AAAA-MM-DD'),
      canal: z.string().optional(),
      cv_perfil: z.string().optional(),
      cv_pdf: z.string().optional(),
      keywords_cubiertas: z.string().optional(),
      proxima_accion: z.string().optional(),
      proxima_fecha: z.string().optional().describe('AAAA-MM-DD'),
      motivo_descarte: z.string().optional(),
      url: z.string().optional(),
      notas: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  (p) => json(() => cv.guardarPostulacion(p))(),
);

await server.connect(new StdioServerTransport());
const shutdown = async () => {
  await driver.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
