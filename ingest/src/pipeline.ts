/** vault en disco → grafo (completo o público) + reporte. Compartido por las CLIs. */
import { buildGraph, type BuildReport } from './graph.ts';
import type { Graph } from './model.ts';
import { readVault } from './vault.ts';
import { filterPublic, type PublicFilterResult } from './visibility.ts';

export interface PipelineResult {
  graph: Graph;
  report: BuildReport & { skipped: string[]; redactions: PublicFilterResult['redactions'] };
}

export function graphFromVault(vaultPath: string, opts: { public: boolean }): PipelineResult {
  const { notes, skipped } = readVault(vaultPath);
  const { graph: full, report } = buildGraph(notes);
  if (!opts.public) return { graph: full, report: { ...report, skipped, redactions: [] } };
  const { graph, redactions } = filterPublic(full);
  return { graph, report: { ...report, skipped, redactions } };
}
