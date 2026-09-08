import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { preview, type PreviewServer } from 'vite';

test('the packed npm package works in an isolated production application', async ({ page }) => {
  const artifacts = resolve('artifacts');
  const filename = 'rtf-viewer.tgz';
  const archive = join(artifacts, filename);
  const pkg = JSON.parse(await readFile('packages/rtf-viewer/package.json', 'utf8')) as {
    name: string;
    version: string;
  };
  const tools = JSON.parse(await readFile('package.json', 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  await mkdir(artifacts, { recursive: true });
  // Remove stale passing evidence before packing or running any assertions.
  for (const file of ['SHA256SUMS', 'package-manifest.json', 'package-verification.json']) {
    await rm(join(artifacts, file), { force: true });
  }
  execFileSync('pnpm', ['pack:lib'], { stdio: 'inherit' });
  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const temp = await mkdtemp(join(tmpdir(), 'rtf-viewer-consumer-'));
  let server: PreviewServer | undefined;
  try {
    await writeFile(
      join(temp, 'package.json'),
      JSON.stringify({ name: 'rtf-viewer-consumer', private: true, type: 'module' }),
    );
    execFileSync(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        archive,
        `vite@${tools.devDependencies.vite}`,
        `typescript@${tools.devDependencies.typescript}`,
      ],
      { cwd: temp, stdio: 'inherit' },
    );
    const installedRoot = join(temp, 'node_modules', pkg.name);
    const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    expect(installed.name).toBe(pkg.name);
    expect(installed.version).toBe(pkg.version);
    const files: string[] = [];
    for (const file of await readdir(installedRoot, { recursive: true })) {
      if ((await stat(join(installedRoot, file))).isFile()) files.push(file.replaceAll('\\', '/'));
    }
    for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']) {
      expect(await readFile(join(installedRoot, file), 'utf8')).toBe(await readFile(file, 'utf8'));
    }
    for (const file of [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/viewer.js',
      'dist/viewer.d.ts',
      'dist/parser.worker.js',
      'dist/rtf_parser.js',
      'dist/rtf_parser_bg.wasm',
      'dist/generated/model.d.ts',
    ]) {
      expect(files).toContain(file);
    }
    for (const file of files) {
      expect(file).toMatch(
        /^(?:dist\/|package\.json$|README\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$|CHANGELOG\.md$)/,
      );
      expect(file).not.toMatch(/\.test\.|node_modules|\.rtf$/);
    }
    await copyFile('tests/consumer/main.ts', join(temp, 'main.ts'));
    await writeFile(
      join(temp, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><title>Package consumer</title></head><body><canvas id="page"></canvas><script type="module" src="/main.ts"></script></body></html>',
    );
    await writeFile(
      join(temp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'DOM'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['main.ts'],
      }),
    );
    await writeFile(join(temp, 'vite.config.ts'), "export default { base: '/viewer/' };\n");
    const installedDist = join(installedRoot, 'dist');
    const manualAssets = join(temp, 'public', 'rtf-assets');
    await mkdir(manualAssets, { recursive: true });
    for (const file of await readdir(installedDist)) {
      if (['.js', '.wasm'].includes(extname(file)))
        await copyFile(join(installedDist, file), join(manualAssets, file));
    }
    execFileSync('npm', ['exec', '--', 'tsc'], { cwd: temp, stdio: 'inherit' });
    execFileSync('npm', ['exec', '--', 'vite', 'build'], { cwd: temp, stdio: 'inherit' });
    server = await preview({
      root: temp,
      configFile: false,
      base: '/viewer/',
      preview: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    const failures: string[] = [];
    const resources: string[] = [];
    page.on('requestfailed', (request) =>
      failures.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
      resources.push(response.url());
    });
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('Consumer preview did not expose a local URL');
    await page.goto(url);
    await page.waitForFunction(() => 'consumerResult' in window);
    const result = await page.evaluate(
      () => (window as unknown as { consumerResult: unknown }).consumerResult,
    );
    expect(result).toEqual({
      ok: true,
      pages: 2,
      lines: 15,
      bitmap: [432, 432],
      explicitAssets: true,
    });
    expect(failures).toEqual([]);
    expect(resources.some((url) => /\/assets\/.*\.wasm$/.test(url))).toBe(true);
    for (const file of ['parser.worker.js', 'rtf_parser_bg.wasm']) {
      expect(resources.some((url) => url.endsWith(`/viewer/rtf-assets/${file}`))).toBe(true);
    }
    const assets = await Promise.all(
      (await readdir(join(temp, 'dist/assets'))).map(async (file) => ({
        file,
        bytes: (await stat(join(temp, 'dist/assets', file))).size,
      })),
    );
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      filename,
      sha256,
      integrity,
      bytes: bytes.length,
      files: files.sort(),
    };
    const report = {
      package: pkg.name,
      version: pkg.version,
      filename,
      sha256,
      base: '/viewer/',
      result,
      failures,
      assets,
    };
    await writeFile(
      join(artifacts, 'package-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    await writeFile(
      join(artifacts, 'package-verification.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(join(artifacts, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
  } finally {
    await page.goto('about:blank').catch(() => undefined);
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
