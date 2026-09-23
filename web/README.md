# web

Visualización del grafo público: Angular 22 (standalone, signals, zoneless) +
Cytoscape.js con layout fcose. Sitio 100 % estático que lee `public/graph.json`.

```bash
npm install
npm run graph   # genera public/graph.json desde el vault (ingest --public)
npm start       # http://localhost:4200 (corre `graph` antes)
npm test
npm run build   # dist/web/browser
```

- Colores por tipo definidos como tokens CSS (`src/styles.scss`); Cytoscape los lee de ahí.
- Filtro por tipo, búsqueda sin tildes, panel de detalle (hoja inferior en celular).
- Tema claro/oscuro según el sistema, con botón para cambiarlo.
- Enlace directo a un nodo: `/#MAZA`.
- Cytoscape se carga en diferido: la carga inicial pesa ~72 KB comprimidos.
