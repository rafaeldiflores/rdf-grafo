/**
 * Brechas y auditoría en el Worker. Leen proyectos, tecnologías y aprendizajes
 * SOLO por su frontmatter: el cuerpo (con la Bitácora) no puede llegar a ninguna
 * salida. Si alguno falla, NO se despliega.
 */
import { describe, expect, it } from 'vitest';
import { Postulador } from '../src/cv.ts';
import type { Embedder } from '../../ingest/src/sugerencias.ts';
import { puedeLeer, soloFrontmatter, Vault } from '../src/vault.ts';
import { githubFalso } from './github-falso.ts';

const BITACORA = 'SECRETO-DE-LA-BITACORA';

const VAULT: Record<string, string> = {
  'cv/encabezado.md': '---\nnombre: "ANA"\nubicacion: "Chile"\ntelefono: "+56"\nemail: "a@b.cl"\n---\n',
  'cv/BASE_Experiencia.md': '# BASE\n\n## MAZA - SaaS (May 2024 - presente)\nNodo: [[MAZA]]\n\n- [maza-01] Reglas de datos\n  tec: reglas de Firestore, Angular\n',
  'cv/base/FullStack.md': '## RESUMEN PROFESIONAL\nAngular.\n',
  'proyectos/MAZA.md': `---\ntipo: proyecto\nestado: activo\nstack: ["[[Angular]]", "[[Firebase]]", "[[Flask]]"]\n---\n# MAZA\nCuerpo.\n\n## Bitácora\n- ${BITACORA}\n`,
  'proyectos/Copiloto.md': `---\ntipo: proyecto\n---\n## Bitácora\n- ${BITACORA}\n`,
  'proyectos/Sin frontmatter.md': `# Nota suelta\n${BITACORA}\n`,
  'tecnologias/Angular.md': '---\ntipo: tecnologia\n---\n',
  'tecnologias/Firebase.md': '---\ntipo: tecnologia\naliases: [Firestore]\n---\n',
  'tecnologias/Flask.md': '---\ntipo: tecnologia\n---\n',
  'aprendizaje/Curso.md': `---\ntipo: aprendizaje\ncubre: ["[[Flask]]"]\n---\n## Bitácora\n- ${BITACORA}\n`,
};

function montar(embed?: Embedder) {
  const gh = githubFalso({ ...VAULT });
  const pdf = async () => ({ pdf: new Uint8Array(), paginas: 1, lineasDeMas: 0, lineasResumen: 1 });
  return { gh, p: new Postulador(new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http), pdf, embed) };
}

describe('lectura solo de frontmatter', () => {
  it('soloFrontmatter descarta todo el cuerpo (acepta CRLF); sin frontmatter = null', () => {
    expect(soloFrontmatter(`---\ntipo: x\n---\n# T\n## Bitácora\n- ${BITACORA}`)).toBe('---\ntipo: x\n---\n');
    expect(soloFrontmatter('---\r\ntipo: x\r\n---\r\ncuerpo')).toBe('---\ntipo: x\n---\n');
    expect(soloFrontmatter('# sin frontmatter\n---\n')).toBeNull();
  });

  it.each(['postulaciones', 'cv', 'cv/base', '', 'proyectos/..', '.github', 'personas'])('niega frontmatters de "%s" sin llamar a GitHub', async (c) => {
    const { gh } = montar();
    await expect(new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http).frontmatters(c)).rejects.toThrow(/no permitida/);
    expect(gh.log).toEqual([]);
  });

  it('frontmatters no devuelve cuerpos ni notas sin frontmatter', async () => {
    const { gh } = montar();
    const r = await new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http).frontmatters('proyectos');
    expect(r.map((x) => x.nombre).sort()).toEqual(['Copiloto.md', 'MAZA.md']);
    expect(JSON.stringify(r)).not.toContain(BITACORA);
    expect(JSON.stringify(r)).not.toContain('Cuerpo.');
  });

  it('las notas de proyectos y tecnologías siguen sin poder leerse completas', () => {
    expect(puedeLeer('proyectos/MAZA.md')).toBe(false);
    expect(puedeLeer('tecnologias/Angular.md')).toBe(false);
  });

  it('un error de GraphQL se informa, no se ignora', async () => {
    const http = (async () => Response.json({ errors: [{ message: 'Bad credentials' }] })) as unknown as typeof fetch;
    await expect(new Vault('TOKEN', 'rafa/rdf-vault', 'main', http).frontmatters('proyectos')).rejects.toThrow(/Bad credentials/);
  });
});

describe('Postulador: brechas', () => {
  it('clasifica contra el grafo y NUNCA devuelve texto de una Bitácora', async () => {
    const { p, gh } = montar();
    const r = await p.brechas(['Firestore', 'Flask', 'Docker'], 'Buscamos Angular');
    expect(r.cobertura).toEqual({ respaldadas: 3, total: 4 });
    expect(r.busqueda).toBe('lexica'); // sin embedder
    expect(r.requisitos.map((x) => [x.termino, x.nivel])).toEqual([
      ['Angular', 'demostrada'],
      ['Firestore', 'demostrada'],
      ['Flask', 'declarada'],
      ['Docker', 'brecha'],
    ]);
    expect(r.requisitos.find((x) => x.termino === 'Flask')!.aprendizajes).toEqual(['Curso']);
    expect(JSON.stringify(r)).not.toContain(BITACORA);
    // Solo lecturas y pocas (límite de 50 subrequests): 1 REST (BASE) + 3 GraphQL (una por carpeta).
    expect(gh.log.map((l) => l.ruta).sort()).toEqual(['cv/BASE_Experiencia.md', 'graphql:aprendizaje', 'graphql:proyectos', 'graphql:tecnologias']);
  });

  it('acepta requisitos vacíos y sin oferta', async () => {
    expect(await montar().p.brechas()).toEqual({ requisitos: [], cobertura: { respaldadas: 0, total: 0 }, busqueda: 'lexica' });
  });

  it('con embedder, sugiere un candidato para lo que quedó en brecha (nunca suma a cobertura)', async () => {
    // Vector fabricado: "Docker" y la nota "Flask" comparten dirección, el resto no.
    const embed: Embedder = async (textos) => textos.map((t) => (t === 'Docker' || t === 'Flask' ? [1, 0] : [0, 1]));
    const { p } = montar(embed);
    const r = await p.brechas(['Docker'], '');
    expect(r.cobertura).toEqual({ respaldadas: 0, total: 1 }); // sugerida no cuenta como respaldo
    expect(r.busqueda).toBe('hibrida');
    expect(r.requisitos[0]).toMatchObject({ nivel: 'sugerida', candidato: { tecnologia: 'Flask', similitud: 1 } });
  });

  it('si el embedder falla, brechas sigue funcionando solo con léxico y lo declara', async () => {
    const embed: Embedder = async () => {
      throw new Error('Workers AI sin cuota');
    };
    const { p } = montar(embed);
    const r = await p.brechas(['Firestore', 'Docker'], '');
    expect(r.requisitos.map((x) => x.nivel)).toEqual(['demostrada', 'brecha']);
    expect(r.busqueda).toBe('lexica');
  });
});

describe('Postulador: auditoría', () => {
  it('reporta con acción, declara las reglas omitidas y no filtra Bitácoras ni escribe', async () => {
    const { p, gh } = montar();
    const r = await p.auditar();
    expect(r.hallazgos.map((h) => h.regla)).toEqual(expect.arrayContaining(['proyecto-sin-logros', 'tecnologia-sin-base']));
    expect(r.hallazgos.find((h) => h.regla === 'tecnologia-sin-base')!.detalle).toContain('MAZA usa Flask');
    expect(r.hallazgos.every((h) => !('donde' in h))).toBe(true);
    expect(r.omitidas).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain(BITACORA);
    expect(gh.log.some((l) => l.metodo === 'PUT')).toBe(false);
    expect(gh.log.length).toBeLessThanOrEqual(12);
  });
});
