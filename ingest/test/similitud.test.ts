import { describe, expect, it } from 'vitest';
import { coseno } from '../src/similitud.ts';

describe('coseno', () => {
  it('1 para vectores idénticos', () => {
    expect(coseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('0 para vectores ortogonales', () => {
    expect(coseno([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('-1 para vectores opuestos', () => {
    expect(coseno([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it('0 si algún vector es todo ceros (evita dividir por 0)', () => {
    expect(coseno([0, 0], [1, 2])).toBe(0);
  });

  it('lanza si los vectores tienen distinto largo', () => {
    expect(() => coseno([1, 2], [1, 2, 3])).toThrow(/distinto largo/);
  });
});
