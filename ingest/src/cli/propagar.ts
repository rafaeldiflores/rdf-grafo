/**
 * npm run propagar [-- --check] [--config <archivo>] [--vault <ruta>]
 *
 * Regenera los bloques <!-- grafo:... --> de los archivos destino listados en
 * la config. Sin --check escribe los cambios (revísalos con `git diff` en cada
 * repo antes de commitear). Con --check no escribe y sale con código 1 si algún
 * bloque está desactualizado (útil en hooks o CI).
 *
 * Config (propagacion.local.json, ignorada por git: lleva rutas de esta máquina):
 *   {
 *     "proyectos": { "MAZA": "C:/ruta/al/repo/de/MAZA" },   // de dónde leer package.json
 *     "destinos": [ "C:/ruta/al/portafolio/index.html", "C:/ruta/README.md" ]
 *   }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv, PACKAGE_DIR, resolveVaultPath } from '../config.ts';
import {
  findBlocks,
  projectStack,
  renderChips,
  renderTable,
  replaceBlocks,
  type Block,
  type Versions,
} from '../propagate.ts';
import { readVault } from '../vault.ts';

loadEnv();
const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    config: { type: 'string', default: resolve(PACKAGE_DIR, 'propagacion.local.json') },
    vault: { type: 'string' },
  },
});

if (!existsSync(values.config!)) {
  console.error(`Falta la config ${values.config} (ver el comentario de src/cli/propagar.ts).`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(values.config!, 'utf8')) as {
  proyectos: Record<string, string>;
  destinos: string[];
};
const { notes } = readVault(resolveVaultPath(values.vault));

/** Versiones INSTALADAS (node_modules) y, si falta alguna, las declaradas en package.json. */
function versionsOf(repo: string): Versions {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const versions: Versions = {};
  for (const [name, declared] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>)) {
    try {
      versions[name] = JSON.parse(readFileSync(join(repo, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch {
      versions[name] = declared;
    }
  }
  return versions;
}

const cache = new Map<string, Versions>();
const versionsFor = (project: string): Versions => {
  const repo = config.proyectos[project];
  if (!repo) throw new Error(`La config no tiene la ruta del repo de "${project}" (proyectos.${project})`);
  if (!cache.has(project)) cache.set(project, versionsOf(repo));
  return cache.get(project)!;
};

const CRLF = String.fromCharCode(13, 10);

let stale = 0;
for (const file of config.destinos) {
  const before = readFileSync(file, 'utf8');
  const blocks = findBlocks(before);
  if (!blocks.length) {
    console.log(`· ${file}: sin bloques grafo`);
    continue;
  }
  const notices: string[] = [];

  const render = (b: Block): string => {
    const ps = projectStack(notes, b.project);
    const versions = versionsFor(b.project);
    if (b.format === 'chips') return renderChips(ps, versions);
    if (b.format === 'tabla') {
      const { table, dropped } = renderTable(ps, versions, b.inner);
      if (dropped.length) notices.push(`filas sin tecnología en el vault (se quitaron): ${dropped.join(', ')}`);
      return table;
    }
    throw new Error(`${file}: formato de bloque desconocido "${b.format}"`);
  };

  // Respeta el fin de línea del archivo (los README en Windows suelen ser CRLF).
  const usesCrlf = before.includes(CRLF);
  const after = replaceBlocks(before, (b) => {
    const out = render(b).split(CRLF).join('\n');
    return usesCrlf ? out.split('\n').join(CRLF) : out;
  });

  if (after === before) {
    console.log(`✓ ${file}: al día (${blocks.length} bloque/s)`);
  } else {
    stale++;
    if (!values.check) writeFileSync(file, after);
    console.log(`${values.check ? '✗ desactualizado' : '✎ actualizado'}: ${file}`);
  }
  for (const n of notices) console.log(`    ⚠ ${n}`);
}

if (values.check && stale) process.exit(1);
