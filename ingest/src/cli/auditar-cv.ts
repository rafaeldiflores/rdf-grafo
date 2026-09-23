/**
 * npm run auditar-cv [-- --vault <ruta>] [--config <archivo>]
 *
 * ¿Siguen al día la BASE y los CVs base con los proyectos, sus stacks y sus
 * repos? Solo lee y reporta (sale con 1 si hay hallazgos de prioridad alta).
 * Local, nunca en CI: el reporte nombra proyectos y archivos privados.
 */
import { parseArgs } from 'node:util';
import { auditarVault } from '../auditar-vault.ts';
import { loadEnv, resolveVaultPath } from '../config.ts';
import { CONFIG_PROPAGACION } from '../repos.ts';

loadEnv();
const { values } = parseArgs({ options: { vault: { type: 'string' }, config: { type: 'string', default: CONFIG_PROPAGACION } } });
const { hallazgos, texto } = auditarVault(resolveVaultPath(values.vault), values.config);
console.log(texto);
process.exit(hallazgos.some((h) => h.severidad === 'alta') ? 1 : 0);
