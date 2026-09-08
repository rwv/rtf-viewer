import { RtfDocument, layoutDocument, pixelSize } from 'rtf-viewer';
import type {
  CanvasTarget,
  RtfInput,
  LoadOptions,
  RenderOptions,
  PageSize,
  TextFragment,
  ImageFragment,
  Fragment,
  LineLayout,
  PageLayout,
  DocumentLayout,
  TextMetricsPt,
  LayoutServices,
  LayoutOptions,
  Diagnostic,
  DocumentModel,
  TextStyle,
} from 'rtf-viewer';
import { RtfViewer } from 'rtf-viewer/viewer';
// Compilation protects every supported type export in the installed package.
export type PublicTypeContract = [
  CanvasTarget,
  RtfInput,
  LoadOptions,
  RenderOptions,
  PageSize,
  TextFragment,
  ImageFragment,
  Fragment,
  LineLayout,
  PageLayout,
  DocumentLayout,
  TextMetricsPt,
  LayoutServices,
  LayoutOptions,
  Diagnostic,
  DocumentModel,
  TextStyle,
];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
try {
  const lines = Array.from({ length: 24 }, (_, i) => `Line ${i + 1}\\par `).join('');
  const input = new TextEncoder().encode(
    String.raw`{\rtf1\ansi\paperw4320\paperh4320\margl360\margr360\margt360\margb360\fs24\sl-240 ` +
      lines +
      '}',
  );
  const doc = await RtfDocument.load(input, { fonts: {} });
  check(doc.pageCount === 2, 'Expected two automatically laid-out pages');
  const plainLayout = await layoutDocument(doc.model, {
    measure: (text) => ({ width: text.length * 6, ascent: 9, descent: 3 }),
    font: () => '12px serif',
    imageSize: () => ({ width: 36, height: 36 }),
  });
  check(plainLayout.pages.length === 2, 'Public layoutDocument export must paginate');
  check(
    pixelSize(plainLayout.pages[0], { ppi: 144 }).width === 432,
    'Public pixelSize export must scale physical units',
  );
  const geometry: PageLayout = doc.getPageLayout(0);
  check(geometry.lines.length === 15, 'Expected 15 lines on the first page');
  check(
    doc.getPageLayout(1).lines[0].fragments.some((f) => f.kind === 'text' && f.text.includes('16')),
    'Wrong continuation content',
  );
  const canvas = document.querySelector<HTMLCanvasElement>('#page')!;
  await doc.renderPage(canvas, 0, { ppi: 72 });
  check(canvas.width === 216 && canvas.height === 216, 'Canvas physical dimensions');
  const bitmap = await doc.renderPageToBitmap(1, { ppi: 144 });
  check(bitmap.width === 432 && bitmap.height === 432, 'Bitmap dimensions');
  bitmap.close();
  const viewer = RtfViewer.fromDocument(canvas, doc);
  await viewer.goToPage(1);
  viewer.destroy();
  check(!doc.destroyed, 'Borrowed viewer destroyed engine');
  doc.destroy();
  doc.destroy();
  const manual = await RtfDocument.load(input, {
    workerUrl: new URL('./rtf-assets/parser.worker.js', location.href),
    wasmUrl: new URL('./rtf-assets/rtf_parser_bg.wasm', location.href),
  });
  check(manual.pageCount === 2, 'Explicit asset URLs changed pagination');
  await manual.renderPage(canvas, 1, { ppi: 144 });
  check(
    canvas.width === 432 && manual.getPageLayout(1).lines.length === 9,
    'Explicit asset URL rendering failed',
  );
  manual.destroy();
  const compatibility = await RtfDocument.load(
    new TextEncoder().encode(
      String.raw`{\rtf1\ansi\ansicpg1200\paperw8640\paperh11520 \'41\'00\'2d\'4e\'3d\'d8\'00\'de}`,
    ),
  );
  try {
    const decoded = compatibility.model.blocks
      .flatMap((block) => (block.kind === 'paragraph' ? block.runs : []))
      .map((run) => (run.kind === 'text' ? run.text : ''))
      .join('');
    check(
      decoded === 'A中😀',
      'Packed WASM must decode UTF-16 ASCII-range bytes and surrogate pairs',
    );
    check(
      !compatibility.diagnostics.some((diagnostic) =>
        ['unsupported-codepage', 'text-decoding-error'].includes(diagnostic.code),
      ),
      'Supported bytes must decode without fallback',
    );
    document.fonts.dispatchEvent(new Event('loadingdone'));
    check(
      !compatibility.needsRelayout,
      'Empty font completion must not invalidate packed documents',
    );
    await compatibility.renderPage(canvas, 0, { ppi: 150 });
    check(
      canvas.width === 900 && canvas.height === 1200,
      'Packed 150-PPI rendering must not gain a pixel',
    );
    check(
      pixelSize({ width: 612, height: 792 }, { ppi: 150 }).height === 1650,
      'Packed Letter height must be integral at 150 PPI',
    );
  } finally {
    compatibility.destroy();
  }
  (window as unknown as { consumerResult: unknown }).consumerResult = {
    ok: true,
    pages: 2,
    lines: geometry.lines.length,
    bitmap: [432, 432],
    explicitAssets: true,
  };
} catch (error) {
  (window as unknown as { consumerResult: unknown }).consumerResult = {
    ok: false,
    message: String(error),
    stack: error instanceof Error ? error.stack : '',
  };
}
