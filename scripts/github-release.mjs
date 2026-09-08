import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifiedPackage } from './package.mjs';

const manifest = await verifiedPackage();
const tag = process.env.RELEASE_TAG;
assert.equal(tag, `v${manifest.version}`);
assert.equal(process.env.GITHUB_REPOSITORY, 'rwv/rtf-viewer');
const gh = (...args) => spawnSync('gh', args, { encoding: 'utf8' });
const existing = gh('release', 'view', tag, '--json', 'tagName,assets,isDraft,isPrerelease');
if (existing.status === 0) {
  // Reruns must not silently replace assets of a public version.
  const checksum = gh('release', 'download', tag, '--pattern', 'SHA256SUMS', '--output', '-');
  assert.equal(checksum.status, 0, checksum.stderr);
  assert.equal(checksum.stdout, await readFile('artifacts/SHA256SUMS', 'utf8'), 'Existing release differs; publish a new version');
  const release = JSON.parse(existing.stdout);
  assert.equal(release.isDraft, false, 'Existing release must be public');
  assert.equal(release.isPrerelease, manifest.version.includes('-'), 'Release channel differs from version');
  const assets = release.assets.map(asset => asset.name);
  for (const name of [manifest.filename, 'SHA256SUMS', 'package-manifest.json', 'package-verification.json']) {
    assert.ok(assets.includes(name), `Existing release is missing ${name}`);
  }
  assert.equal(release.assets.find(asset => asset.name === manifest.filename).size, manifest.bytes);
  const downloaded = await mkdtemp(join(tmpdir(), 'rtf-release-'));
  try {
    const archive = gh('release', 'download', tag, '--pattern', manifest.filename, '--dir', downloaded);
    assert.equal(archive.status, 0, archive.stderr);
    assert.equal(createHash('sha256').update(await readFile(join(downloaded, manifest.filename))).digest('hex'), manifest.sha256, 'Remote archive differs from the verified bytes');
  } finally { await rm(downloaded, { recursive: true, force: true }); }
  for (const name of ['package-manifest.json', 'package-verification.json']) {
    const evidence = gh('release', 'download', tag, '--pattern', name, '--output', '-');
    assert.equal(evidence.status, 0, evidence.stderr);
    assert.equal(evidence.stdout, await readFile(`artifacts/${name}`, 'utf8'), `Remote ${name} differs from verified evidence`);
  }
  console.log(`Release ${tag} already contains the verified archive.`);
} else {
  assert.match(existing.stderr, /release not found/i, existing.stderr);
  const result = gh('release', 'create', tag, '--verify-tag', '--title', `rtf-viewer ${tag}`, '--notes-file', 'artifacts/release-notes.md',
    `artifacts/${manifest.filename}`, 'artifacts/SHA256SUMS', 'artifacts/package-manifest.json', 'artifacts/package-verification.json', ...(manifest.version.includes('-') ? ['--prerelease'] : []));
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
}
