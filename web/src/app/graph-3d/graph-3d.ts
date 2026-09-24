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
import type { ForceGraph3DInstance } from '3d-force-graph';
import type * as THREE from 'three';
import type { PublicGraph } from '../graph.model';
import { cielo, estrellas, halo, onda, polvo } from './escena';

/** Nodo y arista tal como los consume 3d-force-graph (la librería agrega x/y/z). */
interface N3 {
  id: string;
  tipo: string;
  degree: number;
  categoria?: string;
  /** Proyecto con estado "activo": su halo late. */
  activo?: boolean;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

/**
 * Qué tapa parte del lienzo, para centrar la escena en lo que queda visible:
 * el panel lateral (escritorio), la hoja inferior (celular) o la leyenda del
 * recorrido.
 */
export type Cobertura = 'ninguna' | 'lateral' | 'inferior' | 'recorrido';
interface L3 {
  source: string | N3;
  target: string | N3;
  type: string;
  destacado: boolean;
}

/** Lo que se muta al cambiar selección, búsqueda o hover (sin recrear objetos). */
interface Visual {
  materials: THREE.MeshStandardMaterial[];
  body: THREE.Object3D;
  label: HTMLElement;
  halo: THREE.ShaderMaterial;
  /** Escala hacia la que se interpola cada frame (selección, hover, búsqueda). */
  target: number;
  /** Brillo base (lo fija applyState); cada frame le suma latido y onda de hover. */
  emisivo: number;
  halo0: number;
  /** Instante (ms) en que la onda de hover alcanza este nodo, si hay onda. */
  onda?: number;
}

const endId = (e: string | N3): string => (typeof e === 'string' ? e : e.id);

/**
 * Capas de la vista de arquitectura, de arriba (lo que ve el usuario) hacia
 * abajo (infraestructura). Se derivan de la `categoria` de cada tecnología,
 * que es un dato público del grafo: no se infiere nada.
 */
const CAPAS: readonly { nombre: string; categorias: readonly string[] }[] = [
  { nombre: 'Interfaz', categorias: ['frontend', 'mobile'] },
  { nombre: 'Integraciones', categorias: ['integraciones'] },
  { nombre: 'Backend', categorias: ['backend'] },
  { nombre: 'IA', categorias: ['ia'] },
  { nombre: 'Datos', categorias: ['datos'] },
  { nombre: 'Cloud', categorias: ['cloud'] },
  { nombre: 'Calidad', categorias: ['testing', 'herramientas', 'metodologia'] },
];
const CAPA_GAP = 30;

/**
 * Vista 3D del grafo (Three.js vía 3d-force-graph). Misma interfaz que la
 * vista 2D: recibe filtros, selección y búsqueda, y emite la selección.
 *
 * La escena es siempre nocturna (una constelación): el brillo (bloom) solo luce
 * sobre fondo oscuro. Las etiquetas son HTML (CSS2DRenderer), así quedan nítidas
 * y fuera del bloom. Three.js (~700 KB) se importa de forma diferida.
 */
@Component({
  selector: 'app-graph-3d',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host" role="img"
         aria-label="Grafo 3D de proyectos y tecnologías. Usa la búsqueda para elegir un nodo con el teclado."></div>
    @if (!ready()) {
      <p class="loading">Encendiendo la constelación…</p>
    }
  `,
  styleUrl: './graph-3d.scss',
})
export class Graph3D {
  readonly graph = input.required<PublicGraph>();
  readonly hiddenTipos = input<ReadonlySet<string>>(new Set());
  readonly selectedId = input<string | null>(null);
  readonly matchIds = input<ReadonlySet<string>>(new Set());
  /** Lente activa (p. ej. Enfoque IA): sin selección, se atenúa todo lo de afuera. */
  readonly enfoque = input<ReadonlySet<string> | null>(null);
  /** Qué tapa el lienzo (panel, hoja, leyenda). */
  readonly cobertura = input<Cobertura>('ninguna');
  /** Alto en px de la interfaz que flota sobre el borde superior del lienzo. */
  readonly arriba = input(0);
  readonly nodeSelect = output<string | null>();

  protected readonly ready = signal(false);
  /** Milisegundos de entrada transcurridos (null = entrada terminada, todo visible). */
  private readonly trazado = signal<number | null>(null);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly hovered = signal<string | null>(null);

  private fg?: ForceGraph3DInstance<N3, L3>;
  private readonly visuals = new Map<string, Visual>();
  private links: L3[] = [];
  private settled = false;
  private paintedFor: string | null | undefined = null;
  private three?: typeof THREE;
  private CSS2D?: typeof import('three/examples/jsm/renderers/CSS2DRenderer.js').CSS2DObject;
  /** Planos y rótulos de la vista de arquitectura activa (se quitan al deseleccionar). */
  private capas?: THREE.Group;
  private pinned: N3[] = [];
  /** Actualizadores de los pisos que giran (vista de arquitectura). */
  private giros: (() => void)[] = [];
  /** Posición de piso de cada nodo fijado: al soltarlo tras arrastrar, vuelve ahí. */
  private readonly pinPos = new Map<string, { x: number; y: number; z: number }>();
  /** Inicio de la entrada (los nodos se encienden desde el centro hacia afuera). */
  private introT0?: number;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(async () => {
      const [{ default: ForceGraph3D }, three, { CSS2DRenderer, CSS2DObject }, { UnrealBloomPass }] = await Promise.all([
        import('3d-force-graph'),
        import('three'),
        import('three/examples/jsm/renderers/CSS2DRenderer.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      ]);
      const { forceX, forceY, forceZ, forceCollide } = await import('d3-force-3d');
      this.three = three;
      this.CSS2D = CSS2DObject;
      const el = this.host().nativeElement;
      const palette = readPalette(el);
      const data = toData(untracked(this.graph));
      this.links = data.links;
      const mobile = matchMedia('(max-width: 720px)').matches;

      const fg = new ForceGraph3D(el, { controlType: 'orbit', extraRenderers: [new CSS2DRenderer() as never] }) as unknown as ForceGraph3DInstance<N3, L3>;
      fg.width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor(palette.bg)
        .showNavInfo(false)
        .nodeLabel(() => '') // la etiqueta HTML ya está en la escena
        .nodeThreeObject((n) => this.buildNode(three, CSS2DObject, n, palette))
        .linkWidth((l) => (l.destacado ? 0.9 : 0.35))
        // Aristas en arco, cada una girada distinto: el grafo se lee como volumen.
        .linkCurvature(0.16)
        // Ángulo estable por arista: la librería reevalúa este accesor en cada tick,
        // y uno aleatorio hacía titilar las cuerdas al arrastrar un nodo.
        .linkCurveRotation((l) => angulo(`${endId(l.source)}|${endId(l.target)}`))
        .linkOpacity(1) // la opacidad va en el alfa de cada color
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleSpeed(0.005)
        // Menos fricción: al arrastrar un nodo, sus vecinos lo siguen como resortes.
        .d3VelocityDecay(0.22)
        // El layout se precalcula antes de pintar: no depende de requestAnimationFrame
        // (pausado en pestañas ocultas) y en celulares no se ve el grafo "hervir".
        .warmupTicks(220)
        .cooldownTicks(40)
        .onNodeClick((n) => this.nodeSelect.emit(n.id))
        .onNodeHover((n) => {
          el.style.cursor = n ? 'pointer' : '';
          this.hovered.set(n?.id ?? null);
        })
        .onBackgroundClick(() => this.nodeSelect.emit(null))
        .onNodeDrag(() => ((fg.controls() as { autoRotate: boolean }).autoRotate = false))
        // Al soltar, el nodo no queda clavado: vuelve elástico a su equilibrio
        // (o a su piso, si está en la vista de arquitectura).
        .onNodeDragEnd((n) => {
          const piso = this.pinPos.get(n.id);
          if (piso) {
            n.fx = piso.x;
            n.fy = piso.y;
            n.fz = piso.z;
          } else {
            delete n.fx;
            delete n.fy;
            delete n.fz;
          }
          fg.d3ReheatSimulation();
        })
        .graphData(data);

      // Más aire entre nodos que el valor por defecto: las etiquetas no se pisan.
      // Repulsión moderada y una atracción suave al centro: los nodos sin aristas
      // (LinkedIn, BPMN…) no se escapan y el encuadre queda compacto.
      // Los proyectos repelen más (pozos de gravedad): sus tecnologías orbitan alrededor.
      (fg.d3Force('charge') as unknown as { strength(fn: (n: N3) => number): void })?.strength((n) =>
        n.tipo === 'proyecto' ? -280 : -95,
      );
      (fg.d3Force('link') as unknown as { distance(fn: (l: L3) => number): void })?.distance((l) =>
        l.type === 'USA' ? 58 : 85,
      );
      // Centrado anisótropo: la atracción es débil en el eje largo de la pantalla
      // y fuerte en el corto, así el grafo toma su forma (ancho en horizontal,
      // alto en vertical). Al girar el celular se recalcula (ver ResizeObserver).
      const centrado = (horizontal: boolean) => {
        fg.d3Force('x', forceX(0).strength(horizontal ? 0.018 : 0.09) as never)
          .d3Force('y', forceY(0).strength(horizontal ? 0.09 : 0.018) as never);
      };
      this.horizontal = el.clientWidth >= el.clientHeight;
      centrado(this.horizontal);
      this.recentrar = (horizontal: boolean) => {
        this.horizontal = horizontal;
        centrado(horizontal);
        fg.d3ReheatSimulation();
        // Tras reacomodarse, encuadra de nuevo (o vuelve a la selección).
        setTimeout(() => (this.selectedId() ? this.focus(this.selectedId()!) : this.fit(900)), 1600);
      };
      fg.d3Force('z', forceZ(0).strength(0.12) as never)
        // Colisión: cada nodo reserva una burbuja que incluye su etiqueta, así
        // los nombres no se amontonan aunque la repulsión se equilibre.
        .d3Force('colision', forceCollide((n: N3) => (n.tipo === 'proyecto' ? 26 : 15)).strength(0.9) as never)
        // Composición: los proyectos nunca quedan encimados y el más conectado
        // queda al centro de la constelación.
        .d3Force('proyectos', separarProyectos(120) as never)
        .d3Force('ancla', anclarCentro() as never);

      this.paintLinks(palette);
      fg.scene().add(
        // El ambiente (polvo que deriva, estrellas) sigue vivo con movimiento
        // reducido, a menor velocidad: es lento, lejano y no desplaza la vista.
        // Lo que sí se apaga es lo que marea: giro de cámara, vuelos y flotación.
        estrellas(three, palette.star, this.reducedMotion ? 0.5 : 1),
        polvo(three, [palette.tipos['proyecto']!, palette.tipos['tecnologia']!, palette.tipos['canal']!, palette.star], this.reducedMotion ? 0.5 : 1),
      );

      // Brillo: resolución reducida en celular, donde la GPU es más modesta.
      const bloom = new UnrealBloomPass(new three.Vector2(el.clientWidth, el.clientHeight), mobile ? 0.6 : 0.75, 0.45, 0.62);
      fg.postProcessingComposer().addPass(bloom);
      // El clear color no se linealiza al pasar por los render targets del bloom
      // y el fondo salía gris (#262e3b en vez de #05070b, medido en píxeles);
      // como fondo de escena (scene.background) sí se convierte bien.
      const sky = cielo(three, fg.renderer() as THREE.WebGLRenderer, palette.bg, [
        palette.tipos['proyecto']!,
        palette.tipos['canal']!,
        palette.tipos['tecnologia']!,
      ]);
      // Fondo negro puro; la nebulosa solo existe como entorno: no se ve, pero
      // las esferas la reflejan levemente y toman su tinte.
      fg.scene().background = new three.Color(palette.bg);
      fg.scene().environment = sky.entorno;
      sky.fondo.dispose();
      fg.renderer().setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));

      // Entrada: la cámara parte lejos y el grafo se despliega mientras gira despacio.
      fg.cameraPosition({ x: 0, y: 120, z: mobile ? 1100 : 900 });
      const controls = fg.controls() as { autoRotate: boolean; autoRotateSpeed: number; addEventListener(t: string, f: () => void): void };
      controls.autoRotate = !this.reducedMotion;
      controls.autoRotateSpeed = 0.55;
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
        clearTimeout(this.giroTimer);
      });
      // Tras soltar, el giro vuelve solo (mismo sentido) si nadie toca nada.
      controls.addEventListener('end', () => this.reanudarGiro());
      this.reanudarGiro = () => {
        clearTimeout(this.giroTimer);
        if (this.reducedMotion) return;
        this.giroTimer = setTimeout(() => {
          if (!this.selectedId()) controls.autoRotate = true;
        }, 7000);
      };

      // Primer encuadre, cuando el layout se asienta. Con el precálculo (warmup)
      // el aviso de onEngineStop puede llegar antes de registrarse: sin el
      // respaldo de abajo, con movimiento reducido la cámara quedaba en su
      // posición de partida (lejos y descentrada).
      const asentar = () => {
        if (this.settled) return;
        this.settled = true;
        // Desde aquí, "Reordenar" y la arquitectura sí animan unos cuadros.
        fg.cooldownTicks(90);
        const id = this.selectedId();
        if (id) this.focus(id);
        else this.fit(this.reducedMotion ? 0 : 1400);
      };
      fg.onEngineStop(asentar);

      const ro = new ResizeObserver(() => {
        fg.width(el.clientWidth).height(el.clientHeight);
        bloom.resolution.set(el.clientWidth, el.clientHeight);
        // El desplazamiento de la proyección depende del tamaño del lienzo.
        untracked(() => this.moverCentro(this.cobertura(), this.arriba()));
        const horizontal = el.clientWidth >= el.clientHeight;
        if (this.settled && horizontal !== this.horizontal) this.recentrar?.(horizontal);
      });
      ro.observe(el);
      destroyRef.onDestroy(() => {
        ro.disconnect();
        cancelAnimationFrame(this.centroRaf);
        clearTimeout(this.giroTimer);
        clearTimeout(this.pulsoTimer);
        cancelAnimationFrame(this.paralajeRaf);
        fg.pauseAnimation();
        fg._destructor();
        fg.renderer().dispose();
        this.visuals.clear();
      });

      this.fg = fg;

      // Pulsos de energía: cada tanto un destello recorre una conexión al azar,
      // el triple de probable en el stack destacado. Con selección, solo entre
      // las conexiones del nodo elegido. Más espaciados con movimiento reducido.
      const pulso = () => {
        const id = this.selectedId();
        const oculto = this.hiddenTipos();
        const tipoDe = new Map([...this.graphNodes()].map((n) => [n.id, n.tipo]));
        const candidatas = this.links.filter((l) => {
          const a = endId(l.source);
          const b = endId(l.target);
          if (oculto.has(tipoDe.get(a) ?? '') || oculto.has(tipoDe.get(b) ?? '')) return false;
          const lente = !id ? this.enfoque() : null;
          if (lente) return lente.has(a) && lente.has(b);
          return !id || a === id || b === id;
        });
        const pesos = candidatas.map((l) => (l.destacado ? 3 : 1));
        let r = Math.random() * pesos.reduce((x, y) => x + y, 0);
        const elegida = candidatas.find((_, i) => (r -= pesos[i]!) < 0);
        if (elegida && !document.hidden) fg.emitParticle(elegida);
        this.pulsoTimer = setTimeout(pulso, (this.reducedMotion ? 2600 : 700) + Math.random() * 1400);
      };
      this.pulsoTimer = setTimeout(pulso, 2500);

      // Paralaje (solo mouse, sin movimiento reducido): la cámara orbita unos
      // grados siguiendo el cursor. Se aplica como diferencia sobre la posición,
      // así convive con el giro automático y con los vuelos.
      if (!this.reducedMotion && matchMedia('(pointer: fine)').matches) {
        const cam = fg.camera();
        const obj = { x: 0, y: 0 };
        const actual = { x: 0, y: 0 };
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          obj.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
          obj.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
        });
        el.addEventListener('pointerleave', () => ((obj.x = 0), (obj.y = 0)));
        const derecha = new three.Vector3();
        const arriba = new three.Vector3();
        const frame = () => {
          const nx = actual.x + (obj.x - actual.x) * 0.04;
          const ny = actual.y + (obj.y - actual.y) * 0.04;
          const target = (fg.controls() as { target: THREE.Vector3 }).target;
          const d = cam.position.distanceTo(target);
          derecha.setFromMatrixColumn(cam.matrixWorld, 0);
          arriba.setFromMatrixColumn(cam.matrixWorld, 1);
          const k = d * 0.06; // ~3,5° de inclinación máxima
          cam.position.addScaledVector(derecha, (nx - actual.x) * k).addScaledVector(arriba, -(ny - actual.y) * k);
          actual.x = nx;
          actual.y = ny;
          this.paralajeRaf = requestAnimationFrame(frame);
        };
        this.paralajeRaf = requestAnimationFrame(frame);
      }

      if (!this.reducedMotion) {
        // ~12 pasos bastan: cada uno revela las aristas cuyo extremo más lejano ya
        // se encendió (misma fórmula de retraso que los nodos).
        const t0 = performance.now();
        const paso = () => {
          const ms = performance.now() - t0;
          if (ms > 3200) return this.trazado.set(null);
          this.trazado.set(ms);
          setTimeout(paso, 160);
        };
        this.trazado.set(0);
        paso();
      }
      if (ngDevMode) (window as unknown as { fg: unknown }).fg = fg; // depuración
      this.ready.set(true);
      // Respaldo del primer encuadre (ver `asentar`). Tras el warmup el layout ya
      // está prácticamente quieto, así que encuadrar aquí es seguro.
      setTimeout(asentar, 900);
    });

    // Filtro por tipo (ocultar un nodo oculta sus aristas) y, durante la
    // entrada, las aristas se van trazando desde el centro hacia afuera, al
    // mismo ritmo en que se encienden sus nodos.
    effect(() => {
      const hidden = this.hiddenTipos();
      const trazado = this.trazado();
      if (!this.ready() || !this.fg) return;
      const byId = new Map([...this.graphNodes()].map((n) => [n.id, n]));
      const lejos = (id: string) => {
        const n = byId.get(id);
        return n ? Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0) : 0;
      };
      this.fg
        .nodeVisibility((n) => !hidden.has(n.tipo))
        .linkVisibility((l) => {
          const a = endId(l.source);
          const b = endId(l.target);
          if (hidden.has(byId.get(a)?.tipo ?? '') || hidden.has(byId.get(b)?.tipo ?? '')) return false;
          return trazado === null || Math.max(lejos(a), lejos(b)) * 5 + 500 <= trazado;
        });
    });

    // Onda de hover: los vecinos se encienden en cadena (1 y 2 saltos).
    effect(() => {
      const h = this.hovered();
      if (!this.ready()) return;
      for (const v of this.visuals.values()) v.onda = undefined;
      if (!h) return;
      const t0 = performance.now();
      const salto = this.reducedMotion ? 0 : 140;
      let frente = new Set([h]);
      const vistos = new Set([h]);
      for (let d = 1; d <= 2; d++) {
        const sig = new Set<string>();
        for (const l of this.links) {
          const a = endId(l.source);
          const b = endId(l.target);
          if (frente.has(a) && !vistos.has(b)) sig.add(b);
          if (frente.has(b) && !vistos.has(a)) sig.add(a);
        }
        for (const id of sig) {
          vistos.add(id);
          const v = this.visuals.get(id);
          if (v) v.onda = t0 + d * salto;
        }
        frente = sig;
      }
    });

    // Selección, búsqueda y hover: resalta el vecindario y atenúa el resto.
    effect(() => {
      const id = this.selectedId();
      const matches = this.matchIds();
      const hovered = this.hovered();
      this.enfoque();
      if (!this.ready() || !this.fg) return;
      this.applyState(id, matches, hovered);
    });

    // Centro óptico: desplaza la proyección para que la escena quede centrada en
    // la parte visible del lienzo (bajo la barra, al lado del panel, sobre la hoja).
    effect(() => {
      const cobertura = this.cobertura();
      const arriba = this.arriba();
      if (!this.ready()) return;
      this.moverCentro(cobertura, arriba);
    });

    // La cámara solo vuela cuando cambia la selección, no con el hover.
    effect(() => {
      const id = this.selectedId();
      if (!this.ready() || !this.settled) return;
      if (id) this.focus(id);
      else {
        this.desarmarArquitectura();
        this.reanudarGiro();
      }
    });
  }

  private horizontal = true;
  private pulsoTimer?: ReturnType<typeof setTimeout>;
  private paralajeRaf = 0;
  private giroTimer?: ReturnType<typeof setTimeout>;
  private reanudarGiro: () => void = () => undefined;
  private recentrar?: (horizontal: boolean) => void;
  private centro = { x: 0, y: 0 };
  private centroRaf = 0;

  /** Anima el desplazamiento de la proyección (setViewOffset) hacia su objetivo. */
  private moverCentro(cobertura: Cobertura, arriba: number): void {
    const fg = this.fg;
    if (!fg) return;
    const el = this.host().nativeElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const movil = matchMedia('(max-width: 720px)').matches;
    const destino = {
      // Positivo = la ventana se corre a la derecha/abajo, la escena a la izquierda/arriba.
      x: cobertura === 'lateral' ? 200 : 0,
      y: -arriba / 2 + (cobertura === 'inferior' ? h * 0.3 : cobertura === 'recorrido' && movil ? h * 0.14 : 0),
    };
    const cam = fg.camera() as THREE.PerspectiveCamera;
    cancelAnimationFrame(this.centroRaf);
    const paso = () => {
      const k = this.reducedMotion ? 1 : 0.12;
      this.centro.x += (destino.x - this.centro.x) * k;
      this.centro.y += (destino.y - this.centro.y) * k;
      const listo = Math.abs(destino.x - this.centro.x) < 0.5 && Math.abs(destino.y - this.centro.y) < 0.5;
      if (listo) this.centro = { ...destino };
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (this.centro.x === 0 && this.centro.y === 0) cam.clearViewOffset();
      else cam.setViewOffset(W, H, this.centro.x, this.centro.y, W, H);
      if (!listo) this.centroRaf = requestAnimationFrame(paso);
    };
    // Sin animación si no hay tamaño todavía.
    if (!w || !h) return;
    paso();
  }

  /** Reordena: recalienta la simulación de fuerzas. */
  relayout(): void {
    this.fg?.d3ReheatSimulation();
  }

  /**
   * Encuadre propio: zoomToFit usa la esfera envolvente y deja el grafo en la
   * mitad de la pantalla. Aquí se usa la caja visible y el aspecto del lienzo,
   * manteniendo la dirección desde la que se mira.
   */
  fit(ms = 700): void {
    const fg = this.fg;
    const ns = [...this.graphNodes()].filter((n) => !this.hiddenTipos().has(n.tipo) && n.x !== undefined);
    if (!fg || !ns.length) return;
    const lo = (k: 'x' | 'y' | 'z') => Math.min(...ns.map((n) => n[k]!));
    const hi = (k: 'x' | 'y' | 'z') => Math.max(...ns.map((n) => n[k]!));
    const c = { x: (lo('x') + hi('x')) / 2, y: (lo('y') + hi('y')) / 2, z: (lo('z') + hi('z')) / 2 };
    const cam = fg.camera() as THREE.PerspectiveCamera;
    const el = this.host().nativeElement;
    const tanV = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    // Alto útil: la barra flotante tapa `arriba` px (el centro óptico ya se
    // corrió hacia abajo en moverCentro). Márgenes para etiquetas y bordes.
    const utilV = tanV * Math.max(0.3, 1 - (this.arriba() + 60) / Math.max(el.clientHeight, 1));
    const utilH = tanV * cam.aspect * 0.9;
    // La vista general mira el grafo de frente (su lado ancho está en X): se
    // conserva si se miraba desde adelante o desde atrás, y una leve elevación.
    // Sin esto, tras volar a un nodo el encuadre podía quedar de canto.
    const elevActual = Math.asin(Math.min(0.9, Math.max(-0.9, (cam.position.y - c.y) / (cam.position.distanceTo(c as THREE.Vector3Like) || 1))));
    const elev = Math.min(0.35, Math.max(0.08, elevActual));
    // Encuadre con perspectiva real: para cada nodo, la distancia mínima a la
    // que entra en pantalla es su profundidad hacia la cámara más su desvío
    // lateral (o vertical) dividido por la tangente útil. Se toma el peor caso
    // en 12 ángulos alrededor del eje Y si la cámara gira sola (con algo de
    // tolerancia: un borde que asoma un instante en diagonal no molesta); si
    // no gira, solo en el ángulo actual, que es lo que se ve.
    const gira = !!(fg.controls() as { autoRotate?: boolean }).autoRotate;
    const azActual = Math.abs(Math.atan2(cam.position.x - c.x, cam.position.z - c.z)) < Math.PI / 2 ? 0 : Math.PI;
    const angulos = gira ? Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2) : [azActual];
    let dist = 0;
    for (const az of angulos) {
      const d = { x: Math.sin(az) * Math.cos(elev), y: Math.sin(elev), z: Math.cos(az) * Math.cos(elev) };
      const der = { x: Math.cos(az), y: 0, z: -Math.sin(az) };
      // arriba = d × der (aproximado; basta para el peor caso)
      const arr = { x: -Math.sin(az) * Math.sin(elev), y: Math.cos(elev), z: -Math.cos(az) * Math.sin(elev) };
      for (const n of ns) {
        const px = n.x! - c.x;
        const py = n.y! - c.y;
        const pz = (n.z ?? 0) - c.z;
        const prof = px * d.x + py * d.y + pz * d.z;
        const lat = Math.abs(px * der.x + pz * der.z) + 14;
        const ver = Math.abs(px * arr.x + py * arr.y + pz * arr.z) + 14;
        dist = Math.max(dist, prof + lat / utilH, prof + ver / utilV);
      }
    }
    if (gira) dist *= 0.86;
    const dir = { x: Math.sin(azActual) * Math.cos(elev), y: Math.sin(elev), z: Math.cos(azActual) * Math.cos(elev) };
    fg.cameraPosition(
      { x: c.x + dir.x * dist, y: c.y + dir.y * dist, z: c.z + dir.z * dist },
      c,
      this.reducedMotion ? 0 : ms,
    );
  }

  private *graphNodes(): Iterable<N3> {
    yield* (this.fg?.graphData().nodes ?? []) as N3[];
  }

  /**
   * Vuela hacia un nodo. En celular la hoja de detalle tapa el 60 % inferior,
   * así que cámara y foco bajan juntos: el nodo queda en el tercio superior.
   */
  private focus(id: string): void {
    const fg = this.fg;
    const node = [...this.graphNodes()].find((n) => n.id === id);
    if (!fg || !node || node.x === undefined) return;
    const capas = this.armarArquitectura(node);
    this.refrescarEstado();
    if (!this.reducedMotion && this.three) {
      const pal = readPalette(this.host().nativeElement);
      onda(this.three, fg.scene(), fg.camera(), { x: node.x, y: node.y!, z: node.z ?? 0 }, pal.tipos[node.tipo] ?? pal.accent, 10);
    }
    if (capas) {
      // Arquitectura: cámara de costado (algo elevada) para que las capas se lean
      // como pisos; mantiene el ángulo horizontal desde donde se miraba.
      const cam = fg.camera().position;
      const cx = node.x!;
      const cz = node.z ?? 0;
      const cy = node.y! - ((capas + 1) * CAPA_GAP) / 2;
      const az = Math.atan2(cam.x - cx, cam.z - cz);
      // En celular el lienzo es angosto y, con la hoja abierta, solo queda ~1/4 de
      // alto visible: hace falta más distancia para ver todos los pisos.
      const movil = matchMedia('(max-width: 720px)').matches;
      const d = (170 + capas * 30) * (movil ? (this.cobertura() === 'inferior' ? 3.3 : 2.1) : 1);
      (fg.controls() as { autoRotate: boolean }).autoRotate = false;
      fg.cameraPosition(
        { x: cx + Math.sin(az) * d, y: cy + d * 0.28, z: cz + Math.cos(az) * d },
        { x: cx, y: cy, z: cz },
        this.reducedMotion ? 0 : 1200,
      );
      return;
    }
    const { x = 0, z = 0 } = node;
    const y = node.y!;
    const dist = 150;
    const len = Math.hypot(x, y, z) || 1;
    const k = 1 + dist / len;
    (fg.controls() as { autoRotate: boolean }).autoRotate = false;
    fg.cameraPosition({ x: x * k, y: y * k, z: z * k }, { x, y, z }, this.reducedMotion ? 0 : 1100);
  }

  /** Suelta los nodos fijados por la vista de arquitectura anterior. */
  private desarmarArquitectura(): void {
    for (const n of this.pinned) {
      delete n.fx;
      delete n.fy;
      delete n.fz;
    }
    const huboCapas = this.pinned.length > 0;
    this.pinned = [];
    this.pinPos.clear();
    if (this.giros.length && this.fg) {
      this.giros = [];
      this.fg.onEngineTick(() => undefined);
      this.fg.cooldownTicks(90).cooldownTime(15000);
    }
    if (this.capas) {
      this.capas.removeFromParent();
      this.capas.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
        if ('element' in o) (o as unknown as { element: HTMLElement }).element.remove();
      });
      this.capas = undefined;
    }
    if (huboCapas) {
      this.fg?.d3ReheatSimulation();
      this.refrescarEstado();
    }
  }

  /** Reaplica atenuado y aristas tras armar o desarmar la arquitectura. */
  private refrescarEstado(): void {
    this.paintedFor = undefined;
    untracked(() => this.applyState(this.selectedId(), this.matchIds(), this.hovered()));
  }

  /**
   * Vista de arquitectura: si el nodo es un proyecto, su stack se ordena en
   * capas horizontales bajo él (Interfaz arriba, infraestructura abajo), cada
   * una con un plano translúcido y su nombre. Devuelve cuántas capas armó.
   */
  private armarArquitectura(p: N3): number {
    this.desarmarArquitectura();
    const three = this.three;
    const CSS2D = this.CSS2D;
    const fg = this.fg;
    if (!three || !CSS2D || !fg || p.tipo !== 'proyecto') return 0;
    const byId = new Map([...this.graphNodes()].map((n) => [n.id, n]));
    const stack = this.links
      .filter((l) => l.type === 'USA' && endId(l.source) === p.id)
      .map((l) => byId.get(endId(l.target)))
      .filter((n): n is N3 => !!n);
    if (stack.length < 4) return 0;
    const capas = CAPAS.map((c) => ({ ...c, nodos: stack.filter((n) => c.categorias.includes(n.categoria ?? '')) })).filter(
      (c) => c.nodos.length,
    );
    // Lo que no tenga categoría conocida va a una capa final en vez de perderse.
    const sinCapa = stack.filter((n) => !CAPAS.some((c) => c.categorias.includes(n.categoria ?? '')));
    if (sinCapa.length) capas.push({ nombre: 'Otros', categorias: [], nodos: sinCapa });

    const px = p.x ?? 0;
    const py = p.y ?? 0;
    const pz = p.z ?? 0;
    p.fx = px;
    p.fy = py;
    p.fz = pz;
    this.pinned.push(p);
    this.pinPos.set(p.id, { x: px, y: py, z: pz });
    const group = new three.Group();
    const accent = new three.Color(readPalette(this.host().nativeElement).accent);
    const t0 = performance.now();
    capas.forEach((capa, i) => {
      const y = py - CAPA_GAP * (i + 1);
      const radio = Math.max(20, capa.nodos.length * 8.5);
      // Cada piso gira en sentido alterno, como un mecanismo de relojería.
      const sentido = i % 2 ? -1 : 1;
      const vel = this.reducedMotion ? 0 : 0.12 * sentido; // rad/s
      const ubicar = (ms: number) =>
        capa.nodos.forEach((n, j) => {
          const a = (j / capa.nodos.length) * Math.PI * 2 + i * 0.6 + (ms / 1000) * vel;
          n.fx = px + Math.cos(a) * radio;
          n.fy = y;
          n.fz = pz + Math.sin(a) * radio;
          this.pinPos.set(n.id, { x: n.fx, y: n.fy, z: n.fz });
        });
      ubicar(0);
      this.pinned.push(...capa.nodos);
      this.giros.push(() => ubicar(performance.now() - t0));
      const disco = new three.Mesh(
        new three.RingGeometry(radio - 1.2, radio + 10, 64),
        new three.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.07, side: three.DoubleSide, depthWrite: false }),
      );
      disco.rotation.x = -Math.PI / 2;
      disco.position.set(px, y, pz);
      const borde = new three.Mesh(
        new three.TorusGeometry(radio + 10, 0.18, 6, 96),
        new three.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35 }),
      );
      borde.rotation.x = -Math.PI / 2;
      borde.position.set(px, y, pz);
      const rotulo = document.createElement('span');
      rotulo.className = 'n3-capa';
      rotulo.textContent = capa.nombre;
      const obj = new CSS2D(rotulo);
      obj.position.set(px - radio - 12, y, pz);
      obj.center.set(1, 0.5);
      group.add(disco, borde, obj);
    });
    fg.scene().add(group);
    this.capas = group;
    // Mientras la arquitectura esté armada la simulación no se detiene: así las
    // posiciones fijadas (que giran) se reflejan en nodos y aristas cada cuadro.
    if (!this.reducedMotion) {
      fg.cooldownTicks(Infinity).cooldownTime(Infinity);
      fg.onEngineTick(() => this.giros.forEach((g) => g()));
    }
    fg.d3ReheatSimulation();
    return capas.length;
  }

  private applyState(id: string | null, matches: ReadonlySet<string>, hovered: string | null): void {
    const neigh = new Set<string>();
    if (id && this.pinned.length) {
      // Vista de arquitectura: solo el proyecto y su stack; el resto se apaga.
      for (const n of this.pinned) neigh.add(n.id);
    } else if (!id && this.enfoque()) {
      for (const x of this.enfoque()!) neigh.add(x);
    } else if (id) {
      neigh.add(id);
      for (const l of this.links) {
        const s = endId(l.source);
        const t = endId(l.target);
        if (s === id) neigh.add(t);
        if (t === id) neigh.add(s);
      }
    }
    for (const [nid, v] of this.visuals) {
      const lente = !id && !!this.enfoque();
      const faded = (!!id || lente) && !neigh.has(nid);
      const focus = nid === id || nid === hovered;
      const match = matches.has(nid);
      for (const m of v.materials) m.opacity = faded ? 0.1 : 1;
      v.emisivo = focus || match ? 0.85 : 0.28;
      v.halo0 = faded ? 0.04 : focus || match ? 1.6 : 0.75;
      v.target = nid === id ? 1.35 : match || nid === hovered ? 1.2 : 1;
      v.label.classList.toggle('faded', faded);
      v.label.classList.toggle('focus', focus || match || ((!!id || lente) && neigh.has(nid)));
    }
    // Las aristas solo se repintan si cambia la selección: con el hover
    // reiniciarían las partículas en cada movimiento del mouse.
    const clave = id ?? (this.enfoque() ? '\u0000lente' : null);
    if (clave !== this.paintedFor) {
      this.paintedFor = clave;
      this.paintLinks(readPalette(this.host().nativeElement), id);
    }
  }

  /** Colores y partículas de las aristas según la selección actual. */
  private paintLinks(p: Palette, id: string | null = null): void {
    const fg = this.fg;
    if (!fg) return;
    const arq = new Set(this.pinned.map((n) => n.id));
    const lente = !id ? this.enfoque() : null;
    const touches = (l: L3) =>
      lente
        ? lente.has(endId(l.source)) && lente.has(endId(l.target))
        : !!id && (arq.size ? endId(l.source) === id && arq.has(endId(l.target)) : endId(l.source) === id || endId(l.target) === id);
    // Con lente, el resto de las aristas se apaga como con una selección.
    if (lente) id = '\u0000lente';
    // Colores ya mezclados con el fondo (opacos): no dependen del alfa y quedan
    // bajo el umbral del bloom, así solo brillan los nodos y lo seleccionado.
    fg.linkColor((l) => (touches(l) ? p.accent : l.destacado ? mix(p.accent, p.bg, id ? 0.1 : 0.45) : mix(p.edge, p.bg, id ? 0.07 : 0.22)))
      .linkDirectionalParticles((l) => (touches(l) ? (this.pinned.length ? 1 : 3) : !id && l.destacado ? 2 : 0))
      .linkDirectionalParticleColor(() => p.accent);
  }

  private buildNode(
    three: typeof THREE,
    CSS2DObject: typeof import('three/examples/jsm/renderers/CSS2DRenderer.js').CSS2DObject,
    n: N3,
    p: Palette,
  ): THREE.Object3D {
    const color = new three.Color(p.tipos[n.tipo] ?? p.tipos['pendiente']);
    const proyecto = n.tipo === 'proyecto';
    const r = proyecto ? 6.5 + Math.min(n.degree, 20) * 0.3 : n.tipo === 'tecnologia' ? 2.6 + Math.min(n.degree, 8) * 0.4 : n.tipo === 'aprendizaje' ? 3.3 : 4.2;
    const mat = () =>
      // Algo metálicas y pulidas: reflejan levemente la nebulosa del entorno.
      new three.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.28,
        roughness: 0.3,
        metalness: 0.35,
        envMapIntensity: 2.2,
        transparent: true,
      });

    const group = new three.Group();
    const body = new three.Group();
    const materials = [mat()];
    const esfera = new three.Mesh(new three.SphereGeometry(r, 32, 24), materials[0]);
    const aura = halo(three, color, r);
    body.add(esfera, aura.mesh);
    if (proyecto) {
      // Anillo en órbita: los proyectos son los "planetas" de la constelación.
      const ringMat = mat();
      materials.push(ringMat);
      const ring = new three.Mesh(new three.TorusGeometry(r * 1.7, 0.28, 8, 64), ringMat);
      ring.rotation.x = Math.PI / 2.6;
      if (!this.reducedMotion) ring.onBeforeRender = () => (ring.rotation.z += 0.004);
      body.add(ring);
    }
    group.add(body);

    const label = document.createElement('span');
    label.className = `n3-label n3-${n.tipo}`;
    label.textContent = n.id;
    const obj = new CSS2DObject(label);
    const labelY = -(proyecto ? r * 1.9 : r + 3);
    obj.position.set(0, labelY, 0);
    obj.center.set(0.5, 0);
    group.add(obj);

    const visual: Visual = { materials, body, label, halo: aura.material, target: 1, emisivo: 0.28, halo0: 0.75 };
    this.visuals.set(n.id, visual);

    // Cada frame: entrada escalonada, flotación suave y escala interpolada.
    const fase = Math.random() * Math.PI * 2;
    const amp = proyecto ? 1.1 : 0.7;
    let escala = this.reducedMotion ? 1 : 0;
    const tecnologia = n.tipo === 'tecnologia';
    const dondeEsta = new three.Vector3();
    esfera.onBeforeRender = (renderer, _scene, camera) => {
      const t = performance.now();
      this.introT0 ??= t;
      let intro = 1;
      if (!this.reducedMotion) {
        // Los del centro se encienden primero; la onda recorre el grafo en ~1,2 s.
        const retraso = group.position.length() * 5 + (fase / (Math.PI * 2)) * 150;
        const k = Math.min(1, Math.max(0, (t - this.introT0 - 250 - retraso) / 650));
        intro = k === 1 ? 1 : easeOutBack(k);
        const dy = Math.sin(t / 1000 * 0.7 + fase) * amp;
        body.position.y = dy;
        obj.position.y = labelY + dy;
      }
      // Latido: los proyectos activos respiran (~2,4 s por pulso; más lento con
      // movimiento reducido). Solo cambia el brillo, nada se desplaza.
      const latido = n.activo ? 0.5 + 0.5 * Math.sin((t / 1000) * ((Math.PI * 2) / (this.reducedMotion ? 4 : 2.4)) + fase) : 0;
      // Onda de hover: sube rápido al llegar y se mantiene mientras dure el hover.
      const onda = visual.onda === undefined ? 0 : Math.min(1, Math.max(0, (t - visual.onda) / 220));
      visual.halo.uniforms['uOpacity']!.value = visual.halo0 * (1 + latido * 0.9) + onda * 0.9;
      for (const m of visual.materials) m.emissiveIntensity = visual.emisivo + latido * 0.25 + onda * 0.45;
      escala += (visual.target * intro - escala) * (this.reducedMotion ? 1 : 0.14);
      body.scale.setScalar(Math.max(escala, 0.001));
      // Nivel de detalle: los nombres de tecnologías aparecen al acercarse. Se mide
      // cuántos píxeles ocupa una unidad de la escena a la distancia del nodo;
      // con la vista general en celular no caben 40 nombres legibles.
      let detalle = 1;
      if (tecnologia && !label.classList.contains('focus')) {
        const cam = camera as THREE.PerspectiveCamera;
        const d = cam.position.distanceTo(group.getWorldPosition(dondeEsta));
        const alto = renderer.domElement.clientHeight;
        const pxPorUnidad = alto / (2 * d * Math.tan(((cam.fov / 2) * Math.PI) / 180));
        detalle = Math.min(1, Math.max(0, (pxPorUnidad - 0.85) / 0.35));
      }
      const op = Math.min(intro, detalle);
      // Atenuado por selección: manda la clase CSS `faded`.
      label.style.opacity = label.classList.contains('faded') || op >= 1 ? '' : String(Math.max(0, op));
    };
    return group;
  }

}

interface Palette {
  bg: string;
  edge: string;
  accent: string;
  star: string;
  tipos: Record<string, string>;
}

/** Colores desde los tokens CSS del host (que siempre usa el tema oscuro). */
function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const tipos: Record<string, string> = {};
  for (const t of ['proyecto', 'tecnologia', 'persona', 'canal', 'area', 'aprendizaje', 'pendiente']) tipos[t] = v(`--tipo-${t}`);
  return { bg: v('--scene-bg'), edge: v('--scene-edge'), accent: v('--accent'), star: v('--scene-star'), tipos };
}

/** `a` de `hex` sobre `fondo` (0 = fondo, 1 = color puro), como hex opaco. */
function mix(hex: string, fondo: string, a: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [c, f] = [rgb(hex), rgb(fondo)];
  return '#' + c.map((v, i) => Math.round(f[i]! + (v - f[i]!) * a).toString(16).padStart(2, '0')).join('');
}

function toData(graph: PublicGraph): { nodes: N3[]; links: L3[] } {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      degree: degree.get(n.id) ?? 0,
      categoria: typeof n.props['categoria'] === 'string' ? n.props['categoria'] : undefined,
      activo: n.tipo === 'proyecto' && n.props['estado'] === 'activo',
    })),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, type: e.type, destacado: e.props['destacado'] === true })),
  };
}

/** Sobrepasa un poco y vuelve: los nodos "rebotan" al encenderse. */
function easeOutBack(k: number): number {
  const c = 1.6;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

/** Ángulo determinista en [0, 2π) a partir de un texto (hash FNV-1a). */
function angulo(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193);
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

/**
 * Fuerza a medida: si dos proyectos quedan a menos de `min` unidades, se
 * empujan en direcciones opuestas. Solo entre proyectos (son pocos).
 */
function separarProyectos(min: number) {
  let proyectos: N3[] = [];
  const fuerza = (alpha: number) => {
    for (let i = 0; i < proyectos.length; i++) {
      for (let j = i + 1; j < proyectos.length; j++) {
        const a = proyectos[i]!;
        const b = proyectos[j]!;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const dz = (b.z ?? 0) - (a.z ?? 0);
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d >= min) continue;
        const k = ((min - d) / d) * alpha * 0.5;
        a.vx = (a.vx ?? 0) - dx * k;
        a.vy = (a.vy ?? 0) - dy * k;
        a.vz = (a.vz ?? 0) - dz * k;
        b.vx = (b.vx ?? 0) + dx * k;
        b.vy = (b.vy ?? 0) + dy * k;
        b.vz = (b.vz ?? 0) + dz * k;
      }
    }
  };
  fuerza.initialize = (nodes: N3[]) => (proyectos = nodes.filter((n) => n.tipo === 'proyecto'));
  return fuerza;
}

/** Atrae al nodo más conectado hacia el origen: es el centro de la composición. */
function anclarCentro() {
  let centro: N3 | undefined;
  const fuerza = (alpha: number) => {
    if (!centro) return;
    centro.vx = (centro.vx ?? 0) - (centro.x ?? 0) * alpha * 0.3;
    centro.vy = (centro.vy ?? 0) - (centro.y ?? 0) * alpha * 0.3;
    centro.vz = (centro.vz ?? 0) - (centro.z ?? 0) * alpha * 0.3;
  };
  fuerza.initialize = (nodes: N3[]) => (centro = [...nodes].sort((a, b) => b.degree - a.degree)[0]);
  return fuerza;
}
