import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

function copySamples(): Plugin {
  return {
    name: 'copy-rtf-samples',
    buildStart() {
      const syntheticDirectory = fileURLToPath(new URL('../../fixtures/synthetic', import.meta.url));
      const realDirectory = fileURLToPath(new URL('../../fixtures/real', import.meta.url));
      const outputDirectory = fileURLToPath(new URL('./public/samples', import.meta.url));
      mkdirSync(outputDirectory, { recursive: true });
      const referenceDirectory = fileURLToPath(new URL('./public/reference', import.meta.url));
      mkdirSync(referenceDirectory, { recursive: true });
      copyFileSync(fileURLToPath(new URL('../../fixtures/reference/libreoffice-25.2.3.2-page-1.png', import.meta.url)), `${referenceDirectory}/libreoffice-25.2.3.2-page-1.png`);
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
