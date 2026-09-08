import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pack once: the consumer test and release jobs use this exact archive.
export async function packPackage() {
  const directory = resolve('packages/rtf-viewer');
  const artifacts = resolve('artifacts');
  const pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  assert.equal(pkg.private, undefined, 'The public package must be publishable');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(pkg.repository.url, 'git+https://github.com/rwv/rtf-viewer.git');
  for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']) {
    assert.equal(await readFile(`${directory}/${name}`, 'utf8'), await readFile(name, 'utf8'), `${name} is stale: run pnpm build`);
  }
  await mkdir(artifacts, { recursive: true });
  const packed = spawnSync('pnpm', ['--dir', directory, 'pack', '--json', '--pack-destination', artifacts], { encoding: 'utf8' });
  if (packed.error) throw packed.error;
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout || 'Package packing failed');
  const result = JSON.parse(packed.stdout);
  assert.equal(result.name, pkg.name);
  assert.equal(result.version, pkg.version);
  const paths = new Set(result.files.map(file => file.path));
  for (const path of [
    'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md',
    'dist/index.js', 'dist/index.d.ts', 'dist/viewer.js', 'dist/viewer.d.ts',
    'dist/parser.worker.js', 'dist/rtf_parser.js', 'dist/rtf_parser_bg.wasm', 'dist/generated/model.d.ts',
  ]) assert.ok(paths.has(path), `Missing packaged file: ${path}`);
  for (const path of paths) {
    assert.ok(path.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'].includes(path), `Unexpected packaged file: ${path}`);
    assert.ok(!/\.test\.|node_modules|\.rtf$/.test(path), `Development file leaked into package: ${path}`);
  }
  const filename = basename(result.filename);
  const archive = resolve(artifacts, filename);
  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = { name: pkg.name, version: pkg.version, filename, sha256, bytes: bytes.length, files: [...paths].sort() };
  await writeFile(`${artifacts}/package-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(`${artifacts}/SHA256SUMS`, `${sha256}  ${filename}\n`);
  return { ...manifest, archive };
}

export async function verifiedPackage() {
  const manifest = JSON.parse(await readFile('artifacts/package-manifest.json', 'utf8'));
  const report = JSON.parse(await readFile('artifacts/package-verification.json', 'utf8'));
  assert.match(manifest.filename, /^[a-z0-9][a-z0-9._-]*\.tgz$/);
  const archive = resolve('artifacts', manifest.filename);
  const bytes = await readFile(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(report.sha256, manifest.sha256, 'Archive must be the exact consumer-tested bytes');
  assert.equal(report.version, manifest.version);
  assert.equal(report.package, manifest.name);
  assert.equal(report.result.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(await readFile('artifacts/SHA256SUMS', 'utf8'), `${manifest.sha256}  ${manifest.filename}\n`);
  return { ...manifest, archive, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await packPackage(), null, 2));
}
