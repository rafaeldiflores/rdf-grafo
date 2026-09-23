import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { bodyToHtml, neighborGroups } from '../graph-utils';
import { PROP_LABELS, TIPOS, type GraphNode, type PublicGraph } from '../graph.model';

/** Panel con el detalle del nodo seleccionado: datos, descripción y conexiones. */
@Component({
  selector: 'app-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-panel.html',
  styleUrl: './detail-panel.scss',
  host: { '(keydown.escape)': 'close.emit()' },
})
export class DetailPanel {
  readonly graph = input.required<PublicGraph>();
  readonly node = input.required<GraphNode>();
  readonly select = output<string>();
  readonly close = output<void>();

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly tipoLabel = computed(() => {
    const label = TIPOS.find((t) => t.id === this.node().tipo)?.label ?? this.node().tipo;
    return label;
  });

  protected readonly props = computed(() =>
    Object.entries(PROP_LABELS)
      .map(([key, label]) => ({ key, label, value: this.node().props[key] }))
      .filter((p) => p.value !== undefined && p.value !== ''),
  );

  protected readonly groups = computed(() => neighborGroups(this.graph(), this.node().id));

  /**
   * El HTML ya viene saneado por DOMPurify (bodyToHtml). Se marca como
   * confiable solo para conservar los `data-node` de los enlaces internos,
   * que el sanitizador de Angular eliminaría.
   */
  protected readonly bodyHtml = computed(() => {
    const ids = new Set(this.graph().nodes.map((n) => n.id));
    const html = bodyToHtml(this.node().body, ids);
    return html.trim() ? this.sanitizer.bypassSecurityTrustHtml(html) : null;
  });

  protected isUrl(value: unknown): value is string {
    return typeof value === 'string' && /^https?:\/\//.test(value);
  }

  protected display(value: unknown): string {
    const s = Array.isArray(value) ? value.join(', ') : String(value);
    return s.replaceAll('_', ' ');
  }

  /** Delegación de clics para los enlaces `[[nota]]` dentro de la descripción. */
  protected onBodyClick(event: MouseEvent): void {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-node]');
    if (!link) return;
    event.preventDefault();
    this.select.emit(link.dataset['node']!);
  }
}
