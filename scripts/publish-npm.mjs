import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifiedPackage } from './package.mjs';

const pkg = await verifiedPackage();
assert.equal(process.env.GITHUB_REPOSITORY, 'rwv/rtf-viewer');
assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`);
const distTag = pkg.version.includes('-') ? 'next' : 'latest';
const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (response.ok) {
  const existing = await response.json();
  assert.equal(existing.dist?.integrity, pkg.integrity, 'Registry already contains different bytes for this version');
  console.log(`${pkg.name}@${pkg.version} already contains the verified archive; no republish needed.`);
} else {
  assert.equal(response.status, 404, `Registry lookup failed with HTTP ${response.status}`);
  const result = spawnSync('npm', ['publish', pkg.archive, '--access', 'public', '--tag', distTag, '--ignore-scripts', '--registry', 'https://registry.npmjs.org/'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'npm publication failed');
}
