import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

function copySamples(): Plugin {
  return {
    name: 'copy-rtf-samples',
    buildStart() {
      const syntheticDirectory = fileURLToPath(
        new URL('../../fixtures/synthetic', import.meta.url),
      );
      const realDirectory = fileURLToPath(new URL('../../fixtures/real', import.meta.url));
      const outputDirectory = fileURLToPath(new URL('./public/samples', import.meta.url));
      rmSync(outputDirectory, { recursive: true, force: true });
      mkdirSync(outputDirectory, { recursive: true });
      const referenceDirectory = fileURLToPath(new URL('./public/reference', import.meta.url));
      rmSync(referenceDirectory, { recursive: true, force: true });
      mkdirSync(referenceDirectory, { recursive: true });
      const sourceReferences = fileURLToPath(new URL('../../fixtures/reference', import.meta.url));
      for (const name of readdirSync(sourceReferences).filter(
        (entry) => entry.endsWith('.png') || entry.endsWith('.txt'),
      )) {
        copyFileSync(`${sourceReferences}/${name}`, `${referenceDirectory}/${name}`);
      }
      for (const directory of [syntheticDirectory, realDirectory]) {
        for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.rtf'))) {
          copyFileSync(`${directory}/${name}`, `${outputDirectory}/${name}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [copySamples()],
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'test-harness': fileURLToPath(new URL('./test-harness.html', import.meta.url)),
      },
    },
  },
});
