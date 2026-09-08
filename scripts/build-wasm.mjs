import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const bin = join(homedir(), '.cargo/bin');
const run = (name, args) => {
  const executable = existsSync(join(bin, name)) ? join(bin, name) : name;
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
mkdirSync('packages/rtf-viewer/.wasm', { recursive: true });
run('cargo', ['build', '--locked', '-p', 'rtf-parser', '--release', '--target', 'wasm32-unknown-unknown']);
run('wasm-bindgen', ['target/wasm32-unknown-unknown/release/rtf_parser.wasm', '--target', 'web', '--out-dir', 'packages/rtf-viewer/.wasm', '--out-name', 'rtf_parser']);
