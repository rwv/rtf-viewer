import { expect, test } from '@playwright/test';

// Original byte sequences with independently specified Unicode expectations.
// These exercise the installed Rust/WASM decoder, not the browser's TextDecoder.
const encodings: [number, string, string][] = [
  [28592, 'a3f364bc', 'Łódź'],
  [20866, 'f0d2c9d7c5d4', 'Привет'],
  [1256, 'e3d1cdc8c7', 'مرحبا'],
  [1255, 'f9ece5ed', 'שלום'],
  [874, 'e4b7c2', 'ไทย'],
  [65001, 'e4b8ade69687f09f9880', '中文😀'],
  [932, '93fa967b8cea', '日本語'],
  [51932, 'c6fccbdcb8ec', '日本語'],
  [936, 'd6d0cec4', '中文'],
  [54936, 'd6d0cec4953282369439fc36', '中文𠀀😀'],
  [949, 'c7d1b1b9beee', '한국어'],
  [950, 'c163c5e9a4a4a4e5', '繁體中文'],
  [10000, '6361668e', 'café'],
  [1200, '2d4e87653dd800de', '中文😀'],
  [1201, '4e2d6587d83dde00', '中文😀'],
  [1200, '4100', 'A'],
  [1201, '0041', 'A'],
  [1200, '2d4e', '中'],
];

test.beforeEach(async ({ page }) => {
  await page.goto('/test-harness.html');
  await page.waitForFunction(() => Boolean(window.__rtfTest));
});

test('WASM decodes all compatibility codepage fixtures and UTF-16 ASCII-range bytes', async ({ page }) => {
  for (const [codepage, hex, expected] of encodings) {
    const result = await page.evaluate(async ({ codepage, hex }) => {
      const escaped = hex.match(/../g)!.map(byte => `\\'${byte}`).join('');
      const bytes = new TextEncoder().encode(`{\\rtf1\\ansi\\ansicpg${codepage} ${escaped}}`);
      const doc = await window.__rtfTest.RtfDocument.load(bytes);
      try {
        return {
          text: doc.model.blocks.flatMap(block => block.kind === 'paragraph' ? block.runs : [])
            .map(run => run.kind === 'text' ? run.text : '').join(''),
          codes: doc.diagnostics.map(diagnostic => diagnostic.code),
        };
      } finally { doc.destroy(); }
    }, { codepage, hex });
    expect(result.text, `codepage ${codepage}, bytes ${hex}`).toBe(expected);
    expect(result.codes).not.toContain('unsupported-codepage');
    expect(result.codes).not.toContain('text-decoding-error');
  }
});

test('150-PPI Canvas and ImageBitmap dimensions match physical paper without changing layout', async ({ page }) => {
  for (const [width, height, pixels] of [[432, 576, [900, 1200]], [612, 792, [1275, 1650]]] as const) {
    const result = await page.evaluate(async ({ width, height }) => {
      const bytes = new TextEncoder().encode(`{\\rtf1\\ansi\\paperw${width * 20}\\paperh${height * 20} Exact paper}`);
      const doc = await window.__rtfTest.RtfDocument.load(bytes);
      try {
        const layout = JSON.stringify(doc.getPageLayout(0));
        const canvas = document.createElement('canvas');
        await doc.renderPage(canvas, 0, { ppi: 150 });
        const bitmap = await doc.renderPageToBitmap(0, { ppi: 150 });
        try {
          return {
            paper: doc.getPageSize(0), canvas: [canvas.width, canvas.height],
            bitmap: [bitmap.width, bitmap.height],
            unchanged: layout === JSON.stringify(doc.getPageLayout(0)),
          };
        } finally { bitmap.close(); }
      } finally { doc.destroy(); }
    }, { width, height });
    expect(result).toEqual({ paper: { width, height }, canvas: pixels, bitmap: pixels, unchanged: true });
  }
});
