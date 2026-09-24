/**
 * Edición de notas del vault por texto, no por reescritura de YAML: cada
 * función toca solo la línea que le corresponde y preserva el resto exacto
 * (formato, comentarios, orden de campos). Funciones puras (sin fs) para
 * poder testearlas con strings.
 */

/** Agrega `link` a un array inline `campo: [...]` si no está ya. `ok: false` si no encontró el campo. */
export function agregarAlArray(texto: string, campo: string, link: string): { texto: string; ok: boolean } {
  const re = new RegExp(`^${campo}:\\s*\\[(.*)\\]\\s*$`, 'm');
  const m = texto.match(re);
  if (!m) return { texto, ok: false };
  if (m[1]!.split(',').map((s) => s.trim()).includes(link)) return { texto, ok: true };
  const nuevo = m[1]!.trim() ? `${m[1]}, ${link}` : link;
  return { texto: texto.replace(re, `${campo}: [${nuevo}]`), ok: true };
}

/** Agrega alias nuevos (sin duplicar) a la nota de una tecnología existente. */
export function agregarAliases(texto: string, nuevos: readonly string[]): string {
  if (!nuevos.length) return texto;
  const re = /^aliases:\s*\[(.*)\]\s*$/m;
  const m = texto.match(re);
  if (m) {
    const existentes = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    const todos = [...new Set([...existentes, ...nuevos])];
    return texto.replace(re, `aliases: [${todos.join(', ')}]`);
  }
  // Sin `aliases:` todavía: se agrega justo después de `nivel:`.
  if (/^nivel:.*$/m.test(texto)) return texto.replace(/^nivel:.*$/m, (l) => `${l}\naliases: [${nuevos.join(', ')}]`);
  return texto;
}

/** Contenido de una nota nueva de tecnología (mismo formato mínimo que las existentes). */
export function notaTecnologia(nombre: string, categoria: string, aliases: readonly string[]): string {
  const aliasLine = aliases.length ? `\naliases: [${aliases.join(', ')}]` : '';
  return `---\ntipo: tecnologia\ncategoria: ${categoria}\nnivel:${aliasLine}\n---\n# ${nombre}\n`;
}
