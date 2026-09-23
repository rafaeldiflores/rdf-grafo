/** Configuración por entorno: rutas y credenciales, nunca hardcodeadas. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carpeta del paquete `ingest` (este archivo vive en `ingest/src`). */
export const PACKAGE_DIR = resolve(import.meta.dirname, '..');

/** Carga `ingest/.env` si existe (Node ≥ 20.12, sin dependencia de dotenv). */
export function loadEnv(): void {
  const file = resolve(PACKAGE_DIR, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * Ruta al vault, en orden de prioridad: argumento `--vault`, variable
 * `VAULT_PATH`, o `../../vault` (la estructura `Grafo/{app,vault}`).
 */
export function resolveVaultPath(cliValue?: string): string {
  const path = resolve(cliValue || process.env.VAULT_PATH || resolve(PACKAGE_DIR, '../../vault'));
  if (!existsSync(path)) throw new Error(`No existe el vault en ${path}. Usa --vault o VAULT_PATH.`);
  return path;
}

/** Salida por defecto: `ingest/out/` (ignorada por git: el grafo completo es privado). */
export const defaultOutPath = (isPublic: boolean): string =>
  resolve(PACKAGE_DIR, 'out', isPublic ? 'graph.public.json' : 'graph.json');
