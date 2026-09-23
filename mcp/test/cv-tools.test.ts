import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chromePath } from '../../cv/src/pdf.ts';
import { CvStore, hoy, nombreSeguro } from '../src/cv-tools.ts';

// Vault desechable con lo mínimo: encabezado, BASE, un CV base y una postulación.
const vault = mkdtempSync(join(tmpdir(), 'vault-cv-'));
afterAll(() => rmSync(vault, { recursive: true, force: true }));
for (const d of ['cv/base', 'postulaciones']) mkdirSync(join(vault, d), { recursive: true });
writeFileSync(
  join(vault, 'cv/encabezado.md'),
  '---\nnombre: "ANA"\nubicacion: "Chile"\ntelefono: "+56"\nemail: "a@b.cl"\nfechas_fijas: { MAZA: "May 2024" }\nnunca_incluir: ["Proyecto Vetado"]\n---\n',
);
writeFileSync(join(vault, 'cv/BASE_Experiencia.md'), '# BASE\n- [maza-x] logro\n');
const CV = `---
titulo: "Ingeniera | Full-Stack"
---
## RESUMEN PROFESIONAL
Texto corto.
## HABILIDADES TÉCNICAS
- **Frontend:** Angular.
## EXPERIENCIA PROFESIONAL
### Fundadora | MAZA (SaaS) (May 2024 – Presente)
- **Backend:** Worker.
## EDUCACIÓN Y CERTIFICACIONES
### Ingeniería | Duoc UC (Mar 2021 – Dic 2025)
- **Estado:** Titulada.
`;
writeFileSync(join(vault, 'cv/base/FullStack.md'), CV);
writeFileSync(
  join(vault, 'postulaciones/Acme - Dev.md'),
  '---\ntipo: postulacion\nvisibilidad: privado\nempresa: "Acme"\ncargo: "Dev"\nfecha: 2026-09-01\nestado: "Postulado"\n---\n# Dev — Acme\n\nNota original.\n',
);

const store = new CvStore(vault);

describe('nombreSeguro', () => {
  it('quita separadores de ruta y caracteres inválidos', () => {
    expect(nombreSeguro('ON*NET / FIBRA: Dev?')).toBe('ON-NET - FIBRA- Dev');
    expect(nombreSeguro('../../etc/passwd')).toBe('etc-passwd');
  });
  it('rechaza nombres vacíos', () => expect(() => nombreSeguro('///')).toThrow());
});

describe('contexto y listado', () => {
  it('entrega BASE, perfiles y reglas', () => {
    const c = store.contexto();
    expect(c.base).toContain('maza-x');
    expect(c.perfiles.map((p) => p.perfil)).toEqual(['FullStack']);
    expect(c.reglas.nunca_incluir).toEqual(['Proyecto Vetado']);
    expect(c.instrucciones).toBeNull();
  });
  it('entrega las instrucciones del vault cuando existen', () => {
    const ruta = join(vault, 'cv/instrucciones.md');
    writeFileSync(ruta, '<!-- ayuda -->\nREGLAS: {TITULO}\n');
    try {
      expect(store.contexto().instrucciones).toBe('REGLAS: {TITULO}');
    } finally {
      rmSync(ruta);
    }
  });
  it('lista postulaciones con fechas en texto y sin campos internos', () => {
    const [p] = store.listarPostulaciones();
    expect(p).toMatchObject({ nota: 'Acme - Dev', empresa: 'Acme', fecha: '2026-09-01', estado: 'Postulado' });
    expect(p).not.toHaveProperty('visibilidad');
  });
});

describe('guardarPostulacion', () => {
  it('actualiza solo los campos enviados, conserva el cuerpo y agrega la nota con fecha', () => {
    const r = store.guardarPostulacion({ empresa: 'Acme', cargo: 'Dev', estado: 'Entrevista', proxima_fecha: '2026-09-30', notas: 'Llamaron.' });
    expect(r.creada).toBe(false);
    const txt = readFileSync(r.nota, 'utf8');
    expect(txt).toMatch(/estado: Entrevista/);
    expect(txt).toMatch(/fecha: '?2026-09-01'?/); // la fecha original no cambia ni se vuelve timestamp
    expect(txt).not.toMatch(/T00:00:00/);
    expect(txt).toContain('Nota original.');
    expect(txt).toContain(`- ${hoy()}: Llamaron.`);
  });
  it('crea una nota nueva siempre privada', () => {
    const r = store.guardarPostulacion({ empresa: 'Nueva/Co', cargo: 'Data', estado: 'Postulado' });
    expect(r.creada).toBe(true);
    expect(r.nota).toContain(join(vault, 'postulaciones'));
    const txt = readFileSync(r.nota, 'utf8');
    expect(txt).toMatch(/tipo: postulacion/);
    expect(txt).toMatch(/visibilidad: privado/);
  });
  it('valida estado y fechas', () => {
    expect(() => store.guardarPostulacion({ empresa: 'X', cargo: 'Y', estado: 'Ganada' as never })).toThrow(/Estado inválido/);
    expect(() => store.guardarPostulacion({ empresa: 'X', cargo: 'Y', estado: 'Postulado', fecha: '23/09/2026' })).toThrow(/AAAA-MM-DD/);
  });
});

let hayChrome = true;
try {
  chromePath();
} catch {
  hayChrome = false;
}

describe.skipIf(!hayChrome)('validar y generar PDF', () => {
  it('valida y devuelve HTML de vista previa sin escribir nada', async () => {
    const r = await store.validar(CV);
    expect(r.ok).toBe(true);
    expect(r.paginas).toBe(1);
    expect(r.html).toContain('<h1>ANA</h1>');
    expect(existsSync(join(vault, 'cv/generados'))).toBe(false);
  }, 60_000);
  it('se niega a generar si rompe una regla', async () => {
    await expect(store.generarPdf(CV.replace('Titulada.', 'Titulada. Proyecto Vetado.'), 'x')).rejects.toThrow(/nunca va en un CV/);
  }, 60_000);
  it('genera el PDF solo dentro de cv/generados, aunque el nombre intente salir', async () => {
    const r = await store.generarPdf(CV, '../../fuera');
    expect(r.pdf).toContain(join(vault, 'cv', 'generados'));
    expect(existsSync(join(vault, 'cv/generados/fuera.pdf'))).toBe(true);
    expect(existsSync(join(vault, 'cv/generados/fuera.md'))).toBe(true);
    expect(Buffer.from(r.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
});
