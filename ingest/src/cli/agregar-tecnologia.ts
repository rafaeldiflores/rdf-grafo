/**
 * npm run agregar-tecnologia -- "Nombre" [--categoria datos] [--alias a,b]
 *   [--proyecto MAZA,MedInfo] [--destacado] [--vault <ruta>]
 *
 * Crea (o completa) una nota en tecnologias/ y la conecta al `stack` (y con
 * --destacado también a `stack_destacado`) de los proyectos indicados. No
 * reescribe YAML: edita solo la línea que corresponde, así el resto de la
 * nota queda exactamente igual.
 *
 * No mete nada en un logro ni en cv/BASE_Experiencia.md: eso sigue siendo
 * responsabilidad de Rafa (o de una sesión con contexto), porque ahí "todo
 * tiene que ser real y defendible en entrevista".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv, resolveVaultPath } from '../config.ts';
import { agregarAlArray, agregarAliases, notaTecnologia } from '../notas.ts';

loadEnv();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    categoria: { type: 'string', default: '' },
    alias: { type: 'string' },
    proyecto: { type: 'string' },
    destacado: { type: 'boolean', default: false },
    vault: { type: 'string' },
  },
});

const nombre = positionals[0];
if (!nombre) {
  console.error('Uso: npm run agregar-tecnologia -- "Nombre" [--categoria datos] [--alias a,b] [--proyecto MAZA,MedInfo] [--destacado]');
  process.exit(1);
}

const vault = resolveVaultPath(values.vault);
const aliases = (values.alias ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const proyectos = (values.proyecto ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const notaPath = resolve(vault, 'tecnologias', `${nombre}.md`);
if (!existsSync(notaPath)) {
  writeFileSync(notaPath, notaTecnologia(nombre, values.categoria!, aliases));
  console.log(`Creada tecnologias/${nombre}.md`);
} else if (aliases.length) {
  writeFileSync(notaPath, agregarAliases(readFileSync(notaPath, 'utf-8'), aliases));
  console.log(`Alias agregados en tecnologias/${nombre}.md`);
} else {
  console.log(`tecnologias/${nombre}.md ya existía (sin cambios; usa --alias para sumar sinónimos)`);
}

for (const proyecto of proyectos) {
  const proyPath = resolve(vault, 'proyectos', `${proyecto}.md`);
  if (!existsSync(proyPath)) {
    console.warn(`  ! No existe proyectos/${proyecto}.md, se omite`);
    continue;
  }
  const link = `"[[${nombre}]]"`;
  let texto = readFileSync(proyPath, 'utf-8');
  const stack = agregarAlArray(texto, 'stack', link);
  if (!stack.ok) {
    console.warn(`  ! proyectos/${proyecto}.md: no encontré "stack:" en el formato esperado, revísalo a mano`);
    continue;
  }
  texto = stack.texto;
  if (values.destacado) {
    const destacado = agregarAlArray(texto, 'stack_destacado', link);
    if (destacado.ok) texto = destacado.texto;
  }
  writeFileSync(proyPath, texto);
  console.log(`  conectado a proyectos/${proyecto}.md (stack${values.destacado ? ' + stack_destacado' : ''})`);
}

console.log('\nRevisa el diff, corre "npm run build-graph" para validar y comitea cuando quede bien.');
