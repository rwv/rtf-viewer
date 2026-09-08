import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
const root = process.cwd();
const run = (args, cwd = root) => {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed`);
};
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
run(['--dir', 'packages/rtf-viewer', 'pack', '--pack-destination', artifacts]);
const temp = await mkdtemp(join(tmpdir(), 'rtf-viewer-consumer-'));
let browser, server;
try {
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'rtf-viewer-consumer', private: true, type: 'module', packageManager: 'pnpm@10.33.0' }, null, 2));
  run(['add', join(artifacts, 'rtf-viewer-0.1.0.tgz')], temp);
  run(['add', '-D', 'vite@8.2.2', 'typescript@6.0.2'], temp);
  await writeFile(join(temp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Package consumer</title></head><body><canvas id="page"></canvas><script type="module" src="/main.ts"></script></body></html>');
  await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: false }, include: ['main.ts'] }));
  await writeFile(join(temp, 'main.ts'), await readFile('tests/consumer/main.ts'));
  run(['exec', 'tsc'], temp);
  run(['exec', 'vite', 'build'], temp);
  const out = join(temp, 'dist');
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
      const file = resolve(out, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(out + '/')) throw new Error('Invalid path');
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [], resources = [];
  page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); resources.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => 'consumerResult' in window, { timeout: 30_000 });
  const result = await page.evaluate(() => window.consumerResult);
  if (!result.ok || failures.length) throw new Error(JSON.stringify({ result, failures }));
  if (!resources.some((url) => url.endsWith('.wasm'))) throw new Error('Consumer did not fetch a WASM asset');
  const assets = [];
  for (const file of await readdir(join(out, 'assets'))) assets.push({ file, bytes: (await stat(join(out, 'assets', file))).size });
  const report = { result, failures, assets, packageBytes: (await stat(join(artifacts, 'rtf-viewer-0.1.0.tgz'))).size };
  await writeFile(join(artifacts, 'package-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server ? server.close(done) : done());
  await rm(temp, { recursive: true, force: true });
}
