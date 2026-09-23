/**
 * Tests del filtro público. Es la única barrera entre el vault privado y un
 * sitio público: si alguno falla, NO se despliega.
 */
import { describe, expect, it } from 'vitest';
import type { Graph } from '../src/model.ts';
import { filterPublic, isMarkedPublic } from '../src/visibility.ts';
import { build, link, mkNote } from './helpers.ts';

const SECRET = 'SECRETO-NO-PUBLICAR';

/** Vault de prueba con todos los casos borde de visibilidad. */
const fixture = () =>
  build([
    mkNote('Publico', {
      tipo: 'proyecto',
      visibilidad: 'publico',
      stack: [link('TechPublica'), link('TechPrivadaExplicita')],
      stack_destacado: [link('TechPublica')],
      parte_de: link('AreaPrivada'),
      cliente: link('ClienteInexistente'),
      equipo: [link('PersonaPrivada')],
      repo: `https://github.com/x/${SECRET}`,
      notas_internas: SECRET,
    }, `# Publico\nTrabajo con [[PersonaPrivada]] y [[AreaPrivada|mi área]] usando [[TechPublica]].\n\n## Bitácora\n- ${SECRET}\n`),
    mkNote('Privado', { tipo: 'proyecto', visibilidad: 'privado', stack: [link('TechSoloPrivada'), link('TechPublica')] }),
    mkNote('SinVisibilidad', { tipo: 'aprendizaje', cubre: [link('TechPublica')] }),
    mkNote('AreaPrivada', { tipo: 'area', visibilidad: 'privado' }),
    mkNote('PersonaPrivada', { tipo: 'persona', visibilidad: 'privado' }),
    mkNote('CanalPublico', { tipo: 'canal', visibilidad: 'público', parte_de: link('AreaPrivada') }),
    mkNote('TechPublica', { tipo: 'tecnologia', categoria: 'cloud' }, `# TechPublica\n## Bitácora\n- ${SECRET}\n`),
    mkNote('TechSoloPrivada', { tipo: 'tecnologia' }),
    mkNote('TechPrivadaExplicita', { tipo: 'tecnologia', visibilidad: 'privado' }),
  ]).graph;

const ids = (g: Graph) => g.nodes.map((n) => n.id).sort();

describe('filterPublic', () => {
  const { graph: pub, redactions } = filterPublic(fixture());

  it('incluye solo nodos públicos y tecnologías conectadas a ellos', () => {
    expect(ids(pub)).toEqual(['CanalPublico', 'Publico', 'TechPublica']);
  });

  it('excluye nodos privados, sin visibilidad y pendientes', () => {
    for (const id of ['Privado', 'SinVisibilidad', 'AreaPrivada', 'PersonaPrivada', 'ClienteInexistente']) {
      expect(ids(pub)).not.toContain(id);
    }
  });

  it('excluye tecnologías conectadas solo a privados o marcadas privadas', () => {
    expect(ids(pub)).not.toContain('TechSoloPrivada');
    expect(ids(pub)).not.toContain('TechPrivadaExplicita');
  });

  it('nunca deja una arista hacia o desde un nodo excluido', () => {
    const included = new Set(ids(pub));
    for (const e of pub.edges) {
      expect(included.has(e.source) && included.has(e.target)).toBe(true);
    }
    expect(pub.edges.map((e) => `${e.source}-${e.type}->${e.target}`)).toEqual(['Publico-USA->TechPublica']);
  });

  it('conserva la marca destacado en la arista', () => {
    expect(pub.edges[0]!.props).toEqual({ destacado: true });
  });

  it('exporta solo propiedades de la lista blanca (sin repo ni campos desconocidos)', () => {
    const p = pub.nodes.find((n) => n.id === 'Publico')!;
    expect(Object.keys(p.props)).toEqual([]);
    expect(pub.nodes.find((n) => n.id === 'TechPublica')!.props).toEqual({ categoria: 'cloud' });
  });

  it('elimina la Bitácora del cuerpo de todos los nodos', () => {
    for (const n of pub.nodes) expect(n.body).not.toMatch(/bit[aá]cora/i);
  });

  it('redacta links del cuerpo a nodos no incluidos y conserva los incluidos', () => {
    const body = pub.nodes.find((n) => n.id === 'Publico')!.body;
    expect(body).toContain('Trabajo con (privado) y mi área usando [[TechPublica]].');
    expect(redactions).toEqual([
      { node: 'Publico', target: 'PersonaPrivada' },
      { node: 'Publico', target: 'AreaPrivada' },
    ]);
  });

  it('no contiene NINGÚN nombre privado ni secreto en el JSON serializado', () => {
    const json = JSON.stringify(pub);
    for (const leak of [SECRET, 'PersonaPrivada', 'AreaPrivada', 'Privado"', 'SinVisibilidad', 'TechSoloPrivada', 'TechPrivadaExplicita', 'ClienteInexistente', 'github.com']) {
      expect(json).not.toContain(leak);
    }
  });

  it('marca el grafo como público', () => {
    expect(pub.meta.public).toBe(true);
  });
});

describe('isMarkedPublic', () => {
  const node = (visibilidad?: unknown) =>
    ({ id: 'x', tipo: 'proyecto', props: visibilidad === undefined ? {} : { visibilidad }, body: '' }) as never;

  it.each(['publico', 'público', ' Publico ', 'PÚBLICO'])('acepta %j', (v) => expect(isMarkedPublic(node(v))).toBe(true));
  it.each([undefined, 'privado', 'public', 'publico?', 'no publico', true, ''])('rechaza %j', (v) =>
    expect(isMarkedPublic(node(v))).toBe(false),
  );
});

describe('invariantes con grafos aleatorios', () => {
  // Generador determinista (LCG) para que un fallo sea reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const TIPOS = ['proyecto', 'area', 'canal', 'tecnologia', 'aprendizaje', 'persona'];
  const VIS = ['publico', 'privado', undefined, 'otro'];
  const FIELDS = ['stack', 'parte_de', 'cliente', 'relacionado', 'cubre', 'plataforma', 'equipo', 'muestra'];

  it.each(Array.from({ length: 300 }, (_, i) => i))('semilla %i', (seed) => {
    const r = rng(seed + 1);
    const pickOne = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    const n = 2 + Math.floor(r() * 12);
    const names = Array.from({ length: n }, (_, i) => `N${i}`);
    const notes = names.map((id) => {
      const fm: Record<string, string | string[] | undefined> = { tipo: pickOne(TIPOS), visibilidad: pickOne(VIS), repo: SECRET };
      for (const f of FIELDS) if (r() < 0.4) fm[f] = Array.from({ length: 1 + Math.floor(r() * 3) }, () => link(r() < 0.1 ? 'Roto' : pickOne(names)));
      return mkNote(id, fm, `texto [[${pickOne(names)}]]\n## Bitácora\n${SECRET}\n`);
    });
    const full = build(notes).graph;
    const { graph: pub } = filterPublic(full);
    const byId = new Map(full.nodes.map((x) => [x.id, x]));
    const included = new Set(pub.nodes.map((x) => x.id));

    for (const x of pub.nodes) {
      const orig = byId.get(x.id)!;
      // Cada nodo incluido es público, o una tecnología vecina de un público.
      const ok =
        isMarkedPublic(orig) ||
        (orig.tipo === 'tecnologia' &&
          full.edges.some(
            (e) =>
              (e.source === x.id && isMarkedPublic(byId.get(e.target)!)) ||
              (e.target === x.id && isMarkedPublic(byId.get(e.source)!)),
          ));
      expect(ok).toBe(true);
      expect(orig.tipo).not.toBe('pendiente');
    }
    for (const e of pub.edges) expect(included.has(e.source) && included.has(e.target)).toBe(true);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(SECRET);
    for (const id of names) if (!included.has(id)) expect(json).not.toContain(`"${id}"`);
    for (const id of names) if (!included.has(id)) expect(json).not.toContain(`[[${id}]]`);
  });
});
