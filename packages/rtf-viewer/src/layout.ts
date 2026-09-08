import type {
  Block,
  CellShading,
  Diagnostic,
  DocumentModel,
  TableCell,
  TextStyle,
} from './generated/model.js';
import type {
  DocumentLayout,
  ImageFragment,
  LayoutOptions,
  LayoutServices,
  PageLayout,
  RuleFragment,
  TextFragment,
} from './types.js';
import { checkAbort, nextTask } from './lifecycle.js';

type Paragraph = Extract<Block, { kind: 'paragraph' }>;
type Row = Extract<Block, { kind: 'row' }>;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type DraftFragment = Mutable<TextFragment> | Mutable<ImageFragment>;
interface DraftLine {
  x: number;
  y: number;
  width: number;
  height: number;
  paragraphIndex: number;
  fragments: DraftFragment[];
}
type Part = { text: string; style: TextStyle };
type Token =
  | { kind: 'text' | 'space'; parts: Part[] }
  | { kind: 'tab' }
  | { kind: 'break' }
  | { kind: 'image'; id: string };
type Measured =
  | { kind: 'text'; part: Part; width: number; ascent: number; descent: number }
  | { kind: 'image'; id: string; width: number; ascent: number; descent: number };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const opening = /[（［｛〈《「『【〔〖〘〚“‘([{]$/u;
const closing = /^[、。，．？！：；）］｝〉》」』】〕〗〙〛”’!?,.;:)\]}]/u;
/** Smallest usable line width. Indents that overrun their container clamp to it. */
const MIN_COLUMN_WIDTH = 1;
const EPSILON = 0.001;

async function tokenize(paragraph: Paragraph, signal?: AbortSignal): Promise<Token[]> {
  const result: Token[] = [];
  let current: Extract<Token, { parts: Part[] }> | undefined;
  let previous = '';
  let count = 0;
  let tokenClusters = 0;
  const end = () => {
    current = undefined;
    previous = '';
  };
  for (const run of paragraph.runs) {
    if (run.kind === 'image') {
      end();
      result.push({ kind: 'image', id: run.imageId });
      continue;
    }
    if (run.style.hidden) continue;
    for (const { segment } of graphemes.segment(run.text)) {
      if (++count % 2048 === 0) {
        await nextTask();
        checkAbort(signal);
      }
      if (segment === '\n' || segment === '\t') {
        end();
        result.push({ kind: segment === '\n' ? 'break' : 'tab' });
        continue;
      }
      const space = segment === ' ';
      const boundary =
        previous &&
        (cjk.test(previous) || cjk.test(segment)) &&
        !opening.test(previous) &&
        !closing.test(segment);
      if (!current || current.kind !== (space ? 'space' : 'text') || boundary) {
        current = { kind: space ? 'space' : 'text', parts: [] };
        tokenClusters = 0;
        result.push(current);
      }
      if (++tokenClusters > 16_384)
        throw new RangeError('An unbroken text token exceeds 16,384 grapheme clusters.');
      const last = current.parts.at(-1);
      if (last && last.style === run.style) last.text += segment;
      else current.parts.push({ text: segment, style: run.style });
      previous = segment;
    }
  }
  return result;
}

function measured(token: Token, services: LayoutServices): Measured[] {
  if (token.kind === 'image') {
    const size = services.imageSize(token.id);
    return [{ kind: 'image', id: token.id, width: size.width, ascent: size.height, descent: 0 }];
  }
  if (token.kind === 'tab' || token.kind === 'break') return [];
  return token.parts.map((part) => ({
    kind: 'text',
    part,
    ...services.measure(part.text, part.style),
  }));
}
const totalWidth = (parts: Measured[]) => parts.reduce((sum, part) => sum + part.width, 0);

/** Split an overlong word at grapheme boundaries; a single oversized cluster still makes progress. */
function splitText(
  token: Extract<Token, { parts: Part[] }>,
  width: number,
  services: LayoutServices,
): [Token, Token | undefined] {
  const fitted: Part[] = [];
  const remaining: Part[] = [];
  let available = width;
  for (let index = 0; index < token.parts.length; index++) {
    const part = token.parts[index];
    if (remaining.length) {
      remaining.push(part);
      continue;
    }
    const size = services.measure(part.text, part.style).width;
    if (size <= available) {
      fitted.push(part);
      available -= size;
      continue;
    }
    const chars = Array.from(graphemes.segment(part.text), (item) => item.segment);
    let low = 0,
      high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (services.measure(chars.slice(0, mid).join(''), part.style).width <= available) low = mid;
      else high = mid - 1;
    }
    if (low === 0 && fitted.length === 0) low = 1;
    if (low > 0) fitted.push({ ...part, text: chars.slice(0, low).join('') });
    if (low < chars.length) remaining.push({ ...part, text: chars.slice(low).join('') });
  }
  return [
    { kind: token.kind, parts: fitted },
    remaining.length ? { kind: token.kind, parts: remaining } : undefined,
  ];
}

interface FlowContext {
  model: DocumentModel;
  services: LayoutServices;
  signal?: AbortSignal;
  /** Height of the page content area, used only for oversized-content notices. */
  contentHeight: number;
  warn(code: string, message: string): void;
  tick(): Promise<void>;
}

function colour(model: DocumentModel, index: number | null, fallback = '#000000'): string {
  return (index === null ? null : model.colors[index]) ?? fallback;
}

const channels = (value: string): [number, number, number] | undefined => {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return undefined;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
};

/**
 * Resolve a cell fill. `\clshdng` is the percentage of the foreground laid over the background,
 * so an intensity blends the two; without one, only a declared background fills the cell.
 */
function shadingFill(model: DocumentModel, shading: CellShading | undefined): string | undefined {
  if (!shading) return undefined;
  const background = colour(model, shading.background, '#ffffff');
  if (shading.intensity === null) {
    return shading.background === null ? undefined : background;
  }
  const back = channels(background);
  const front = channels(colour(model, shading.foreground, '#000000'));
  if (!back || !front) return background;
  const ratio = Math.min(1, Math.max(0, shading.intensity / 10_000));
  const mix = (index: number) => Math.round(back[index] + (front[index] - back[index]) * ratio);
  return `#${[0, 1, 2].map((index) => mix(index).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Break one paragraph into stacked lines inside a column. Line breaking depends only on the
 * column width, so the result can be placed at any vertical position, in a page or in a cell.
 */
async function layoutParagraph(
  block: Paragraph,
  blockIndex: number,
  columnLeft: number,
  columnWidth: number,
  ctx: FlowContext,
): Promise<DraftLine[]> {
  const style = block.style;
  const paragraphLeft = columnLeft + style.leftIndent;
  let paragraphWidth = columnWidth - style.leftIndent - style.rightIndent;
  if (
    ![
      paragraphLeft,
      paragraphWidth,
      style.firstLineIndent,
      style.spaceBefore,
      style.spaceAfter,
    ].every(Number.isFinite)
  )
    throw new RangeError('Paragraph geometry is not a finite number.');
  if (paragraphWidth - Math.max(0, style.firstLineIndent) < MIN_COLUMN_WIDTH) {
    ctx.warn(
      'narrow-column',
      'Paragraph indents leave no usable line width; the line box was clamped to a minimum.',
    );
    paragraphWidth = MIN_COLUMN_WIDTH + Math.max(0, style.firstLineIndent);
  }
  if (style.lineSpacing.kind !== 'auto' && !(style.lineSpacing.value > 0))
    throw new RangeError('Invalid line spacing.');

  const lines: DraftLine[] = [];
  const tokens = await tokenize(block, ctx.signal);
  const mark = ctx.services.measure('Mg', block.markStyle);
  let firstLine = true;
  let parts: Measured[] = [];
  let width = 0;
  let forcedEnding = false;
  let y = 0;
  const lineX = () => paragraphLeft + (firstLine ? style.firstLineIndent : 0);
  const available = () => paragraphWidth - (firstLine ? style.firstLineIndent : 0);
  const emit = (last: boolean, forced = false) => {
    // Spaces consumed at wrap boundaries have no ink and do not affect alignment.
    while (
      parts.at(-1)?.kind === 'text' &&
      /^ +$/.test((parts.at(-1) as Extract<Measured, { kind: 'text' }>).part.text)
    ) {
      width -= parts.pop()!.width;
    }
    let ascent = mark.ascent,
      descent = mark.descent;
    for (const part of parts) {
      const shift = part.kind === 'text' ? part.part.style.baseline : 0;
      ascent = Math.max(ascent, part.ascent + shift);
      descent = Math.max(descent, part.descent - shift);
    }
    const natural = Math.max(1, ascent + descent);
    let height = natural;
    const spacing = style.lineSpacing;
    if (spacing.kind === 'exact') height = Math.max(0.1, spacing.value);
    else if (spacing.kind === 'atLeast') height = Math.max(natural, spacing.value);
    else if (spacing.kind === 'multiple') height = Math.max(0.1, natural * spacing.value);
    if (height > ctx.contentHeight)
      ctx.warn(
        'oversized-line',
        'A line is taller than the page content area; it is placed once and may overflow.',
      );
    if (width > available() + EPSILON)
      ctx.warn(
        'oversized-inline',
        'An indivisible text cluster or inline image is wider than the paragraph.',
      );
    let x = lineX();
    const slack = Math.max(0, available() - width);
    if (style.align === 'center') x += slack / 2;
    if (style.align === 'right') x += slack;
    const spaces = parts.filter((part) => part.kind === 'text' && /^ +$/.test(part.part.text));
    const extraSpace =
      style.align === 'justify' && !last && !forced && spaces.length > 0
        ? slack / spaces.length
        : 0;
    const baseline = y + ascent + (height - natural) / 2;
    const fragments: DraftFragment[] = [];
    const startX = x;
    for (const part of parts) {
      if (part.kind === 'image') {
        fragments.push({
          kind: 'image',
          imageId: part.id,
          x,
          y: baseline - part.ascent,
          width: part.width,
          height: part.ascent,
        });
      } else {
        const textStyle = part.part.style;
        const spaceExtra = /^ +$/.test(part.part.text) ? extraSpace : 0;
        fragments.push({
          kind: 'text',
          text: part.part.text,
          x,
          y,
          width: part.width + spaceExtra,
          height,
          baseline: baseline - textStyle.baseline,
          font: ctx.services.font(textStyle),
          fontSize: textStyle.fontSize,
          color: colour(ctx.model, textStyle.color),
          highlight:
            textStyle.highlight === null ? null : (ctx.model.colors[textStyle.highlight] ?? null),
          underline: textStyle.underline,
          strike: textStyle.strike,
        });
        x += spaceExtra;
      }
      x += part.width;
    }
    lines.push({
      x: startX,
      y,
      width: x - startX,
      height,
      paragraphIndex: blockIndex,
      fragments,
    });
    y += height;
    firstLine = false;
    parts = [];
    width = 0;
  };
  for (let index = 0; index < tokens.length; index++) {
    if (lines.length > 0 && lines.length % 64 === 0) await ctx.tick();
    let token = tokens[index];
    if (token.kind === 'break') {
      emit(false, true);
      forcedEnding = true;
      continue;
    }
    forcedEnding = false;
    if (token.kind === 'tab') {
      const tab = ctx.model.defaultTab > 0 ? ctx.model.defaultTab : 36;
      const tabAdvance = () => {
        const position = lineX() - columnLeft + width;
        return tab - (((position % tab) + tab) % tab);
      };
      let advance = tabAdvance();
      if (width + advance > available() && parts.length > 0) {
        emit(false);
        advance = tabAdvance();
      }
      parts.push({
        kind: 'text',
        part: { text: ' ', style: block.markStyle },
        width: advance,
        ascent: mark.ascent,
        descent: mark.descent,
      });
      width += advance;
      continue;
    }
    let additions = measured(token, ctx.services);
    let additionWidth = totalWidth(additions);
    if (width + additionWidth > available() + EPSILON && parts.length > 0) {
      emit(false);
      if (token.kind === 'space') continue;
    }
    if (additionWidth > available() && (token.kind === 'text' || token.kind === 'space')) {
      const [head, tail] = splitText(token, available(), ctx.services);
      additions = measured(head, ctx.services);
      additionWidth = totalWidth(additions);
      if (tail) {
        tokens[index] = tail;
        index--;
      }
    }
    parts.push(...additions);
    width += additionWidth;
  }
  if (parts.length > 0 || firstLine || forcedEnding) emit(true);
  return lines;
}

function shift(line: DraftLine, delta: number): DraftLine {
  line.y += delta;
  for (const fragment of line.fragments) {
    fragment.y += delta;
    if (fragment.kind === 'text') fragment.baseline += delta;
  }
  return line;
}

/** Stack a cell's paragraphs into a column without paginating; the row places the result. */
async function layoutColumn(
  blocks: readonly Block[],
  blockIndex: number,
  columnLeft: number,
  columnWidth: number,
  ctx: FlowContext,
): Promise<{ lines: DraftLine[]; height: number }> {
  const lines: DraftLine[] = [];
  let y = 0;
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      // Schema version 2 never nests rows or breaks inside a cell.
      ctx.warn('unsupported-cell-content', 'Only paragraphs are laid out inside a table cell.');
      continue;
    }
    await ctx.tick();
    y += Math.max(0, block.style.spaceBefore);
    for (const line of await layoutParagraph(block, blockIndex, columnLeft, columnWidth, ctx)) {
      lines.push(shift(line, y));
    }
    y = lines.at(-1) ? lines.at(-1)!.y + lines.at(-1)!.height : y;
    y += Math.max(0, block.style.spaceAfter);
  }
  return { lines, height: y };
}

interface CellPlan {
  left: number;
  right: number;
  padding: TableCell['padding'];
  borders: TableCell['borders'];
  verticalAlign: TableCell['verticalAlign'];
  fill: string | undefined;
  lines: DraftLine[];
  /** Line bottoms measured from the row top, used to choose a page break inside the row. */
  height: number;
}

function border(
  rules: RuleFragment[],
  model: DocumentModel,
  side: TableCell['borders']['top'],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!side || !(side.width > 0)) return;
  // Strokes are centred on the boundary so that the shared edge of two cells overprints
  // instead of drawing twice its width.
  const half = side.width / 2;
  rules.push(
    width === 0
      ? {
          kind: 'rule',
          x: x - half,
          y,
          width: side.width,
          height,
          color: colour(model, side.color),
        }
      : {
          kind: 'rule',
          x,
          y: y - half,
          width,
          height: side.width,
          color: colour(model, side.color),
        },
  );
}

export async function layoutDocument(
  model: DocumentModel,
  services: LayoutServices,
  options: LayoutOptions = {},
): Promise<DocumentLayout> {
  checkAbort(options.signal);
  const p = model.page;
  const values = [p.width, p.height, p.marginLeft, p.marginRight, p.marginTop, p.marginBottom];
  if (
    !values.every(Number.isFinite) ||
    p.width <= 0 ||
    p.height <= 0 ||
    p.width > 14400 ||
    p.height > 14400 ||
    values.slice(2).some((v) => v < 0) ||
    p.width <= p.marginLeft + p.marginRight ||
    p.height <= p.marginTop + p.marginBottom
  ) {
    throw new RangeError('Invalid RTF paper size or margins.');
  }
  const maxPages = options.maxPages ?? 2000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 2000)
    throw new RangeError('Invalid page limit.');
  const pages: {
    index: number;
    width: number;
    height: number;
    lines: DraftLine[];
    decorations: RuleFragment[];
  }[] = [];
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<string>();
  const warn = (code: string, message: string) => {
    if (!reported.has(code)) {
      reported.add(code);
      diagnostics.push({ code, message, offset: 0 });
    }
  };
  let page: (typeof pages)[number];
  let y = p.marginTop;
  const newPage = () => {
    if (pages.length >= maxPages)
      throw new RangeError('RTF page count exceeds the configured limit.');
    page = { index: pages.length, width: p.width, height: p.height, lines: [], decorations: [] };
    pages.push(page);
    y = p.marginTop;
  };
  newPage();
  const bottom = p.height - p.marginBottom;
  const contentLeft = p.marginLeft;
  const contentWidth = p.width - p.marginLeft - p.marginRight;
  const ctx: FlowContext = {
    model,
    services,
    signal: options.signal,
    contentHeight: bottom - p.marginTop,
    warn,
    tick: async () => {
      await nextTask();
      checkAbort(options.signal);
    },
  };

  for (let blockIndex = 0; blockIndex < model.blocks.length; blockIndex++) {
    if (blockIndex % 32 === 0) await ctx.tick();
    const block = model.blocks[blockIndex];
    if (block.kind === 'pageBreak') {
      newPage();
      continue;
    }
    if (block.kind === 'row') {
      await layoutRow(block, blockIndex);
      continue;
    }
    if (
      block.runs.some(
        (run) =>
          run.kind === 'text' &&
          /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/u.test(
            run.text,
          ),
      )
    )
      warn(
        'complex-script-layout',
        'This script needs additional bidirectional or dictionary layout rules; rendering uses the initial horizontal layout.',
      );
    const style = block.style;
    if (style.pageBreakBefore && (page!.lines.length > 0 || y > p.marginTop)) newPage();
    let before = Math.max(0, style.spaceBefore);
    if (y + before >= bottom && page!.lines.length > 0) {
      newPage();
      before = 0;
    }
    y += before;
    const lines = await layoutParagraph(block, blockIndex, contentLeft, contentWidth, ctx);
    for (const line of lines) {
      if (y + line.height > bottom + EPSILON && page!.lines.length > 0) newPage();
      page!.lines.push(shift(line, y - line.y));
      y += line.height;
    }
    y += Math.max(0, style.spaceAfter);
  }
  checkAbort(options.signal);
  return { pages: pages as PageLayout[], diagnostics };

  async function layoutRow(row: Row, blockIndex: number): Promise<void> {
    if (row.cells.length === 0) return;
    let rightmost = row.left;
    for (const cell of row.cells)
      if (Number.isFinite(cell.right) && cell.right > rightmost) rightmost = cell.right;
    const shiftX = rowShift(row, rightmost);
    const plans: CellPlan[] = [];
    let previous = row.left;
    for (const cell of row.cells) {
      if (!Number.isFinite(cell.right) || cell.right <= previous) {
        warn(
          'invalid-cell-boundary',
          'A table cell boundary does not advance to the right; the cell was skipped.',
        );
        continue;
      }
      const left = contentLeft + shiftX + previous;
      const right = contentLeft + shiftX + cell.right;
      previous = cell.right;
      const padding = {
        left: Math.max(0, cell.padding.left),
        right: Math.max(0, cell.padding.right),
        top: Math.max(0, cell.padding.top),
        bottom: Math.max(0, cell.padding.bottom),
      };
      let width = right - left - padding.left - padding.right;
      if (width < MIN_COLUMN_WIDTH) {
        warn(
          'narrow-table-cell',
          'Cell padding leaves no usable content width; the content box was clamped to a minimum.',
        );
        width = MIN_COLUMN_WIDTH;
      }
      const content = await layoutColumn(cell.blocks, blockIndex, left + padding.left, width, ctx);
      plans.push({
        left,
        right,
        padding,
        borders: cell.borders,
        verticalAlign: cell.verticalAlign,
        fill: shadingFill(model, cell.shading),
        lines: content.lines.map((line) => shift(line, padding.top)),
        height: padding.top + content.height + padding.bottom,
      });
    }
    if (plans.length === 0) return;

    const natural = Math.max(...plans.map((plan) => plan.height));
    let height = natural;
    if (row.height.kind === 'atLeast') height = Math.max(natural, Math.max(0, row.height.value));
    else if (row.height.kind === 'exact') {
      height = Math.max(0, row.height.value);
      if (natural > height + EPSILON)
        warn(
          'table-row-overflow',
          'Cell content is taller than the exact row height; it is drawn without clipping.',
        );
    }
    if (height <= 0) return;

    // A row taller than the page content area is always split, and a fragment has no share of
    // the row's alignment target, so those keep their content at the top.
    const split = height > ctx.contentHeight;
    for (const plan of plans) {
      if (plan.verticalAlign !== 'center' && plan.verticalAlign !== 'bottom') continue;
      if (split) {
        warn(
          'unsupported-split-row-alignment',
          'A table row that continues across a page keeps its cell content top aligned.',
        );
        continue;
      }
      const slack = height - plan.height;
      if (slack <= EPSILON) continue;
      const offset = plan.verticalAlign === 'center' ? slack / 2 : slack;
      for (const line of plan.lines) shift(line, offset);
      plan.height += offset;
    }

    const stops = [
      ...new Set(plans.flatMap((plan) => plan.lines.map((line) => line.y + line.height))),
    ].sort((a, b) => a - b);
    let consumed = 0;
    for (;;) {
      const available = bottom - y;
      if (height - consumed <= available + EPSILON) {
        emitFragment(plans, consumed, height, true);
        return;
      }
      // Cut at the lowest line bottom that still fits, so no line straddles the page edge.
      let cut = stops
        .filter((stop) => stop > consumed + EPSILON && stop - consumed <= available + EPSILON)
        .at(-1);
      if (cut === undefined) {
        if (page!.lines.length > 0 || page!.decorations.length > 0) {
          newPage();
          continue;
        }
        const next = stops.find((stop) => stop > consumed + EPSILON);
        if (next === undefined) cut = Math.min(height, consumed + available);
        else {
          cut = next;
          warn(
            'oversized-table-row',
            'A table line is taller than the page content area; it is placed once and may overflow.',
          );
        }
      }
      emitFragment(plans, consumed, cut, false);
      consumed = cut;
      newPage();
    }
  }

  function rowShift(row: Row, rightmost: number): number {
    const width = rightmost - row.left;
    if (!Number.isFinite(width) || width <= 0) return 0;
    if (row.align === 'center') return (contentWidth - width) / 2 - row.left;
    if (row.align === 'right') return contentWidth - width - row.left;
    return 0;
  }

  /**
   * Place the row slice [from, to) at the current y. Every fragment is drawn as a closed box,
   * so a row broken across pages is still bounded above and below on each page. The closing
   * fragment also places content that overflows an exact row height, which is drawn rather
   * than clipped.
   */
  function emitFragment(plans: CellPlan[], from: number, to: number, closing: boolean): void {
    const height = to - from;
    const top = y;
    // Fills come first for every cell: a stroke centred on a shared boundary reaches into its
    // neighbour, so a later cell's fill must not paint over an earlier cell's border.
    for (const plan of plans) {
      if (plan.fill === undefined) continue;
      page!.decorations.push({
        kind: 'rule',
        x: plan.left,
        y: top,
        width: plan.right - plan.left,
        height,
        color: plan.fill,
      });
    }
    for (const plan of plans) {
      // Lines are ordered, so the fragment consumes a prefix and leaves the rest for the
      // next page. Consuming them keeps a line from being placed twice.
      const remaining: DraftLine[] = [];
      for (const line of plan.lines) {
        if (closing || line.y + line.height <= to + EPSILON)
          page!.lines.push(shift(line, top - from));
        else remaining.push(line);
      }
      plan.lines = remaining;
      const rules = page!.decorations;
      const width = plan.right - plan.left;
      border(rules, model, plan.borders.left, plan.left, top, 0, height);
      border(rules, model, plan.borders.right, plan.right, top, 0, height);
      border(rules, model, plan.borders.top, plan.left, top, width, 0);
      border(rules, model, plan.borders.bottom, plan.left, top + height, width, 0);
    }
    y = top + height;
  }
}
