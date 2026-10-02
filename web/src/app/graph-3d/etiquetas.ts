/**
 * Despeje de etiquetas en pantalla: decide qué nombres se muestran cuando dos
 * se pisan. Es una función pura sobre rectángulos en píxeles, así se prueba sin
 * escena ni navegador.
 *
 * Reglas:
 *  - Las etiquetas en foco (selección, hover, búsqueda) siempre se muestran.
 *  - Los proyectos nunca se ocultan: si chocan, el de menor peso se corre en
 *    vertical hasta el hueco libre más cercano, sin alejarse mucho de su nodo.
 *  - El resto (tecnologías, formación…) se oculta si pisa algo ya ubicado.
 *    Gana la de mayor peso; a igual peso, la que ya estaba visible, para que el
 *    grafo no parpadee mientras gira.
 */

/** Prioridad de una etiqueta: 0 = en foco, 1 = proyecto, 2 = el resto. */
export type NivelEtiqueta = 0 | 1 | 2;

export interface CajaEtiqueta {
  id: string;
  /** Rectángulo en píxeles de pantalla, sin corrimiento aplicado. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  nivel: NivelEtiqueta;
  /** Importancia dentro del nivel (p. ej. el grado del nodo). */
  peso: number;
  /** Si hoy se está mostrando: se usa como histéresis contra el parpadeo. */
  visible: boolean;
  /** Corrimiento que ya tiene aplicado (px). Mientras siga sirviendo, se conserva. */
  dyActual?: number;
}

export interface Despeje {
  /** Etiquetas que no caben y se apagan. */
  ocultas: Set<string>;
  /** Corrimiento vertical en px de las que se movieron (solo proyectos). */
  dy: Map<string, number>;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const pisa = (a: Rect, b: Rect, margen: number): boolean =>
  a.x0 < b.x1 + margen && a.x1 > b.x0 - margen && a.y0 < b.y1 + margen && a.y1 > b.y0 - margen;

const libre = (r: Rect, puestas: readonly Rect[], margen: number): boolean => !puestas.some((p) => pisa(r, p, margen));

/**
 * @param margen   aire mínimo en px entre dos etiquetas.
 * @param holgura  aire extra que se le exige a una etiqueta oculta para volver
 *                 a aparecer (histéresis).
 */
export function despejarEtiquetas(cajas: readonly CajaEtiqueta[], margen = 2, holgura = 4): Despeje {
  const orden = [...cajas].sort(
    (a, b) =>
      a.nivel - b.nivel ||
      (a.nivel === 2 ? Number(b.visible) - Number(a.visible) : 0) ||
      b.peso - a.peso ||
      a.id.localeCompare(b.id),
  );
  const puestas: Rect[] = [];
  const ocultas = new Set<string>();
  const dy = new Map<string, number>();

  for (const c of orden) {
    const r: Rect = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
    if (c.nivel === 0) {
      puestas.push(r);
      continue;
    }
    if (c.nivel === 1) {
      const previo = c.dyActual ?? 0;
      // Ya corrida: para volver a su sitio pide holgura, así no va y viene.
      if (!libre(r, puestas, previo ? margen + holgura : margen)) {
        const tope = (c.y1 - c.y0) * 3.5;
        const mover = (d: number): Rect => ({ x0: c.x0, y0: c.y0 + d, x1: c.x1, y1: c.y1 + d });
        // Si el corrimiento que ya tiene sigue libre, se queda: el grafo gira
        // todo el tiempo y recalcular en cada pasada la haría temblar.
        if (previo && Math.abs(previo) <= tope && libre(mover(previo), puestas, margen)) {
          dy.set(c.id, previo);
          puestas.push(mover(previo));
          continue;
        }
        // Avanza en un sentido saltando lo que va pisando, hasta quedar libre o
        // alejarse demasiado del nodo.
        const buscar = (sentido: 1 | -1): number | undefined => {
          let d = 0;
          for (let i = 0; i < 6; i++) {
            const choques = puestas.filter((p) => pisa(mover(d), p, margen));
            if (!choques.length) return d;
            d = sentido === 1 ? Math.max(...choques.map((p) => p.y1)) + margen - c.y0 : Math.min(...choques.map((p) => p.y0)) - margen - c.y1;
            if (Math.abs(d) > tope) return undefined;
          }
          return undefined;
        };
        const abajo = buscar(1);
        const arriba = buscar(-1);
        // El hueco más cercano; a igual distancia, hacia abajo (no tapa el nodo).
        const d = abajo === undefined ? arriba : arriba === undefined || abajo <= -arriba ? abajo : arriba;
        if (d !== undefined) {
          dy.set(c.id, d);
          puestas.push(mover(d));
          continue;
        }
        // Sin hueco cerca: se queda donde está (un proyecto nunca se oculta).
      }
      puestas.push(r);
      continue;
    }
    if (libre(r, puestas, c.visible ? margen : margen + holgura)) puestas.push(r);
    else ocultas.add(c.id);
  }
  return { ocultas, dy };
}
