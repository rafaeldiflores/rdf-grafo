import { describe, expect, it } from 'vitest';
import { despejarEtiquetas, type CajaEtiqueta } from './etiquetas';

const caja = (id: string, x0: number, y0: number, ancho: number, extra: Partial<CajaEtiqueta> = {}): CajaEtiqueta => ({
  id,
  x0,
  y0,
  x1: x0 + ancho,
  y1: y0 + 12,
  nivel: 2,
  peso: 1,
  visible: true,
  ...extra,
});

const pisan = (a: CajaEtiqueta, b: CajaEtiqueta, dyA = 0, dyB = 0): boolean =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 + dyA < b.y1 + dyB && a.y1 + dyA > b.y0 + dyB;

describe('despejarEtiquetas', () => {
  it('no toca etiquetas que no se pisan', () => {
    const r = despejarEtiquetas([caja('Angular', 0, 0, 40), caja('Firebase', 100, 0, 50)]);
    expect(r.ocultas.size).toBe(0);
    expect(r.dy.size).toBe(0);
  });

  it('entre dos tecnologías que se pisan queda la de mayor peso', () => {
    const r = despejarEtiquetas([caja('Karma', 0, 0, 40, { peso: 1 }), caja('Angular', 10, 4, 50, { peso: 6 })]);
    expect([...r.ocultas]).toEqual(['Karma']);
  });

  it('una tecnología cede ante un proyecto aunque pese más', () => {
    const r = despejarEtiquetas([caja('TypeScript', 0, 0, 60, { peso: 20 }), caja('MAZA', 20, 4, 40, { nivel: 1, peso: 3 })]);
    expect([...r.ocultas]).toEqual(['TypeScript']);
  });

  it('nunca oculta proyectos: corre el de menor peso hasta dejarlos separados', () => {
    const maza = caja('MAZA', 100, 100, 40, { nivel: 1, peso: 20 });
    const web = caja('MAZA web', 110, 104, 60, { nivel: 1, peso: 8 });
    const r = despejarEtiquetas([web, maza]);
    expect(r.ocultas.size).toBe(0);
    expect(r.dy.has('MAZA')).toBe(false);
    const d = r.dy.get('MAZA web')!;
    expect(d).toBeGreaterThan(0);
    expect(pisan(web, maza, d, 0)).toBe(false);
  });

  it('si abajo está ocupado, corre el proyecto hacia arriba', () => {
    const maza = caja('MAZA', 100, 100, 40, { nivel: 1, peso: 20 });
    const abajo = caja('MedInfo', 100, 116, 60, { nivel: 1, peso: 15 });
    const masAbajo = caja('JobFill AI', 100, 132, 60, { nivel: 1, peso: 12 });
    const web = caja('MAZA web', 110, 104, 60, { nivel: 1, peso: 8 });
    const r = despejarEtiquetas([maza, abajo, masAbajo, web]);
    expect(r.dy.get('MAZA web')!).toBeLessThan(0);
    expect(pisan(web, maza, r.dy.get('MAZA web')!, 0)).toBe(false);
  });

  it('un proyecto ya corrido conserva su corrimiento mientras siga libre', () => {
    const maza = caja('MAZA', 100, 100, 40, { nivel: 1, peso: 20 });
    const web = (dyActual: number) => caja('MAZA web', 110, 104, 60, { nivel: 1, peso: 8, dyActual });
    // Sin memoria elige el hueco más cercano; con memoria se queda donde estaba.
    const nuevo = despejarEtiquetas([maza, web(0)]).dy.get('MAZA web')!;
    expect(despejarEtiquetas([maza, web(nuevo + 5)]).dy.get('MAZA web')).toBe(nuevo + 5);
    // Si el corrimiento viejo ahora choca, se recalcula.
    expect(despejarEtiquetas([maza, web(2)]).dy.get('MAZA web')).toBe(nuevo);
  });

  it('un proyecto corrido vuelve a su sitio solo cuando queda con holgura', () => {
    const maza = caja('MAZA', 100, 100, 40, { nivel: 1, peso: 20 });
    const justo = caja('MAZA web', 110, 115, 60, { nivel: 1, peso: 8, dyActual: 10 }); // a 3 px
    const lejos = caja('MAZA web', 110, 130, 60, { nivel: 1, peso: 8, dyActual: 10 });
    expect(despejarEtiquetas([maza, justo]).dy.get('MAZA web')).toBe(10);
    expect(despejarEtiquetas([maza, lejos]).dy.has('MAZA web')).toBe(false);
  });

  it('las etiquetas en foco siempre se muestran y mandan sobre el resto', () => {
    const r = despejarEtiquetas([
      caja('Claude API', 0, 0, 60, { nivel: 0 }),
      caja('MAZA', 10, 4, 40, { nivel: 1, peso: 20 }),
      caja('Karma', 20, 2, 30, { peso: 9 }),
    ]);
    expect(r.ocultas.has('Claude API')).toBe(false);
    expect(r.ocultas.has('Karma')).toBe(true);
    expect(r.dy.has('MAZA')).toBe(true);
  });

  it('a igual peso conserva la que ya estaba visible (sin parpadeo)', () => {
    const a = caja('Flask', 0, 0, 40, { visible: false });
    const b = caja('React', 10, 4, 40, { visible: true });
    expect([...despejarEtiquetas([a, b]).ocultas]).toEqual(['Flask']);
    expect([...despejarEtiquetas([b, a]).ocultas]).toEqual(['Flask']);
  });

  it('una etiqueta oculta necesita holgura extra para reaparecer', () => {
    const fija = caja('Angular', 0, 0, 40, { peso: 5 });
    // A 4 px de distancia: cabe si ya estaba visible, no si viene de estar oculta.
    const cerca = (visible: boolean) => caja('Ionic', 44, 0, 30, { visible });
    expect(despejarEtiquetas([fija, cerca(true)]).ocultas.size).toBe(0);
    expect([...despejarEtiquetas([fija, cerca(false)]).ocultas]).toEqual(['Ionic']);
  });
});
