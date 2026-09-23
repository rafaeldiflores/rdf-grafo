/**
 * npm run build-graph [-- --public] [--out <archivo>] [--vault <ruta>]
 *
 * Genera graph.json (completo, privado) o graph.public.json (--public) e
 * imprime un reporte: conteos, links rotos (nodos pendientes) y advertencias.
 *
 * En modo --public el detalle se omite salvo con --verbose: en CI este log es
 * PÚBLICO (repo público) y las advertencias nombran notas privadas.
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
    verbose: { type: 'boolean', default: false },
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

if (values.public && !values.verbose) {
  const n = Object.keys(report.pendientes).length + report.redactions.length + report.warnings.length + report.logros.warnings.length;
  if (n) console.log(`\n${n} avisos omitidos (pueden nombrar notas privadas). Usa --verbose en local.`);
  process.exit(0);
}

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
const lg = report.logros;
if (lg.total) {
  const sinP = Object.entries(lg.sinProyecto);
  console.log(`
Logros de la BASE: ${lg.total} (${lg.total - sinP.length} con proyecto, ${lg.total - lg.sinTecnologia.length} con tecnología)`);
  // Agrupados por el proyecto buscado: la solución es una línea "Nodo: [[…]]" por sección.
  for (const [proyecto, ids] of Object.entries(Object.groupBy(sinP, ([, p]) => p))) {
    console.log(`  - sin proyecto "${proyecto}" (agrega "Nodo: [[…]]" a su sección): ${ids!.map(([id]) => id).join(', ')}`);
  }
  if (lg.sinTecnologia.length) console.log(`  - sin tecnología reconocida (agrega aliases a la nota de tecnología): ${lg.sinTecnologia.join(', ')}`);
}
for (const w of lg.warnings) console.log(`  ! ${w}`);
if (report.skipped.length) console.log(`\nNotas omitidas (sin frontmatter o sin tipo): ${report.skipped.join(', ')}`);
