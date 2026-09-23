/**
 * Reglas de la BASE y del estándar ATS que se verifican antes de generar el PDF.
 * Errores = no se genera (salvo --forzar). Avisos = se genera, pero revisa.
 */
import type { Cv, Encabezado } from './parse.ts';

export interface Hallazgo {
  nivel: 'error' | 'aviso';
  regla: string;
  detalle: string;
}

/**
 * Encabezados ancla que los parsers ATS (Buk, Workday, Greenhouse…) reconocen,
 * en este orden. Títulos estándar y literales: un título creativo o con el área
 * pegada ("EXPERIENCIA / PROYECTOS EN …") arriesga que el parser no clasifique la
 * sección; el área de la oferta ya va en el subtítulo.
 */
export const SECCIONES = ['RESUMEN PROFESIONAL', 'HABILIDADES TÉCNICAS', 'EXPERIENCIA PROFESIONAL', 'EDUCACIÓN Y CERTIFICACIONES'];

const MES = '(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)';
/** "Cargo | Empresa (Mes Año – Mes Año|Presente)" en una sola línea. */
const ENTRADA = new RegExp(`^.+ \\| .+ \\(${MES} \\d{4} [–-] (${MES} \\d{4}|Presente)\\)$`);

/** Textos que nunca deben llegar a un CV enviado (reglas de la BASE). */
const PROHIBIDOS: [RegExp, string][] = [
  [/ESTIMAD[AO]/i, 'Una métrica ESTIMADA no se imprime: se omite el número'],
  [/confirmad[oa] vigente|verificad[oa] (internamente|al \d)/i, 'Las certificaciones en curso se citan sin fecha de verificación'],
  [/\[\[|\]\]/, 'Queda un marcador [[…]] sin reemplazar'],
  [/\bC1\b/, 'Nunca mencionar C1: el inglés es B2'],
];

export function lintCv(cv: Cv, enc: Encabezado): Hallazgo[] {
  const out: Hallazgo[] = [];
  const titulos = cv.secciones.map((s) => s.titulo);

  // 1. Exactamente las 4 anclas, en orden.
  if (titulos.length !== SECCIONES.length || !SECCIONES.every((t, i) => titulos[i] === t)) {
    out.push({
      nivel: 'error',
      regla: 'anclas-ats',
      detalle: `Secciones esperadas: ${SECCIONES.join(', ')}. Hay: ${titulos.join(' · ')}`,
    });
  }

  // 2. Entradas de experiencia y educación en una línea con mes y año.
  for (const s of cv.secciones.slice(2)) {
    for (const e of s.entradas) {
      if (!ENTRADA.test(e.titulo)) {
        out.push({ nivel: 'error', regla: 'entrada-una-linea', detalle: `"${e.titulo}": debe ser "Cargo | Empresa (Mes Año – Mes Año)"` });
      }
    }
  }

  // 3. Fechas fijas (p. ej. MAZA siempre "May 2024").
  for (const s of cv.secciones) {
    for (const e of s.entradas) {
      for (const [clave, inicio] of Object.entries(enc.fechas_fijas)) {
        if (e.titulo.includes(clave) && !e.titulo.includes(`(${inicio} `)) {
          out.push({ nivel: 'error', regla: 'fecha-fija', detalle: `${clave} empieza en "${inicio}": ${e.titulo}` });
        }
      }
    }
  }

  // 4. Textos prohibidos en cualquier parte.
  const todo = [cv.titulo, ...cv.secciones.flatMap((s) => [s.titulo, ...s.parrafos, ...s.vinetas, ...s.entradas.flatMap((e) => [e.titulo, ...e.vinetas])])].join('\n');
  for (const [re, detalle] of PROHIBIDOS) {
    const m = re.exec(todo);
    if (m) out.push({ nivel: 'error', regla: 'texto-prohibido', detalle: `${detalle} (encontrado: "${m[0]}")` });
  }

  // 4b. Textos vetados por Rafa en encabezado.md (nunca_incluir).
  for (const veto of enc.nunca_incluir) {
    if (todo.toLowerCase().includes(veto.toLowerCase())) {
      out.push({ nivel: 'error', regla: 'nunca-incluir', detalle: `"${veto}" nunca va en un CV` });
    }
  }

  // 4c. Título profesional literal: el ATS lo busca tal cual y un reclutador nota "Informático" al instante.
  if (enc.titulo_profesional) {
    if (!cv.titulo.startsWith(`${enc.titulo_profesional} | `)) {
      out.push({ nivel: 'error', regla: 'titulo-profesional', detalle: `El subtítulo debe empezar con "${enc.titulo_profesional} | " (hay: "${cv.titulo}")` });
    }
    const validas = [enc.titulo_profesional, enc.grado].filter((x): x is string => !!x);
    for (const encontrado of variantes(todo, validas)) {
      out.push({ nivel: 'error', regla: 'titulo-profesional', detalle: `Escribe "${validas.join('" o "')}" tal cual (encontrado: "${encontrado}")` });
    }
  }

  // 5. Densidad (avisos): máximo 8 viñetas de experiencia.
  const exp = cv.secciones.find((s) => s.titulo.startsWith('EXPERIENCIA'));
  const vinetasExp = exp?.entradas.reduce((n, e) => n + e.vinetas.length, 0) ?? 0;
  if (vinetasExp > 8) out.push({ nivel: 'aviso', regla: 'densidad', detalle: `${vinetasExp} viñetas de experiencia (máximo recomendado: 8)` });

  return out;
}

/** Quita tildes carácter a carácter, sin cambiar el largo (los índices siguen sirviendo). */
const sinTildes = (s: string) => s.replace(/[^\x00-\x7f]/g, (c) => c.normalize('NFD')[0]!).toLowerCase();

/**
 * Formas deformadas de las frases válidas: mismas raíces, otra terminación o sin
 * tilde ("Ingeniero en Informático", "Ingeniero en Informatica"). Cada raíz es la
 * palabra sin tildes y sin su vocal final, y admite cualquier terminación.
 */
export function variantes(texto: string, validas: string[]): string[] {
  const base = sinTildes(texto);
  const raices = new Set(validas.map((v) => sinTildes(v).split(/\s+/).map((w) => w.replace(/[aeiou]$/, '') + '\\w*').join('\\s+')));
  const malas = new Set<string>();
  for (const r of raices) {
    for (const m of base.matchAll(new RegExp(`\\b${r}`, 'g'))) {
      const original = texto.slice(m.index, m.index + m[0].length);
      if (!validas.includes(original)) malas.add(original);
    }
  }
  return [...malas];
}
