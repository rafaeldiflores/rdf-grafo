/**
 * Postulador — MCP remoto (Cloudflare Worker) para usar desde claude.ai, la app
 * de escritorio, el celular y el artefacto "Postulador".
 *
 * Seguridad (ver README):
 *  - OAuth 2.1 (workers-oauth-provider) con login de GitHub; solo el usuario
 *    cuyo id numérico es ALLOWED_GITHUB_ID recibe un token (github-handler.ts)
 *    y, además, cada herramienta lo vuelve a comprobar.
 *  - El vault se lee/escribe con listas blancas de rutas (vault.ts) y un token
 *    fine-grained limitado a rdf-vault → Contents.
 *  - Sin herramientas de borrado; cada escritura es un commit reversible.
 */
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { z } from 'zod';
import { ESTADOS } from '../../cv/src/postulaciones.ts';
import { Postulador } from './cv.ts';
import { GitHubHandler } from './github-handler.ts';
import { htmlAPdf, type BrowserBinding } from './pdf.ts';
import type { Props } from './utils.ts';
import { Vault } from './vault.ts';

const soloLectura = { readOnlyHint: true, openWorldHint: false };
const escritura = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export class PostuladorMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: 'postulador', version: '0.1.0' });

  /** Defensa en profundidad: además del filtro en el login, cada llamada verifica la identidad. */
  private autorizado(): boolean {
    return String(this.props?.githubId ?? '') === String(this.env.ALLOWED_GITHUB_ID);
  }

  private postulador() {
    return new Postulador(new Vault(this.env.VAULT_TOKEN, this.env.VAULT_REPO), (html, papel) =>
      // El tipo generado (BrowserRun) y el que espera @cloudflare/puppeteer (Fetcher) difieren; en ejecución es el mismo binding.
      htmlAPdf(this.env.BROWSER as unknown as BrowserBinding, html, papel),
    );
  }

  /** Envuelve cada herramienta: identidad, JSON de salida y errores legibles sin filtrar detalles internos. */
  private herramienta<T>(fn: (p: Postulador) => Promise<T>) {
    return async () => {
      if (!this.autorizado()) return { content: [{ type: 'text' as const, text: 'No autorizado.' }], isError: true };
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(this.postulador())) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    };
  }

  async init() {
    this.server.registerTool(
      'cv_contexto',
      {
        title: 'Contexto para adaptar un CV',
        description: 'BASE de experiencia (fuente única de logros), los CVs base por perfil en Markdown, las instrucciones de redacción editables del vault (null si no hay) y las reglas (fechas fijas, textos vetados, estados del Tracker).',
        inputSchema: {},
        annotations: soloLectura,
      },
      () => this.herramienta((p) => p.contexto())(),
    );

    this.server.registerTool(
      'cv_validar',
      {
        title: 'Validar y previsualizar un CV',
        description: 'Aplica el verificador (reglas de la BASE y ATS), renderiza con la plantilla y mide páginas, líneas de más y líneas del Resumen. Devuelve el HTML para vista previa. No escribe nada.',
        inputSchema: { markdown: z.string().max(40_000) },
        annotations: soloLectura,
      },
      ({ markdown }) => this.herramienta((p) => p.validar(markdown))(),
    );

    this.server.registerTool(
      'cv_generar_pdf',
      {
        title: 'Generar el PDF del CV',
        description: 'Genera el PDF solo si pasa todas las reglas y cabe en 1 página. Lo guarda (con su fuente .md) en cv/generados/ del vault y lo devuelve en base64.',
        inputSchema: { markdown: z.string().max(40_000), nombre: z.string().min(1).max(120) },
        annotations: { ...escritura, idempotentHint: true },
      },
      ({ markdown, nombre }) => this.herramienta((p) => p.generarPdf(markdown, nombre))(),
    );

    this.server.registerTool(
      'brechas',
      {
        title: 'Brechas frente a una oferta',
        description:
          'Clasifica lo que pide una oferta contra el grafo de Rafa: demostrada (logros de la BASE), declarada (stack de un proyecto), mencionada (texto de un logro, sin nota de tecnología), conocida (nota sin uso) o brecha. Extrae tú los requisitos de la oferta y pásalos en `requisitos`; `oferta` (texto) detecta además tecnologías conocidas. Devuelve {requisitos, cobertura: {respaldadas, total}}; respaldadas = demostrada + declarada + mencionada. No inventa respaldo.',
        inputSchema: {
          requisitos: z.array(z.string()).default([]).describe('Términos que pide la oferta, p. ej. ["React", "Docker"]'),
          oferta: z.string().optional().describe('Texto de la oferta (opcional)'),
        },
        annotations: soloLectura,
      },
      ({ requisitos, oferta }) => this.herramienta((p) => p.brechas(requisitos, oferta ?? ''))(),
    );

    this.server.registerTool(
      'auditar_cv',
      {
        title: 'Auditoría de frescura del CV',
        description:
          '¿Están al día la BASE y los CVs base con los proyectos y sus stacks? Proyectos sin logros, tecnologías del stack que la BASE no nombra y tecnologías demostradas que ningún CV base muestra, cada una con su acción. Las reglas de versión (contra los repos) solo corren en local y se listan en `omitidas`. No escribe nada.',
        inputSchema: {},
        annotations: soloLectura,
      },
      () => this.herramienta((p) => p.auditar())(),
    );

    this.server.registerTool(
      'postulaciones_listar',
      {
        title: 'Listar postulaciones',
        description: 'Todas las postulaciones del Tracker (frontmatter de las notas de vault/postulaciones).',
        inputSchema: {},
        annotations: soloLectura,
      },
      () => this.herramienta((p) => p.listarPostulaciones())(),
    );

    this.server.registerTool(
      'postulacion_guardar',
      {
        title: 'Crear o actualizar una postulación',
        description: 'Crea o actualiza la nota "Empresa - Cargo" en vault/postulaciones (siempre privada). Solo cambia los campos enviados; "notas" se agrega al cuerpo con fecha.',
        inputSchema: {
          empresa: z.string().min(1).max(120),
          cargo: z.string().min(1).max(200),
          estado: z.enum(ESTADOS),
          area: z.string().max(200).optional(),
          fecha: z.string().max(10).optional(),
          canal: z.string().max(120).optional(),
          cv_perfil: z.string().max(60).optional(),
          cv_pdf: z.string().max(200).optional(),
          keywords_cubiertas: z.string().max(1000).optional(),
          proxima_accion: z.string().max(300).optional(),
          proxima_fecha: z.string().max(10).optional(),
          motivo_descarte: z.string().max(300).optional(),
          url: z.string().max(500).optional(),
          notas: z.string().max(2000).optional(),
        },
        annotations: { ...escritura, idempotentHint: false },
      },
      (input) => this.herramienta((p) => p.guardarPostulacion(input))(),
    );
  }
}

export default new OAuthProvider({
  apiHandler: PostuladorMCP.serve('/mcp'),
  apiRoute: '/mcp',
  authorizeEndpoint: '/authorize',
  clientRegistrationEndpoint: '/register',
  defaultHandler: GitHubHandler as never,
  tokenEndpoint: '/token',
});
