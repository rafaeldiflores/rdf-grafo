import { describe, expect, it } from 'vitest';
import { findNode, impactOf } from '../src/impact.ts';
import { build, link, mkNote } from './helpers.ts';

const { graph } = build([
  mkNote('MAZA', { tipo: 'proyecto', stack: [link('Firebase'), link('Nueva')], stack_destacado: [link('Firebase')] }),
  mkNote('MAZA web', { tipo: 'proyecto', parte_de: link('MAZA'), muestra: [link('MAZA')] }),
  mkNote('Portafolio', { tipo: 'proyecto', muestra: [link('MAZA')], parte_de: link('Búsqueda') }),
  mkNote('Búsqueda', { tipo: 'area' }),
  mkNote('CV base', { tipo: 'canal', muestra: [link('Portafolio')] }),
  mkNote('Firebase', { tipo: 'tecnologia', nivel: 'avanzado' }),
  mkNote('Curso Firebase', { tipo: 'aprendizaje', cubre: [link('Firebase')] }),
  mkNote('Otro', { tipo: 'proyecto', stack: [link('Firebase')] }),
]);

describe('impactOf', () => {
  it('encuentra dependientes directos y transitivos con su camino', () => {
    const r = impactOf(graph, 'MAZA');
    const byId = Object.fromEntries(r.affected.map((a) => [a.id, a]));
    expect(byId['MAZA web']).toMatchObject({ depth: 1, via: 'MUESTRA' });
    expect(byId['Portafolio']).toMatchObject({ depth: 1, via: 'MUESTRA' });
    expect(byId['CV base']).toMatchObject({ depth: 2, path: ['MAZA', 'Portafolio', 'CV base'] });
    expect(byId['Búsqueda']).toMatchObject({ depth: 2, via: 'PARTE_DE' });
  });

  it('no sube por PARTE_DE en sentido inverso (el padre no afecta a sus partes)', () => {
    expect(impactOf(graph, 'Búsqueda').affected).toEqual([]);
  });

  it('propaga un cambio de tecnología a los proyectos que la usan', () => {
    const ids = impactOf(graph, 'Firebase').affected.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['MAZA', 'Otro', 'Portafolio', 'MAZA web']));
  });

  it('respeta la profundidad máxima', () => {
    expect(impactOf(graph, 'MAZA', 1).affected.every((a) => a.depth === 1)).toBe(true);
  });

  it('resume el stack: destacado, aprendizajes, nivel y pendientes', () => {
    const r = impactOf(graph, 'MAZA');
    expect(r.stack).toEqual([
      { id: 'Firebase', destacado: true, aprendizajes: ['Curso Firebase'], sinNivel: false, pendiente: false },
      { id: 'Nueva', destacado: false, aprendizajes: [], sinNivel: false, pendiente: true },
    ]);
    expect(r.sinCuraduria).toBe(false);
    expect(impactOf(graph, 'Otro').sinCuraduria).toBe(true);
  });
});

describe('findNode', () => {
  it('busca sin distinguir mayúsculas y sugiere coincidencias parciales', () => {
    expect(findNode(graph, 'maza')).toMatchObject({ id: 'MAZA' });
    expect(findNode(graph, 'porta')).toEqual({ suggestions: ['Portafolio'] });
  });
});
