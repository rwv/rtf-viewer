import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const local = join(homedir(), '.cargo/bin/cargo');
const result = spawnSync(existsSync(local) ? local : 'cargo', ['run', '--quiet', '-p', 'rtf-parser', '--example', 'generate_types'], { encoding: 'utf8' });
if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
const path = 'packages/rtf-viewer/src/generated/model.ts';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== result.stdout) throw new Error('Generated model has drifted. Run pnpm generate:types.');
  console.log('Rust/TypeScript contract matches.');
} else writeFileSync(path, result.stdout);
