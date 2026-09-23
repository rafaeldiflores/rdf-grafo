/**
 * Acceso al vault privado (repo rdf-vault) vía la API de contenidos de GitHub.
 *
 * Seguridad por construcción: solo se puede LEER y ESCRIBIR lo que las listas
 * blancas permiten, verificado aquí mismo (no en quien llama). El token de
 * GitHub, además, solo tiene "Contents" sobre rdf-vault.
 */

/** Rutas legibles: CVs, BASE, encabezado, instrucciones y postulaciones. Nada más del vault (p. ej. Bitácoras). */
const LECTURA = [/^cv\/BASE_Experiencia\.md$/, /^cv\/encabezado\.md$/, /^cv\/instrucciones\.md$/, /^cv\/base\/[^/]+\.md$/, /^postulaciones\/[^/]+\.md$/];
/** Rutas escribibles: notas de postulación y CVs generados. La BASE y los CVs base, nunca. */
const ESCRITURA = [/^postulaciones\/[^/]+\.md$/, /^cv\/generados\/[^/]+\.(md|pdf)$/];
/** Carpetas listables. */
const LISTABLES = new Set(['cv/base', 'postulaciones']);

const segura = (ruta: string) => !ruta.includes('..') && !ruta.startsWith('/') && !ruta.includes('\\');
export const puedeLeer = (ruta: string) => segura(ruta) && LECTURA.some((re) => re.test(ruta));
export const puedeEscribir = (ruta: string) => segura(ruta) && ESCRITURA.some((re) => re.test(ruta));

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(texto: string): Uint8Array {
    const s = atob(texto.replace(/\n/g, ''));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};
export { b64 };

export class Vault {
  constructor(
    private readonly token: string,
    private readonly repo: string,
    private readonly rama = 'main',
    // Envoltura, no `fetch` directo: llamado como this.http() recibiría this = Vault y Workers lo rechaza ("Illegal invocation").
    private readonly http: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    return this.http(`https://api.github.com/repos/${this.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${init.method ? '' : `?ref=${this.rama}`}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'rdf-grafo-postulador',
        'x-github-api-version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });
  }

  async leer(ruta: string): Promise<string | null> {
    if (!puedeLeer(ruta)) throw new Error(`Lectura no permitida: ${ruta}`);
    const r = await this.api(ruta);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status} al leer ${ruta}`);
    const { content } = (await r.json()) as { content: string };
    return new TextDecoder().decode(b64.decode(content));
  }

  async listar(carpeta: string): Promise<string[]> {
    if (!LISTABLES.has(carpeta)) throw new Error(`Listado no permitido: ${carpeta}`);
    const r = await this.api(carpeta);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`GitHub ${r.status} al listar ${carpeta}`);
    return ((await r.json()) as { name: string; type: string }[]).filter((f) => f.type === 'file' && f.name.endsWith('.md')).map((f) => f.name);
  }

  /** Crea o reemplaza un archivo con un commit. Devuelve si ya existía. */
  async escribir(ruta: string, contenido: string | Uint8Array, mensaje: string): Promise<{ existia: boolean }> {
    if (!puedeEscribir(ruta)) throw new Error(`Escritura no permitida: ${ruta}`);
    const previo = await this.api(ruta);
    const sha = previo.ok ? ((await previo.json()) as { sha: string }).sha : undefined;
    const bytes = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
    const r = await this.api(ruta, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: mensaje, content: b64.encode(bytes), branch: this.rama, ...(sha ? { sha } : {}) }),
    });
    if (!r.ok) throw new Error(`GitHub ${r.status} al escribir ${ruta}`);
    return { existia: Boolean(sha) };
  }
}
