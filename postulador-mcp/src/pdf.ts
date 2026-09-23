/**
 * HTML → PDF con Cloudflare Browser Run (Chrome en la nube). Misma geometría y
 * medición que el generador local (app/cv/src/medir.ts), así que "1 página" y
 * "líneas del Resumen" significan exactamente lo mismo en ambos lados.
 */
import puppeteer from '@cloudflare/puppeteer';
import { anchoUtil, medicion, medirEnPagina, type Medicion } from '../../cv/src/medir.ts';

export interface PdfNube extends Medicion {
  pdf: Uint8Array;
}

/** El binding del navegador tal como lo espera @cloudflare/puppeteer. */
export type BrowserBinding = Parameters<typeof puppeteer.launch>[0];

export async function htmlAPdf(browserBinding: BrowserBinding, html: string, papel: 'Letter' | 'A4'): Promise<PdfNube> {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: anchoUtil(papel), height: 1000 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMediaType('print');
    const medida = await page.evaluate(medirEnPagina);
    const pdf = new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    return { pdf, ...medicion(pdf, medida, papel) };
  } finally {
    await browser.close();
  }
}
