/**
 * HTML → PDF con el Chrome instalado (playwright-core, sin descargar navegadores).
 * El PDF de Chrome tiene texto seleccionable, que es lo que leen los ATS.
 * La geometría y la medición son las mismas del Worker remoto (medir.ts).
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { anchoUtil, contarPaginas, medicion, medirEnPagina, type Medicion } from './medir.ts';

export { contarPaginas };

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

export interface PdfResult extends Medicion {
  pdf: Buffer;
}

export async function htmlAPdf(html: string, papel: 'Letter' | 'A4'): Promise<PdfResult> {
  const browser = await chromium.launch({ executablePath: chromePath() });
  try {
    const page = await browser.newPage({ viewport: { width: anchoUtil(papel), height: 1000 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    const medida = await page.evaluate(medirEnPagina);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return { pdf, ...medicion(pdf, medida, papel) };
  } finally {
    await browser.close();
  }
}
