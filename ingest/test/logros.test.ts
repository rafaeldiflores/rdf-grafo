/**
 * Logros derivados de la BASE: parser, cruce con tecnologías, grafo, impacto
 * y — lo crítico — que nunca salgan en la exportación pública.
 */
import { describe, expect, it } from 'vitest';
import { addLogros } from '../src/graph.ts';
import { impactOf } from '../src/impact.ts';
import { nombreDeSeccion, parseLogros, tecnologiasEn } from '../src/logros.ts';
import { filterPublic } from '../src/visibility.ts';
import { build, link, mkNote } from './helpers.ts';

const SECRET = 'METRICA-ESTIMADA-SECRETA';

const BASE = `# BASE

## REGLAS DE USO

- No es un logro [aunque tenga corchetes]

## MAZA - SaaS de gestion de talleres (May 2024 - presente)

Rol: Fundador

### Recuperacion y RAG

- [maza-rag-01] Motor hibrido
  tec: bge-m3 en Cloudflare Workers AI, Vectorize, Firestore
  metrica: ${SECRET}
  contexto:
  verificable: si

- [maza-rag-02] Otro logro sin tec
  verificable: si

## Colectivo Viento Sur - sitio (May 2025 - Dic 2025)
Nodo: [[Alianza Basura Cero]]

- [viento-01] Plataforma web
  tec: WordPress institucional

## Sistema de postulaciones (2026)

- [sispost-01] Agente
  tec: Gemini Spark, Sheets
- [maza-rag-01] Duplicado
`;

describe('parseLogros', () => {
  const { logros, warnings } = parseLogros(BASE);

  it('lee id, título, sección, tema y campos no vacíos', () => {
    expect(logros.map((l) => l.id)).toEqual(['maza-rag-01', 'maza-rag-02', 'viento-01', 'sispost-01']);
    expect(logros[0]).toMatchObject({
      titulo: 'Motor hibrido',
      seccion: 'MAZA - SaaS de gestion de talleres (May 2024 - presente)',
      tema: 'Recuperacion y RAG',
      proyecto: 'MAZA',
      proyectoExplicito: false,
      campos: { tec: 'bge-m3 en Cloudflare Workers AI, Vectorize, Firestore', metrica: SECRET, verificable: 'si' },
    });
    expect(logros[0]!.campos).not.toHaveProperty('contexto');
  });

  it('Nodo: [[…]] define el proyecto de la sección; si no, su nombre', () => {
    expect(logros.find((l) => l.id === 'viento-01')).toMatchObject({ proyecto: 'Alianza Basura Cero', proyectoExplicito: true });
    expect(logros.find((l) => l.id === 'sispost-01')).toMatchObject({ proyecto: 'Sistema de postulaciones', proyectoExplicito: false });
    expect(logros.find((l) => l.id === 'viento-01')).not.toHaveProperty('tema');
  });

  it('avisa ids duplicados y conserva el primero', () => {
    expect(warnings).toEqual(['BASE: id de logro duplicado [maza-rag-01]']);
    expect(logros.find((l) => l.id === 'maza-rag-01')!.titulo).toBe('Motor hibrido');
  });

  it('acepta CRLF y avisa un Nodo: escrito después de los logros (y lo aplica igual)', () => {
    const r = parseLogros('## X - y\r\n- [x-01] Uno\r\n  tec: Angular\r\nNodo: [[Proyecto X]]\r\n');
    expect(r.logros[0]).toMatchObject({ proyecto: 'Proyecto X', campos: { tec: 'Angular' } });
    expect(r.warnings[0]).toMatch(/después de sus logros/);
  });

  it('nombreDeSeccion quita la descripción y las fechas', () => {
    expect(nombreDeSeccion('MAZA - SaaS de gestion (May 2024 - presente)')).toBe('MAZA');
    expect(nombreDeSeccion('Sistema de postulaciones (2026)')).toBe('Sistema de postulaciones');
  });
});

describe('tecnologiasEn', () => {
  const t = (tecnologia: string, texto = tecnologia) => ({ tecnologia, texto });
  const terminos = [t('Cloudflare Workers'), t('Cloudflare Workers AI'), t('Cloudflare Vectorize'), t('Cloudflare Vectorize', 'Vectorize'), t('Firebase', 'Firestore'), t('Node.js'), t('Java'), t('Python')];

  it('el término más largo gana y no deja un duplicado corto', () => {
    expect(tecnologiasEn('bge-m3 en Cloudflare Workers AI', terminos)).toEqual(['Cloudflare Workers AI']);
    expect(tecnologiasEn('Cloudflare Workers AI y un Cloudflare Workers', terminos)).toEqual(['Cloudflare Workers', 'Cloudflare Workers AI']);
  });
  it('usa aliases, ignora mayúsculas y tildes', () => {
    expect(tecnologiasEn('vectorize y FIRESTORE', terminos)).toEqual(['Cloudflare Vectorize', 'Firebase']);
    expect(tecnologiasEn('Pýthon', [t('Python', 'pýthon')])).toEqual(['Python']);
  });
  it('solo palabras completas', () => {
    expect(tecnologiasEn('JavaScript y Pythonic', terminos)).toEqual([]);
    expect(tecnologiasEn('backend en Node.js', terminos)).toEqual(['Node.js']);
  });
});

/** Vault mínimo con un proyecto público, para verificar el filtro. */
const conLogros = () => {
  const { graph } = build([
    mkNote('MAZA', { tipo: 'proyecto', visibilidad: 'publico', stack: [link('Cloudflare Workers AI')] }),
    mkNote('Alianza Basura Cero', { tipo: 'proyecto', visibilidad: 'publico' }),
    mkNote('Colectivo Viento Sur', { tipo: 'persona' }),
    mkNote('Cloudflare Workers AI', { tipo: 'tecnologia' }),
    mkNote('Cloudflare Vectorize', { tipo: 'tecnologia', aliases: ['Vectorize'] }),
    mkNote('Firebase', { tipo: 'tecnologia', aliases: 'Firestore' }),
    mkNote('WordPress', { tipo: 'tecnologia' }),
    mkNote('sispost-01', { tipo: 'aprendizaje' }), // choca con un id de logro
  ]);
  const report = addLogros(graph, parseLogros(BASE).logros);
  return { graph, report };
};

describe('addLogros', () => {
  const { graph, report } = conLogros();
  const aristas = (id: string, type: string) => graph.edges.filter((e) => e.source === id && e.type === type).map((e) => e.target).sort();

  it('crea LOGRO_DE y DEMUESTRA con nombre y aliases (lista o texto)', () => {
    expect(aristas('maza-rag-01', 'LOGRO_DE')).toEqual(['MAZA']);
    expect(aristas('maza-rag-01', 'DEMUESTRA')).toEqual(['Cloudflare Vectorize', 'Cloudflare Workers AI', 'Firebase']);
    expect(aristas('viento-01', 'LOGRO_DE')).toEqual(['Alianza Basura Cero']);
    expect(aristas('viento-01', 'DEMUESTRA')).toEqual(['WordPress']);
  });

  it('guarda los campos como propiedades del nodo logro', () => {
    expect(graph.nodes.find((n) => n.id === 'maza-rag-01')).toMatchObject({ tipo: 'logro', props: { titulo: 'Motor hibrido', tema: 'Recuperacion y RAG', metrica: SECRET } });
  });

  it('reporta lo que no calza y no inventa nodos', () => {
    expect(report.total).toBe(3);
    expect(report.sinTecnologia).toEqual(['maza-rag-02']);
    expect(report.sinProyecto).toEqual({});
    expect(report.warnings[0]).toMatch(/sispost-01.*choca/);
    expect(graph.nodes.some((n) => n.tipo === 'pendiente')).toBe(false);
  });

  it('un proyecto que no es tipo proyecto cuenta como sin proyecto', () => {
    const g = build([mkNote('Colectivo Viento Sur', { tipo: 'persona' })]).graph;
    const r = addLogros(g, parseLogros('## Colectivo Viento Sur - x\n- [v-01] Uno\n').logros);
    expect(r.sinProyecto).toEqual({ 'v-01': 'Colectivo Viento Sur' });
    expect(g.edges).toEqual([]);
  });

  it('el impacto de una tecnología incluye los logros que la demuestran', () => {
    const ids = impactOf(graph, 'Cloudflare Workers AI').affected.map((a) => `${a.id}←${a.via}`);
    expect(ids).toEqual(expect.arrayContaining(['MAZA←USA', 'maza-rag-01←DEMUESTRA']));
  });
});

describe('logros en la exportación pública', () => {
  it('NUNCA salen, aunque su proyecto y sus tecnologías sean públicos', () => {
    const { graph } = conLogros();
    // Aunque alguien marque un logro como público a mano.
    graph.nodes.find((n) => n.id === 'maza-rag-01')!.props.visibilidad = 'publico';
    const pub = filterPublic(graph).graph;
    expect(pub.nodes.some((n) => n.tipo === 'logro')).toBe(false);
    expect(pub.edges.some((e) => e.type === 'LOGRO_DE' || e.type === 'DEMUESTRA')).toBe(false);
    expect(JSON.stringify(pub)).not.toContain(SECRET);
    expect(JSON.stringify(pub)).not.toContain('maza-rag');
  });

  it('un logro no arrastra al público una tecnología que solo él menciona', () => {
    const pub = filterPublic(conLogros().graph).graph;
    expect(pub.nodes.map((n) => n.id)).not.toContain('Firebase');
    expect(pub.nodes.map((n) => n.id)).toContain('Cloudflare Workers AI'); // esta sí: la usa MAZA (público)
  });
});
