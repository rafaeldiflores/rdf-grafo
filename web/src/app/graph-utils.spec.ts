import { describe, expect, it } from 'vitest';
import type { PublicGraph } from './graph.model';
import { bodyToHtml, neighborGroups, nodosIA, normalize, recorrido, resumenBreve, searchNodes } from './graph-utils';

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


describe('resumenBreve', () => {
  it('toma el primer párrafo sin título, listas ni marcas', () => {
    const body = '# MAZA\nSaaS de **gestión** de [[Talleres|talleres]].\nEn pruebas.\n\n- Detalle';
    expect(resumenBreve(body)).toBe('SaaS de gestión de talleres. En pruebas.');
  });
  it('corta en frase completa', () => {
    expect(resumenBreve('# X\nUno dos. Tres cuatro cinco seis.', 12)).toBe('Uno dos.');
  });
});

describe('recorrido', () => {
  it('ordena por conexiones, omite pendientes y cierra con la vista general', () => {
    const g: PublicGraph = {
      ...graph,
      nodes: [
        { ...node('MAZA'), body: '# MAZA\nSaaS de talleres.' },
        { ...node('MAZA web'), body: '# MAZA web\nLanding.' },
        { ...node('Portafolio web'), body: '# Portafolio web\nPendiente: RAG.' },
        node('Firebase', 'tecnologia'),
      ],
    };
    const r = recorrido(g);
    expect(r.map((p) => p.id)).toEqual(['MAZA', 'MAZA web', null]);
    expect(r[0]!.texto).toBe('SaaS de talleres.');
    expect(r[0]!.ia).toEqual([]);
    expect(r.at(-1)!.texto).toMatch(/^3 proyectos y 1 tecnologías/);
  });
});

describe('perfil IA', () => {
  const g: PublicGraph = {
    meta: { public: true, generatedAt: '' },
    nodes: [
      { ...node('Web'), body: '# Web\nSitio.' },
      { ...node('Bot'), body: '# Bot\nAsistente.' },
      { id: 'Claude API', tipo: 'tecnologia', props: { categoria: 'ia' }, body: '' },
      { id: 'React', tipo: 'tecnologia', props: { categoria: 'frontend' }, body: '' },
      { id: 'Next.js', tipo: 'tecnologia', props: { categoria: 'frontend' }, body: '' },
    ],
    edges: [
      { source: 'Web', target: 'React', type: 'USA', props: {} },
      { source: 'Web', target: 'Next.js', type: 'USA', props: {} },
      { source: 'Bot', target: 'Claude API', type: 'USA', props: {} },
    ],
  };
  it('la lente incluye las tecnologías de IA y los proyectos que las usan', () => {
    expect([...nodosIA(g)].sort()).toEqual(['Bot', 'Claude API']);
  });
  it('el recorrido parte por los proyectos con IA aunque tengan menos conexiones', () => {
    expect(recorrido(g).map((p) => p.id)).toEqual(['Bot', 'Web', null]);
    expect(recorrido(g)[0]!.ia).toEqual(['Claude API']);
  });
});
