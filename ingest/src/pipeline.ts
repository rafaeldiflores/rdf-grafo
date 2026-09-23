/** vault en disco → grafo (completo o público) + reporte. Compartido por las CLIs. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addLogros, buildGraph, type BuildReport, type LogrosReport } from './graph.ts';
import { parseLogros, RUTA_BASE } from './logros.ts';
import type { Graph } from './model.ts';
import { readVault } from './vault.ts';
import { filterPublic, type PublicFilterResult } from './visibility.ts';

export interface PipelineResult {
  graph: Graph;
  report: BuildReport & { skipped: string[]; redactions: PublicFilterResult['redactions']; logros: LogrosReport };
}

export function graphFromVault(vaultPath: string, opts: { public: boolean }): PipelineResult {
  const { notes, skipped } = readVault(vaultPath);
  const { graph: full, report } = buildGraph(notes);

  // Los logros se agregan al grafo completo; el filtro público los descarta siempre (NEVER_PUBLIC_TIPOS).
  const base = join(vaultPath, RUTA_BASE);
  const parsed = existsSync(base) ? parseLogros(readFileSync(base, 'utf8')) : { logros: [], warnings: [] };
  const logros = addLogros(full, parsed.logros);
  logros.warnings.unshift(...parsed.warnings);

  if (!opts.public) return { graph: full, report: { ...report, skipped, redactions: [], logros } };
  const { graph, redactions } = filterPublic(full);
  return { graph, report: { ...report, skipped, redactions, logros } };
}
