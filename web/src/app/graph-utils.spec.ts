import { describe, expect, it } from 'vitest';
import type { PublicGraph } from './graph.model';
import { bodyToHtml, neighborGroups, normalize, searchNodes } from './graph-utils';

const node = (id: string, tipo = 'proyecto') => ({ id, tipo, props: {}, body: '' });
const graph: PublicGraph = {
  meta: { public: true, generatedAt: '' },
  nodes: [node('MAZA'), node('MAZA web'), node('Firebase', 'tecnologia'), node('Capacitor', 'tecnologia'), node('Portafolio web')],
  edges: [
    { source: 'MAZA', target: 'Firebase', type: 'USA', props: {} },
    { source: 'MAZA', target: 'Capacitor', type: 'USA', props: { destacado: true } },
    { source: 'Portafolio web', target: 'MAZA', type: 'MUESTRA', props: {} },
  ],
};

describe('normalize', () => {
  it('ignora tildes y mayúsculas', () => expect(normalize(' Tecnología ')).toBe('tecnologia'));
});

describe('searchNodes', () => {
  it('prioriza coincidencias al inicio', () => {
    expect(searchNodes(graph.nodes, 'web').map((n) => n.id)).toEqual(['MAZA web', 'Portafolio web']);
    expect(searchNodes(graph.nodes, 'maza').map((n) => n.id)).toEqual(['MAZA', 'MAZA web']);
  });
  it('devuelve vacío sin búsqueda', () => expect(searchNodes(graph.nodes, '  ')).toEqual([]));
});

describe('neighborGroups', () => {
  it('agrupa por relación y sentido, con destacados primero', () => {
    const groups = neighborGroups(graph, 'MAZA');
    expect(groups.map((g) => g.label)).toEqual(['Usa', 'Aparece en']);
    expect(groups[0]!.items.map((i) => [i.node.id, i.destacado])).toEqual([
      ['Capacitor', true],
      ['Firebase', false],
    ]);
  });
  it('lee la relación desde el destino', () => {
    expect(neighborGroups(graph, 'Firebase')[0]!.label).toBe('Usada en');
  });
});

describe('bodyToHtml', () => {
  const existing = new Set(['MAZA']);
  it('quita el título y enlaza notas existentes', () => {
    const html = bodyToHtml('# Título\nVer [[MAZA|la app]] y [[Otra]].', existing);
    expect(html).not.toContain('Título');
    expect(html).toContain('<a href="#MAZA" data-node="MAZA">la app</a>');
    expect(html).toContain('y Otra.');
  });
  it('sanea HTML peligroso', () => {
    const html = bodyToHtml('<img src=x onerror="alert(1)"><script>alert(1)</script>', existing);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });
  it('escapa alias con HTML', () => {
    expect(bodyToHtml('[[MAZA|<b>x</b>]]', existing)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
