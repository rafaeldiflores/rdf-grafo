/** Auditoría del CV sobre el vault en disco y los repos locales. Compartida por la CLI y el MCP. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditar, formatAuditoria, type Hallazgo, type RepoInfo } from './auditoria.ts';
import { RUTA_BASE } from './logros.ts';
import { graphFromVault } from './pipeline.ts';
import { CONFIG_PROPAGACION, leerConfigPropagacion, versionDelProyecto, versionsOf } from './repos.ts';

export function auditarVault(vault: string, config = CONFIG_PROPAGACION): { hallazgos: Hallazgo[]; texto: string } {
  const { graph } = graphFromVault(vault, { public: false });
  const base = existsSync(join(vault, RUTA_BASE)) ? readFileSync(join(vault, RUTA_BASE), 'utf8') : '';
  const dir = join(vault, 'cv/base');
  const cvs = Object.fromEntries(
    (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.md')).map((f) => [f.slice(0, -3), readFileSync(join(dir, f), 'utf8')]),
  );
  const repos: Record<string, RepoInfo> = {};
  for (const [proyecto, ruta] of Object.entries(leerConfigPropagacion(config)?.proyectos ?? {})) {
    if (existsSync(join(ruta, 'package.json'))) repos[proyecto] = { version: versionDelProyecto(ruta), paquetes: versionsOf(ruta) };
  }
  const sinRepos = graph.nodes.filter((n) => n.tipo === 'proyecto' && n.props.repo && !repos[n.id]).map((n) => n.id);
  const hallazgos = auditar({ graph, base, cvs, repos });
  return { hallazgos, texto: formatAuditoria(hallazgos, sinRepos) };
}
