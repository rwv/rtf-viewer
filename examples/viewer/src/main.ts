import { RtfViewer } from 'rtf-viewer/viewer';
import type { Diagnostic, LoadOptions, RtfInput } from 'rtf-viewer';
import './styles.css';

const canvas = element<HTMLCanvasElement>('document-canvas');
const viewer = new RtfViewer(canvas);
const fileInput = element<HTMLInputElement>('file-input');
const fileName = element<HTMLElement>('file-name');
const sampleButton = element<HTMLButtonElement>('sample-button');
const previousButton = element<HTMLButtonElement>('previous-page');
const nextButton = element<HTMLButtonElement>('next-page');
const zoomOutButton = element<HTMLButtonElement>('zoom-out');
const zoomInButton = element<HTMLButtonElement>('zoom-in');
const downloadButton = element<HTMLButtonElement>('download-png');
const pageIndicator = element<HTMLOutputElement>('page-indicator');
const zoomValue = element<HTMLOutputElement>('zoom-value');
const sheetNumber = element<HTMLElement>('sheet-number');
const diagnosticCount = element<HTMLElement>('diagnostic-count');
const diagnosticList = element<HTMLOListElement>('diagnostic-list');
const paperSize = element<HTMLElement>('paper-size');
const pageFact = element<HTMLElement>('page-fact');
const status = element<HTMLElement>('status');
const paperWrap = element<HTMLElement>('paper-wrap');
const emptyState = element<HTMLElement>('empty-state');

const SCALES = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75];
let scaleIndex = 3;
let busy = false;
let currentLabel = '';

const fontOptions: LoadOptions = {
  fonts: {
    'Liberation Serif': 'Rtf Liberation Serif',
    'Liberation Sans': 'Rtf Liberation Sans',
  },
  fallbackFont: 'Rtf Free Sans',
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}.`);
  return found as T;
}

async function prepareFonts(): Promise<void> {
  const requests = [
    ['normal 400 12px "Rtf Liberation Serif"', 'Regular'],
    ['normal 700 12px "Rtf Liberation Serif"', 'Bold'],
    ['italic 400 12px "Rtf Liberation Serif"', 'Italic'],
    ['italic 700 12px "Rtf Liberation Serif"', 'Bold italic'],
    ['normal 400 12px "Rtf Liberation Sans"', 'Sans'],
    ['normal 700 12px "Rtf Liberation Sans"', 'Sans bold'],
    ['normal 400 12px "Rtf Free Sans"', '中文'],
  ] as const;
  await Promise.all(requests.map(([font, sample]) => document.fonts.load(font, sample)));
  await document.fonts.ready;
}

function setBusy(value: boolean, message?: string): void {
  busy = value;
  document.body.classList.toggle('is-busy', value);
  fileInput.disabled = value;
  sampleButton.disabled = value;
  if (message) status.textContent = message;
  updateControls();
}

function updateControls(): void {
  const document = viewer.document;
  const pageCount = document?.pageCount ?? 0;
  const pageIndex = pageCount > 0 ? viewer.pageIndex : 0;
  const disabled = busy || pageCount === 0;

  previousButton.disabled = disabled || pageIndex === 0;
  nextButton.disabled = disabled || pageIndex >= pageCount - 1;
  zoomOutButton.disabled = disabled || scaleIndex === 0;
  zoomInButton.disabled = disabled || scaleIndex === SCALES.length - 1;
  downloadButton.disabled = disabled;
  pageIndicator.value = pageCount ? `${pageIndex + 1} / ${pageCount}` : '— / —';
  sheetNumber.textContent = pageCount ? String(pageIndex + 1).padStart(2, '0') : '—';
  zoomValue.value = `${Math.round(SCALES[scaleIndex] * 100)}%`;
  pageFact.textContent = pageCount ? `${pageIndex + 1} of ${pageCount}` : '—';
  paperWrap.hidden = pageCount === 0;
  emptyState.hidden = pageCount !== 0;

  if (document && pageCount) {
    const size = document.getPageSize(pageIndex);
    paperSize.textContent = `${formatPoints(size.width)} × ${formatPoints(size.height)} pt`;
  } else {
    paperSize.textContent = '—';
  }
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function showDiagnostics(diagnostics: readonly Diagnostic[]): void {
  diagnosticCount.textContent = String(diagnostics.length);
  diagnosticCount.classList.toggle('has-diagnostics', diagnostics.length > 0);
  diagnosticList.replaceChildren();
  if (!diagnostics.length) {
    const item = document.createElement('li');
    item.className = 'diagnostic-empty';
    item.textContent = 'No notices for this document.';
    diagnosticList.append(item);
    return;
  }
  for (const diagnostic of diagnostics) {
    const item = document.createElement('li');
    const code = document.createElement('code');
    const message = document.createElement('span');
    code.textContent = diagnostic.code;
    message.textContent = diagnostic.message;
    item.append(code, message);
    diagnosticList.append(item);
  }
}

async function loadDocument(input: RtfInput, label: string): Promise<void> {
  if (busy) return;
  setBusy(true, `Opening ${label}…`);
  try {
    await prepareFonts();
    scaleIndex = 3;
    await viewer.load(input, fontOptions);
    currentLabel = label;
    fileName.textContent = label;
    fileName.title = label;
    showDiagnostics(viewer.document?.diagnostics ?? []);
    status.textContent = `${label} opened with ${viewer.document?.pageCount ?? 0} pages.`;
  } catch (error) {
    status.textContent = `Could not open ${label}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    setBusy(false);
  }
}

async function loadSample(): Promise<void> {
  if (busy) return;
  setBusy(true, 'Loading the sample…');
  try {
    const response = await fetch('/samples/showcase.rtf');
    if (!response.ok) throw new Error(`Sample request returned ${response.status}.`);
    setBusy(false);
    await loadDocument(await response.blob(), 'showcase.rtf');
  } catch (error) {
    setBusy(false);
    status.textContent = `Could not load the sample: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function goToPage(index: number): Promise<void> {
  if (busy || !viewer.document) return;
  setBusy(true, `Rendering page ${index + 1}…`);
  try {
    await viewer.goToPage(index);
    status.textContent = `Showing page ${viewer.pageIndex + 1} of ${viewer.document.pageCount}.`;
  } catch (error) {
    status.textContent = `Could not render that page: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    setBusy(false);
  }
}

async function setScale(index: number): Promise<void> {
  if (busy || !viewer.document || index < 0 || index >= SCALES.length) return;
  setBusy(true, `Setting zoom to ${Math.round(SCALES[index] * 100)}%…`);
  try {
    await viewer.setScale(SCALES[index]);
    scaleIndex = index;
    status.textContent = `Zoom set to ${Math.round(SCALES[index] * 100)}%.`;
  } catch (error) {
    status.textContent = `Could not change zoom: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    setBusy(false);
  }
}

async function savePng(): Promise<void> {
  const document = viewer.document;
  if (busy || !document) return;
  setBusy(true, 'Preparing PNG…');
  let bitmap: ImageBitmap | undefined;
  try {
    const rendered = await document.renderPageToBitmap(viewer.pageIndex, { ppi: 144 });
    bitmap = rendered;
    const exportCanvas = window.document.createElement('canvas');
    exportCanvas.width = rendered.width;
    exportCanvas.height = rendered.height;
    exportCanvas.getContext('2d')?.drawImage(rendered, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('PNG encoding failed.'))),
        'image/png',
      );
    });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    const stem = currentLabel.replace(/\.rtf$/i, '') || 'document';
    link.href = url;
    link.download = `${stem}-page-${viewer.pageIndex + 1}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = `Saved page ${viewer.pageIndex + 1} as PNG.`;
  } catch (error) {
    status.textContent = `Could not save PNG: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    bitmap?.close();
    setBusy(false);
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadDocument(file, file.name);
  fileInput.value = '';
});
sampleButton.addEventListener('click', () => void loadSample());
previousButton.addEventListener('click', () => void goToPage(viewer.pageIndex - 1));
nextButton.addEventListener('click', () => void goToPage(viewer.pageIndex + 1));
zoomOutButton.addEventListener('click', () => void setScale(scaleIndex - 1));
zoomInButton.addEventListener('click', () => void setScale(scaleIndex + 1));
downloadButton.addEventListener('click', () => void savePng());
window.addEventListener('beforeunload', () => viewer.destroy(), { once: true });

showDiagnostics([]);
updateControls();
void loadSample();
