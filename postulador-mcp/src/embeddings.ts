/**
 * Adapta el binding `AI` de Cloudflare (bge-m3, el mismo modelo que usa MAZA
 * para su RAG) a la interfaz `Embedder` que espera app/ingest/src/sugerencias.ts.
 */
import type { Embedder } from '../../ingest/src/sugerencias.ts';

export function embedderDesdeAi(ai: Ai): Embedder {
  return async (textos) => {
    const out = (await ai.run('@cf/baai/bge-m3', { text: [...textos] })) as { data?: number[][] };
    if (!out.data || out.data.length !== textos.length) throw new Error('bge-m3: respuesta sin el vector esperado por texto');
    return out.data;
  };
}
