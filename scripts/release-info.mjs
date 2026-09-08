import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('packages/rtf-viewer/package.json', 'utf8'));
const tag = process.env.RELEASE_TAG ?? process.argv[2] ?? `v${pkg.version}`;
assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Expected an explicit semantic version tag');
assert.equal(tag, `v${pkg.version}`, 'Tag must match the public package version');
assert.ok((await readFile('crates/rtf-parser/Cargo.toml', 'utf8')).includes(`version = "${pkg.version}"`), 'Parser and package versions must match');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
assert.equal(git('rev-parse', `${tag}^{commit}`), commit, 'The checkout must be the tagged commit');
// A release can only contain a commit already on this repository's main branch.
git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
if (process.env.GITHUB_REPOSITORY) assert.equal(process.env.GITHUB_REPOSITORY, 'rwv/rtf-viewer');
const changelog = (await readFile('CHANGELOG.md', 'utf8')).split(/\r?\n/);
const headings = [`## ${pkg.version}`, `## [${pkg.version}]`];
const start = changelog.findIndex(line => headings.some(heading => line === heading || line.startsWith(heading + ' - ')));
assert.ok(start >= 0, 'CHANGELOG must contain a heading for this version');
const next = changelog.findIndex((line, index) => index > start && line.startsWith('## '));
const notes = changelog.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
assert.ok(notes.length > 0, 'Release notes cannot be empty');
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/release-notes.md', notes + '\n');
const output = { tag, version: pkg.version, commit, filename: `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`, dist_tag: pkg.version.includes('-') ? 'next' : 'latest' };
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(''));
console.log(JSON.stringify(output, null, 2));
