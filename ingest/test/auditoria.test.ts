import { describe, expect, it } from 'vitest';
import { auditar, formatAuditoria } from '../src/auditoria.ts';
import { addLogros } from '../src/graph.ts';
import { parseLogros } from '../src/logros.ts';
import { build, link, mkNote } from './helpers.ts';

const BASE = `## CADENAS CANONICAS
MAZA: en pruebas cerradas (v1.18.0), con 14 talleres.

## MAZA - SaaS (May 2024 - presente)
Nodo: [[MAZA]]
Estado: en pruebas cerradas para Google Play (v1.18.0)

- [maza-01] Plataforma
  tec: Ionic 8, Angular 22, Firestore

## MedInfo - CESFAM (Dic 2025 - May 2026)
- [medinfo-01] Web por roles
  tec: Angular, Python
`;

const grafo = () => {
  const { graph } = build([
    mkNote('MAZA', { tipo: 'proyecto', estado: 'activo', stack: [link('Angular'), link('Ionic Angular'), link('Firebase'), link('jsPDF')] }),
    mkNote('MedInfo', { tipo: 'proyecto', stack: [link('Angular'), link('Flask'), link('Supabase')] }),
    mkNote('Portafolio web', { tipo: 'proyecto', estado: 'activo' }),
    mkNote('Toolkit', { tipo: 'proyecto', estado: 'idea' }),
    mkNote('Angular', { tipo: 'tecnologia', paquete: '@angular/core' }),
    mkNote('Ionic Angular', { tipo: 'tecnologia', paquete: '@ionic/angular', aliases: ['Ionic'] }),
    mkNote('Firebase', { tipo: 'tecnologia', aliases: ['Firestore'] }),
    mkNote('Python', { tipo: 'tecnologia' }),
    mkNote('jsPDF', { tipo: 'tecnologia' }),
    mkNote('Flask', { tipo: 'tecnologia' }),
    mkNote('Supabase', { tipo: 'tecnologia' }),
  ]);
  addLogros(graph, parseLogros(BASE).logros);
  return graph;
};

const CV = '## RESUMEN PROFESIONAL\nCreador de MAZA: en pruebas cerradas (v1.18.0). Angular 22 y Firebase.\n';
const al = (version: string, angular: string) => ({ MAZA: { version, paquetes: { '@angular/core': angular, '@ionic/angular': '8.4.0' } } });
const reglas = (h: ReturnType<typeof auditar>, r: string) => h.filter((x) => x.regla === r);

describe('auditar', () => {
  it('sin desfases de versión cuando el repo coincide', () => {
    const h = auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: al('1.18.0', '22.1.5') });
    expect(reglas(h, 'version-proyecto')).toEqual([]);
    expect(reglas(h, 'version-tecnologia')).toEqual([]);
  });

  it('detecta la versión del proyecto desfasada en la BASE (también en su sección) y en los CVs', () => {
    const [v] = reglas(auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: al('1.19.0', '22.1.5') }), 'version-proyecto');
    expect(v).toMatchObject({ severidad: 'alta', accion: expect.stringContaining('v1.19.0') });
    expect(v!.donde).toEqual(['cv/BASE_Experiencia.md:2 (v1.18.0)', 'cv/BASE_Experiencia.md:6 (v1.18.0)', 'cv/base/FullStack.md:2 (v1.18.0)']);
  });

  it('detecta la versión mayor desfasada de una tecnología, por nombre o alias', () => {
    const h = auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: al('1.18.0', '23.0.0') });
    const [v] = reglas(h, 'version-tecnologia');
    expect(v).toMatchObject({ detalle: expect.stringContaining('Angular instalada es la 23') });
    expect(v!.donde).toEqual(['cv/BASE_Experiencia.md:9 (angular 22)', 'cv/base/FullStack.md:2 (angular 22)']);
    // "Ionic 8" (alias) coincide con @ionic/angular 8.x: no se reporta.
    expect(h.some((x) => x.detalle.startsWith('Ionic Angular'))).toBe(false);
  });

  it('no confunde porcentajes ni versiones de otras cosas con versiones mayores', () => {
    const base = BASE + '\n- [maza-02] Algo\n  tec: Angular 40% mas rapido\n  metrica: Angular 22.1 estable\n';
    const h = auditar({ graph: grafo(), base, cvs: {}, repos: al('1.18.0', '22.0.0') });
    expect(reglas(h, 'version-tecnologia')).toEqual([]);
  });

  it('reporta proyectos sin logros (idea = baja) y tecnologías del stack que la BASE no nombra', () => {
    const h = auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: {} });
    expect(reglas(h, 'proyecto-sin-logros').map((x) => [x.detalle.split(' ')[0], x.severidad])).toEqual([
      ['Portafolio', 'media'],
      ['Toolkit', 'baja'],
    ]);
    expect(reglas(h, 'tecnologia-sin-base').map((x) => x.detalle)).toEqual([
      'MAZA usa jsPDF, pero la BASE no la nombra: el Postulador no puede declararla',
      'MedInfo usa Flask, Supabase, pero la BASE no las nombra: el Postulador no puede declararlas',
    ]);
  });

  it('reporta tecnologías demostradas que ningún CV base nombra', () => {
    const [x] = reglas(auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: {} }), 'tecnologia-sin-cv');
    expect(x!.detalle).toBe('Demostradas por logros pero en ningún CV base: Ionic Angular (1), Python (1)');
  });

  it('ordena por severidad y formatea', () => {
    const h = auditar({ graph: grafo(), base: BASE, cvs: { FullStack: CV }, repos: al('1.19.0', '22.0.0') });
    expect(h[0]!.severidad).toBe('alta');
    const out = formatAuditoria(h, ['MedInfo']);
    expect(out).toMatch(/^Auditoría del CV: 1 alta · \d+ media · \d+ baja/);
    expect(out).toContain('## Prioridad alta (1)');
    expect(out).toContain('Sin repo local configurado (no se revisan sus versiones): MedInfo.');
    expect(formatAuditoria([])).toBe('Auditoría del CV: todo al día.');
  });
});
