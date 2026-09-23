import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DetailPanel } from './detail-panel/detail-panel';
import { GraphDataService } from './graph-data';
import { Graph3D, type Cobertura } from './graph-3d/graph-3d';
import { GraphView } from './graph-view/graph-view';
import { nodosIA, recorrido, searchNodes } from './graph-utils';
import { TIPOS } from './graph.model';
import { MusicaService } from './musica';
import { ThemeService } from './theme';

/**
 * Contenedor: es dueño del estado de la vista (filtros, búsqueda, selección)
 * y lo reparte a los componentes. La selección se refleja en el hash de la
 * URL (`#MAZA`) para poder enlazar un nodo directamente desde el portafolio.
 */
@Component({
  selector: 'app-root',
  imports: [GraphView, Graph3D, DetailPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '[class.inmersivo]': 'inmersivo()', '[style.--chrome-h.px]': 'alturaChrome()' },
})
export class App {
  protected readonly data = inject(GraphDataService);
  protected readonly themeService = inject(ThemeService);
  protected readonly musica = inject(MusicaService);
  private readonly view2d = viewChild(GraphView);
  private readonly view3d = viewChild(Graph3D);
  private readonly chrome = viewChild.required<ElementRef<HTMLElement>>('chrome');

  /** 3D por defecto; 2D si no hay WebGL o si el visitante lo eligió antes. */
  protected readonly webgl = hasWebGL();
  protected readonly vista = signal<Vista>(this.webgl ? readVista() : '2d');

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

  /** Resumen para la tarjeta de bienvenida y enlaces de contacto públicos del grafo. */
  protected readonly resumen = computed(() => {
    const g = this.graph();
    if (!g) return null;
    const n = (tipo: string) => g.nodes.filter((x) => x.tipo === tipo).length;
    const url = (id: string) => {
      const u = g.nodes.find((x) => x.id === id)?.props['url'];
      return typeof u === 'string' ? u : null;
    };
    const ia = g.nodes.filter((x) => x.tipo === 'tecnologia' && x.props['categoria'] === 'ia').length;
    return { proyectos: n('proyecto'), tecnologias: n('tecnologia'), ia, portafolio: url('Portafolio web'), linkedin: url('LinkedIn') };
  });

  /** Lente "Enfoque IA": ilumina las herramientas de IA y los proyectos que las usan. */
  protected readonly lenteIA = signal(false);
  protected readonly enfoque = computed(() => {
    const g = this.graph();
    return g && this.lenteIA() ? nodosIA(g) : null;
  });

  protected readonly selectedNode = computed(() => {
    const id = this.selectedId();
    return this.graph()?.nodes.find((n) => n.id === id) ?? null;
  });

  /**
   * Modo inmersivo (2D y 3D): la escena nocturna ocupa toda la pantalla y la
   * interfaz flota encima, siempre oscura, para que no quede encajonada.
   */
  protected readonly inmersivo = computed(() => !!this.graph());
  protected readonly movil = signal(matchMedia('(max-width: 720px)').matches);
  /** Alto de la barra flotante: la escena se centra debajo de ella. */
  protected readonly alturaChrome = signal(0);

  // ── Recorrido guiado ─────────────────────────────────────────────────────
  protected readonly paradas = computed(() => {
    const g = this.graph();
    return g ? recorrido(g) : [];
  });
  /** Índice de la parada actual, o null si no hay recorrido en curso. */
  protected readonly paso = signal<number | null>(null);
  protected readonly pausado = signal(false);
  protected readonly parada = computed(() => {
    const i = this.paso();
    return i === null ? null : (this.paradas()[i] ?? null);
  });
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Segundos por parada; la barra de progreso de la leyenda usa el mismo valor. */
  protected readonly segundosParada = 8;

  /** El panel de detalle se oculta durante el recorrido: manda la leyenda. */
  protected readonly panelVisible = computed(() => !!this.selectedNode() && this.paso() === null);

  protected readonly cobertura = computed<Cobertura>(() => {
    if (this.paso() !== null) return 'recorrido';
    if (!this.selectedNode()) return 'ninguna';
    return this.movil() ? 'inferior' : 'lateral';
  });

  constructor() {
    void this.data.load();
    const destroyRef = inject(DestroyRef);

    const mq = matchMedia('(max-width: 720px)');
    const onMq = () => this.movil.set(mq.matches);
    mq.addEventListener('change', onMq);
    destroyRef.onDestroy(() => mq.removeEventListener('change', onMq));

    // La barra cambia de alto con el ancho (filtros en una o más líneas).
    effect((onCleanup) => {
      const el = this.chrome().nativeElement;
      const ro = new ResizeObserver(() => this.alturaChrome.set(el.offsetHeight));
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });

    // Avance automático del recorrido. Se puede pausar (contenido que se mueve
    // solo más de 5 s debe poder detenerse) y con movimiento reducido no avanza.
    effect((onCleanup) => {
      const i = this.paso();
      if (i === null || this.pausado() || this.reducedMotion) return;
      if (i >= this.paradas().length - 1) return; // la última parada se queda
      const t = setTimeout(() => this.avanzar(1), this.segundosParada * 1000);
      onCleanup(() => clearTimeout(t));
    });

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

  /** Clic en el grafo o en el panel: si hay recorrido, lo termina. */
  protected elegir(id: string | null): void {
    this.paso.set(null);
    this.select(id);
  }

  protected iniciarRecorrido(): void {
    if (!this.paradas().length) return;
    this.pausado.set(false);
    this.irA(0);
  }

  protected avanzar(delta: number): void {
    const i = this.paso();
    if (i === null) return;
    this.irA(Math.min(Math.max(i + delta, 0), this.paradas().length - 1));
  }

  /** Sale del recorrido; con `verDetalle` deja abierto el panel de la parada. */
  protected salirRecorrido(verDetalle = false): void {
    const id = this.parada()?.id ?? null;
    this.paso.set(null);
    if (!verDetalle) this.select(null);
    else if (id) this.select(id);
  }

  private irA(i: number): void {
    this.paso.set(i);
    const p = this.paradas()[i]!;
    this.select(p.id);
    // La vista general final encuadra todo (la selección ya quedó en null).
    if (!p.id) setTimeout(() => (this.view3d() ?? this.view2d())?.fit(1400));
  }

  protected pickResult(id: string): void {
    this.elegir(id);
    this.query.set('');
  }

  protected onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.results()[0]) this.pickResult(this.results()[0]!.id);
    if (event.key === 'Escape') this.query.set('');
  }

  protected relayout(): void {
    (this.view3d() ?? this.view2d())?.relayout();
  }

  protected fit(): void {
    (this.view3d() ?? this.view2d())?.fit();
  }

  protected toggleVista(): void {
    const v: Vista = this.vista() === '3d' ? '2d' : '3d';
    this.vista.set(v);
    try {
      localStorage.setItem(VISTA_KEY, v);
    } catch {
      /* sin storage: la elección dura la sesión */
    }
  }
}

type Vista = '2d' | '3d';
const VISTA_KEY = 'rdf-grafo:vista';

function readVista(): Vista {
  try {
    return localStorage.getItem(VISTA_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
