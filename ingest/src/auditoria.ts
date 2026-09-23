/**
 * Auditoría de frescura del CV: ¿lo que dicen la BASE y los CVs base sigue al
 * día con los proyectos, sus stacks y sus repos?
 *
 * La cadena que vigila: repos → notas del vault (hooks) → BASE (a mano) → CVs
 * base (a mano) → Postulador. Los dos últimos saltos son manuales: esta
 * auditoría los mide y dice qué hacer, sin escribir nada.
 *
 * Funciones puras: reciben el grafo (con logros), los textos y las versiones.
 */
import { nombreDeSeccion, tecnologiasEn, type Termino } from './logros.ts';
import { LOGRO_RELATIONS, LOGRO_TIPO, RELATIONS, type Graph, type GraphNode } from './model.ts';
import { major, type Versions } from './propagate.ts';

export interface RepoInfo {
  /** `version` del package.json del proyecto. */
  version?: string;
  /** Paquetes instalados → versión. */
  paquetes: Versions;
}

export interface EntradaAuditoria {
  graph: Graph;
  /** Texto de cv/BASE_Experiencia.md. */
  base: string;
  /** Perfil → texto de cv/base/<perfil>.md. */
  cvs: Record<string, string>;
  /** Proyecto → info de su repo local (solo los que tienen ruta configurada). */
  repos: Record<string, RepoInfo>;
}

export type Severidad = 'alta' | 'media' | 'baja';
export const SEVERIDADES: readonly Severidad[] = ['alta', 'media', 'baja'];

export interface Hallazgo {
  regla: 'version-proyecto' | 'version-tecnologia' | 'proyecto-sin-logros' | 'tecnologia-sin-base' | 'tecnologia-sin-cv';
  severidad: Severidad;
  detalle: string;
  accion: string;
  /** Archivo(s) y línea, relativos al vault. */
  donde?: string[];
}

const aliasesDe = (n: GraphNode): string[] => [n.props.aliases ?? []].flat().map(String).filter((s) => s.trim());
const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plano = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Líneas de un texto con su número (1-based). */
const lineas = (texto: string) => texto.replaceAll('\r\n', '\n').split('\n').map((t, i) => ({ t, n: i + 1 }));

/**
 * En la BASE, cada línea pertenece al proyecto de su sección `##` (por `Nodo:` o
 * por nombre). Así "Estado: … (v1.18.0)" bajo "## MAZA - …" cuenta como de MAZA
 * aunque la línea no diga MAZA.
 */
function proyectoPorLinea(base: string): Map<number, string> {
  const out = new Map<number, string>();
  let actual = '';
  for (const { t, n } of lineas(base)) {
    const sec = t.match(/^##\s+(.+?)\s*$/);
    if (sec) actual = nombreDeSeccion(sec[1]!);
    const nodo = t.match(/^Nodo:\s*\[\[([^\]|#]+)/i);
    if (nodo) actual = nodo[1]!.trim();
    if (actual) out.set(n, actual);
  }
  return out;
}

export function auditar(e: EntradaAuditoria): Hallazgo[] {
  const h: Hallazgo[] = [];
  const { graph } = e;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const proyectos = graph.nodes.filter((n) => n.tipo === 'proyecto');
  const techs = graph.nodes.filter((n) => n.tipo === 'tecnologia');
  const terminos: Termino[] = techs.flatMap((n) => [n.id, ...aliasesDe(n)].map((texto) => ({ tecnologia: n.id, texto })));
  const textos: [string, string][] = [['cv/BASE_Experiencia.md', e.base], ...Object.entries(e.cvs).map(([p, t]) => [`cv/base/${p}.md`, t] as [string, string])];
  const secciones = proyectoPorLinea(e.base);

  // 1. Versión del proyecto escrita en el texto vs la del repo (p. ej. "(v1.18.0)").
  for (const [proyecto, repo] of Object.entries(e.repos)) {
    if (!repo.version) continue;
    const desfasadas: string[] = [];
    for (const [archivo, texto] of textos) {
      for (const { t, n } of lineas(texto)) {
        const delProyecto = t.includes(proyecto) || (archivo.endsWith('BASE_Experiencia.md') && secciones.get(n) === proyecto);
        if (!delProyecto) continue;
        for (const m of t.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) if (m[1] !== repo.version) desfasadas.push(`${archivo}:${n} (v${m[1]})`);
      }
    }
    if (desfasadas.length) {
      h.push({
        regla: 'version-proyecto',
        severidad: 'alta',
        detalle: `${proyecto} va en v${repo.version} según su repo, pero el texto dice otra versión en ${desfasadas.length} lugar(es)`,
        accion: `Actualizar a v${repo.version} (la cadena canónica y el Resumen de cada CV base)`,
        donde: desfasadas,
      });
    }
  }

  // 2. Versión mayor de una tecnología ("Angular 22") vs la instalada en el repo del proyecto que la usa.
  for (const t of techs) {
    const paquete = typeof t.props.paquete === 'string' ? t.props.paquete : '';
    if (!paquete) continue;
    const usuarios = graph.edges.filter((x) => x.type === RELATIONS.stack && x.target === t.id).map((x) => x.source);
    const instalada = usuarios.map((p) => e.repos[p]?.paquetes[paquete]).find(Boolean);
    if (!instalada) continue;
    const m = major(instalada);
    const nombres = [t.id, ...aliasesDe(t)].sort((a, b) => b.length - a.length);
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${nombres.map((x) => escapar(plano(x))).join('|')})\\s+v?(\\d+)(?![\\d,.]*\\s*%)(?![\\p{L}])`, 'gu');
    const desfasadas: string[] = [];
    for (const [archivo, texto] of textos) {
      for (const { t: linea, n } of lineas(texto)) {
        for (const x of plano(linea).matchAll(re)) if (x[1] !== m) desfasadas.push(`${archivo}:${n} (${x[0].trim()})`);
      }
    }
    if (desfasadas.length) {
      h.push({
        regla: 'version-tecnologia',
        severidad: 'alta',
        detalle: `${t.id} instalada es la ${m} (${paquete} ${instalada}), pero el texto nombra otra versión mayor`,
        accion: `Cambiar a "${t.id.split(' ').pop()} ${m}" donde corresponda`,
        donde: desfasadas,
      });
    }
  }

  // 3. Proyectos sin ningún logro en la BASE: el Postulador no puede mencionarlos.
  for (const p of proyectos) {
    if (graph.edges.some((x) => x.type === LOGRO_RELATIONS.proyecto && x.target === p.id)) continue;
    const idea = p.props.estado === 'idea';
    h.push({
      regla: 'proyecto-sin-logros',
      severidad: idea ? 'baja' : 'media',
      detalle: `${p.id}${p.props.estado ? ` (${p.props.estado})` : ''} no tiene logros en la BASE: ningún CV puede mencionarlo`,
      accion: `Escribir sus logros en la BASE, en una sección "## ${p.id} - …" con "Nodo: [[${p.id}]]"`,
    });
  }

  // 4. Tecnologías del stack de un proyecto que la BASE no nombra en ninguna parte.
  const enBase = new Set(tecnologiasEn(e.base, terminos));
  const sinBase = new Map<string, string[]>();
  for (const x of graph.edges) {
    if (x.type !== RELATIONS.stack || byId.get(x.source)?.tipo !== 'proyecto' || byId.get(x.target)?.tipo !== 'tecnologia') continue;
    if (enBase.has(x.target)) continue;
    sinBase.set(x.source, [...(sinBase.get(x.source) ?? []), x.target].sort());
  }
  for (const [proyecto, ts] of [...sinBase].sort((a, b) => a[0].localeCompare(b[0]))) {
    h.push({
      regla: 'tecnologia-sin-base',
      severidad: 'media',
      detalle: `${proyecto} usa ${ts.join(', ')}, pero la BASE no ${ts.length > 1 ? 'las nombra' : 'la nombra'}: el Postulador no puede ${ts.length > 1 ? 'declararlas' : 'declararla'}`,
      accion: `Si la BASE la nombra con otro nombre, agrega un alias a la nota de tecnología; si la usaste y no está, súmala al "tec:" de un logro de ${proyecto}; si no la usaste, quítala del stack`,
    });
  }

  // 5. Tecnologías demostradas por logros que ningún CV base nombra.
  const demostradas = new Map<string, number>();
  for (const x of graph.edges) {
    if (x.type === LOGRO_RELATIONS.tecnologia && byId.get(x.source)?.tipo === LOGRO_TIPO) demostradas.set(x.target, (demostradas.get(x.target) ?? 0) + 1);
  }
  const enCvs = new Set(tecnologiasEn(Object.values(e.cvs).join('\n'), terminos));
  const fuera = [...demostradas].filter(([t]) => !enCvs.has(t)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (fuera.length) {
    h.push({
      regla: 'tecnologia-sin-cv',
      severidad: 'baja',
      detalle: `Demostradas por logros pero en ningún CV base: ${fuera.map(([t, n]) => `${t} (${n})`).join(', ')}`,
      accion: 'Revisar si algún perfil debería mostrarlas en HABILIDADES o en una viñeta',
    });
  }

  return h.sort((a, b) => SEVERIDADES.indexOf(a.severidad) - SEVERIDADES.indexOf(b.severidad));
}

const ICONO: Record<Severidad, string> = { alta: '✗', media: '⚠', baja: '·' };

export function formatAuditoria(h: readonly Hallazgo[], sinRepos: string[] = []): string {
  const cuenta = SEVERIDADES.map((s) => `${h.filter((x) => x.severidad === s).length} ${s}`).join(' · ');
  const out = [h.length ? `Auditoría del CV: ${cuenta}` : 'Auditoría del CV: todo al día.'];
  for (const s of SEVERIDADES) {
    const xs = h.filter((x) => x.severidad === s);
    if (!xs.length) continue;
    out.push('', `## Prioridad ${s} (${xs.length})`);
    for (const x of xs) {
      out.push(`${ICONO[s]} ${x.detalle}`, `  → ${x.accion}`);
      for (const d of x.donde ?? []) out.push(`    ${d}`);
    }
  }
  if (sinRepos.length) out.push('', `Sin repo local configurado (no se revisan sus versiones): ${sinRepos.join(', ')}. Ver propagacion.local.json.`);
  return out.join('\n');
}
