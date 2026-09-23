#!/usr/bin/env node
/**
 * Fusiona la configuración de hooks del grafo en un settings.json de Claude Code
 * SIN pisar lo existente, y de forma idempotente (correrlo N veces = 1 vez).
 *
 * Uso: node merge-settings.mjs <settings.json> <ruta-del-vault>
 *
 * - Agrega los hooks SessionStart y SessionEnd solo si su comando no está ya.
 * - Agrega el vault a permissions.additionalDirectories si no está.
 * - Conserva el resto de claves y el orden; crea el archivo si no existe.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [file, vaultPath] = process.argv.slice(2);
if (!file || !vaultPath) {
  console.error('Uso: node merge-settings.mjs <settings.json> <ruta-del-vault>');
  process.exit(1);
}

let settings = {};
if (existsSync(file)) {
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    // Nunca sobrescribir un archivo que no entendemos.
    console.error(`No se pudo leer ${file} como JSON (${err.message}). No se modificó.`);
    process.exit(1);
  }
}

// Comandos en forma "shell": $CLAUDE_PROJECT_DIR lo expande Git Bash / sh.
const HOOKS = {
  SessionStart: { command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/start.sh"', timeout: 15 },
  // SessionEnd tiene 1,5 s por defecto; se sube para alcanzar el push del vault.
  SessionEnd: { command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/end.sh"', timeout: 45 },
};

settings.hooks ??= {};
for (const [event, handler] of Object.entries(HOOKS)) {
  const groups = (settings.hooks[event] ??= []);
  const present = groups.some((g) => (g.hooks ?? []).some((h) => h.command === handler.command));
  if (!present) groups.push({ hooks: [{ type: 'command', ...handler }] });
}

settings.permissions ??= {};
const dirs = (settings.permissions.additionalDirectories ??= []);
const norm = (p) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
if (!dirs.some((d) => norm(d) === norm(vaultPath))) dirs.push(vaultPath);

writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(`settings actualizado: ${file}`);
