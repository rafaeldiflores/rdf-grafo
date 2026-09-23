/** Recorre el vault en disco y parsea sus notas. Única parte con I/O. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseNote, type ParsedNote } from './parser.ts';

export interface VaultRead {
  notes: ParsedNote[];
  /** Archivos .md que no son nodos (sin frontmatter o sin `tipo`). */
  skipped: string[];
}

/**
 * Lee todas las notas `.md` del vault. Omite carpetas ocultas (`.obsidian`,
 * `.git`, `.trash`) y las que empiezan con `_` (`_plantillas`).
 * Falla si dos notas comparten nombre: Obsidian resolvería el link de forma
 * ambigua y el grafo mezclaría nodos distintos.
 */
export function readVault(root: string): VaultRead {
  const notes: ParsedNote[] = [];
  const skipped: string[] = [];
  const seen = new Map<string, string>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      const rel = relative(root, full).replaceAll('\\', '/');
      const note = parseNote(rel, readFileSync(full, 'utf8'));
      if (!note) {
        skipped.push(rel);
        continue;
      }
      const prev = seen.get(note.id);
      if (prev) throw new Error(`Nombre de nota duplicado "${note.id}": ${prev} y ${rel}`);
      seen.set(note.id, rel);
      notes.push(note);
    }
  };

  walk(root);
  return { notes, skipped };
}
