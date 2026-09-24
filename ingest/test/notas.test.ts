import { describe, expect, it } from 'vitest';
import { agregarAlArray, agregarAliases, notaTecnologia } from '../src/notas.ts';

describe('agregarAlArray', () => {
  it('agrega un link nuevo al final del array, preservando el resto de la línea', () => {
    const texto = 'stack: ["[[Angular]]", "[[Firebase]]"]\nstack_destacado: ["[[Angular]]"]';
    const { texto: out, ok } = agregarAlArray(texto, 'stack', '"[[Python]]"');
    expect(ok).toBe(true);
    expect(out).toBe('stack: ["[[Angular]]", "[[Firebase]]", "[[Python]]"]\nstack_destacado: ["[[Angular]]"]');
  });

  it('no duplica si el link ya está', () => {
    const texto = 'stack: ["[[Angular]]", "[[Python]]"]';
    const { texto: out } = agregarAlArray(texto, 'stack', '"[[Python]]"');
    expect(out).toBe(texto);
  });

  it('funciona con el array vacío', () => {
    const { texto } = agregarAlArray('stack: []', 'stack', '"[[Python]]"');
    expect(texto).toBe('stack: ["[[Python]]"]');
  });

  it('ok:false si no encuentra el campo, y no toca el texto', () => {
    const texto = 'otracosa: []';
    const r = agregarAlArray(texto, 'stack', '"[[Python]]"');
    expect(r.ok).toBe(false);
    expect(r.texto).toBe(texto);
  });
});

describe('agregarAliases', () => {
  it('crea aliases: cuando no existe, después de nivel:', () => {
    const texto = '---\ntipo: tecnologia\ncategoria: datos\nnivel:\n---\n# X\n';
    const out = agregarAliases(texto, ['Alias1', 'Alias2']);
    expect(out).toContain('nivel:\naliases: [Alias1, Alias2]');
  });

  it('suma a un aliases: existente sin duplicar', () => {
    const texto = 'aliases: [Machine Learning, ML]';
    const out = agregarAliases(texto, ['ML', 'IA supervisada']);
    expect(out).toBe('aliases: [Machine Learning, ML, IA supervisada]');
  });

  it('sin alias nuevos no cambia nada', () => {
    const texto = 'aliases: [X]';
    expect(agregarAliases(texto, [])).toBe(texto);
  });
});

describe('notaTecnologia', () => {
  it('genera el frontmatter mínimo con aliases', () => {
    expect(notaTecnologia('LLM', 'ia', ['Large Language Models'])).toBe(
      '---\ntipo: tecnologia\ncategoria: ia\nnivel:\naliases: [Large Language Models]\n---\n# LLM\n',
    );
  });

  it('sin aliases omite la línea', () => {
    expect(notaTecnologia('Airflow', 'datos', [])).toBe('---\ntipo: tecnologia\ncategoria: datos\nnivel:\n---\n# Airflow\n');
  });
});
