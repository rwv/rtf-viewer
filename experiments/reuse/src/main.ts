import { DocxDocument } from '@silurus/ooxml/docx';
import { WMFJS } from 'rtf.js';

const result = document.querySelector('#result') as HTMLElement;
const docxInput = document.querySelector('#docx') as HTMLInputElement;
const wmfInput = document.querySelector('#wmf') as HTMLInputElement;

docxInput.addEventListener('change', async () => {
  const file = docxInput.files?.[0];
  if (!file) return;
  const docx = await DocxDocument.load(await file.arrayBuffer(), { mode: 'main' });
  try {
    result.textContent = JSON.stringify({
      pageCount: docx.pageCount,
      firstPage: docx.pageSize(0),
      markdownCharacters: (await docx.toMarkdown()).length,
    }, null, 2);
  } finally {
    docx.destroy();
  }
});

wmfInput.addEventListener('change', async () => {
  const file = wmfInput.files?.[0];
  if (!file) return;
  WMFJS.loggingEnabled(false);
  const svg = new WMFJS.Renderer(await file.arrayBuffer()).render({
    width: '240px',
    height: '180px',
    xExt: 240,
    yExt: 180,
    mapMode: 8,
  });
  document.querySelector('#wmf-output')?.replaceChildren(svg);
  result.textContent = JSON.stringify({
    tagName: svg.tagName,
    childNodes: svg.childNodes.length,
  }, null, 2);
});
