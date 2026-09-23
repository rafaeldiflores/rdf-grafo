/**
 * HTML → PDF con el Chrome instalado (playwright-core, sin descargar navegadores).
 * El PDF de Chrome tiene texto seleccionable, que es lo que leen los ATS.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => Boolean(p));

export function chromePath(): string {
  const p = CANDIDATOS.find((c) => existsSync(c));
  if (!p) throw new Error('No encontré Chrome. Define CHROME_PATH con la ruta de chrome.exe.');
  return p;
}

export interface PdfResult {
  pdf: Buffer;
  paginas: number;
  /** Alto del contenido vs. el alto útil de una página, en líneas de 10 pt (negativo = sobra espacio). */
  lineasDeMas: number;
  /** Líneas que ocupa el párrafo del Resumen en el render (la regla pide máximo 4). */
  lineasResumen: number;
}

/** Cuenta páginas en el PDF (objetos /Type /Page, no /Pages). */
export const contarPaginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

export async function htmlAPdf(html: string, papel: 'Letter' | 'A4'): Promise<PdfResult> {
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    // El ancho del viewport = ancho imprimible, para que el texto se corte igual que en el PDF.
    const cm = (x: number) => (x / 2.54) * 96;
    const ancho = cm((papel === 'A4' ? 21 : 21.59) - 2 * 1.27);
    const page = await browser.newPage({ viewport: { width: Math.round(ancho), height: 1000 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    // Alto útil de la página en px CSS (96 dpi) menos los márgenes de 1,27 cm.
    const altoPagina = cm((papel === 'A4' ? 29.7 : 27.94) - 2 * 1.27);
    const altoContenido = await page.evaluate(() => document.body.scrollHeight);
    const linea = (10 * 1.2 * 96) / 72; // una línea de 10 pt con interlineado 1,2, en px
    const altoResumen = await page.evaluate(() => {
      const ps = document.querySelectorAll('section:first-of-type p');
      return [...ps].reduce((h, el) => h + el.getBoundingClientRect().height, 0);
    });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return { pdf, paginas: contarPaginas(pdf), lineasDeMas: Math.round(((altoContenido - altoPagina) / linea) * 10) / 10, lineasResumen: Math.round(altoResumen / linea) };
  } finally {
    await browser.close();
  }
}
