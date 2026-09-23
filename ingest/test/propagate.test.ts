import { describe, expect, it } from 'vitest';
import { findBlocks, label, major, projectStack, renderChips, renderTable, replaceBlocks } from '../src/propagate.ts';
import { link, mkNote } from './helpers.ts';

const notes = [
  mkNote('App', {
    tipo: 'proyecto',
    visibilidad: 'publico',
    stack: [link('Ionic Angular'), link('Firebase'), link('Pagos'), link('BigQuery')],
    stack_destacado: [link('Firebase'), link('Ionic Angular')],
  }),
  mkNote('Ionic Angular', { tipo: 'tecnologia', paquete: '@ionic/angular', etiqueta: 'Ionic Angular {mayor:@angular/core}' }),
  mkNote('Firebase', { tipo: 'tecnologia', paquete: 'firebase', etiqueta: 'Firebase Auth / Storage' }),
  mkNote('Pagos', { tipo: 'tecnologia', etiqueta: 'Pagos <Pro>' }),
  mkNote('BigQuery', { tipo: 'tecnologia' }),
  mkNote('Privado', { tipo: 'proyecto', visibilidad: 'privado', stack: [link('BigQuery')] }),
];
const versions = { '@ionic/angular': '8.8.13', '@angular/core': '^22.1.5', firebase: '12.15.0' };

describe('bloques', () => {
  const text = 'a <!-- grafo:chips App -->VIEJO<!-- /grafo --> b\n<!-- grafo:tabla App -->\nX\n<!-- /grafo -->';

  it('encuentra formato, proyecto y contenido', () => {
    expect(findBlocks(text).map((b) => [b.format, b.project, b.inner])).toEqual([
      ['chips', 'App', 'VIEJO'],
      ['tabla', 'App', '\nX\n'],
    ]);
  });

  it('reemplaza solo el contenido entre marcadores', () => {
    expect(replaceBlocks(text, (b) => b.format.toUpperCase())).toBe(
      'a <!-- grafo:chips App -->CHIPS<!-- /grafo --> b\n<!-- grafo:tabla App -->TABLA<!-- /grafo -->',
    );
  });

  it('es idempotente', () => {
    const once = replaceBlocks(text, () => 'Z');
    expect(replaceBlocks(once, () => 'Z')).toBe(once);
  });
});

describe('etiquetas', () => {
  it('usa la versión mayor del paquete indicado', () => {
    expect(label({ name: 'Ionic Angular', paquete: '@ionic/angular', etiqueta: 'Ionic Angular {mayor:@angular/core}' }, versions)).toBe('Ionic Angular 22');
    expect(label({ name: 'X', paquete: 'firebase', etiqueta: 'X {version}' }, versions)).toBe('X 12.15.0');
  });
  it('sin etiqueta usa el nombre', () => expect(label({ name: 'BigQuery' }, versions)).toBe('BigQuery'));
  it('falla si falta la versión (no inventa)', () => {
    expect(() => label({ name: 'X', etiqueta: 'X {mayor:no-existe}' }, versions)).toThrow(/no hay versión/);
  });
  it('major limpia rangos', () => expect(major('^22.1.5')).toBe('22'));
});

describe('projectStack', () => {
  it('respeta el orden de stack_destacado', () => {
    expect(projectStack(notes, 'App').destacado.map((t) => t.name)).toEqual(['Firebase', 'Ionic Angular']);
  });
  it('se niega a propagar un proyecto privado', () => {
    expect(() => projectStack(notes, 'Privado')).toThrow(/no es público/);
  });
});

describe('renderChips', () => {
  it('genera spans en orden y escapa HTML', () => {
    const ps = projectStack(notes, 'App');
    expect(renderChips(ps, versions)).toBe('<span>Firebase Auth / Storage</span><span>Ionic Angular 22</span>');
    expect(renderChips({ ...ps, destacado: [ps.stack[2]!] }, versions)).toBe('<span>Pagos &lt;Pro&gt;</span>');
  });
});

describe('renderTable', () => {
  const previa = `
| Tecnología | Versión | Uso |
|---|---|---|
| Ionic Angular | 7.0.0 | UI |
| Firebase Auth | 11 | Login |
| Firebase Storage | 11 | Imágenes |
| Pagos | Checkout | Cobros |
| Angular | 18 | Base |
`;
  const { table, dropped } = renderTable(projectStack(notes, 'App'), versions, previa);
  const rows = table.trim().split('\n').slice(2);

  it('pone las destacadas primero y luego el resto del stack', () => {
    expect(rows.map((r) => r.split('|')[1]!.trim())).toEqual(['Firebase', 'Ionic Angular', 'Pagos', 'BigQuery']);
  });
  it('actualiza la versión desde el paquete instalado', () => {
    expect(rows[1]).toBe('| Ionic Angular | 8.8.13 | UI |');
  });
  it('junta el Uso de varias filas previas (Firebase Auth + Storage)', () => {
    expect(rows[0]).toBe('| Firebase | 12.15.0 | Login; Imágenes |');
  });
  it('sin paquete conserva la versión escrita; sin fila previa marca por completar', () => {
    expect(rows[2]).toBe('| Pagos | Checkout | Cobros |');
    expect(rows[3]).toBe('| BigQuery | — | _por completar_ |');
  });
  it('reporta filas que ya no están en el stack', () => expect(dropped).toEqual(['Angular']));
  it('es idempotente sobre su propia salida', () => {
    expect(renderTable(projectStack(notes, 'App'), versions, table).table).toBe(table);
  });
});
