import { describe, expect, it, vi } from 'vitest';
import type { Requisito } from '../src/brechas.ts';
import { agregarSugerencias, calcularVectores, sugerirCandidatos } from '../src/sugerencias.ts';

const req = (termino: string, nivel: Requisito['nivel'] = 'brecha'): Requisito => ({
  termino,
  nivel,
  logros: [],
  proyectos: [],
  aprendizajes: [],
  detectada: false,
});

describe('sugerirCandidatos', () => {
  it('sube a "sugerida" cuando la similitud supera el umbral', () => {
    const reqs = [req('APIs de LLMs')];
    const vectoresRequisito = new Map([['APIs de LLMs', [1, 0]]]);
    const vectoresTecnologia = new Map([['LLM', [1, 0]], ['Docker', [0, 1]]]);
    const out = sugerirCandidatos(reqs, vectoresRequisito, vectoresTecnologia, 0.75);
    expect(out[0]!.nivel).toBe('sugerida');
    expect(out[0]!.candidato).toEqual({ tecnologia: 'LLM', similitud: 1 });
  });

  it('no sugiere nada bajo el umbral', () => {
    const reqs = [req('Cosa rarísima')];
    const vectoresRequisito = new Map([['Cosa rarísima', [1, 0]]]);
    const vectoresTecnologia = new Map([['Docker', [0, 1]]]);
    const out = sugerirCandidatos(reqs, vectoresRequisito, vectoresTecnologia, 0.75);
    expect(out[0]!.nivel).toBe('brecha');
    expect(out[0]!.candidato).toBeUndefined();
  });

  it('nunca toca un nivel que ya no es "brecha"', () => {
    const reqs = [req('Python', 'demostrada')];
    const vectoresRequisito = new Map([['Python', [1, 0]]]);
    const vectoresTecnologia = new Map([['Java', [1, 0]]]);
    const out = sugerirCandidatos(reqs, vectoresRequisito, vectoresTecnologia, 0.5);
    expect(out[0]).toEqual(reqs[0]);
  });

  it('elige el candidato con mayor similitud, no el primero que supera el umbral', () => {
    const reqs = [req('X')];
    const vectoresRequisito = new Map([['X', [1, 0]]]);
    const vectoresTecnologia = new Map([
      ['Parecido', [0.8, 0.6]], // similitud 0.8
      ['Mejor', [1, 0]], // similitud 1
    ]);
    const out = sugerirCandidatos(reqs, vectoresRequisito, vectoresTecnologia, 0.75);
    expect(out[0]!.candidato?.tecnologia).toBe('Mejor');
  });
});

describe('calcularVectores', () => {
  it('llama al embedder una vez con los textos únicos y mapea de vuelta', async () => {
    const embed = vi.fn(async (textos: readonly string[]) => textos.map((t) => [t.length, 0]));
    const out = await calcularVectores(['a', 'bb', 'a'], embed);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['a', 'bb']);
    expect(out.get('a')).toEqual([1, 0]);
    expect(out.get('bb')).toEqual([2, 0]);
  });

  it('con textos vacíos no llama al embedder', async () => {
    const embed = vi.fn();
    const out = await calcularVectores([], embed);
    expect(embed).not.toHaveBeenCalled();
    expect(out.size).toBe(0);
  });
});

describe('agregarSugerencias', () => {
  const tecnologias = new Map([['LLM', 'LLM Large Language Models']]);

  it('sin embedder, devuelve los requisitos intactos', async () => {
    const reqs = [req('APIs de LLMs')];
    const out = await agregarSugerencias(reqs, tecnologias, undefined);
    expect(out).toEqual(reqs);
  });

  it('si el embedder falla, degrada a la clasificación léxica sin romper', async () => {
    const reqs = [req('APIs de LLMs')];
    const embed = vi.fn().mockRejectedValue(new Error('sin cuota'));
    const out = await agregarSugerencias(reqs, tecnologias, embed);
    expect(out).toEqual(reqs);
  });

  it('sin requisitos en brecha, no llama al embedder', async () => {
    const reqs = [req('Python', 'demostrada')];
    const embed = vi.fn();
    await agregarSugerencias(reqs, tecnologias, embed);
    expect(embed).not.toHaveBeenCalled();
  });

  it('camino feliz: sugiere el candidato correcto', async () => {
    const reqs = [req('APIs de LLMs')];
    const embed = vi.fn(async (textos: readonly string[]) =>
      textos.map((t) => (t.includes('LLM') ? [1, 0] : [0, 1])),
    );
    const out = await agregarSugerencias(reqs, tecnologias, embed);
    expect(out[0]!.nivel).toBe('sugerida');
    expect(out[0]!.candidato?.tecnologia).toBe('LLM');
  });
});
