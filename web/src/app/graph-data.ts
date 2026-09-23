import { Injectable, signal } from '@angular/core';
import type { PublicGraph } from './graph.model';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; graph: PublicGraph }
  | { status: 'error'; message: string };

/**
 * Carga `graph.json`, un archivo estático generado por
 * `ingest build-graph --public`. No hay backend: el sitio es 100 % estático.
 */
@Injectable({ providedIn: 'root' })
export class GraphDataService {
  readonly state = signal<LoadState>({ status: 'loading' });

  async load(url = 'graph.json'): Promise<void> {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const graph = (await res.json()) as PublicGraph;
      // Defensa en profundidad: el sitio solo debe servir el grafo público.
      if (graph.meta?.public !== true) throw new Error('graph.json no es la exportación pública');
      this.state.set({ status: 'ready', graph });
    } catch (err) {
      this.state.set({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}
