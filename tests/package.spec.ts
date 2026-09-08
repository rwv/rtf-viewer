import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { preview, type PreviewServer } from 'vite';

const exec = promisify(execFile);
const commandOptions = {
  timeout: 60_000,
  killSignal: 'SIGKILL' as const,
  maxBuffer: 4 * 1024 * 1024,
};
const registryVersion = process.env.RTF_REGISTRY_VERSION;
const registry = 'https://registry.npmjs.org/';

test('the npm package works in an isolated production application', async ({ page }) => {
  const artifacts = resolve('artifacts');
  const filename = 'rtf-viewer.tgz';
  let archive = join(artifacts, filename);
  const pkg = JSON.parse(await readFile('packages/rtf-viewer/package.json', 'utf8')) as {
    name: string;
    version: string;
  };
  const tools = JSON.parse(await readFile('package.json', 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  await mkdir(artifacts, { recursive: true });
  // Remove stale passing evidence before packing or running any assertions.
  for (const file of registryVersion
    ? ['registry-verification.json']
    : ['SHA256SUMS', 'package-manifest.json', 'package-verification.json']) {
    await rm(join(artifacts, file), { force: true });
  }
  const temp = await mkdtemp(join(tmpdir(), 'rtf-viewer-consumer-'));
  let server: PreviewServer | undefined;
  try {
    if (registryVersion) {
      expect(registryVersion).toBe(pkg.version);
      expect(process.env.RTF_REGISTRY_INTEGRITY).toMatch(/^sha512-/);
      const { stdout } = await exec(
        'npm',
        ['view', `${pkg.name}@${registryVersion}`, 'dist', '--json', '--registry', registry],
        commandOptions,
      );
      const dist = JSON.parse(stdout) as {
        integrity: string;
        attestations?: { provenance?: { predicateType: string } };
      };
      expect(dist.integrity).toBe(process.env.RTF_REGISTRY_INTEGRITY);
      expect(dist.attestations?.provenance?.predicateType).toBe('https://slsa.dev/provenance/v1');
      const packed = await exec(
        'npm',
        [
          'pack',
          `${pkg.name}@${registryVersion}`,
          '--ignore-scripts',
          '--json',
          '--registry',
          registry,
          '--pack-destination',
          temp,
        ],
        commandOptions,
      );
      const entries = JSON.parse(packed.stdout) as { filename: string }[];
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe(`${pkg.name}-${pkg.version}.tgz`);
      archive = join(temp, entries[0].filename);
    } else {
      await exec('pnpm', ['pack:lib'], commandOptions);
    }
    const bytes = await readFile(archive);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (registryVersion) expect(integrity).toBe(process.env.RTF_REGISTRY_INTEGRITY);
    await writeFile(
      join(temp, 'package.json'),
      JSON.stringify({ name: 'rtf-viewer-consumer', private: true, type: 'module' }),
    );
    await exec(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--registry',
        registry,
        registryVersion ? `${pkg.name}@${registryVersion}` : archive,
        `vite@${tools.devDependencies.vite}`,
        `typescript@${tools.devDependencies.typescript}`,
      ],
      { ...commandOptions, cwd: temp },
    );
    if (registryVersion) {
      const lock = JSON.parse(await readFile(join(temp, 'package-lock.json'), 'utf8')) as {
        packages: Record<string, { integrity?: string }>;
      };
      expect(lock.packages[`node_modules/${pkg.name}`].integrity).toBe(integrity);
      // npm verifies registry signatures and any provenance attestations, not just their presence.
      await exec('npm', ['audit', 'signatures', '--registry', registry], {
        ...commandOptions,
        cwd: temp,
      });
    }
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
      const contents = await readFile(join(installedRoot, file), 'utf8');
      expect(contents.length).toBeGreaterThan(0);
      if (!registryVersion) expect(contents).toBe(await readFile(file, 'utf8'));
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
    await exec('npm', ['exec', '--', 'tsc'], { ...commandOptions, cwd: temp });
    await exec('npm', ['exec', '--', 'vite', 'build'], { ...commandOptions, cwd: temp });
    server = await preview({
      root: temp,
      configFile: false,
      base: '/viewer/',
      preview: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    const failures: string[] = [];
    const resources: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
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
      integrity,
      source: registryVersion ? 'npm' : 'archive',
      signaturesVerified: !!registryVersion,
      base: '/viewer/',
      result,
      failures,
      assets,
    };
    if (registryVersion) {
      await writeFile(
        join(artifacts, 'registry-verification.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
    } else {
      await writeFile(
        join(artifacts, 'package-manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
      await writeFile(
        join(artifacts, 'package-verification.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      await writeFile(join(artifacts, 'SHA256SUMS'), `${sha256}  ${filename}\n`);
    }
  } finally {
    await page.goto('about:blank').catch(() => undefined);
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
