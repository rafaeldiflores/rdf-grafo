import { describe, expect, it } from 'vitest';
import { build, link, mkNote } from './helpers.ts';

describe('buildGraph', () => {
  const notes = [
    mkNote('MAZA', {
      tipo: 'proyecto',
      visibilidad: 'publico',
      stack: [link('Firebase'), link('GCP')],
      stack_destacado: [link('Firebase')],
      cliente: link('Taller X'),
      repo: 'https://github.com/x/maza',
    }),
    mkNote('Firebase', { tipo: 'tecnologia', categoria: 'cloud' }),
    mkNote('GCP', { tipo: 'tecnologia' }),
    mkNote('Portafolio', { tipo: 'proyecto', muestra: [link('MAZA')], relacionado: [link('MAZA')] }),
  ];
  const { graph, report } = build(notes);
  const edge = (s: string, t: string, type: string) =>
    graph.edges.find((e) => e.source === s && e.target === t && e.type === type);

  it('crea un nodo por nota con su tipo y propiedades (sin campos de relación)', () => {
    const maza = graph.nodes.find((n) => n.id === 'MAZA')!;
    expect(maza.tipo).toBe('proyecto');
    expect(maza.props).toEqual({ visibilidad: 'publico', repo: 'https://github.com/x/maza' });
  });

  it('mapea cada campo de relación a su tipo de arista', () => {
    expect(edge('MAZA', 'GCP', 'USA')).toBeDefined();
    expect(edge('MAZA', 'Taller X', 'PARA_CLIENTE')).toBeDefined();
    expect(edge('Portafolio', 'MAZA', 'MUESTRA')).toBeDefined();
    expect(edge('Portafolio', 'MAZA', 'RELACIONADO_CON')).toBeDefined();
  });

  it('marca destacado solo en las aristas USA curadas', () => {
    expect(edge('MAZA', 'Firebase', 'USA')!.props).toEqual({ destacado: true });
    expect(edge('MAZA', 'GCP', 'USA')!.props).toEqual({});
  });

  it('crea nodos pendientes para links rotos y los reporta', () => {
    expect(graph.nodes.find((n) => n.id === 'Taller X')).toMatchObject({ tipo: 'pendiente' });
    expect(report.pendientes).toEqual({ 'Taller X': ['MAZA'] });
  });

  it('advierte destacados que no están en stack y valores sin link', () => {
    const r = build([
      mkNote('P', { tipo: 'proyecto', stack: ['Firebase'], stack_destacado: [link('GCP')] }),
      mkNote('GCP', { tipo: 'tecnologia' }),
    ]).report;
    expect(r.warnings.join('\n')).toMatch(/"stack" tiene un valor sin \[\[link\]\]: Firebase/);
    expect(r.warnings.join('\n')).toMatch(/"GCP" está en stack_destacado pero no en stack/);
  });

  it('deduplica aristas y es determinista', () => {
    const again = build([...notes].reverse()).graph;
    expect(JSON.stringify(again)).toBe(JSON.stringify(graph));
    const keys = graph.edges.map((e) => `${e.source}|${e.type}|${e.target}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
