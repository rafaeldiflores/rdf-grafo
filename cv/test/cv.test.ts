import { describe, expect, it } from 'vitest';
import { extraerInstrucciones } from '../src/instrucciones.ts';
import { lintCv } from '../src/lint.ts';
import { parseCv, parseEncabezado } from '../src/parse.ts';
import { chromePath, contarPaginas, htmlAPdf } from '../src/pdf.ts';
import { renderHtml } from '../src/render.ts';

const enc = parseEncabezado(`---
nombre: "ANA PRUEBA"
ubicacion: "Santiago, Chile"
telefono: "+56 9 0000 0000"
email: "ana@example.com"
links:
  - { etiqueta: "GitHub", url: "github.com/ana" }
fechas_fijas: { MAZA: "May 2024" }
nunca_incluir: ["Proyecto Secreto"]
---`);

const cvOk = `---
titulo: "Ingeniera | Desarrolladora Full-Stack"
---
## RESUMEN PROFESIONAL
Ingeniera con **experiencia** en TypeScript.
## HABILIDADES TÉCNICAS
- **Frontend:** Angular, React.
## EXPERIENCIA PROFESIONAL
### Fundadora | MAZA (SaaS) (May 2024 – Presente)
- **Backend:** Worker con 21 endpoints.
## EDUCACIÓN Y CERTIFICACIONES
### Ingeniería en Informática | Duoc UC (Mar 2021 – Dic 2025)
- **Estado:** Titulada.
`;

describe('parseCv', () => {
  const cv = parseCv(cvOk);
  it('lee título, secciones, entradas y viñetas', () => {
    expect(cv.titulo).toBe('Ingeniera | Desarrolladora Full-Stack');
    expect(cv.secciones.map((s) => s.titulo)).toHaveLength(4);
    expect(cv.secciones[2]!.entradas[0]).toEqual({ titulo: 'Fundadora | MAZA (SaaS) (May 2024 – Presente)', vinetas: ['**Backend:** Worker con 21 endpoints.'] });
  });
  it('rechaza encabezados no admitidos y párrafos dentro de entradas', () => {
    expect(() => parseCv(cvOk.replace('## RESUMEN PROFESIONAL', '# RESUMEN'))).toThrow(/no admitido/);
    expect(() => parseCv(cvOk.replace('- **Backend:** Worker con 21 endpoints.', 'Texto suelto'))).toThrow(/Párrafo dentro de una entrada/);
  });
  it('exige título', () => expect(() => parseCv('---\nperfil: x\n---\n## A')).toThrow(/titulo/));
});

describe('lintCv', () => {
  const reglas = (md: string) => lintCv(parseCv(md), enc).map((h) => h.regla);
  it('un CV correcto no tiene hallazgos', () => expect(lintCv(parseCv(cvOk), enc)).toEqual([]));
  it('exige las 4 anclas ATS en orden', () => {
    expect(reglas(cvOk.replace('## HABILIDADES TÉCNICAS', '## SKILLS'))).toContain('anclas-ats');
  });
  it('exige "Cargo | Empresa (Mes Año – …)" en una línea', () => {
    expect(reglas(cvOk.replace('(Mar 2021 – Dic 2025)', '(2021 – 2025)'))).toContain('entrada-una-linea');
  });
  it('aplica las fechas fijas', () => {
    expect(reglas(cvOk.replace('(May 2024 – Presente)', '(Mar 2024 – Presente)'))).toContain('fecha-fija');
  });
  it.each(['ESTIMADA', 'confirmado vigente al 2026-09-22', '[[marcador]]', 'Inglés C1'])('prohíbe "%s"', (txt) => {
    expect(reglas(cvOk.replace('Titulada.', `Titulada. ${txt}`))).toContain('texto-prohibido');
  });
  it('bloquea textos de nunca_incluir sin importar mayúsculas', () => {
    expect(reglas(cvOk.replace('Titulada.', 'Titulada. Ver proyecto secreto.'))).toContain('nunca-incluir');
  });
  it('rechaza el título antiguo "EXPERIENCIA / PROYECTOS EN …"', () => {
    expect(reglas(cvOk.replace('## EXPERIENCIA PROFESIONAL', '## EXPERIENCIA / PROYECTOS EN DESARROLLO'))).toContain('anclas-ats');
  });

  describe('título profesional literal', () => {
    const encT = { ...enc, titulo_profesional: 'Ingeniero en Informática', grado: 'Ingeniería en Informática' };
    const cvT = cvOk
      .replace('titulo: "Ingeniera | Desarrolladora Full-Stack"', 'titulo: "Ingeniero en Informática | Desarrollador Full-Stack"')
      .replace('Ingeniera con', 'Ingeniero en Informática con');
    const detalles = (md: string) => lintCv(parseCv(md), encT).filter((h) => h.regla === 'titulo-profesional').map((h) => h.detalle);
    it('acepta el título y el grado escritos tal cual', () => expect(detalles(cvT)).toEqual([]));
    it.each(['Ingeniero en Informático', 'Ingeniero en Informatica', 'Ingeniera en Informática', 'ingeniero en informática'])('detecta "%s"', (malo) => {
      expect(detalles(cvT.replace('Ingeniero en Informática con', `${malo} con`)).join()).toContain(`"${malo}"`);
    });
    it('exige que el subtítulo empiece con el título profesional', () => {
      expect(detalles(cvT.replace('"Ingeniero en Informática | Desarrollador', '"Desarrollador'))).toHaveLength(1);
    });
    it('sin titulo_profesional en el encabezado la regla no aplica', () => expect(reglas(cvOk)).not.toContain('titulo-profesional'));
  });

  it('avisa con más de 8 viñetas de experiencia', () => {
    const muchas = Array.from({ length: 9 }, (_, i) => `- **V${i}:** x.`).join('\n');
    expect(reglas(cvOk.replace('- **Backend:** Worker con 21 endpoints.', muchas))).toContain('densidad');
  });
});

describe('renderHtml', () => {
  const html = renderHtml(parseCv(cvOk), enc);
  it('usa el encabezado del vault y solo negrita como formato', () => {
    expect(html).toContain('<h1>ANA PRUEBA</h1>');
    expect(html).toContain('<strong>experiencia</strong>');
    expect(html).toContain('href="https://github.com/ana"');
  });
  it('escapa HTML del contenido', () => {
    expect(renderHtml(parseCv(cvOk.replace('TypeScript', '<script>x</script>')), enc)).not.toContain('<script>x');
  });
  it('es una sola columna: sin tablas', () => expect(html).not.toMatch(/<table|column/));
});

let hayChrome = true;
try {
  chromePath();
} catch {
  hayChrome = false;
}

describe.skipIf(!hayChrome)('PDF con Chrome', () => {
  it('genera 1 página con texto seleccionable', async () => {
    const r = await htmlAPdf(renderHtml(parseCv(cvOk), enc), 'Letter');
    expect(r.paginas).toBe(1);
    expect(r.lineasDeMas).toBeLessThan(0);
    expect(r.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // Chrome incrusta la fuente como texto (no imagen): hay operadores de texto.
    expect(r.pdf.toString('latin1')).toMatch(/\/Font/);
  }, 60_000);

  it('detecta cuando no cabe en una página', async () => {
    const largo = cvOk.replace('- **Backend:** Worker con 21 endpoints.', Array.from({ length: 80 }, (_, i) => `- **V${i}:** texto.`).join('\n'));
    const r = await htmlAPdf(renderHtml(parseCv(largo), enc), 'Letter');
    expect(r.paginas).toBeGreaterThan(1);
    expect(r.lineasDeMas).toBeGreaterThan(0);
  }, 60_000);

  it('contarPaginas ignora el nodo /Pages', () => {
    expect(contarPaginas(Buffer.from('/Type /Pages /Type /Page /Type/Page'))).toBe(2);
  });
});

describe('instrucciones del vault', () => {
  it('quita frontmatter y comentarios; vacía o ausente = null', () => {
    expect(extraerInstrucciones('---\na: 1\n---\n<!-- ayuda\nvarias líneas -->\n\nREGLAS:\n- una\n')).toBe('REGLAS:\n- una');
    expect(extraerInstrucciones('﻿---\r\na: 1\r\n---\r\nX')).toBe('X');
    expect(extraerInstrucciones('Sin frontmatter --- aquí')).toBe('Sin frontmatter --- aquí');
    expect(extraerInstrucciones('---\na: 1\n---\n<!-- solo ayuda -->\n')).toBeNull();
    expect(extraerInstrucciones(null)).toBeNull();
  });
});
