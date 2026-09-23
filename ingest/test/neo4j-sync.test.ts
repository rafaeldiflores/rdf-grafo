import type { Driver } from 'neo4j-driver';
import { describe, expect, it } from 'vitest';
import type { Graph } from '../src/model.ts';
import { buildSyncStatements, CONSTRAINT, syncToNeo4j } from '../src/neo4j-sync.ts';
import { build, link, mkNote } from './helpers.ts';

const { graph } = build([
  mkNote('MAZA', { tipo: 'proyecto', estado: 'activo', stack: [link('Firebase')], stack_destacado: [link('Firebase')] }),
  mkNote('Firebase', { tipo: 'tecnologia' }),
  mkNote('Raro', { tipo: 'otro' }),
]);

describe('buildSyncStatements', () => {
  const st = buildSyncStatements(graph);

  it('hace MERGE de nodos por id y asigna el label de su tipo', () => {
    const proyecto = st.find((s) => s.query.includes('SET n:Proyecto'))!;
    expect(proyecto.query).toContain('MERGE (n:Nodo {id: row.id})');
    expect(proyecto.params.rows).toEqual([
      { estado: 'activo', id: 'MAZA', tipo: 'proyecto', body: '# MAZA\n' },
    ]);
  });

  it('un tipo desconocido solo recibe :Nodo (nada se interpola sin validar)', () => {
    const raro = st.find((s) => JSON.stringify(s.params).includes('"Raro"'))!;
    expect(raro.query).not.toMatch(/SET n:/);
  });

  it('hace MERGE de aristas con sus propiedades', () => {
    const usa = st.find((s) => s.query.includes('[r:USA]'))!;
    expect(usa.params.rows).toEqual([{ source: 'MAZA', target: 'Firebase', props: { destacado: true } }]);
  });

  it('elimina lo que ya no está en el vault', () => {
    const [edges, nodes] = st.slice(-2);
    expect(edges!.params.keys).toEqual(['MAZA|USA|Firebase']);
    expect(nodes!.query).toContain('DETACH DELETE');
    expect(nodes!.params.ids).toEqual(['Firebase', 'MAZA', 'Raro']);
  });

  it('rechaza tipos de relación fuera de la lista blanca (inyección de Cypher)', () => {
    const evil: Graph = { ...graph, edges: [{ source: 'MAZA', target: 'Firebase', type: 'X]->() DETACH DELETE (a) //', props: {} }] };
    expect(() => buildSyncStatements(evil)).toThrow(/no permitido/);
  });

  it('las claves reservadas no se pueden pisar desde el frontmatter', () => {
    const g = build([mkNote('A', { tipo: 'proyecto', id: 'otro', body: 'x' })]).graph;
    const row = (buildSyncStatements(g)[0]!.params.rows as Record<string, unknown>[])[0]!;
    expect(row.id).toBe('A');
    expect(row.body).toBe('# A\n');
  });
});

describe('syncToNeo4j', () => {
  it('crea la restricción fuera de la transacción y escribe todo en una sola', async () => {
    const log: string[] = [];
    const session = {
      run: async (q: string) => void log.push(`session: ${q}`),
      executeWrite: async (fn: (tx: unknown) => Promise<void>) => {
        log.push('BEGIN');
        await fn({ run: async (q: string) => void log.push(`tx: ${q.split('\n')[0]}`) });
        log.push('COMMIT');
      },
      close: async () => void log.push('close'),
    };
    const driver = { session: () => session } as unknown as Driver;
    await syncToNeo4j(driver, graph);
    expect(log[0]).toBe(`session: ${CONSTRAINT}`);
    expect(log[1]).toBe('BEGIN');
    expect(log.at(-2)).toBe('COMMIT');
    expect(log.at(-1)).toBe('close');
    expect(log.filter((l) => l.startsWith('tx:'))).toHaveLength(buildSyncStatements(graph).length);
  });

  it('cierra la sesión aunque falle la escritura', async () => {
    let closed = false;
    const session = {
      run: async () => {},
      executeWrite: async () => {
        throw new Error('boom');
      },
      close: async () => void (closed = true),
    };
    await expect(syncToNeo4j({ session: () => session } as unknown as Driver, graph)).rejects.toThrow('boom');
    expect(closed).toBe(true);
  });
});
