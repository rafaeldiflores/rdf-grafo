/**
 * Instrucciones de redacción del Postulador, editables por Rafa en el vault
 * (`cv/instrucciones.md`) sin tocar código ni republicar el artefacto.
 *
 * Solo guían a Claude al redactar: las reglas duras (título, fechas, vetos,
 * secciones, 1 página) las sigue imponiendo lint.ts, así que una edición
 * desafortunada de la nota no puede producir un CV inválido.
 */
export const RUTA_INSTRUCCIONES = 'cv/instrucciones.md';

/**
 * Cuerpo de la nota listo para el prompt: sin frontmatter ni comentarios HTML
 * (ahí van las explicaciones para Rafa). null si no hay nota o queda vacía,
 * y entonces el artefacto usa sus reglas incluidas.
 */
export function extraerInstrucciones(raw: string | null): string | null {
  if (!raw) return null;
  const cuerpo = raw
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  return cuerpo || null;
}
