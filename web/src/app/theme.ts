import { effect, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'rdf-grafo:tema';

/**
 * Tema claro/oscuro. Arranca con la preferencia guardada o la del sistema y
 * lo aplica como `data-theme` en <html>, donde viven los tokens CSS.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.initial());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.dataset['theme'] = t;
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* modo privado o storage bloqueado: el tema solo dura la sesión */
      }
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  private initial(): Theme {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* sin storage: se usa la preferencia del sistema */
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
