import { describe, expect, it } from 'vitest';
import { extractLinks, parseNote, stripBitacora, toPropValue } from '../src/parser.ts';

const note = (fm: string, body = '# Título\n') => `---\n${fm}\n---\n${body}`;

describe('parseNote', () => {
  it('usa el nombre del archivo como id y lee el frontmatter', () => {
    const n = parseNote('proyectos/MAZA.md', note('tipo: proyecto\nestado: activo'));
    expect(n).toMatchObject({ id: 'MAZA', data: { tipo: 'proyecto', estado: 'activo' } });
    expect(n?.body).toContain('# Título');
  });

  it('acepta separadores de ruta de Windows', () => {
    expect(parseNote('proyectos\\MAZA web.md', note('tipo: proyecto'))?.id).toBe('MAZA web');
  });

  it('ignora notas sin frontmatter o sin tipo', () => {
    expect(parseNote('00-Inicio.md', '# Inicio\n```dataview\n```')).toBeNull();
    expect(parseNote('x.md', note('estado: activo'))).toBeNull();
    expect(parseNote('x.md', note('tipo: ""'))).toBeNull();
  });

  it('normaliza tildes descompuestas (NFD) a NFC en id y datos', () => {
    const nfd = 'Canción de acción'.normalize('NFD');
    const n = parseNote(`notas/${nfd}.md`, note(`tipo: area\nparte_de: "[[${nfd}]]"`));
    expect(n?.id).toBe('Canción de acción'.normalize('NFC'));
    expect(extractLinks(n?.data.parte_de).links).toEqual(['Canción de acción'.normalize('NFC')]);
  });

  it('no comparte estado entre notas con igual contenido (caché de gray-matter)', () => {
    const a = parseNote('a.md', note('tipo: proyecto'))!;
    a.data.tipo = 'mutado';
    expect(parseNote('b.md', note('tipo: proyecto'))!.data.tipo).toBe('proyecto');
  });
});

describe('extractLinks', () => {
  it('lee strings y listas', () => {
    expect(extractLinks('[[MAZA]]').links).toEqual(['MAZA']);
    expect(extractLinks(['[[Firebase]]', '[[GCP]]']).links).toEqual(['Firebase', 'GCP']);
  });

  it('quita alias, anclas y carpetas', () => {
    expect(extractLinks(['[[MAZA|la app]]', '[[GCP#Costos]]', '[[tecnologias/Vercel]]']).links).toEqual([
      'MAZA',
      'GCP',
      'Vercel',
    ]);
  });

  it('trata vacíos como sin links y sin errores', () => {
    for (const v of [null, undefined, '', []]) expect(extractLinks(v)).toEqual({ links: [], invalid: [] });
  });

  it('reporta valores sin link', () => {
    expect(extractLinks(['Firebase', '[[GCP]]'])).toEqual({ links: ['GCP'], invalid: ['Firebase'] });
  });

  it('deduplica', () => {
    expect(extractLinks(['[[GCP]]', '[[GCP|Google]]']).links).toEqual(['GCP']);
  });
});

describe('stripBitacora', () => {
  it('elimina la sección final completa', () => {
    const body = '# MAZA\nSaaS de talleres.\n\n## Bitácora\n### 2026-09-01\n- secreto\n';
    expect(stripBitacora(body)).toBe('# MAZA\nSaaS de talleres.\n');
  });

  it('conserva las secciones posteriores de igual o mayor jerarquía', () => {
    const body = '# A\n## Bitácora\n- secreto\n### sub\n- secreto 2\n## Links\n- público\n';
    const out = stripBitacora(body);
    expect(out).not.toContain('secreto');
    expect(out).toContain('## Links\n- público');
  });

  it.each(['## Bitácora', '## bitacora', '### BITÁCORA', '## Bitácora 📓', '#  Bitácora'])(
    'reconoce la variante %j',
    (heading) => {
      expect(stripBitacora(`intro\n${heading}\n- secreto\n`)).not.toContain('secreto');
    },
  );

  it('reconoce la tilde descompuesta (NFD)', () => {
    expect(stripBitacora(`intro\n${'## Bitácora'.normalize('NFD')}\n- secreto\n`)).not.toContain('secreto');
  });

  it('no confunde un encabezado dentro de un bloque de código', () => {
    const body = 'intro\n```md\n## Bitácora\n```\nvisible\n';
    expect(stripBitacora(body)).toContain('visible');
  });

  it('no toca notas sin bitácora', () => {
    expect(stripBitacora('# A\ntexto\n')).toBe('# A\ntexto\n');
  });
});

describe('toPropValue', () => {
  it('omite vacíos', () => {
    for (const v of [null, undefined, '', []]) expect(toPropValue(v)).toBeUndefined();
  });

  it('convierte fechas YAML a ISO (día)', () => {
    expect(toPropValue(new Date('2026-09-22T00:00:00Z'))).toBe('2026-09-22');
  });

  it('homogeneiza listas mixtas a string (requisito de Neo4j)', () => {
    expect(toPropValue([1, 'a'])).toEqual(['1', 'a']);
    expect(toPropValue([1, 2])).toEqual([1, 2]);
  });

  it('serializa objetos anidados', () => {
    expect(toPropValue({ a: 1 })).toBe('{"a":1}');
  });
});
