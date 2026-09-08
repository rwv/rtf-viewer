import { describe, expect, it } from 'vitest';
import { layoutDocument } from './layout.js';
import { pixelSize } from './paint.js';
import type {
  Block,
  DocumentModel,
  ParagraphStyle,
  TableCell,
  TextStyle,
} from './generated/model.js';
import type { LayoutServices } from './types.js';
const textStyle: TextStyle = {
  fontId: 0,
  fontSize: 10,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: null,
  highlight: null,
  hidden: false,
  baseline: 0,
};
const paragraphStyle: ParagraphStyle = {
  align: 'left',
  leftIndent: 0,
  rightIndent: 0,
  firstLineIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  lineSpacing: { kind: 'exact', value: 10 },
  pageBreakBefore: false,
};
const services: LayoutServices = {
  font: (style) => `${style.fontSize}px monospace`,
  measure: (text) => ({
    width:
      Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length *
      5,
    ascent: 8,
    descent: 2,
  }),
  imageSize: () => ({ width: 20, height: 15 }),
};
function paragraph(text: string, style: Partial<ParagraphStyle> = {}): Block {
  return {
    kind: 'paragraph',
    runs: [{ kind: 'text', text, style: textStyle }],
    style: { ...paragraphStyle, ...style },
    markStyle: textStyle,
  };
}
function model(blocks: Block[], contentWidth = 50, contentHeight = 30): DocumentModel {
  return {
    schemaVersion: 2,
    page: {
      width: contentWidth + 20,
      height: contentHeight + 20,
      marginLeft: 10,
      marginRight: 10,
      marginTop: 10,
      marginBottom: 10,
    },
    defaultTab: 10,
    fonts: [{ id: 0, name: 'monospace', charset: null, codepage: null }],
    colors: [null],
    images: [],
    blocks,
    diagnostics: [],
  };
}
const textOf = (line: Awaited<ReturnType<typeof layoutDocument>>['pages'][0]['lines'][0]) =>
  line.fragments.map((f) => (f.kind === 'text' ? f.text : '[image]')).join('');

describe('retained point geometry', () => {
  it('wraps at words and automatically paginates using exact line height', async () => {
    const layout = await layoutDocument(
      model(Array.from({ length: 7 }, (_, i) => paragraph(`Line ${i}`))),
      services,
    );
    expect(layout.pages.map((p) => p.lines.length)).toEqual([3, 3, 1]);
    expect(layout.pages[1].lines.map(textOf)).toEqual(['Line 3', 'Line 4', 'Line 5']);
    expect(layout.pages[0].lines.map((l) => l.y)).toEqual([10, 20, 30]);
  });
  it('retains CJK punctuation with its preceding cluster and preserves emoji graphemes', async () => {
    const layout = await layoutDocument(model([paragraph('中文，世界👩‍💻文')], 15, 100), services);
    const lines = layout.pages[0].lines.map(textOf);
    expect(lines.join('')).toBe('中文，世界👩‍💻文');
    expect(lines.every((line) => !line.startsWith('，'))).toBe(true);
    expect(lines.some((line) => line.includes('👩‍💻'))).toBe(true);
  });
  it('does not break a word just because its style changes', async () => {
    const p = paragraph('') as Extract<Block, { kind: 'paragraph' }>;
    p.runs = [
      { kind: 'text', text: 'hi ab', style: textStyle },
      { kind: 'text', text: 'cdef', style: { ...textStyle, bold: true } },
    ];
    const layout = await layoutDocument(model([p], 35, 100), services);
    expect(layout.pages[0].lines.map(textOf)).toEqual(['hi', 'abcdef']);
  });
  it('applies first-line and hanging indents only to their intended lines', async () => {
    const layout = await layoutDocument(
      model([paragraph('abc def ghi jkl', { leftIndent: 5, firstLineIndent: 10 })], 50, 100),
      services,
    );
    expect(layout.pages[0].lines.map((l) => l.x)).toEqual([25, 15]);
    const hanging = await layoutDocument(
      model([paragraph('abc def ghi jkl', { leftIndent: 10, firstLineIndent: -5 })], 45, 100),
      services,
    );
    expect(hanging.pages[0].lines.map((l) => l.x)).toEqual([15, 20]);
  });
  it('recomputes a wrapped tab from the continuation-line indent', async () => {
    const layout = await layoutDocument(
      model([paragraph('abc\tz', { leftIndent: 3 })], 19, 100),
      services,
    );
    const lines = layout.pages[0].lines;
    expect(lines.map(textOf)).toEqual(['abc', ' z']);
    expect(lines[1]).toMatchObject({ x: 13, width: 12 });
    expect(
      lines[1].fragments.map((fragment) => ({ x: fragment.x, width: fragment.width })),
    ).toEqual([
      { x: 13, width: 7 },
      { x: 20, width: 5 },
    ]);
  });
  it('centers, right-aligns and expands justification using retained advances', async () => {
    const centered = await layoutDocument(model([paragraph('abc', { align: 'center' })]), services);
    expect(centered.pages[0].lines[0].x).toBe(27.5);
    const right = await layoutDocument(model([paragraph('abc', { align: 'right' })]), services);
    expect(right.pages[0].lines[0].x).toBe(45);
    const justified = await layoutDocument(
      model([paragraph('ab cd ef gh', { align: 'justify' })], 45, 100),
      services,
    );
    expect(justified.pages[0].lines[0].width).toBe(45);
    expect(justified.pages[0].lines[1].width).toBe(10);
  });
  it('handles forced lines, empty paragraphs and explicit blank pages', async () => {
    const layout = await layoutDocument(
      model(
        [paragraph('one\ntwo\n'), { kind: 'pageBreak' }, { kind: 'pageBreak' }, paragraph('last')],
        50,
        100,
      ),
      services,
    );
    expect(layout.pages.map((p) => p.lines.map(textOf))).toEqual([
      ['one', 'two', ''],
      [],
      ['last'],
    ]);
  });
  it('does not add a blank line when a forced break follows an exactly full line', async () => {
    const layout = await layoutDocument(model([paragraph('abcdefghij\nx')], 50, 100), services);
    expect(layout.pages[0].lines.map(textOf)).toEqual(['abcdefghij', 'x']);
  });
  it('applies before/after spacing and multiple line spacing', async () => {
    const layout = await layoutDocument(
      model(
        [
          paragraph('a', {
            spaceBefore: 5,
            spaceAfter: 7,
            lineSpacing: { kind: 'multiple', value: 1.5 },
          }),
          paragraph('b'),
        ],
        50,
        100,
      ),
      services,
    );
    expect(layout.pages[0].lines.map((l) => [l.y, l.height])).toEqual([
      [15, 15],
      [37, 10],
    ]);
  });
  it('retains images as measured rectangles and makes progress for oversized content', async () => {
    const p = paragraph('') as Extract<Block, { kind: 'paragraph' }>;
    p.runs = [{ kind: 'image', imageId: 'image-0' }];
    const layout = await layoutDocument(model([p], 10, 10), services);
    expect(layout.pages).toHaveLength(1);
    expect(layout.diagnostics.map((d) => d.code)).toContain('oversized-inline');
    expect(layout.pages[0].lines[0].fragments[0]).toMatchObject({
      kind: 'image',
      width: 20,
      height: 15,
    });
  });
  it('enforces paper and page limits without producing invalid geometry', async () => {
    await expect(layoutDocument(model([paragraph('a')], 0), services)).rejects.toThrow('paper');
    await expect(
      layoutDocument(model([paragraph('a'), paragraph('b')], 50, 10), services, { maxPages: 1 }),
    ).rejects.toThrow('page count');
  });
  it('cancels long paragraph tokenization while yielding to the event loop', async () => {
    const controller = new AbortController();
    const result = layoutDocument(model([paragraph('word '.repeat(50_000))]), services, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 2);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('changes only backing dimensions across PPI, zoom and pixel ratio', async () => {
    const layout = await layoutDocument(model([paragraph('abc def ghi jkl')]), services);
    const before = JSON.stringify(layout);
    expect(pixelSize(layout.pages[0], { ppi: 72 })).toMatchObject({ width: 70, height: 50 });
    expect(pixelSize(layout.pages[0], { ppi: 144, scale: 2, pixelRatio: 2 })).toMatchObject({
      width: 560,
      height: 400,
    });
    expect(JSON.stringify(layout)).toBe(before);
    expect(() => pixelSize(layout.pages[0], { ppi: NaN })).toThrow();
    expect(() => pixelSize(layout.pages[0], { ppi: 100_000 })).toThrow();
  });
});

type Row = Extract<Block, { kind: 'row' }>;
const noBorders: TableCell['borders'] = { top: null, left: null, bottom: null, right: null };
const noPadding: TableCell['padding'] = { left: 0, top: 0, right: 0, bottom: 0 };
function tableCell(texts: string[], right: number, over: Partial<TableCell> = {}): TableCell {
  return {
    right,
    blocks: texts.map((text) => paragraph(text)),
    padding: noPadding,
    borders: noBorders,
    ...over,
  };
}
function tableRow(cells: TableCell[], over: Partial<Omit<Row, 'kind'>> = {}): Block {
  return { kind: 'row', cells, left: 0, height: { kind: 'auto' }, align: 'left', ...over };
}
const rule = (width: number) => ({ width, color: null, style: 'single' as const });

describe('ordinary table geometry', () => {
  it('places cells side by side so widths sum to the row width and nothing overlaps', async () => {
    const layout = await layoutDocument(
      model([tableRow([tableCell(['abcd'], 20), tableCell(['ef'], 45)])], 50, 100),
      services,
    );
    const lines = layout.pages[0].lines;
    expect(lines.map((line) => [line.x, line.y])).toEqual([
      [10, 10],
      [30, 10],
    ]);
    // Boundaries are contiguous: 10..30 and 30..55, so the widths sum to the 45 pt row.
    expect(lines[0].x + lines[0].width).toBeLessThanOrEqual(lines[1].x);
    expect(lines.every((line) => line.width > 0)).toBe(true);
  });
  it('insets content by cell padding and sizes the row from the tallest cell', async () => {
    const padded = tableCell(['abcd'], 20, {
      padding: { left: 2, top: 3, right: 3, bottom: 4 },
    });
    const layout = await layoutDocument(
      model([tableRow([padded, tableCell(['x'], 40)]), paragraph('after')], 50, 100),
      services,
    );
    const lines = layout.pages[0].lines;
    // 15 pt of content width splits "abcd" after three clusters.
    expect(lines.slice(0, 2).map((line) => [line.x, line.y])).toEqual([
      [12, 13],
      [12, 23],
    ]);
    expect(lines[2]).toMatchObject({ x: 30, y: 10 });
    // 3 + 10 + 10 + 4 pt of cell height decides the row height.
    expect(lines.at(-1)).toMatchObject({ y: 37 });
  });
  it('honours at-least and exact row heights and reports content that overflows', async () => {
    const atLeast = await layoutDocument(
      model(
        [
          tableRow([tableCell(['a'], 40)], { height: { kind: 'atLeast', value: 40 } }),
          paragraph('b'),
        ],
        50,
        100,
      ),
      services,
    );
    expect(atLeast.pages[0].lines.at(-1)).toMatchObject({ y: 50 });
    const exact = await layoutDocument(
      model(
        [tableRow([tableCell(['a'], 40)], { height: { kind: 'exact', value: 5 } }), paragraph('b')],
        50,
        100,
      ),
      services,
    );
    // The row advances by its exact height and the overflowing content is still drawn.
    expect(exact.pages[0].lines.map((line) => [textOf(line), line.y])).toEqual([
      ['a', 10],
      ['b', 15],
    ]);
    expect(exact.diagnostics.map((d) => d.code)).toContain('table-row-overflow');
  });
  it('centres and right-aligns a row inside the page content box', async () => {
    const centred = await layoutDocument(
      model([tableRow([tableCell(['a'], 20)], { align: 'center' })], 50, 100),
      services,
    );
    expect(centred.pages[0].lines[0].x).toBe(25);
    const right = await layoutDocument(
      model([tableRow([tableCell(['a'], 20)], { align: 'right' })], 50, 100),
      services,
    );
    expect(right.pages[0].lines[0].x).toBe(40);
  });
  it('draws borders as rectangles centred on the cell boundary', async () => {
    const bordered = tableCell(['a'], 20, {
      borders: { top: rule(1), left: rule(1), bottom: rule(2), right: null },
    });
    const layout = await layoutDocument(model([tableRow([bordered])], 50, 100), services);
    expect(layout.pages[0].decorations).toEqual([
      { kind: 'rule', x: 9.5, y: 10, width: 1, height: 10, color: '#000000' },
      { kind: 'rule', x: 10, y: 9.5, width: 20, height: 1, color: '#000000' },
      { kind: 'rule', x: 10, y: 19, width: 20, height: 2, color: '#000000' },
    ]);
  });
  it('continues a tall row on the next page at a line boundary', async () => {
    const tall = tableCell(['a', 'b', 'c', 'd', 'e'], 20, {
      borders: { top: rule(1), left: rule(1), bottom: rule(1), right: rule(1) },
    });
    const layout = await layoutDocument(
      model([tableRow([tall, tableCell(['z'], 40)]), paragraph('after')], 50, 30),
      services,
    );
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].lines.map(textOf)).toEqual(['a', 'b', 'c', 'z']);
    expect(layout.pages[1].lines.map(textOf)).toEqual(['d', 'e', 'after']);
    expect(layout.pages[0].lines.map((line) => line.y)).toEqual([10, 20, 30, 10]);
    expect(layout.pages[1].lines.map((line) => line.y)).toEqual([10, 20, 30]);
    // Each fragment is closed above and below, so the break itself is drawn.
    const horizontal = (page: (typeof layout.pages)[number]) =>
      page.decorations.filter((decoration) => decoration.width > decoration.height).map((d) => d.y);
    expect(horizontal(layout.pages[0])).toEqual([9.5, 39.5]);
    expect(horizontal(layout.pages[1])).toEqual([9.5, 29.5]);
    // Vertical cell walls are drawn on both fragments.
    expect(layout.pages[0].decorations.filter((d) => d.height > d.width)).toHaveLength(2);
    expect(layout.pages[1].decorations.filter((d) => d.height > d.width)).toHaveLength(2);
  });
  it('skips a cell boundary that does not advance and keeps the rest of the row', async () => {
    const layout = await layoutDocument(
      model(
        [tableRow([tableCell(['a'], 20), tableCell(['b'], 20), tableCell(['c'], 40)])],
        50,
        100,
      ),
      services,
    );
    expect(layout.pages[0].lines.map(textOf)).toEqual(['a', 'c']);
    expect(layout.diagnostics.map((d) => d.code)).toContain('invalid-cell-boundary');
  });
  it('clamps a cell whose padding leaves no content width', async () => {
    const layout = await layoutDocument(
      model(
        [tableRow([tableCell(['ab'], 10, { padding: { left: 6, top: 0, right: 6, bottom: 0 } })])],
        50,
        100,
      ),
      services,
    );
    expect(layout.diagnostics.map((d) => d.code)).toContain('narrow-table-cell');
    expect(layout.pages[0].lines.map(textOf).join('')).toBe('ab');
  });
});

describe('vertical cell alignment and shading', () => {
  it('offsets content for centre and bottom alignment inside a taller row', async () => {
    const row = tableRow([
      tableCell(['a', 'b', 'c'], 20),
      tableCell(['x'], 40, { verticalAlign: 'center' }),
      tableCell(['y'], 60, { verticalAlign: 'bottom' }),
    ]);
    const layout = await layoutDocument(model([row], 60, 100), services);
    // The tallest cell is 30 pt, so the single lines sit at +10 and +20 inside it.
    expect(layout.pages[0].lines.map((line) => [textOf(line), line.y] as const).slice(-2)).toEqual([
      ['x', 20],
      ['y', 30],
    ]);
    expect(layout.diagnostics).toEqual([]);
  });
  it('leaves geometry unchanged when the cell already fills the row', async () => {
    const centred = await layoutDocument(
      model([tableRow([tableCell(['a'], 40, { verticalAlign: 'center' })])], 50, 100),
      services,
    );
    expect(centred.pages[0].lines.map((line) => line.y)).toEqual([10]);
  });
  it('keeps a split row top aligned and says so', async () => {
    const tall = tableCell(['a', 'b', 'c', 'd', 'e'], 20, { verticalAlign: 'bottom' });
    const layout = await layoutDocument(
      model([tableRow([tall, tableCell(['z'], 40, { verticalAlign: 'bottom' })])], 50, 30),
      services,
    );
    expect(layout.pages[0].lines.map((line) => [textOf(line), line.y])).toEqual([
      ['a', 10],
      ['b', 20],
      ['c', 30],
      ['z', 10],
    ]);
    expect(layout.diagnostics.map((d) => d.code)).toContain('unsupported-split-row-alignment');
  });
  it('fills a shaded cell beneath its content and borders', async () => {
    const shaded = tableCell(['a'], 20, {
      shading: { background: 1, foreground: null, intensity: null },
      borders: { top: rule(1), left: null, bottom: null, right: null },
    });
    const layout = await layoutDocument(
      { ...model([tableRow([shaded])], 50, 100), colors: [null, '#ff0000'] },
      services,
    );
    expect(layout.pages[0].decorations).toEqual([
      { kind: 'rule', x: 10, y: 10, width: 20, height: 10, color: '#ff0000' },
      { kind: 'rule', x: 10, y: 9.5, width: 20, height: 1, color: '#000000' },
    ]);
  });
  it('blends the shading intensity between the declared colours', async () => {
    const fill = async (shading: TableCell['shading']) => {
      const layout = await layoutDocument(
        {
          ...model([tableRow([tableCell(['a'], 20, { shading })])], 50, 100),
          colors: [null, '#ffffff', '#000000'],
        },
        services,
      );
      return layout.pages[0].decorations[0]?.color;
    };
    expect(await fill({ background: 1, foreground: 2, intensity: 0 })).toBe('#ffffff');
    expect(await fill({ background: 1, foreground: 2, intensity: 10_000 })).toBe('#000000');
    expect(await fill({ background: 1, foreground: 2, intensity: 2500 })).toBe('#bfbfbf');
    // An intensity with no declared colours blends automatic black over automatic white.
    expect(await fill({ background: null, foreground: null, intensity: 5000 })).toBe('#808080');
    // A foreground alone has no pattern to apply, so nothing is filled.
    expect(await fill({ background: null, foreground: 2, intensity: null })).toBeUndefined();
  });
});
