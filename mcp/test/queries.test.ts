import { describe, expect, it } from 'vitest';
import { buscar, logros, proyectosQueUsan, resolveNode, vecinos, type Runner } from '../src/queries.ts';

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
  { id: 'Firebase', tipo: 'tecnologia', aliases: ['Firestore'] },
  { id: 'MAZA', tipo: 'proyecto' },
  { id: 'MAZA web', tipo: 'proyecto' },
  { id: 'Búsqueda de trabajo', tipo: 'area' },
];

describe('resolveNode', () => {
  const { run } = fakeRunner([[/RETURN n\.id AS id, n\.aliases AS aliases/, ids]]);
  it('ignora tildes y mayúsculas', async () => {
    expect(await resolveNode(run, 'busqueda DE trabajo')).toEqual({ id: 'Búsqueda de trabajo' });
  });
  it('acepta un alias exacto de Obsidian', async () => {
    expect(await resolveNode(run, 'firestore')).toEqual({ id: 'Firebase' });
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
      [/RETURN n\.id AS id, n\.aliases AS aliases/, ids],
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
    const { run } = fakeRunner([[/RETURN n\.id AS id, n\.aliases AS aliases/, ids]]);
    expect(await proyectosQueUsan(run, 'Kotlin')).toMatch(/No encontré la tecnología "Kotlin"/);
  });
});

describe('vecinos', () => {
  it('acota la profundidad a 1..3 antes de interpolarla en Cypher', async () => {
    const { run, calls } = fakeRunner([[/RETURN n\.id AS id, n\.aliases AS aliases/, ids]]);
    await vecinos(run, 'MAZA', 99);
    await vecinos(run, 'MAZA', -5);
    const depths = calls.map((c) => /\*1\.\.(\d+)/.exec(c.cypher)?.[1]).filter(Boolean);
    expect(depths).toEqual(['3', '1']);
  });
  it('pasa el id como parámetro, nunca interpolado', async () => {
    const { run, calls } = fakeRunner([[/RETURN n\.id AS id, n\.aliases AS aliases/, ids]]);
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

describe('logros', () => {
  const filas = [
    { id: 'maza-rag-02', titulo: 'Vector store', tema: 'RAG', tec: 'Vectorize', metrica: null, contexto: 'indice al dia', proyecto: 'MAZA', tecnologias: ['Cloudflare Vectorize'] },
    { id: 'maza-db-01', titulo: 'Modelo de datos', tema: null, tec: 'Firestore', metrica: '40% menos lecturas ESTIMADA', contexto: null, proyecto: 'MAZA', tecnologias: ['Firebase'] },
    { id: 'medinfo-01', titulo: 'Contraparte clinica', tema: null, tec: 'Scrum', metrica: null, contexto: null, proyecto: 'MedInfo', tecnologias: [] },
  ];
  const nodos = [...ids, { id: 'Cloudflare Vectorize', tipo: 'tecnologia' }, { id: 'MedInfo', tipo: 'proyecto' }];
  const montar = () => fakeRunner([[/RETURN n\.id AS id, n\.aliases AS aliases/, nodos], [/tipo: 'logro'/, filas]]);

  it('sin filtros resume por proyecto y por tecnología respaldada', async () => {
    const out = await logros(montar().run, {});
    expect(out).toContain('3 logros en la BASE.');
    expect(out).toContain('- MAZA: 2');
    expect(out).toContain('- Cloudflare Vectorize: 1');
    expect(out).toContain('(1 logros no nombran una tecnología del grafo)');
  });

  it('resuelve la tecnología aproximada y la pasa como parámetro, no interpolada', async () => {
    const { run, calls } = montar();
    await logros(run, { tecnologia: 'vectorize' });
    const q = calls.find((c) => /tipo: 'logro'/.test(c.cypher))!;
    expect(q.params).toEqual({ tecnologia: 'Cloudflare Vectorize', proyecto: null });
    expect(q.cypher).not.toContain('Cloudflare Vectorize');
  });

  it('filtra por texto (sin tildes) y muestra el detalle', async () => {
    const out = await logros(montar().run, { texto: 'ÍNDICE' });
    expect(out).toContain('1 logro(s) con texto "ÍNDICE"');
    expect(out).toContain('- [maza-rag-02] Vector store (MAZA / RAG) · demuestra: Cloudflare Vectorize');
    expect(out).toContain('  contexto: indice al dia');
  });

  it('advierte cuando una métrica es ESTIMADA', async () => {
    expect(await logros(montar().run, { texto: 'datos' })).toMatch(/ESTIMADA es solo para entrevista/);
    expect(await logros(montar().run, { texto: 'vector' })).not.toMatch(/solo para entrevista/);
  });

  it('sugiere si la tecnología no existe y avisa si no hay coincidencias', async () => {
    expect(await logros(montar().run, { tecnologia: 'Cobol' })).toMatch(/No encontré la tecnología "Cobol"/);
    expect(await logros(montar().run, { texto: 'blockchain' })).toBe('Ningún logro con texto "blockchain".');
  });
});
