import { resolveConfigPath } from './settings.js';
import { start } from './runtime.js';

// Config path precedence: argv, then HASTE_CONFIG, then ./config.js. An empty
// HASTE_CONFIG means "no file layer": pure-environment deployments (container
// orchestrators that inject every value) do not need a file at all.
const configPath = resolveConfigPath(process.argv[2]);

await start(configPath ?? undefined);
