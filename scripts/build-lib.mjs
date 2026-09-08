import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
const base = 'packages/rtf-viewer';
await rm(`${base}/dist`, { recursive: true, force: true });
await mkdir(`${base}/dist`, { recursive: true });
await build({
  entryPoints: [`${base}/src/index.ts`, `${base}/src/viewer.ts`, `${base}/src/parser.worker.ts`],
  outdir: `${base}/dist`, bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', sourcemap: true, splitting: true, chunkNames: 'shared-[hash]',
  external: ['./rtf_parser.js'],
});
await cp(`${base}/.wasm/rtf_parser.js`, `${base}/dist/rtf_parser.js`);
await cp(`${base}/.wasm/rtf_parser_bg.wasm`, `${base}/dist/rtf_parser_bg.wasm`);
for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']) await cp(name, `${base}/${name}`);
