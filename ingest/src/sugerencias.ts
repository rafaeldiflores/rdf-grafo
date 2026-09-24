/**
 * Capa semántica de brechas: para lo que quedó en 'brecha' (ningún match léxico),
 * busca la nota de tecnología más parecida por embeddings y, si supera el umbral,
 * lo sube a 'sugerida' con el candidato y su similitud.
 *
 * Solo es una pista para revisar a mano (crear un alias o una nota nueva) — nunca
 * cuenta como respaldo real ni cambia demostrada/declarada/mencionada/conocida.
 *
 * `sugerirCandidatos` es pura (recibe los vectores ya calculados, sin red, para
 * poder testearla con vectores fabricados). `calcularVectores` es la única parte
 * que llama a un embedder real.
 */
import type { Requisito } from './brechas.ts';
import { coseno } from './similitud.ts';

/** Umbral bajo el cual no se sugiere nada: mejor sin sugerencia que una mala. */
export const UMBRAL_SUGERENCIA = 0.75;

export type Embedder = (textos: readonly string[]) => Promise<number[][]>;

export function sugerirCandidatos(
  reqs: readonly Requisito[],
  vectoresRequisito: ReadonlyMap<string, number[]>,
  vectoresTecnologia: ReadonlyMap<string, number[]>,
  umbral = UMBRAL_SUGERENCIA,
): Requisito[] {
  return reqs.map((r) => {
    if (r.nivel !== 'brecha') return r;
    const v = vectoresRequisito.get(r.termino);
    if (!v) return r;
    let mejor: { tecnologia: string; similitud: number } | null = null;
    for (const [tecnologia, vt] of vectoresTecnologia) {
      const similitud = coseno(v, vt);
      if (similitud >= umbral && (!mejor || similitud > mejor.similitud)) mejor = { tecnologia, similitud };
    }
    return mejor ? { ...r, nivel: 'sugerida' as const, candidato: mejor } : r;
  });
}

/** Llama al embedder una sola vez con todos los textos únicos y arma el mapa texto → vector. */
export async function calcularVectores(textos: readonly string[], embed: Embedder): Promise<Map<string, number[]>> {
  const unicos = [...new Set(textos)];
  if (!unicos.length) return new Map();
  const vectores = await embed(unicos);
  return new Map(unicos.map((t, i) => [t, vectores[i]!]));
}

/**
 * Punto de entrada: agrega sugerencias a una clasificación de brechas ya hecha.
 * Si `embed` no está disponible o falla (sin credenciales, red, cuota), devuelve
 * `reqs` sin tocar — nunca rompe ni bloquea el resto de `brechas`.
 *
 * `hibrida` dice si la capa semántica realmente corrió (para que quien use el
 * resultado pueda declarar "CV hecho con búsqueda híbrida" o "solo léxica" sin
 * adivinar por la presencia de 'sugerida', que puede no haber encontrado nada).
 */
export async function agregarSugerencias(
  reqs: readonly Requisito[],
  tecnologias: ReadonlyMap<string, string>, // id de la nota → texto a embeber (nombre + aliases)
  embed: Embedder | undefined,
): Promise<{ requisitos: Requisito[]; hibrida: boolean }> {
  const pendientes = reqs.filter((r) => r.nivel === 'brecha');
  if (!embed || !pendientes.length || !tecnologias.size) return { requisitos: [...reqs], hibrida: false };
  try {
    const [vectoresRequisito, vectoresTecnologia] = await Promise.all([
      calcularVectores(pendientes.map((r) => r.termino), embed),
      calcularVectores([...tecnologias.values()], embed).then(
        (porTexto) => new Map([...tecnologias].map(([id, texto]) => [id, porTexto.get(texto)!])),
      ),
    ]);
    return { requisitos: sugerirCandidatos(reqs, vectoresRequisito, vectoresTecnologia), hibrida: true };
  } catch {
    return { requisitos: [...reqs], hibrida: false }; // degradación segura: se queda con la clasificación léxica
  }
}
