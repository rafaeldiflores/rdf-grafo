/**
 * Brechas frente a una oferta: qué pide y qué puede respaldar Rafa.
 *
 * Reparto de trabajo: Claude lee la oferta y extrae los términos que pide
 * (entender lenguaje); esta función los clasifica contra el grafo sin inferir
 * nada (evidencia). Si además llega el texto de la oferta, se detectan en él las
 * tecnologías conocidas del grafo (nombre o `aliases`), para que no se escape
 * ninguna aunque Claude la omita.
 *
 * Niveles, del más fuerte al más débil:
 *   demostrada  — hay logros de la BASE con DEMUESTRA hacia la tecnología
 *   declarada   — está en el `stack` de algún proyecto, pero ningún logro la nombra
 *   mencionada  — no es nota de tecnología, pero el texto de algún logro la nombra
 *                 (p. ej. "Scrum"): es real, falta crear la nota o un alias
 *   conocida    — hay nota de tecnología, pero sin proyectos ni logros
 *   brecha      — nada en el grafo la respalda
 */
import { tecnologiasEn, type Termino } from './logros.ts';
import { LOGRO_RELATIONS, LOGRO_TIPO, RELATIONS, type Graph, type GraphNode } from './model.ts';

export type Nivel = 'demostrada' | 'declarada' | 'mencionada' | 'conocida' | 'brecha';
export const NIVELES: readonly Nivel[] = ['demostrada', 'declarada', 'mencionada', 'conocida', 'brecha'];

export interface Requisito {
  /** Término tal como lo pide la oferta (o el nombre de la tecnología si se detectó en el texto). */
  termino: string;
  /** Nota de tecnología a la que corresponde, si existe. */
  tecnologia?: string;
  nivel: Nivel;
  /** Logros que la respaldan (DEMUESTRA o, en `mencionada`, texto). */
  logros: string[];
  /** Proyectos cuyo `stack` la declara. */
  proyectos: string[];
  /** Aprendizajes en curso que la cubren (CUBRE). */
  aprendizajes: string[];
  /** true si no la pidió Claude y salió de buscar tecnologías conocidas en el texto de la oferta. */
  detectada: boolean;
}

const plano = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const aliasesDe = (n: GraphNode): string[] => [n.props.aliases ?? []].flat().map(String).filter((s) => s.trim());

export function brechasDe(graph: Graph, pedidos: readonly string[], oferta = ''): Requisito[] {
  const techs = graph.nodes.filter((n) => n.tipo === 'tecnologia');
  const logros = graph.nodes.filter((n) => n.tipo === LOGRO_TIPO);
  const terminos: Termino[] = techs.flatMap((n) => [n.id, ...aliasesDe(n)].map((texto) => ({ tecnologia: n.id, texto })));
  const fuentes = (target: string, type: string) => graph.edges.filter((e) => e.target === target && e.type === type).map((e) => e.source).sort();

  /**
   * Nombre o alias exacto → nota. Si no, se acepta el nombre seguido solo de una
   * versión ("React 19", "Angular 17+", "Python 3.x"), pero no de otra palabra:
   * "React Native" no es React.
   */
  const resolver = (termino: string): string | undefined => {
    const q = plano(termino);
    for (const n of techs) {
      for (const x of [n.id, ...aliasesDe(n)]) {
        const nombre = plano(x);
        if (q === nombre) return n.id;
        if (q.startsWith(nombre) && /^\s+v?[\d.]+[x+]?(\s*\+)?$/.test(q.slice(nombre.length))) return n.id;
      }
    }
    return undefined;
  };

  const clasificar = (termino: string, detectada: boolean): Requisito => {
    const tecnologia = resolver(termino);
    if (tecnologia) {
      const r = { termino, tecnologia, detectada, logros: fuentes(tecnologia, LOGRO_RELATIONS.tecnologia), proyectos: fuentes(tecnologia, RELATIONS.stack), aprendizajes: fuentes(tecnologia, RELATIONS.cubre) };
      return { ...r, nivel: r.logros.length ? 'demostrada' : r.proyectos.length ? 'declarada' : 'conocida' };
    }
    // Sin nota: ¿algún logro lo nombra en su texto? Misma regla de palabra completa que DEMUESTRA.
    const menciones = logros
      .filter((l) => tecnologiasEn([l.props.titulo, l.props.tec, l.props.contexto].filter(Boolean).join('\n'), [{ tecnologia: 'x', texto: termino }]).length)
      .map((l) => l.id)
      .sort();
    return { termino, detectada, logros: menciones, proyectos: [], aprendizajes: [], nivel: menciones.length ? 'mencionada' : 'brecha' };
  };

  const out: Requisito[] = [];
  const vistos = new Set<string>();
  const agregar = (r: Requisito) => {
    const clave = r.tecnologia ?? plano(r.termino);
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);
    out.push(r);
  };
  for (const p of pedidos) if (p.trim()) agregar(clasificar(p.trim(), false));
  for (const t of tecnologiasEn(oferta, terminos)) agregar(clasificar(t, true));

  return out.sort((a, b) => NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel) || b.logros.length - a.logros.length || a.termino.localeCompare(b.termino));
}

const TITULOS: Record<Nivel, string> = {
  demostrada: 'Demostradas con logros (van al CV con evidencia)',
  declarada: 'Declaradas en un proyecto, sin logro que las nombre (respaldo débil)',
  mencionada: 'Mencionadas en logros, sin nota de tecnología (crear nota o alias)',
  conocida: 'Con nota de tecnología, pero sin proyectos ni logros',
  brecha: 'Brechas: nada en el grafo las respalda',
};

export function formatBrechas(reqs: readonly Requisito[]): string {
  if (!reqs.length) return 'No hay requisitos que clasificar: pasa los términos que pide la oferta o su texto.';
  const respaldadas = reqs.filter((r) => r.nivel === 'demostrada' || r.nivel === 'declarada' || r.nivel === 'mencionada').length;
  const lines = [`Cobertura: ${respaldadas} de ${reqs.length} requisitos con respaldo (${Math.round((respaldadas / reqs.length) * 100)}%).`];
  for (const nivel of NIVELES) {
    const xs = reqs.filter((r) => r.nivel === nivel);
    if (!xs.length) continue;
    lines.push('', `## ${TITULOS[nivel]} (${xs.length})`);
    for (const r of xs) {
      const nombre = r.tecnologia && plano(r.tecnologia) !== plano(r.termino) ? `${r.termino} → ${r.tecnologia}` : r.termino;
      const det = [
        r.logros.length && `${r.logros.length} logro(s): ${r.logros.slice(0, 5).join(', ')}${r.logros.length > 5 ? '…' : ''}`,
        r.proyectos.length && `stack de ${r.proyectos.join(', ')}`,
        r.aprendizajes.length && `en estudio: ${r.aprendizajes.join(', ')}`,
        r.detectada && 'detectada en el texto de la oferta',
      ].filter(Boolean);
      lines.push(`- ${nombre}${det.length ? ` — ${det.join(' · ')}` : ''}`);
    }
  }
  return lines.join('\n');
}
