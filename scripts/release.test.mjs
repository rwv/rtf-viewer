import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const releaseScript = resolve('scripts/release-info.mjs');
const packageModule = pathToFileURL(resolve('scripts/package.mjs')).href;

async function repository(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'rtf-release-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  await mkdir(join(cwd, 'packages/rtf-viewer'), { recursive: true });
  await mkdir(join(cwd, 'crates/rtf-parser'), { recursive: true });
  await writeFile(join(cwd, 'packages/rtf-viewer/package.json'), JSON.stringify({ name: 'rtf-viewer', version: '1.0.0' }));
  await writeFile(join(cwd, 'crates/rtf-parser/Cargo.toml'), 'version = "1.0.0"\n');
  await writeFile(join(cwd, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.0] - 2026-09-07\n\nVersion one notes.\n\n## 0.1.0\n\nOlder notes.\n');
  git('add', '.');
  git('commit', '-m', 'Release fixture');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('tag', 'v1.0.0');
  const run = (tag = 'v1.0.0') => spawnSync(process.execPath, [releaseScript], { cwd, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag, GITHUB_REPOSITORY: 'rwv/rtf-viewer', GITHUB_OUTPUT: join(cwd, 'outputs') } });
  return { cwd, git, run };
}

test('release extracts only the dated version section at a tagged main commit', async t => {
  const fixture = await repository(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(fixture.cwd, 'artifacts/release-notes.md'), 'utf8'), 'Version one notes.\n');
  assert.match(await readFile(join(fixture.cwd, 'outputs'), 'utf8'), /dist_tag=latest\n/);
});

test('release refuses a tag that disagrees with the package version', async t => {
  const fixture = await repository(t);
  const result = fixture.run('v1.0.1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Tag must match/);
});

test('release refuses to build HEAD when the version tag points elsewhere', async t => {
  const fixture = await repository(t);
  fixture.git('commit', '--allow-empty', '-m', 'Later commit');
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout must be the tagged commit/);
});

test('release refuses a tagged commit that has not reached main', async t => {
  const fixture = await repository(t);
  fixture.git('switch', '-c', 'unmerged');
  fixture.git('commit', '--allow-empty', '-m', 'Unmerged release');
  fixture.git('tag', '--force', 'v1.0.0');
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /merge-base --is-ancestor/);
});

test('publication rejects altered archive bytes after consumer verification', async t => {
  const fixture = await repository(t);
  const artifacts = join(fixture.cwd, 'artifacts');
  await mkdir(artifacts);
  const filename = 'rtf-viewer-1.0.0.tgz';
  const bytes = Buffer.from('original archive fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(artifacts, filename), bytes);
  await writeFile(join(artifacts, 'package-manifest.json'), JSON.stringify({ name: 'rtf-viewer', version: '1.0.0', filename, sha256 }));
  await writeFile(join(artifacts, 'package-verification.json'), JSON.stringify({ package: 'rtf-viewer', version: '1.0.0', sha256, result: { ok: true }, failures: [] }));
  await writeFile(join(artifacts, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
  const verify = () => spawnSync(process.execPath, ['--input-type=module', '-e', `import { verifiedPackage } from ${JSON.stringify(packageModule)}; await verifiedPackage();`], { cwd: fixture.cwd, encoding: 'utf8' });
  assert.equal(verify().status, 0);
  await writeFile(join(artifacts, filename), Buffer.from('altered archive fixture'));
  assert.notEqual(verify().status, 0);
});
