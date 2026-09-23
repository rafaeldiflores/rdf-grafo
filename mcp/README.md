# mcp — el grafo como herramientas para Claude Code

Servidor MCP (stdio) de **solo lectura** sobre Neo4j AuraDB. Registrado a nivel de
usuario, cualquier sesión de Claude Code puede consultar el grafo de proyectos.

| Tool | Qué responde |
|---|---|
| `proyectos_que_usan(tecnologia)` | Proyectos que usan una tecnología (★ si es destacada) |
| `vecinos(nodo, profundidad)` | Nodos conectados por distancia (1–3) y relaciones directas |
| `resumen_proyecto(nombre)` | Datos, relaciones y nota completa (con Bitácora) |
| `impacto(nodo)` | Qué revisar si cambia un nodo, con el camino de cada dependencia |
| `buscar_nodo(texto)` | Nodos cuyo nombre contiene el texto |

```bash
npm install
npm test            # consultas con un runner falso
npm run e2e         # cliente MCP real contra la AuraDB
claude mcp add --scope user grafo -- node "<ruta>/app/mcp/src/server.ts"
```

- **Solo lectura garantizada por Neo4j**: todo corre en transacciones `READ`.
- **Sin credenciales en la config de Claude**: se leen de `app/ingest/.env` (o `GRAFO_ENV`).
- **Sin build**: Node 24 ejecuta TypeScript directo. `impacto` reutiliza la lógica testeada de `ingest`.
- Nombres aproximados: "medinfo", "busqueda de trabajo" o "fireb" resuelven al nodo correcto.
- La base se sincroniza en cada push del vault (paso "Sincronizar Neo4j" del deploy).
