import { describe, expect, it } from 'vitest';
import { brechasDe, formatBrechas } from '../src/brechas.ts';
import { addLogros } from '../src/graph.ts';
import { parseLogros } from '../src/logros.ts';
import { build, link, mkNote } from './helpers.ts';

const BASE = `## MAZA - x
Nodo: [[MAZA]]
- [maza-01] Reglas de datos
  tec: reglas de Firestore con 132 tests
- [maza-02] Plataforma
  tec: Angular 22 con signals
- [maza-03] Proceso
  tec: Scrum, priorizacion de backlog
`;

const grafo = () => {
  const { graph } = build([
    mkNote('MAZA', { tipo: 'proyecto', stack: [link('Angular'), link('Firebase'), link('Python')] }),
    mkNote('Angular', { tipo: 'tecnologia' }),
    mkNote('Firebase', { tipo: 'tecnologia', aliases: ['Firestore'] }),
    mkNote('Python', { tipo: 'tecnologia' }),
    mkNote('React', { tipo: 'tecnologia' }),
    mkNote('Kubernetes', { tipo: 'tecnologia' }),
    mkNote('Curso K8s', { tipo: 'aprendizaje', cubre: [link('Kubernetes')] }),
  ]);
  addLogros(graph, parseLogros(BASE).logros);
  return graph;
};

const por = (reqs: ReturnType<typeof brechasDe>) => Object.fromEntries(reqs.map((r) => [r.termino, r]));

describe('brechasDe', () => {
  it('clasifica en los cinco niveles', () => {
    const r = por(brechasDe(grafo(), ['Angular', 'Python', 'Scrum', 'React', 'Docker']));
    expect(r.Angular).toMatchObject({ nivel: 'demostrada', tecnologia: 'Angular', logros: ['maza-02'], proyectos: ['MAZA'] });
    expect(r.Python).toMatchObject({ nivel: 'declarada', logros: [], proyectos: ['MAZA'] });
    expect(r.Scrum).toMatchObject({ nivel: 'mencionada', logros: ['maza-03'] });
    expect(r.React).toMatchObject({ nivel: 'conocida', tecnologia: 'React' });
    expect(r.Docker).toMatchObject({ nivel: 'brecha', logros: [] });
  });

  it('resuelve aliases, mayúsculas y versiones, pero no otra tecnología con el mismo prefijo', () => {
    const r = por(brechasDe(grafo(), ['FIRESTORE', 'Angular 17+', 'Python 3.x', 'React Native']));
    expect(r.FIRESTORE).toMatchObject({ tecnologia: 'Firebase', nivel: 'demostrada', logros: ['maza-01'] });
    expect(r['Angular 17+']!.tecnologia).toBe('Angular');
    expect(r['Python 3.x']!.tecnologia).toBe('Python');
    expect(r['React Native']).toMatchObject({ nivel: 'brecha' });
    expect(r['React Native']!.tecnologia).toBeUndefined();
  });

  it('muestra los aprendizajes que cubren una tecnología', () => {
    expect(por(brechasDe(grafo(), ['Kubernetes'])).Kubernetes).toMatchObject({ nivel: 'conocida', aprendizajes: ['Curso K8s'] });
  });

  it('detecta en el texto de la oferta las tecnologías conocidas que no se pidieron, sin duplicar', () => {
    const reqs = brechasDe(grafo(), ['Firestore'], 'Buscamos dev con Angular, Firebase y ganas de aprender Go.');
    expect(reqs.map((r) => [r.termino, r.detectada])).toEqual([
      ['Angular', true],
      ['Firestore', false],
    ]);
  });

  it('ordena del respaldo más fuerte al más débil y omite términos vacíos', () => {
    expect(brechasDe(grafo(), ['Docker', ' ', 'Angular', 'Scrum']).map((r) => r.nivel)).toEqual(['demostrada', 'mencionada', 'brecha']);
  });
});

describe('formatBrechas', () => {
  it('resume cobertura y agrupa por nivel', () => {
    const out = formatBrechas(brechasDe(grafo(), ['Firestore', 'Scrum', 'Docker', 'React']));
    expect(out).toMatch(/^Cobertura: 2 de 4 requisitos con respaldo \(50%\)\./);
    expect(out).toContain('- Firestore → Firebase — 1 logro(s): maza-01 · stack de MAZA');
    expect(out).toContain('## Brechas: nada en el grafo las respalda (1)\n- Docker');
  });
  it('sin requisitos lo dice', () => expect(formatBrechas([])).toMatch(/No hay requisitos/));
});
