/**
 * El servidor corre con `node src/server.ts` (Node solo QUITA los tipos). vitest
 * transpila y no detectaría sintaxis no borrable (enum, parameter properties…).
 * Este test carga los módulos con Node real para cubrir ese caso.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['src/cv-tools.ts', 'src/queries.ts', '../cv/src/pdf.ts', '../ingest/src/impact.ts'])('%s se carga con node sin transpilar', (f) => {
  const url = pathToFileURL(resolve(import.meta.dirname, '..', f)).href;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { stdio: 'pipe' })).not.toThrow();
});
