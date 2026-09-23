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
import type { Cobertura } from '../graph-3d/graph-3d';
import { RELATION_LABELS, type PublicGraph } from '../graph.model';

/**
 * Lienzo 2D con Cytoscape.js, en el mismo mundo nocturno que la vista 3D:
 * nodos como esferas con halo, proyectos con anillo, aristas finas y un flujo
 * animado en las conexiones del nodo elegido. Cytoscape (~400 KB) se importa
 * de forma diferida para que la primera pintura no espere por él.
 *
 * Es un componente "tonto": recibe estado por inputs (filtros, selección,
 * búsqueda, qué tapa el lienzo) y emite la selección.
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
    :host { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; background: var(--scene-bg); }
    /* Estrellas: dos capas de puntos con distinto tamaño y período, sin imágenes. */
    :host::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.7;
      background-image:
        radial-gradient(1px 1px at 12% 18%, #9fb4d6, transparent),
        radial-gradient(1px 1px at 68% 42%, #9fb4d6, transparent),
        radial-gradient(1.5px 1.5px at 32% 76%, #c6d3ea, transparent),
        radial-gradient(1px 1px at 86% 12%, #9fb4d6, transparent),
        radial-gradient(1px 1px at 48% 92%, #7f95b8, transparent),
        radial-gradient(1.5px 1.5px at 92% 66%, #c6d3ea, transparent),
        radial-gradient(1px 1px at 22% 52%, #7f95b8, transparent),
        radial-gradient(1px 1px at 58% 8%, #9fb4d6, transparent);
      background-size: 420px 420px, 420px 420px, 420px 420px, 420px 420px, 610px 610px, 610px 610px, 610px 610px, 610px 610px;
    }
    /* Viñeta de lente, igual que en 3D. */
    :host::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 0.55) 100%);
    }
    .host { position: absolute; inset: 0; z-index: 1; }
    .loading {
      position: absolute; inset: 0; display: grid; place-items: center; margin: 0;
      color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;
    }
  `,
})
export class GraphView {
  readonly graph = input.required<PublicGraph>();
  readonly hiddenTipos = input<ReadonlySet<string>>(new Set());
  readonly selectedId = input<string | null>(null);
  readonly matchIds = input<ReadonlySet<string>>(new Set());
  /** Lente activa (p. ej. Enfoque IA): sin selección, se atenúa todo lo de afuera. */
  readonly enfoque = input<ReadonlySet<string> | null>(null);
  /** Qué tapa el lienzo (panel, hoja, leyenda), para encuadrar en lo visible. */
  readonly cobertura = input<Cobertura>('ninguna');
  /** Alto en px de la interfaz que flota sobre el borde superior. */
  readonly arriba = input(0);
  readonly nodeSelect = output<string | null>();

  protected readonly ready = signal(false);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private cy?: Core;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private flujoRaf = 0;
  /** Hasta que termina el primer layout, las posiciones son provisorias: no se encuadra. */
  private layoutListo = false;
  private horizontal?: boolean;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(async () => {
      const [{ default: cytoscape }, { default: fcose }] = await Promise.all([
        import('cytoscape'),
        import('cytoscape-fcose'),
      ]);
      cytoscape.use(fcose);
      const el = this.host().nativeElement;
      const cy = cytoscape({
        container: el,
        elements: toElements(untracked(this.graph)),
        style: buildStyle(el),
        minZoom: 0.2,
        maxZoom: 3,
      });
      cy.on('tap', 'node', (e) => this.nodeSelect.emit(e.target.id()));
      cy.on('tap', (e) => {
        if (e.target === cy) this.nodeSelect.emit(null);
      });
      cy.on('mouseover', 'node', (e) => {
        e.target.addClass('hover');
        el.style.cursor = 'pointer';
      });
      cy.on('mouseout', 'node', (e) => {
        e.target.removeClass('hover');
        el.style.cursor = '';
      });
      // El contenedor cambia de tamaño con la rotación del celular; si cambia la
      // orientación, el grafo se reacomoda a la nueva forma de la pantalla.
      const ro = new ResizeObserver(() => {
        cy.resize();
        const horizontal = cy.width() >= cy.height();
        if (this.layoutListo && horizontal !== this.horizontal) this.relayout();
      });
      ro.observe(el);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        cancelAnimationFrame(this.flujoRaf);
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

    // Selección: resalta el vecindario, atenúa el resto y anima el flujo.
    effect(() => {
      const id = this.selectedId();
      const lente = this.enfoque();
      if (!this.ready() || !this.cy) return;
      const cy = this.cy;
      cy.batch(() => {
        cy.elements().removeClass('faded selected active rotulada');
        if (!id && lente) {
          // Lente: sus nodos y las aristas entre ellos quedan vivos (con flujo).
          const dentro = cy.nodes().filter((n) => lente.has(n.id()));
          const aristas = dentro.edgesWith(dentro);
          aristas.addClass('active');
          cy.elements().not(dentro.union(aristas)).addClass('faded');
          return;
        }
        if (!id) return;
        const node = cy.getElementById(id);
        if (node.empty()) return;
        node.addClass('selected');
        const aristas = node.connectedEdges();
        aristas.addClass('active');
        // Con muchas conexiones (MAZA tiene 30) los rótulos "Usa" se pisan: el
        // panel ya las lista, así que solo se rotulan los vecindarios chicos.
        if (aristas.length <= 8) aristas.addClass('rotulada');
        cy.elements().not(node.closedNeighborhood()).addClass('faded');
      });
      this.animarFlujo();
    });

    // Encuadre: cambia la selección o lo que tapa el lienzo (panel, hoja, recorrido).
    effect(() => {
      const id = this.selectedId();
      this.cobertura();
      this.arriba();
      if (!this.ready() || !this.cy || !this.layoutListo) return;
      if (id) this.focus(id);
    });
  }

  /** Reordena los nodos visibles (útil después de filtrar). */
  relayout(): void {
    const cy = this.cy;
    if (!cy) return;
    const layout = cy.elements(':visible').layout(layoutOptions());
    layout.one('layoutstop', () => {
      this.ajustarAPantalla();
      this.layoutListo = true;
      // Encuadra la selección si hay una (p. ej. al abrir con #MAZA).
      if (this.selectedId()) this.focus(this.selectedId(), false);
      else this.fit(0);
    });
    layout.run();
  }

  /**
   * Da al grafo la forma de la pantalla: fcose produce una nube casi redonda;
   * aquí se estira a lo ancho (horizontal) o a lo alto (vertical) hasta la
   * proporción del área libre. Solo escala posiciones: la topología no cambia
   * y los nodos ganan aire en el eje que sobra.
   */
  private ajustarAPantalla(): void {
    const cy = this.cy!;
    const nodos = cy.nodes(':visible');
    if (nodos.length < 2) return;
    const bb = nodos.boundingBox({ includeLabels: false });
    const a = this.areaLibre();
    const objetivo = (a.x1 - a.x0) / Math.max(a.y1 - a.y0, 1);
    const actual = bb.w / Math.max(bb.h, 1);
    this.horizontal = cy.width() >= cy.height();
    // Tope de estiramiento: más allá, las aristas se ven como rayas paralelas.
    const k = Math.min(2.2, Math.max(1 / 2.2, objetivo / actual));
    const [sx, sy] = k >= 1 ? [k, 1] : [1, 1 / k];
    const cx = (bb.x1 + bb.x2) / 2;
    const cyy = (bb.y1 + bb.y2) / 2;
    cy.batch(() => {
      nodos.forEach((n) => {
        const p = n.position();
        n.position({ x: cx + (p.x - cx) * sx, y: cyy + (p.y - cyy) * sy });
      });
    });
  }

  /** Encuadra todo lo visible dentro del área libre del lienzo. */
  fit(ms = 400): void {
    const cy = this.cy;
    if (!cy) return;
    this.encuadrar(cy.elements(':visible').boundingBox(), 1.4, ms);
  }

  /** Área del lienzo que no tapa la interfaz flotante. */
  private areaLibre(): { x0: number; y0: number; x1: number; y1: number } {
    const cy = this.cy!;
    const w = cy.width();
    const h = cy.height();
    const movil = matchMedia('(max-width: 720px)').matches;
    const c = this.cobertura();
    return {
      x0: 0,
      y0: this.arriba(),
      x1: c === 'lateral' ? w - 404 : w,
      y1: c === 'inferior' ? h * 0.4 : c === 'recorrido' ? (movil ? h * 0.66 : h) : h,
    };
  }

  /** Ajusta zoom y paneo para que la caja `bb` quede centrada en el área libre. */
  private encuadrar(bb: { x1: number; x2: number; y1: number; y2: number; w: number; h: number }, zoomMax: number, ms: number): void {
    const cy = this.cy!;
    const a = this.areaLibre();
    const pad = 36;
    const zoom = Math.min(zoomMax, (a.x1 - a.x0 - 2 * pad) / Math.max(bb.w, 1), (a.y1 - a.y0 - 2 * pad) / Math.max(bb.h, 1));
    const pan = {
      x: (a.x0 + a.x1) / 2 - ((bb.x1 + bb.x2) / 2) * zoom,
      y: (a.y0 + a.y1) / 2 - ((bb.y1 + bb.y2) / 2) * zoom,
    };
    cy.stop(true, true);
    // Instantáneo al cargar: no debe depender de requestAnimationFrame, que el
    // navegador pausa en pestañas en segundo plano.
    if (ms && !this.reducedMotion) cy.animate({ zoom, pan, duration: ms, easing: 'ease-in-out-cubic' });
    else cy.viewport({ zoom, pan });
  }

  /** Encuadra un nodo y sus vecinos, con zoom tope (con pocos vecinos acercaría demasiado). */
  private focus(id: string | null, animate = true): void {
    const cy = this.cy;
    const node = id && cy ? cy.getElementById(id) : null;
    if (!cy || !node || node.empty()) return;
    this.encuadrar(node.closedNeighborhood().boundingBox(), 1.3, animate ? 450 : 0);
  }

  /**
   * Flujo: las aristas activas se dibujan punteadas y el punteado avanza,
   * como energía saliendo del nodo elegido. Se detiene sola si no hay
   * aristas activas; con movimiento reducido queda quieta.
   */
  private animarFlujo(): void {
    cancelAnimationFrame(this.flujoRaf);
    const cy = this.cy;
    if (!cy || this.reducedMotion) return;
    const activas = cy.edges('.active');
    if (activas.empty()) return;
    const t0 = performance.now();
    const paso = (t: number) => {
      activas.style('line-dash-offset', -((t - t0) / 40) % 24);
      this.flujoRaf = requestAnimationFrame(paso);
    };
    this.flujoRaf = requestAnimationFrame(paso);
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
    nodeRepulsion: (n: { data(k: string): string }) => (n.data('tipo') === 'proyecto' ? 24000 : 9000),
    idealEdgeLength: 95,
    nodeSeparation: 90,
    padding: 30,
  } as unknown as LayoutOptions;
}

/** `a` de `hex` sobre `otro` (0 = otro, 1 = hex puro), como hex. */
function mix(hex: string, otro: string, a: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [c, f] = [rgb(hex), rgb(otro)];
  return '#' + c.map((v, i) => Math.round(f[i]! + (v - f[i]!) * a).toString(16).padStart(2, '0')).join('');
}

/** Estilo de Cytoscape a partir de los tokens CSS de la escena (siempre nocturna). */
function buildStyle(el: HTMLElement): StylesheetJson {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const bg = v('--scene-bg') || '#05070b';
  const accent = v('--accent');
  const tipos = ['proyecto', 'tecnologia', 'persona', 'canal', 'area', 'aprendizaje', 'pendiente'];
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        width: 'mapData(degree, 0, 12, 10, 22)',
        height: 'mapData(degree, 0, 12, 10, 22)',
        color: '#c6cfdc',
        'font-size': 10,
        'font-family': v('--font-sans'),
        'text-valign': 'bottom',
        'text-margin-y': 5,
        'text-outline-color': bg,
        'text-outline-width': 2,
        'text-outline-opacity': 0.9,
        'min-zoomed-font-size': 7,
        'underlay-shape': 'ellipse',
        'underlay-padding': 6,
        'underlay-opacity': 0.16,
        'transition-property': 'opacity, underlay-opacity, underlay-padding',
        'transition-duration': 220,
      },
    },
    // Cada tipo: esfera con centro luminoso (gradiente radial) y halo de su color.
    ...tipos.map((t) => {
      const c = v(`--tipo-${t}`) || '#9ca3af';
      return {
        selector: `node[tipo = "${t}"]`,
        style: {
          'background-fill': 'radial-gradient',
          'background-gradient-stop-colors': `${mix(c, '#ffffff', 0.35)} ${c} ${mix(c, bg, 0.55)}`,
          'background-gradient-stop-positions': '0 55 100',
          'underlay-color': c,
        },
      };
    }),
    // Proyectos: planetas más grandes, con anillo (outline separado del cuerpo).
    {
      selector: 'node[tipo = "proyecto"]',
      style: {
        width: 'mapData(degree, 0, 30, 26, 44)',
        height: 'mapData(degree, 0, 30, 26, 44)',
        color: '#f2f5fa',
        'font-size': 13,
        'font-weight': 600,
        'underlay-padding': 10,
        'underlay-opacity': 0.22,
        'outline-width': 1.5,
        'outline-offset': 5,
        'outline-color': v('--tipo-proyecto'),
        'outline-opacity': 0.55,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': mix(v('--scene-edge') || '#8fa3bf', bg, 0.3),
        'curve-style': 'unbundled-bezier',
        'control-point-distances': 18,
        'control-point-weights': 0.5,
        opacity: 0.9,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': 220,
      },
    },
    { selector: 'edge[?destacado]', style: { width: 1.8, 'line-color': mix(accent, bg, 0.6) } },
    { selector: '.hidden', style: { display: 'none' } },
    { selector: '.faded', style: { opacity: 0.08 } },
    { selector: 'node.hover', style: { 'underlay-opacity': 0.4, 'underlay-padding': 9, color: '#ffffff' } },
    {
      selector: 'node.selected',
      style: { 'underlay-opacity': 0.5, 'underlay-padding': 14, color: '#ffffff', 'outline-color': accent, 'outline-opacity': 1 },
    },
    {
      selector: 'edge.active',
      style: {
        width: 2,
        'line-color': accent,
        'line-style': 'dashed',
        'line-dash-pattern': [10, 14],
        opacity: 1,
      },
    },
    {
      selector: 'edge.rotulada',
      style: {
        label: 'data(label)',
        'font-size': 9,
        'font-family': v('--font-mono'),
        color: '#ffb27d',
        'text-rotation': 'autorotate',
        'text-background-color': bg,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
      },
    },
    { selector: 'node.match', style: { 'underlay-color': accent, 'underlay-opacity': 0.45, 'underlay-padding': 10 } },
  ] as StylesheetJson;
}
