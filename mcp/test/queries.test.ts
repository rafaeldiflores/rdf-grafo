import { describe, expect, it } from 'vitest';
import { buscar, proyectosQueUsan, resolveNode, vecinos, type Runner } from '../src/queries.ts';

/** Runner falso: responde según fragmentos de la consulta, y registra lo ejecutado. */
function fakeRunner(responses: [RegExp, Record<string, unknown>[]][]) {
  const calls: { cypher: string; params: Record<string, unknown> }[] = [];
  const run: Runner = async (cypher, params = {}) => {
    calls.push({ cypher, params });
    const hit = responses.find(([re]) => re.test(cypher));
    if (!hit) return [];
    const [, rows] = hit;
    // Simula el filtro por tipo de resolveNode.
    return params.tipo ? rows.filter((r) => !r.tipo || r.tipo === params.tipo) : rows;
  };
  return { run, calls };
}

const ids = [
  { id: 'Firebase', tipo: 'tecnologia' },
  { id: 'MAZA', tipo: 'proyecto' },
  { id: 'MAZA web', tipo: 'proyecto' },
  { id: 'Búsqueda de trabajo', tipo: 'area' },
];

describe('resolveNode', () => {
  const { run } = fakeRunner([[/RETURN n\.id AS id ORDER BY id/, ids]]);
  it('ignora tildes y mayúsculas', async () => {
    expect(await resolveNode(run, 'busqueda DE trabajo')).toEqual({ id: 'Búsqueda de trabajo' });
  });
  it('prefiere la coincidencia exacta a la parcial', async () => {
    expect(await resolveNode(run, 'maza')).toEqual({ id: 'MAZA' });
  });
  it('acepta una única coincidencia parcial y sugiere si hay varias', async () => {
    expect(await resolveNode(run, 'fireb')).toEqual({ id: 'Firebase' });
    expect(await resolveNode(run, 'a')).toMatchObject({ suggestions: expect.arrayContaining(['MAZA', 'MAZA web']) });
  });
});

describe('proyectosQueUsan', () => {
  it('lista proyectos con destacado y visibilidad', async () => {
    const { run } = fakeRunner([
      [/RETURN n\.id AS id ORDER BY id/, ids],
      [/-\[u:USA\]->/, [
        { id: 'MAZA', tipo: 'proyecto', estado: 'activo', visibilidad: 'publico', destacado: true },
        { id: 'MedInfo', tipo: 'proyecto', estado: 'en_espera', visibilidad: 'privado', destacado: false },
      ]],
    ]);
    const out = await proyectosQueUsan(run, 'firebase');
    expect(out).toContain('"Firebase" se usa en 2');
    expect(out).toContain('- MAZA (proyecto, activo, público) ★ destacada');
    expect(out).toContain('- MedInfo (proyecto, en_espera, privado)');
  });
  it('sugiere cuando no existe la tecnología', async () => {
    const { run } = fakeRunner([[/RETURN n\.id AS id ORDER BY id/, ids]]);
    expect(await proyectosQueUsan(run, 'Kotlin')).toMatch(/No encontré la tecnología "Kotlin"/);
  });
});

describe('vecinos', () => {
  it('acota la profundidad a 1..3 antes de interpolarla en Cypher', async () => {
    const { run, calls } = fakeRunner([[/RETURN n\.id AS id ORDER BY id/, ids]]);
    await vecinos(run, 'MAZA', 99);
    await vecinos(run, 'MAZA', -5);
    const depths = calls.map((c) => /\*1\.\.(\d+)/.exec(c.cypher)?.[1]).filter(Boolean);
    expect(depths).toEqual(['3', '1']);
  });
  it('pasa el id como parámetro, nunca interpolado', async () => {
    const { run, calls } = fakeRunner([[/RETURN n\.id AS id ORDER BY id/, ids]]);
    await vecinos(run, 'MAZA', 1);
    for (const c of calls.slice(1)) {
      expect(c.cypher).not.toContain('MAZA');
      expect(c.params.id).toBe('MAZA');
    }
  });
});

describe('buscar', () => {
  it('busca sin tildes', async () => {
    const { run } = fakeRunner([[/RETURN n\.id AS id, n\.tipo AS tipo ORDER BY id/, ids]]);
    expect(await buscar(run, 'busq')).toBe('- Búsqueda de trabajo (area)');
  });
});
