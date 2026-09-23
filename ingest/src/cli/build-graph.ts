/**
 * npm run build-graph [-- --public] [--out <archivo>] [--vault <ruta>]
 *
 * Genera graph.json (completo, privado) o graph.public.json (--public) e
 * imprime un reporte: conteos, links rotos (nodos pendientes) y advertencias.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultOutPath, loadEnv, resolveVaultPath } from '../config.ts';
import { graphFromVault } from '../pipeline.ts';

loadEnv();
const { values } = parseArgs({
  options: {
    public: { type: 'boolean', default: false },
    out: { type: 'string' },
    vault: { type: 'string' },
  },
});

const vault = resolveVaultPath(values.vault);
const { graph, report } = graphFromVault(vault, { public: values.public! });
const out = values.out ?? defaultOutPath(values.public!);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(graph, null, 2) + '\n');

const count = <T>(xs: T[], key: (x: T) => string) =>
  Object.entries(Object.groupBy(xs, key)).map(([k, v]) => `${k} ${v!.length}`).join(', ');

console.log(`${values.public ? 'Grafo PÚBLICO' : 'Grafo completo (privado)'} → ${relative(process.cwd(), out)}`);
console.log(`  Nodos:   ${graph.nodes.length} (${count(graph.nodes, (n) => n.tipo)})`);
console.log(`  Aristas: ${graph.edges.length} (${count(graph.edges, (e) => e.type)})`);

const pend = Object.entries(report.pendientes);
if (pend.length) {
  console.log(`\nLinks a notas inexistentes (nodos "pendiente"): ${pend.length}`);
  for (const [target, refs] of pend) console.log(`  - [[${target}]] ← ${refs.join(', ')}`);
}
if (report.redactions.length) {
  console.log(`\nLinks del cuerpo redactados por apuntar a nodos privados: ${report.redactions.length}`);
  for (const r of report.redactions) console.log(`  - ${r.node} → [[${r.target}]]`);
}
if (report.warnings.length) {
  console.log(`\nAdvertencias: ${report.warnings.length}`);
  for (const w of report.warnings) console.log(`  - ${w}`);
}
if (report.skipped.length) console.log(`\nNotas omitidas (sin frontmatter o sin tipo): ${report.skipped.join(', ')}`);
