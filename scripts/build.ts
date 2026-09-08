import { build, type BuildOptions } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { upstreamSourceAliases } from './upstream-source.ts';

const packageDirectory = 'packages/rtf-viewer';
const outputDirectory = `${packageDirectory}/dist`;

const options = {
  entryPoints: [
    `${packageDirectory}/src/index.ts`,
    `${packageDirectory}/src/viewer.ts`,
    `${packageDirectory}/src/parser.worker.ts`,
  ],
  outdir: outputDirectory,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  metafile: true,
  splitting: true,
  chunkNames: 'shared-[hash]',
  alias: upstreamSourceAliases,
  external: ['./rtf_parser.js'],
} satisfies BuildOptions;

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const result = await build(options);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/build-meta.json', JSON.stringify(result.metafile, null, 2) + '\n');

await Promise.all([
  cp(`${packageDirectory}/.wasm/rtf_parser.js`, `${outputDirectory}/rtf_parser.js`),
  cp(`${packageDirectory}/.wasm/rtf_parser_bg.wasm`, `${outputDirectory}/rtf_parser_bg.wasm`),
  ...['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'].map((name) =>
    cp(name, `${packageDirectory}/${name}`),
  ),
]);
