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

/** Encabezados ancla que los parsers ATS reconocen (en este orden). */
const ANCLAS = [/^RESUMEN PROFESIONAL$/, /^HABILIDADES TÉCNICAS$/, /^EXPERIENCIA \/ PROYECTOS EN .+$/, /^EDUCACIÓN Y CERTIFICACIONES$/];

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
  if (titulos.length !== ANCLAS.length || !ANCLAS.every((re, i) => re.test(titulos[i] ?? ''))) {
    out.push({
      nivel: 'error',
      regla: 'anclas-ats',
      detalle: `Secciones esperadas: RESUMEN PROFESIONAL, HABILIDADES TÉCNICAS, EXPERIENCIA / PROYECTOS EN …, EDUCACIÓN Y CERTIFICACIONES. Hay: ${titulos.join(' · ')}`,
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

  // 5. Densidad (avisos): máximo 8 viñetas de experiencia.
  const exp = cv.secciones.find((s) => s.titulo.startsWith('EXPERIENCIA'));
  const vinetasExp = exp?.entradas.reduce((n, e) => n + e.vinetas.length, 0) ?? 0;
  if (vinetasExp > 8) out.push({ nivel: 'aviso', regla: 'densidad', detalle: `${vinetasExp} viñetas de experiencia (máximo recomendado: 8)` });

  return out;
}
