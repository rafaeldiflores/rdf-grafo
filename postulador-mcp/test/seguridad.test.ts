/**
 * Reglas de seguridad del Postulador remoto. Si alguno falla, NO se despliega.
 */
import { describe, expect, it } from 'vitest';
import { Postulador } from '../src/cv.ts';
import { b64, puedeEscribir, puedeLeer, Vault } from '../src/vault.ts';

describe('listas blancas de rutas', () => {
  it.each(['cv/BASE_Experiencia.md', 'cv/encabezado.md', 'cv/base/Mobile.md', 'postulaciones/Acme - Dev.md'])('permite leer %s', (r) => {
    expect(puedeLeer(r)).toBe(true);
  });
  it.each([
    'proyectos/MAZA.md', // Bitácoras y notas privadas del vault
    'personas/Mauricio Guzmán.md',
    '.github/workflows/avisar-grafo.yml',
    'cv/generados/x.pdf',
    'postulaciones/../proyectos/MAZA.md',
    'postulaciones/sub/x.md',
    '/etc/passwd',
    'cv\\base\\x.md',
  ])('niega leer %s', (r) => expect(puedeLeer(r)).toBe(false));

  it.each(['postulaciones/Acme - Dev.md', 'cv/generados/CV_RDF_Acme.pdf', 'cv/generados/CV_RDF_Acme.md'])('permite escribir %s', (r) => {
    expect(puedeEscribir(r)).toBe(true);
  });
  it.each([
    'cv/BASE_Experiencia.md', // la BASE es de solo lectura
    'cv/base/Mobile.md',
    'cv/encabezado.md',
    'proyectos/MAZA.md',
    '.gitignore',
    'cv/generados/x.exe',
    'cv/generados/../BASE_Experiencia.md',
    'postulaciones/../../x.md',
  ])('niega escribir %s', (r) => expect(puedeEscribir(r)).toBe(false));
});

/** GitHub falso en memoria: registra cada request para verificar qué se intentó. */
function githubFalso(archivos: Record<string, string>) {
  const log: { metodo: string; ruta: string; body?: { message: string; content: string; sha?: string } }[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const ruta = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const metodo = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    log.push({ metodo, ruta, body });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer TOKEN');
    if (metodo === 'PUT') {
      archivos[ruta] = new TextDecoder().decode(b64.decode(body.content));
      return new Response('{}', { status: 201 });
    }
    const hijos = Object.keys(archivos).filter((k) => k.startsWith(ruta + '/') && !k.slice(ruta.length + 1).includes('/'));
    if (hijos.length) return Response.json(hijos.map((k) => ({ name: k.split('/').pop(), type: 'file' })));
    if (!(ruta in archivos)) return new Response('{}', { status: 404 });
    return Response.json({ sha: 'sha-' + ruta, content: b64.encode(new TextEncoder().encode(archivos[ruta])) });
  }) as typeof fetch;
  return { http, log, archivos };
}

const ENCABEZADO = '---\nnombre: "ANA"\nubicacion: "Chile"\ntelefono: "+56"\nemail: "a@b.cl"\nfechas_fijas: { MAZA: "May 2024" }\nnunca_incluir: ["Proyecto Vetado"]\n---\n';
const CV = `---
titulo: "Ingeniera | Full-Stack"
---
## RESUMEN PROFESIONAL
Texto.
## HABILIDADES TÉCNICAS
- **Frontend:** Angular.
## EXPERIENCIA PROFESIONAL
### Fundadora | MAZA (SaaS) (May 2024 – Presente)
- **Backend:** Worker.
## EDUCACIÓN Y CERTIFICACIONES
### Ingeniería | Duoc UC (Mar 2021 – Dic 2025)
- **Estado:** Titulada.
`;

function montar(paginas = 1) {
  const gh = githubFalso({
    'cv/encabezado.md': ENCABEZADO,
    'cv/BASE_Experiencia.md': '# BASE',
    'cv/base/FullStack.md': CV,
    'postulaciones/Acme - Dev.md': '---\ntipo: postulacion\nvisibilidad: privado\nempresa: "Acme"\ncargo: "Dev"\nfecha: 2026-09-01\nestado: "Postulado"\n---\n# Dev — Acme\n',
    'proyectos/MAZA.md': 'PRIVADO',
  });
  const pdfFalso = async () => ({ pdf: new TextEncoder().encode('%PDF-1.7 falso'), paginas, lineasDeMas: paginas > 1 ? 5 : -3, lineasResumen: 2 });
  return { gh, p: new Postulador(new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http), pdfFalso) };
}

describe('Vault contra GitHub', () => {
  it('la lista blanca se aplica ANTES de llamar a GitHub', async () => {
    const { gh } = montar();
    const v = new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http);
    await expect(v.leer('proyectos/MAZA.md')).rejects.toThrow(/no permitida/);
    await expect(v.escribir('cv/BASE_Experiencia.md', 'x', 'm')).rejects.toThrow(/no permitida/);
    await expect(v.listar('proyectos')).rejects.toThrow(/no permitido/);
    expect(gh.log).toEqual([]);
  });
  it('llama a fetch sin atarlo a Vault (en Workers eso es "Illegal invocation")', async () => {
    const original = globalThis.fetch;
    // Imita la regla del runtime: fetch solo acepta this = undefined o globalThis.
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json({ sha: 's', content: b64.encode(new TextEncoder().encode('# BASE')) }));
    } as typeof fetch;
    try {
      expect(await new Vault('TOKEN', 'rafa/rdf-vault').leer('cv/BASE_Experiencia.md')).toBe('# BASE');
    } finally {
      globalThis.fetch = original;
    }
  });
  it('actualiza con el sha previo y crea sin sha', async () => {
    const { gh } = montar();
    const v = new Vault('TOKEN', 'rafa/rdf-vault', 'main', gh.http);
    expect(await v.escribir('postulaciones/Acme - Dev.md', 'nuevo', 'm')).toEqual({ existia: true });
    expect(gh.log.at(-1)!.body!.sha).toBe('sha-postulaciones/Acme - Dev.md');
    expect(await v.escribir('postulaciones/Nueva - X.md', 'x', 'm')).toEqual({ existia: false });
    expect(gh.log.at(-1)!.body!.sha).toBeUndefined();
  });
});

describe('Postulador', () => {
  it('contexto trae BASE, perfiles y reglas, y nunca otras notas del vault', async () => {
    const { p, gh } = montar();
    const c = await p.contexto();
    expect(c.perfiles.map((x) => x.perfil)).toEqual(['FullStack']);
    expect(JSON.stringify(c)).not.toContain('PRIVADO');
    expect(gh.log.every((l) => l.metodo === 'GET')).toBe(true);
  });

  it('validar no escribe nada', async () => {
    const { p, gh } = montar();
    const r = await p.validar(CV);
    expect(r.ok).toBe(true);
    expect(gh.log.some((l) => l.metodo === 'PUT')).toBe(false);
  });

  it('se niega a generar un CV que rompe una regla o no cabe en 1 página, sin escribir', async () => {
    const a = montar();
    await expect(a.p.generarPdf(CV.replace('Titulada.', 'Titulada. Proyecto Vetado.'), 'x')).rejects.toThrow(/nunca va en un CV/);
    const b = montar(2);
    await expect(b.p.generarPdf(CV, 'x')).rejects.toThrow(/2 páginas/);
    expect([...a.gh.log, ...b.gh.log].some((l) => l.metodo === 'PUT')).toBe(false);
  });

  it('genera en cv/generados con nombre saneado, aunque intente salir', async () => {
    const { p, gh } = montar();
    const r = await p.generarPdf(CV, '../../BASE_Experiencia');
    expect(r.ruta).toBe('cv/generados/BASE_Experiencia.pdf');
    expect(gh.log.filter((l) => l.metodo === 'PUT').map((l) => l.ruta)).toEqual(['cv/generados/BASE_Experiencia.md', 'cv/generados/BASE_Experiencia.pdf']);
    expect(gh.archivos['cv/BASE_Experiencia.md']).toBe('# BASE');
  });

  it('guarda postulaciones siempre privadas, con commit descriptivo', async () => {
    const { p, gh } = montar();
    await p.guardarPostulacion({ empresa: 'Acme', cargo: 'Dev', estado: 'Entrevista', notas: 'Llamaron' });
    const put = gh.log.find((l) => l.metodo === 'PUT')!;
    expect(put.ruta).toBe('postulaciones/Acme - Dev.md');
    expect(put.body!.message).toBe('postulador: actualiza Acme - Dev (Entrevista)');
    expect(gh.archivos['postulaciones/Acme - Dev.md']).toMatch(/visibilidad: privado/);
    await expect(p.guardarPostulacion({ empresa: 'X', cargo: 'Y', estado: 'Ganada' as never })).rejects.toThrow(/Estado inválido/);
  });

  it('lista postulaciones sin exponer notas de otras carpetas', async () => {
    const { p } = montar();
    const l = await p.listarPostulaciones();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ empresa: 'Acme', fecha: '2026-09-01' });
  });
});
