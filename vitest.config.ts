import { defineConfig } from 'vitest/config';
import { upstreamSourceAliases } from './scripts/upstream-source.ts';

export default defineConfig({
  resolve: { alias: upstreamSourceAliases },
  test: { allowOnly: !process.env.CI, include: ['packages/**/*.test.ts'], environment: 'node' },
});
