import { RtfDocument, type PageLayout } from 'rtf-viewer';
import { RtfViewer } from 'rtf-viewer/viewer';
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
try {
  const lines = Array.from({ length: 24 }, (_, i) => `Line ${i + 1}\\par `).join('');
  const input = new TextEncoder().encode(String.raw`{\rtf1\ansi\paperw4320\paperh4320\margl360\margr360\margt360\margb360\fs24\sl-240 ` + lines + '}');
  const doc = await RtfDocument.load(input, { fonts: {} });
  check(doc.pageCount === 2, 'Expected two automatically laid-out pages');
  const geometry: PageLayout = doc.getPageLayout(0);
  check(geometry.lines.length === 15, 'Expected 15 lines on the first page');
  check(doc.getPageLayout(1).lines[0].fragments.some(f => f.kind === 'text' && f.text.includes('16')), 'Wrong continuation content');
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
  doc.destroy(); doc.destroy();
  (window as unknown as { consumerResult: unknown }).consumerResult = { ok: true, pages: 2, lines: geometry.lines.length, bitmap: [432, 432] };
} catch (error) {
  (window as unknown as { consumerResult: unknown }).consumerResult = { ok: false, message: String(error), stack: error instanceof Error ? error.stack : '' };
}
