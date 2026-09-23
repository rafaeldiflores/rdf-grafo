import { expect } from 'vitest';
import { b64 } from '../src/vault.ts';

/** GitHub falso en memoria: registra cada request para verificar qué se intentó. */
export function githubFalso(archivos: Record<string, string>) {
  const log: { metodo: string; ruta: string; body?: { message: string; content: string; sha?: string } }[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const ruta = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''));
    const metodo = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer TOKEN');
    if (u.pathname === '/graphql') {
      // Árbol de una carpeta con el texto COMPLETO de cada nota, como lo devuelve GitHub.
      const carpeta = String(body.variables.expr).replace(/^main:/, '');
      log.push({ metodo, ruta: `graphql:${carpeta}` });
      const entries = Object.keys(archivos)
        .filter((k) => k.startsWith(carpeta + '/') && !k.slice(carpeta.length + 1).includes('/'))
        .map((k) => ({ name: k.split('/').pop(), type: 'blob', object: { text: archivos[k] } }));
      return Response.json({ data: { repository: { object: entries.length ? { entries } : null } } });
    }
    log.push({ metodo, ruta, body });
    if (metodo === 'PUT') {
      archivos[ruta] = new TextDecoder().decode(b64.decode(body.content));
      return new Response('{}', { status: 201 });
    }
    const hijos = Object.keys(archivos).filter((k) => k.startsWith(ruta + '/') && !k.slice(ruta.length + 1).includes('/'));
    if (hijos.length) return Response.json(hijos.map((k) => ({ name: k.split('/').pop(), type: 'file' })));
    if (!(ruta in archivos)) return new Response('{}', { status: 404 });
    return Response.json({ sha: 'sha-' + ruta, content: b64.encode(new TextEncoder().encode(archivos[ruta])) });
  }) as typeof fetch;
  return { http, log, archivos };
}
