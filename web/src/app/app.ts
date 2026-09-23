import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DetailPanel } from './detail-panel/detail-panel';
import { GraphDataService } from './graph-data';
import { GraphView } from './graph-view/graph-view';
import { searchNodes } from './graph-utils';
import { TIPOS } from './graph.model';
import { ThemeService } from './theme';

/**
 * Contenedor: es dueño del estado de la vista (filtros, búsqueda, selección)
 * y lo reparte a los componentes. La selección se refleja en el hash de la
 * URL (`#MAZA`) para poder enlazar un nodo directamente desde el portafolio.
 */
@Component({
  selector: 'app-root',
  imports: [GraphView, DetailPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly data = inject(GraphDataService);
  protected readonly themeService = inject(ThemeService);
  private readonly view = viewChild(GraphView);

  protected readonly graph = computed(() => {
    const s = this.data.state();
    return s.status === 'ready' ? s.graph : null;
  });

  protected readonly hiddenTipos = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedId = signal<string | null>(null);
  protected readonly query = signal('');

  /** Solo los tipos presentes en el grafo, con su cantidad. */
  protected readonly tipos = computed(() => {
    const g = this.graph();
    if (!g) return [];
    return TIPOS.map((t) => ({ ...t, count: g.nodes.filter((n) => n.tipo === t.id).length })).filter((t) => t.count > 0);
  });

  protected readonly results = computed(() => {
    const g = this.graph();
    return g ? searchNodes(g.nodes, this.query()) : [];
  });
  protected readonly matchIds = computed(() => new Set(this.results().map((n) => n.id)));

  protected readonly selectedNode = computed(() => {
    const id = this.selectedId();
    return this.graph()?.nodes.find((n) => n.id === id) ?? null;
  });

  constructor() {
    void this.data.load();

    // URL → selección (al cargar y al usar atrás/adelante).
    const fromHash = () => this.selectedId.set(decodeURIComponent(location.hash.slice(1)) || null);
    fromHash();
    addEventListener('hashchange', fromHash);

    // Selección → URL, sin llenar el historial en cada clic.
    effect(() => {
      const id = this.selectedId();
      const hash = id ? `#${encodeURIComponent(id)}` : '';
      if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
    });
  }

  protected toggleTipo(id: string): void {
    this.hiddenTipos.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected select(id: string | null): void {
    this.selectedId.set(id);
    if (id) {
      // Un nodo oculto por filtro no se podría ver: se muestra su tipo.
      const tipo = this.graph()?.nodes.find((n) => n.id === id)?.tipo;
      if (tipo && this.hiddenTipos().has(tipo)) this.toggleTipo(tipo);
    }
  }

  protected pickResult(id: string): void {
    this.select(id);
    this.query.set('');
  }

  protected onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.results()[0]) this.pickResult(this.results()[0]!.id);
    if (event.key === 'Escape') this.query.set('');
  }

  protected relayout(): void {
    this.view()?.relayout();
  }

  protected fit(): void {
    this.view()?.fit();
  }
}
