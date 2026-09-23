# Postulador — MCP remoto

Servidor MCP en un Cloudflare Worker para adaptar CVs y llevar el Tracker de
postulaciones desde claude.ai (web, escritorio, celular) y desde el artefacto
"Postulador". Es la versión remota de las herramientas `cv_*` / `postulacion*`
del MCP local (`app/mcp`) y reutiliza el mismo código de `app/cv`
(verificador, plantilla, medición de páginas), así que un CV "de 1 página" lo
es en ambos lados.

```
claude.ai ──OAuth 2.1──▶ Worker (este repo) ──Contents API──▶ rdf-vault (privado)
                              └──Browser Run──▶ HTML → PDF
```

## Herramientas

| Herramienta | Qué hace | Escribe |
|---|---|---|
| `cv_contexto` | BASE de experiencia, CVs base por perfil y reglas | No |
| `cv_validar` | Verificador + render + medición; devuelve HTML de vista previa | No |
| `cv_generar_pdf` | PDF solo si pasa las reglas y cabe en 1 página; guarda `.md` + `.pdf` en `cv/generados/` | Sí (commit) |
| `postulaciones_listar` | Frontmatter de `postulaciones/*.md` | No |
| `postulacion_guardar` | Crea/actualiza "Empresa - Cargo" (siempre privada) | Sí (commit) |

## Seguridad

El Worker es público en internet, así que cada capa asume que la anterior puede fallar:

1. **Login**: OAuth 2.1 (`@cloudflare/workers-oauth-provider`) con GitHub. Solo
   el id numérico `ALLOWED_GITHUB_ID` recibe token; cualquier otra cuenta ve
   "Acceso denegado". El token de GitHub del login no se guarda.
2. **Cada llamada** vuelve a comprobar la identidad (`autorizado()` en `index.ts`).
3. **Listas blancas de rutas** (`vault.ts`), aplicadas antes de tocar GitHub:
   - lee solo `cv/BASE_Experiencia.md`, `cv/encabezado.md`, `cv/base/*.md`, `postulaciones/*.md`;
   - escribe solo `postulaciones/*.md` y `cv/generados/*.{md,pdf}`;
   - la BASE, los CVs base y el resto del vault (proyectos, personas, Bitácoras) son inalcanzables.
4. **Token del vault** fine-grained: solo `rdf-vault`, permiso *Contents*.
5. **Sin borrados**: no existe herramienta que borre; cada escritura es un commit
   `postulador: …` que se revierte con git.
6. **Logs** sin contenido: no se registran entradas ni salidas de herramientas.

`test/seguridad.test.ts` cubre estas reglas (rutas con `..`, escrituras en la
BASE, identidad, CVs que rompen reglas). Si falla, no se despliega.

## Puesta en marcha (una vez)

```bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV     # copia el id a wrangler.jsonc
```

1. **GitHub OAuth App** (Settings → Developer settings → OAuth Apps):
   Homepage `https://postulador-mcp.<cuenta>.workers.dev`,
   callback `https://postulador-mcp.<cuenta>.workers.dev/callback`.
2. **Token fine-grained**: solo el repo `rdf-vault`, *Contents: Read and write*.
3. **Secretos** (se pegan en la terminal, nunca en el chat ni en archivos versionados):
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put COOKIE_ENCRYPTION_KEY   # openssl rand -hex 32
   npx wrangler secret put VAULT_TOKEN
   ```
4. `npm test && npx wrangler deploy`
5. claude.ai → Configuración → Conectores → *Agregar conector personalizado* →
   `https://postulador-mcp.<cuenta>.workers.dev/mcp`.

## Desarrollo

```bash
npm test            # reglas de seguridad y flujos (GitHub y PDF simulados)
npm run type-check
npx wrangler dev    # local en :8788, secretos en .dev.vars (ignorado por git)
```

Límites del plan gratuito de Browser Run: 10 min/día de navegador, 3
concurrentes; un PDF toma unos segundos.
