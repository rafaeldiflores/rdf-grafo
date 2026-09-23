# rdf-grafo

> **RDF** son mis iniciales (Rafael Díaz Flores) y también el estándar W3C para
> describir knowledge graphs. Este repo es el segundo sentido aplicado al primero:
> un grafo de todo lo que he construido.

Knowledge graph de mis proyectos, tecnologías, aprendizajes y clientes,
generado desde una bóveda de Obsidian (privada) y publicado como sitio.
Además de mostrarse, sirve para **propagar cambios**: cuando un proyecto adopta
una tecnología, `impacto` dice qué portafolio, sitio o CV hay que actualizar.

```
vault (Obsidian, privado) ──build-graph──▶ graph.json ──▶ Neo4j AuraDB ──▶ MCP (Claude Code)
                                  └──--public──▶ graph.public.json ──▶ web (Angular + Cytoscape)
```

## `ingest/`

TypeScript/Node. Lee las notas markdown, convierte los `[[links]]` del
frontmatter en aristas y exporta el grafo.

```bash
cd ingest
npm install
npm run build-graph              # grafo completo → out/graph.json (privado, no se commitea)
npm run build-graph -- --public  # solo lo público → out/graph.public.json
npm run impacto -- MAZA          # qué hay que revisar cuando cambia un nodo
npm run sync-neo4j               # MERGE idempotente en Neo4j (credenciales en .env)
npm test
```

La ruta al vault se toma de `--vault`, de `VAULT_PATH` o de `../vault`.

### Mapeo frontmatter → grafo

| Campo           | Relación          |
|-----------------|-------------------|
| `stack`         | `USA`             |
| `parte_de`      | `PARTE_DE`        |
| `cliente`       | `PARA_CLIENTE`    |
| `relacionado`   | `RELACIONADO_CON` |
| `cubre`         | `CUBRE`           |
| `plataforma`    | `EN_PLATAFORMA`   |
| `equipo`        | `CON_EQUIPO`      |
| `muestra`       | `MUESTRA`         |

`stack_destacado` marca `destacado: true` en las aristas `USA` curadas.
Un link a una nota inexistente crea un nodo `pendiente`.

## `web/`

Angular 22 + Cytoscape.js sobre el `graph.json` público: colores por tipo,
filtros, búsqueda, panel de detalle, tema claro/oscuro, responsive y enlaces
directos a un nodo (`/#MAZA`). Ver [`web/README.md`](web/README.md).

## `mcp/` y `tools/`

- [`mcp/`](mcp/README.md): servidor MCP de solo lectura sobre Neo4j (`proyectos_que_usan`, `vecinos`, `resumen_proyecto`, `impacto`).
- [`tools/`](tools/README.md): hooks de Claude Code que cargan la nota del proyecto al iniciar y registran los commits en su Bitácora al cerrar.

### Exportación pública (fail-closed)

- Solo nodos con `visibilidad: publico`, más las tecnologías conectadas a ellos.
- Una arista sale solo si sus dos extremos salen.
- Propiedades por lista blanca; el cuerpo sale sin la sección `## Bitácora` y
  con los links a notas privadas redactados.
- Cubierto por tests de casos borde y por invariantes sobre 300 grafos aleatorios.

## `cv/`, `postulador-mcp/` y `postulador/`

Sistema de postulaciones sobre el mismo vault privado:

- [`cv/`](cv/README.md): CV ATS de 1 página, Markdown → HTML → PDF, con un
  verificador de reglas (secciones estándar, título literal, fechas fijas, textos
  vetados) y medición real de páginas.
- [`postulador-mcp/`](postulador-mcp/README.md): servidor MCP remoto (Cloudflare
  Worker) con OAuth de GitHub para un único usuario, listas blancas de rutas y PDF
  con Browser Run. Lo usa claude.ai como conector.
- `postulador/`: página (artefacto de Claude) que adapta un CV base a una oferta,
  lo valida, genera el PDF y registra la postulación en el Tracker.

```
claude.ai / artefacto ──OAuth──▶ Worker ──Contents API──▶ vault (cv/, postulaciones/)
                                   └──Browser Run──▶ PDF
```
