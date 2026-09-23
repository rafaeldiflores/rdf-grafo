/**
 * Geometría de la hoja y medición del render, compartida por el PDF local
 * (playwright-core + Chrome) y el remoto (Cloudflare Browser Run).
 */

const cm = (x: number) => (x / 2.54) * 96; // cm → px CSS (96 dpi)

/** Ancho imprimible en px: el viewport debe medir esto para que el texto se corte igual que en el PDF. */
export const anchoUtil = (papel: 'Letter' | 'A4') => Math.round(cm((papel === 'A4' ? 21 : 21.59) - 2 * 1.27));
/** Alto imprimible de una página en px. */
export const altoUtil = (papel: 'Letter' | 'A4') => cm((papel === 'A4' ? 29.7 : 27.94) - 2 * 1.27);
/** Una línea de 10 pt con interlineado 1,2, en px. */
export const LINEA = (10 * 1.2 * 96) / 72;

/** Se evalúa DENTRO de la página: alto del contenido y del Resumen, en px. */
export function medirEnPagina(): { contenido: number; resumen: number } {
  const ps = document.querySelectorAll('section:first-of-type p');
  const resumen = [...ps].reduce((h, el) => h + el.getBoundingClientRect().height, 0);
  return { contenido: document.body.scrollHeight, resumen };
}

/** Cuenta páginas en el PDF (objetos /Type /Page, no /Pages). */
export function contarPaginas(pdf: Uint8Array): number {
  let s = '';
  for (let i = 0; i < pdf.length; i += 0x8000) s += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  return (s.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

export interface Medicion {
  paginas: number;
  /** Positivo = sobran líneas; negativo = quedan libres. */
  lineasDeMas: number;
  lineasResumen: number;
}

export function medicion(pdf: Uint8Array, medida: { contenido: number; resumen: number }, papel: 'Letter' | 'A4'): Medicion {
  return {
    paginas: contarPaginas(pdf),
    lineasDeMas: Math.round(((medida.contenido - altoUtil(papel)) / LINEA) * 10) / 10,
    lineasResumen: Math.round(medida.resumen / LINEA),
  };
}
