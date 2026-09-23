import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Core, ElementDefinition, LayoutOptions, StylesheetJson } from 'cytoscape';
import { RELATION_LABELS, type PublicGraph } from '../graph.model';
import type { Theme } from '../theme';

/**
 * Lienzo del grafo con Cytoscape.js. Cytoscape (~400 KB) se importa de forma
 * diferida para que la primera pintura no espere por él.
 *
 * Es un componente "tonto": recibe estado por inputs (filtros, selección,
 * búsqueda, tema) y emite la selección; no decide nada por su cuenta.
 */
@Component({
  selector: 'app-graph-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host" role="application" aria-label="Grafo de proyectos. Toca un nodo para ver su detalle."></div>
    @if (!ready()) {
      <p class="loading">Dibujando el grafo…</p>
    }
  `,
  styles: `
    :host { position: relative; display: block; width: 100%; height: 100%; }
    .host { position: absolute; inset: 0; }
    .loading { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-muted); }
  `,
})
export class GraphView {
  readonly graph = input.required<PublicGraph>();
  readonly hiddenTipos = input<ReadonlySet<string>>(new Set());
  readonly selectedId = input<string | null>(null);
  readonly matchIds = input<ReadonlySet<string>>(new Set());
  readonly theme = input.required<Theme>();
  readonly nodeSelect = output<string | null>();

  protected readonly ready = signal(false);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private cy?: Core;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(async () => {
      const [{ default: cytoscape }, { default: fcose }] = await Promise.all([
        import('cytoscape'),
        import('cytoscape-fcose'),
      ]);
      cytoscape.use(fcose);
      const cy = cytoscape({
        container: this.host().nativeElement,
        elements: toElements(untracked(this.graph)),
        style: buildStyle(),
        minZoom: 0.2,
        maxZoom: 3,
      });
      cy.on('tap', 'node', (e) => this.nodeSelect.emit(e.target.id()));
      cy.on('tap', (e) => {
        if (e.target === cy) this.nodeSelect.emit(null);
      });
      // El contenedor cambia de tamaño con el panel lateral y la rotación del celular.
      const ro = new ResizeObserver(() => cy.resize());
      ro.observe(this.host().nativeElement);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        cy.destroy();
      });
      this.cy = cy;
      if (ngDevMode) (window as unknown as { cy: Core }).cy = cy; // depuración
      this.ready.set(true);
      // El primer layout espera un frame: al montar, el contenedor puede medir
      // 0 px y fcose apilaría todo en una esquina.
      requestAnimationFrame(() => {
        cy.resize();
        this.relayout();
      });
    });

    // Tema: los colores salen de los tokens CSS, así que se releen al cambiar.
    effect(() => {
      this.theme();
      if (!this.ready()) return;
      // Espera a que el navegador aplique el nuevo data-theme.
      requestAnimationFrame(() => this.cy?.style(buildStyle()));
    });

    // Filtro por tipo: ocultar un nodo oculta también sus aristas.
    effect(() => {
      const hidden = this.hiddenTipos();
      if (!this.ready() || !this.cy) return;
      this.cy.batch(() => {
        this.cy!.nodes().forEach((n) => {
          n.toggleClass('hidden', hidden.has(n.data('tipo')));
        });
      });
    });

    // Coincidencias de búsqueda.
    effect(() => {
      const matches = this.matchIds();
      if (!this.ready() || !this.cy) return;
      this.cy.batch(() => {
        this.cy!.nodes().forEach((n) => {
          n.toggleClass('match', matches.has(n.id()));
        });
      });
    });

    // Selección: resalta el vecindario y atenúa el resto.
    effect(() => {
      const id = this.selectedId();
      if (!this.ready() || !this.cy) return;
      const cy = this.cy;
      cy.batch(() => {
        cy.elements().removeClass('faded selected active');
        if (!id) return;
        const node = cy.getElementById(id);
        if (node.empty()) return;
        node.addClass('selected');
        node.connectedEdges().addClass('active');
        cy.elements().not(node.closedNeighborhood()).addClass('faded');
      });
      this.focus(id);
    });
  }

  /** Reordena los nodos visibles (útil después de filtrar). */
  relayout(): void {
    const cy = this.cy;
    if (!cy) return;
    const layout = cy.elements(':visible').layout(layoutOptions());
    // Al terminar, encuadra la selección si hay una (p. ej. al abrir con #MAZA).
    layout.one('layoutstop', () => (this.selectedId() ? this.focus(this.selectedId(), false) : cy.fit(cy.elements(':visible'), 30)));
    layout.run();
  }

  /**
   * Encuadra un nodo y sus vecinos dentro del área VISIBLE del lienzo: en
   * celular la hoja de detalle tapa el 60 % inferior, así que se centra en el
   * 40 % superior. Zoom con tope (con pocos vecinos acercaría demasiado).
   */
  private focus(id: string | null, animate = true): void {
    const cy = this.cy;
    const node = id && cy ? cy.getElementById(id) : null;
    if (!cy || !node || node.empty()) return;
    const bb = node.closedNeighborhood().boundingBox();
    const pad = 40;
    const width = cy.width();
    const visibleHeight = matchMedia('(max-width: 720px)').matches ? cy.height() * 0.4 : cy.height();
    const zoom = Math.min(1.3, (width - 2 * pad) / bb.w, (visibleHeight - 2 * pad) / bb.h);
    const cx = (bb.x1 + bb.x2) / 2;
    const cyy = (bb.y1 + bb.y2) / 2;
    const pan = { x: width / 2 - cx * zoom, y: visibleHeight / 2 - cyy * zoom };
    cy.stop(true, true);
    // Instantáneo al cargar: no debe depender de requestAnimationFrame, que el
    // navegador pausa en pestañas en segundo plano.
    if (animate) cy.animate({ zoom, pan, duration: 350, easing: 'ease-in-out-cubic' });
    else cy.viewport({ zoom, pan });
  }

  fit(): void {
    this.cy?.animate({ fit: { eles: this.cy.elements(':visible'), padding: 30 }, duration: 300 });
  }
}

function toElements(graph: PublicGraph): ElementDefinition[] {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return [
    ...graph.nodes.map((n) => ({
      data: { id: n.id, label: n.id, tipo: n.tipo, degree: degree.get(n.id) ?? 0 },
    })),
    ...graph.edges.map((e) => ({
      data: {
        id: `${e.source}|${e.type}|${e.target}`,
        source: e.source,
        target: e.target,
        type: e.type,
        label: RELATION_LABELS[e.type]?.out ?? e.type,
        destacado: e.props['destacado'] === true,
      },
    })),
  ];
}

function layoutOptions() {
  // fcose: layout de fuerzas rápido y estable. Sin animación: con este tamaño
  // de grafo es instantáneo, y el modo animado no emitía `layoutstop` fiable.
  return {
    name: 'fcose',
    quality: 'proof',
    animate: false,
    fit: false, // el encuadre lo decide relayout() (selección o todo)
    nodeRepulsion: 9000,
    idealEdgeLength: 90,
    nodeSeparation: 80,
    padding: 30,
  } as unknown as LayoutOptions;
}

/** Estilo de Cytoscape a partir de los tokens CSS del tema actual. */
function buildStyle(): StylesheetJson {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const tipos = ['proyecto', 'tecnologia', 'persona', 'canal', 'area', 'aprendizaje', 'pendiente'];
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': v('--tipo-pendiente'),
        width: 'mapData(degree, 0, 20, 18, 52)',
        height: 'mapData(degree, 0, 20, 18, 52)',
        color: v('--text'),
        'font-size': 11,
        'font-family': v('--font-sans'),
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-outline-color': v('--bg'),
        'text-outline-width': 2,
        'min-zoomed-font-size': 7,
        'transition-property': 'opacity, border-width',
        'transition-duration': 200,
      },
    },
    ...tipos.map((t) => ({ selector: `node[tipo = "${t}"]`, style: { 'background-color': v(`--tipo-${t}`) } })),
    { selector: 'node[tipo = "proyecto"]', style: { 'font-size': 13, 'font-weight': 600, shape: 'round-rectangle' } },
    {
      selector: 'edge',
      style: {
        width: 1.2,
        'line-color': v('--edge'),
        'target-arrow-color': v('--edge'),
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
        opacity: 0.8,
      },
    },
    { selector: 'edge[?destacado]', style: { width: 3, 'line-color': v('--accent'), 'target-arrow-color': v('--accent') } },
    { selector: '.hidden', style: { display: 'none' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.selected', style: { 'border-width': 4, 'border-color': v('--accent') } },
    {
      selector: 'edge.active',
      style: {
        label: 'data(label)',
        'font-size': 9,
        color: v('--text-muted'),
        'text-rotation': 'autorotate',
        'text-background-color': v('--bg'),
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        opacity: 1,
      },
    },
    { selector: 'node.match', style: { 'border-width': 3, 'border-color': v('--accent'), 'border-style': 'dashed' } },
  ] as StylesheetJson;
}
