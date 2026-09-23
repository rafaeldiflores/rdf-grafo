/**
 * Repos locales de los proyectos (config `propagacion.local.json`, ignorada por
 * git: lleva rutas de esta máquina) y sus versiones. Única parte con I/O que
 * comparten `propagar` y `auditar-cv`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_DIR } from './config.ts';
import type { Versions } from './propagate.ts';

export interface PropagacionConfig {
  /** Proyecto (id del nodo) → ruta local de su repo. */
  proyectos: Record<string, string>;
  destinos: string[];
}

export const CONFIG_PROPAGACION = resolve(PACKAGE_DIR, 'propagacion.local.json');

export function leerConfigPropagacion(ruta = CONFIG_PROPAGACION): PropagacionConfig | null {
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as PropagacionConfig) : null;
}

/** Versiones INSTALADAS (node_modules) y, si falta alguna, las declaradas en package.json. */
export function versionsOf(repo: string): Versions {
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

/** Versión del propio proyecto (campo `version` de su package.json). */
export function versionDelProyecto(repo: string): string | undefined {
  const archivo = join(repo, 'package.json');
  if (!existsSync(archivo)) return undefined;
  const v = JSON.parse(readFileSync(archivo, 'utf8')).version;
  return typeof v === 'string' ? v : undefined;
}
