import { buildGraph } from '../src/graph.ts';
import { parseNote, type ParsedNote } from '../src/parser.ts';

/** Construye una nota de prueba desde un objeto de frontmatter (YAML simple). */
export function mkNote(id: string, fm: Record<string, string | string[] | undefined>, body = `# ${id}\n`): ParsedNote {
  const yaml = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]` : `${k}: ${JSON.stringify(v)}`))
    .join('\n');
  const n = parseNote(`${id}.md`, `---\n${yaml}\n---\n${body}`);
  if (!n) throw new Error(`nota de prueba inválida: ${id}`);
  return n;
}

export const link = (id: string) => `[[${id}]]`;

export const build = (notes: ParsedNote[]) => buildGraph(notes, new Date('2026-01-01T00:00:00Z'));
