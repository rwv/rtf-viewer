import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/test-harness.html');
  await page.waitForFunction(() => Boolean(window.__rtfTest));
});

test('WASM understands Unicode, scoped styles, codepages and ignorable destinations', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('.wasm')) requests.push(`${response.status()}`);
  });
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const input = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0\fcharset0 Liberation Serif;}{\f1\fcharset134 Noto Serif CJK SC;}}\f0 Base {\b Bold} plain \u20013?\u25991? {\*\future SECRET} \f1\'d6\'d0\'ce\'c4\par}`;
    const doc = await RtfDocument.load(new TextEncoder().encode(input), {
      fonts: { 'Liberation Serif': 'Rtf Liberation Serif' },
    });
    const paragraph = doc.model.blocks[0];
    if (paragraph.kind !== 'paragraph') throw new Error('Expected a paragraph');
    const runs = paragraph.runs;
    const result = {
      text: runs.map((r: any) => r.text ?? '').join(''),
      bold: runs
        .filter((r: any) => r.style?.bold)
        .map((r: any) => r.text)
        .join(''),
      diagnostics: doc.diagnostics.map((d: any) => d.code),
      pages: doc.pageCount,
    };
    doc.destroy();
    return result;
  });
  expect(result.text).toContain('Base Bold plain 中文');
  expect(result.text).toContain('中文');
  expect(result.text).not.toContain('SECRET');
  expect(result.text).not.toContain('?');
  expect(result.bold).toBe('Bold');
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.pages).toBe(1);
  expect(requests).toContain('200');
});

test('font mappings ignore inherited object properties', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const input = String.raw`{\rtf1{\fonttbl{\f0\fnil toString;}}\f0 Inherited font key\par}`;
    const doc = await RtfDocument.load(new TextEncoder().encode(input), { fonts: {} });
    const text = doc
      .getPageLayout(0)
      .lines.flatMap((line: any) => line.fragments)
      .map((fragment: any) => fragment.text ?? '')
      .join('');
    doc.destroy();
    return text;
  });
  expect(result).toBe('Inherited font key');
});

test('independent exact-line fixture paginates 15 + 9 with resolution-invariant geometry', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const bytes = await (await fetch('/samples/automatic-pagination.rtf')).arrayBuffer();
    const doc = await RtfDocument.load(bytes, {
      fonts: { 'Liberation Serif': 'Rtf Liberation Serif' },
    });
    const before = JSON.stringify([doc.getPageLayout(0), doc.getPageLayout(1)]);
    const canvas = document.createElement('canvas');
    await doc.renderPage(canvas, 0, { ppi: 72 });
    const low = [canvas.width, canvas.height];
    await doc.renderPage(canvas, 0, { ppi: 144, scale: 1.25 });
    const high = [canvas.width, canvas.height];
    const bitmap = await doc.renderPageToBitmap(1, { ppi: 144 });
    const bitmapSize = [bitmap.width, bitmap.height];
    bitmap.close();
    const result = {
      pages: doc.pageCount,
      lines: [doc.getPageLayout(0).lines.length, doc.getPageLayout(1).lines.length],
      y: doc.getPageLayout(0).lines.map((l: any) => l.y),
      next: doc
        .getPageLayout(1)
        .lines[0].fragments.map((f: any) => f.text)
        .join(''),
      low,
      high,
      bitmapSize,
      closedWidth: bitmap.width,
      invariant: before === JSON.stringify([doc.getPageLayout(0), doc.getPageLayout(1)]),
    };
    doc.destroy();
    return result;
  });
  expect(result).toMatchObject({
    pages: 2,
    lines: [15, 9],
    low: [216, 216],
    high: [540, 540],
    bitmapSize: [432, 432],
    closedWidth: 0,
    invariant: true,
  });
  expect(result.y[0]).toBe(18);
  expect(result.y[14]).toBe(186);
  expect(result.next).toContain('16');
});

test('inline PNG and JPEG use authored dimensions and paint the declared regions', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const doc = await RtfDocument.load(
      await (await fetch('/samples/inline-png-jpeg.rtf')).arrayBuffer(),
      { fonts: {} },
    );
    const images = doc
      .getPageLayout(0)
      .lines.flatMap((l: any) => l.fragments)
      .filter((f: any) => f.kind === 'image');
    const canvas = document.createElement('canvas');
    await doc.renderPage(canvas, 0, { ppi: 72 });
    const context = canvas.getContext('2d')!;
    const colors = images.map((f: any) => [
      ...context.getImageData(Math.floor(f.x + 4), Math.floor(f.y + 4), 1, 1).data,
    ]);
    const result = {
      images: images.map((f: any) => [f.width, f.height]),
      colors,
      codes: doc.diagnostics.map((d: any) => d.code),
    };
    doc.destroy();
    return result;
  });
  expect(result.images).toEqual([
    [36, 27],
    [36, 27],
  ]);
  expect(result.colors).toHaveLength(2);
  for (const color of result.colors) expect(color.slice(0, 3)).not.toEqual([255, 255, 255]);
  expect(result.codes).not.toContain('image-decode-failed');
});

test('abort terminates dedicated Workers and rejects pre-aborted loads', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const NativeWorker = window.Worker;
    let created = 0,
      terminated = 0;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        created++;
      }
      terminate() {
        terminated++;
        super.terminate();
      }
    };
    try {
      const controller = new AbortController();
      const input = new TextEncoder().encode('{\\rtf1 ' + 'word '.repeat(500_000) + '}');
      const loading = RtfDocument.load(input, { signal: controller.signal });
      controller.abort();
      const during = await loading.then(
        () => 'resolved',
        (e: Error) => e.name,
      );
      const before = await RtfDocument.load(input, { signal: controller.signal }).then(
        () => 'resolved',
        (e: Error) => e.name,
      );
      return { created, terminated, during, before, inputBytes: input.byteLength };
    } finally {
      window.Worker = NativeWorker;
    }
  });
  expect(result).toMatchObject({
    created: 1,
    terminated: 1,
    during: 'AbortError',
    before: 'AbortError',
  });
  expect(result.inputBytes).toBeGreaterThan(2_000_000);
});

test('concurrent targets work; contention, destroy and borrowed ownership are deterministic', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument, RtfViewer } = window.__rtfTest;
    const doc = await RtfDocument.load(new TextEncoder().encode('{\\rtf1 Hello\\par}'), {
      fonts: {},
    });
    const a = document.createElement('canvas'),
      b = document.createElement('canvas');
    const first = doc.renderPage(a, 0);
    const collision = await doc.renderPage(a, 0).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await Promise.all([first, doc.renderPage(b, 0)]);
    const borrowed = RtfViewer.fromDocument(a, doc);
    const borrowedLoad = await borrowed.load(new ArrayBuffer(0)).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    borrowed.destroy();
    const survives = !doc.destroyed;
    const painting = doc.renderPage(a, 0);
    doc.destroy();
    doc.destroy();
    const destroyedPending = await painting.then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    const after = await doc.renderPage(b, 0).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    return { collision, borrowedLoad, survives, destroyedPending, after, count: doc.pageCount };
  });
  expect(result.collision).toContain('already active');
  expect(result.borrowedLoad).toContain('borrowed');
  expect(result.survives).toBe(true);
  expect(result.destroyedPending).toBe('AbortError');
  expect(result.after).toContain('destroyed');
  expect(result.count).toBe(1);
});

test('font completion filters empty and unrelated batches but invalidates a relevant family', async ({
  page,
  browserName,
}) => {
  const result = await page.evaluate(async (expectNativeCompletion) => {
    const { RtfDocument } = window.__rtfTest;
    const doc = await RtfDocument.load(
      new TextEncoder().encode(
        String.raw`{\rtf1{\fonttbl{\f0\fnil Lifecycle Source;}{\f1\fnil Rtf Lifecycle Unrelated;}}\f0 WWWWWWiiiiii font revision\par}`,
      ),
      { fonts: { 'Lifecycle Source': 'Rtf Lifecycle Relevant' } },
    );
    const before = doc.layoutRevision;
    const beforeWidth = doc.getPageLayout(0).lines[0].width;
    document.fonts.dispatchEvent(new Event('loadingdone'));
    const emptyIgnored = !doc.needsRelayout;

    const loadFace = async (face: FontFace, font: string) => {
      const familyKey = (value: string) => value.replace(/^["']|["']$/g, '').toLowerCase();
      const expectedFamily = familyKey(face.family);
      let nativeCompletion = false;
      let stopWaiting!: () => void;
      const completion = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`No loadingdone event for ${face.family}.`)),
          5000,
        );
        const done = (event: Event) => {
          const faces = 'fontfaces' in event ? (event as FontFaceSetLoadEvent).fontfaces : [];
          if (!faces.some((loaded) => familyKey(loaded.family) === expectedFamily)) return;
          nativeCompletion = true;
          stopWaiting();
          resolve();
        };
        stopWaiting = () => {
          clearTimeout(timeout);
          document.fonts.removeEventListener('loadingdone', done);
        };
        document.fonts.addEventListener('loadingdone', done);
      });
      document.fonts.add(face);
      const loading = document.fonts.load(font, 'Font metrics');
      if (expectNativeCompletion) await Promise.all([loading, completion]);
      else {
        await loading;
        stopWaiting();
      }
      if (!nativeCompletion) {
        // WebKit can complete a script-initiated load without loadingdone. Use
        // the native face in an equivalent event shape to test filtering there.
        const event = new Event('loadingdone');
        Object.defineProperty(event, 'fontfaces', { value: [face] });
        document.fonts.dispatchEvent(event);
      }
      return nativeCompletion;
    };

    const unrelated = new FontFace(
      'Rtf Lifecycle Unrelated',
      'url("/fonts/LiberationSans-Regular.ttf?font-lifecycle=unrelated")',
    );
    const unrelatedNative = await loadFace(unrelated, '12px "Rtf Lifecycle Unrelated"');
    const unrelatedIgnored = !doc.needsRelayout;
    document.fonts.delete(unrelated);

    const quotedUnrelated = new Event('loadingdone');
    Object.defineProperty(quotedUnrelated, 'fontfaces', {
      value: [{ family: '"Rtf Lifecycle Quoted Unrelated"' }],
    });
    document.fonts.dispatchEvent(quotedUnrelated);
    const quotedUnrelatedIgnored = !doc.needsRelayout;

    const relevant = new FontFace(
      'Rtf Lifecycle Relevant',
      'url("/fonts/LiberationSans-Regular.ttf?font-lifecycle=relevant")',
    );
    const relevantNative = await loadFace(relevant, '12px "Rtf Lifecycle Relevant"');
    const stale = doc.needsRelayout;
    const blocked = await doc.renderPage(document.createElement('canvas'), 0).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await doc.relayout();
    await doc.renderPage(document.createElement('canvas'), 0);
    const afterWidth = doc.getPageLayout(0).lines[0].width;
    const fresh = !doc.needsRelayout;
    const malformed = new Event('loadingdone');
    Object.defineProperty(malformed, 'fontfaces', { value: [null] });
    document.fonts.dispatchEvent(malformed);
    const malformedConservative = doc.needsRelayout;
    const result = {
      before,
      after: doc.layoutRevision,
      beforeWidth,
      afterWidth,
      emptyIgnored,
      unrelatedIgnored,
      quotedUnrelatedIgnored,
      unrelatedNative,
      relevantNative,
      stale,
      fresh,
      malformedConservative,
      blocked,
    };
    document.fonts.delete(relevant);
    doc.destroy();
    return result;
  }, browserName !== 'webkit');
  expect(result).toMatchObject({
    before: 1,
    after: 2,
    emptyIgnored: true,
    unrelatedIgnored: true,
    quotedUnrelatedIgnored: true,
    stale: true,
    fresh: true,
    malformedConservative: true,
  });
  if (browserName !== 'webkit')
    expect([result.unrelatedNative, result.relevantNative]).toEqual([true, true]);
  expect(Math.abs(result.afterWidth - result.beforeWidth)).toBeGreaterThan(0.1);
  expect(result.blocked).toContain('Fonts changed');
});

test('rejects malformed input and image allocation bombs before browser decode', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const bad = await RtfDocument.load(new TextEncoder().encode('not rtf')).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    const signature = '89504e470d0a1a0a0000000d494844520000ea600000ea60';
    const image = String.raw`{\rtf1{\pict\pngblip\picwgoal100\pichgoal100 ` + signature + '}}';
    const bomb = await RtfDocument.load(new TextEncoder().encode(image), { fonts: {} }).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    return { bad, bomb };
  });
  expect(result.bad).not.toBe('resolved');
  expect(result.bomb).toContain('budget');
});

test('real LibreOffice sample matches independent page/text geometry and nearby ink', async ({
  page,
}) => {
  const reference = await page.request.get('/reference/libreoffice-25.2.3.2-page-1.png');
  // The reference comes from the desktop producer, never from this engine.
  expect(reference.ok()).toBe(true);
  const referenceBytes = [...(await reference.body())];
  const result = await page.evaluate(async (referenceBytes) => {
    const { RtfDocument } = window.__rtfTest;
    await document.fonts.load('18px "Rtf Liberation Sans"');
    await document.fonts.load('bold 18px "Rtf Liberation Sans"');
    await document.fonts.load('12px "Rtf Free Sans"', '中文');
    const doc = await RtfDocument.load(
      await (await fetch('/samples/libreoffice-25.2.3.2.rtf')).arrayBuffer(),
      {
        fonts: {
          'Liberation Serif': 'Rtf Liberation Serif',
          'Liberation Sans': 'Rtf Liberation Sans',
        },
        fallbackFont: 'Rtf Free Sans',
      },
    );
    const canvas = document.createElement('canvas');
    await doc.renderPage(canvas, 0, { ppi: 96 });
    const actual = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const expectedBitmap = await createImageBitmap(
      new Blob([new Uint8Array(referenceBytes)], { type: 'image/png' }),
    );
    const referenceCanvas = new OffscreenCanvas(expectedBitmap.width, expectedBitmap.height);
    const context = referenceCanvas.getContext('2d')!;
    context.drawImage(expectedBitmap, 0, 0);
    expectedBitmap.close();
    const expected = context.getImageData(0, 0, referenceCanvas.width, referenceCanvas.height).data;
    const w = canvas.width,
      h = canvas.height;
    const dark = (pixels: Uint8ClampedArray, x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && pixels[(y * w + x) * 4] < 150;
    let actualInk = 0,
      expectedInk = 0,
      unmatched = 0;
    const near = (pixels: Uint8ClampedArray, x: number, y: number) => {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) if (dark(pixels, x + dx, y + dy)) return true;
      return false;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (dark(actual, x, y)) {
          actualInk++;
          if (!near(expected, x, y)) unmatched++;
        }
        if (dark(expected, x, y)) {
          expectedInk++;
          if (!near(actual, x, y)) unmatched++;
        }
      }
    const lines = doc.getPageLayout(0).lines;
    const result = {
      pages: doc.pageCount,
      size: doc.getPageSize(0),
      pixels: [w, h],
      lines: lines.map((line: any) => line.fragments.map((f: any) => f.text ?? '').join('')),
      positions: lines.map((l: any) => [l.x, l.y]),
      actualInk,
      expectedInk,
      unmatchedRatio: unmatched / (actualInk + expectedInk),
      png: canvas.toDataURL(),
    };
    doc.destroy();
    return result;
  }, referenceBytes);
  expect(result.pages).toBe(1);
  expect(result.size).toEqual({ width: 288, height: 360 });
  expect(result.pixels).toEqual([384, 480]);
  expect(result.lines).toEqual([
    'LibreOffice RTF',
    'Reference',
    'Plain text with bold, italic, and underlined',
    'words.',
    'Indented paragraph marker with',
    'enough words to expose paragraph',
    'geometry and line wrapping.',
    'Unicode text: Hello, 中文, 你好世界.',
    'Continuation Marker',
    'This sentence follows the second heading.',
    'Final marker: LO-25.2.3.2.',
  ]);
  expect(result.positions[0][0]).toBeCloseTo(36, 1);
  expect(result.positions[4][0]).toBeCloseTo(90, 1);
  expect(result.positions[5][0]).toBeCloseTo(72, 1);
  expect(result.actualInk / result.expectedInk).toBeGreaterThan(0.85);
  expect(result.actualInk / result.expectedInk).toBeLessThan(1.15);
  // A 4-pixel neighborhood allows documented font/rasterizer shifts at 96 PPI.
  // Symmetric coverage plus exact text/line assertions rejects missing content.
  expect(result.unmatchedRatio).toBeLessThan(0.02);
  await test.info().attach('engine-libreoffice-page', {
    body: Buffer.from(result.png.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
});

test('font changes during measurement cannot publish mixed geometry', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const proto = OffscreenCanvasRenderingContext2D.prototype;
    // oxlint-disable-next-line typescript/unbound-method -- Restored below; invoked with the original receiver via call.
    const original = proto.measureText;
    const relevantFace = new FontFace('Rtf Race Font', 'local("serif")');
    let triggered = false;
    proto.measureText = function (text: string) {
      if (!triggered) {
        triggered = true;
        const event = new Event('loadingdone');
        Object.defineProperty(event, 'fontfaces', { value: [relevantFace] });
        document.fonts.dispatchEvent(event);
      }
      return original.call(this, text);
    };
    try {
      return await RtfDocument.load(
        new TextEncoder().encode(
          String.raw`{\rtf1{\fonttbl{\f0\fnil Race Source;}}\f0 Font race\par}`,
        ),
        { fonts: { 'Race Source': 'Rtf Race Font' } },
      ).then(
        (doc: any) => {
          doc.destroy();
          return 'resolved';
        },
        (error: Error) => error.message,
      );
    } finally {
      proto.measureText = original;
    }
  });
  expect(result).toContain('Fonts changed during layout');
});

test('malformed Worker replies terminate without waiting for the parser timeout', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const url = URL.createObjectURL(
      new Blob(['self.onmessage = () => self.postMessage(null);'], { type: 'text/javascript' }),
    );
    const started = performance.now();
    try {
      const error = await RtfDocument.load(new TextEncoder().encode('{\\rtf1 test}'), {
        workerUrl: url,
        parseTimeoutMs: 5000,
      }).then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      return { error, elapsed: performance.now() - started };
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  expect(result.error).toContain('Invalid parser Worker response');
  expect(result.elapsed).toBeLessThan(2000);
});

test('an image bitmap that finishes decoding after load abort is closed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { RtfDocument } = window.__rtfTest;
    const original = window.createImageBitmap;
    const controller = new AbortController();
    let late: ImageBitmap | undefined;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      return (original as any)(...args).then((bitmap: ImageBitmap) => {
        late = bitmap;
        controller.abort();
        return new Promise<ImageBitmap>((resolve) => setTimeout(() => resolve(bitmap), 30));
      });
    }) as typeof createImageBitmap;
    try {
      const bytes = await (await fetch('/samples/inline-png-jpeg.rtf')).arrayBuffer();
      const error = await RtfDocument.load(bytes, { fonts: {}, signal: controller.signal }).then(
        () => 'resolved',
        (error: Error) => error.name,
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { error, lateWidth: late?.width };
    } finally {
      window.createImageBitmap = original;
    }
  });
  expect(result).toEqual({ error: 'AbortError', lateWidth: 0 });
});

test('destroying an owning viewer while loading aborts its pending acquisition', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { RtfViewer } = window.__rtfTest;
    const viewer = new RtfViewer(document.createElement('canvas'));
    const loading = viewer.load(new TextEncoder().encode('{\\rtf1 pending}'));
    viewer.destroy();
    viewer.destroy();
    const error = await loading.then(
      () => 'resolved',
      (error: Error) => error.name,
    );
    return { error, document: viewer.document };
  });
  expect(result).toEqual({ error: 'AbortError', document: null });
});

test('bitmap export rejects and closes a result from a superseded layout', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const doc = await window.__rtfTest.RtfDocument.load(
      new TextEncoder().encode(
        String.raw`{\rtf1{\fonttbl{\f0 AuditFont;}}\f0\fs24 WWWWWW iiiiii sample paragraph}`,
      ),
      { fonts: { AuditFont: 'Delayed Export Font' } },
    );
    const original = window.createImageBitmap.bind(window);
    const ready = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    })();
    const gate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    })();
    let captured: ImageBitmap | undefined;
    const intercepted: typeof createImageBitmap = async (source: ImageBitmapSource) => {
      captured = await original(source);
      ready.resolve();
      await gate.promise;
      return captured;
    };
    window.createImageBitmap = intercepted;
    const face = new FontFace('Delayed Export Font', 'url(/fonts/LiberationSans-Regular.ttf)');
    try {
      const before = doc.getPageLayout(0).lines[0].width;
      const pending = doc.renderPageToBitmap(0).then(
        (bitmap) => {
          bitmap.close();
          return 'resolved';
        },
        (error: Error) => error.message,
      );
      await ready.promise;
      document.fonts.add(await face.load());
      await doc.relayout();
      const after = doc.getPageLayout(0).lines[0].width;
      gate.resolve();
      const error = await pending;
      return { before, after, error, width: captured?.width, revision: doc.layoutRevision };
    } finally {
      gate.resolve();
      window.createImageBitmap = original;
      doc.destroy();
      document.fonts.delete(face);
    }
  });
  expect(result.after).not.toBe(result.before);
  expect(result.revision).toBe(2);
  expect(result.error).toContain('Document layout changed during rendering');
  expect(result.width).toBe(0);
});

test('canvas rendering rejects when relayout commits before paint completes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const doc = await window.__rtfTest.RtfDocument.load(
      new TextEncoder().encode('{\\rtf1 revision}'),
    );
    const originalTimer = window.setTimeout;
    let resume!: () => void;
    try {
      // Hold the first paint yield until the new geometry has committed.
      window.setTimeout = ((callback: () => void) => {
        resume = callback;
        return 0;
      }) as typeof window.setTimeout;
      const pending = doc.renderPage(document.createElement('canvas'), 0).then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      window.setTimeout = originalTimer;
      await doc.relayout();
      resume();
      return await pending;
    } finally {
      window.setTimeout = originalTimer;
      doc.destroy();
    }
  });
  expect(result).toContain('Document layout changed during rendering');
});
