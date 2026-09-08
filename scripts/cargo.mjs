import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const local = join(homedir(), '.cargo/bin/cargo');
const cargo = existsSync(local) ? local : 'cargo';
const result = spawnSync(cargo, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
