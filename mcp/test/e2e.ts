/**
 * Prueba de punta a punta contra la AuraDB real, hablando MCP por stdio con
 * el mismo cliente que usan las aplicaciones. Uso: npm run e2e
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const client = new Client({ name: 'grafo-e2e', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [resolve(import.meta.dirname, '../src/server.ts')] }),
);

const { tools } = await client.listTools();
console.log(`Tools: ${tools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? ' (solo lectura)' : ''}`).join(', ')}\n`);

const calls: [string, Record<string, unknown>][] = [
  ['proyectos_que_usan', { tecnologia: 'firebase' }],
  ['vecinos', { nodo: 'medinfo', profundidad: 1 }],
  ['resumen_proyecto', { nombre: 'litoralbikes' }],
  ['impacto', { nodo: 'Angular' }],
  ['buscar_nodo', { texto: 'cloud' }],
];
let failed = 0;
for (const [name, args] of calls) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = res.content.map((c) => c.text).join('\n');
  if (res.isError) failed++;
  console.log(`── ${name}(${JSON.stringify(args)})${res.isError ? ' ✗' : ''}\n${text.split('\n').slice(0, 12).join('\n')}\n`);
}
await client.close();
process.exit(failed ? 1 : 0);
