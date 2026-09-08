/**
 * Layout and paint latency baseline, measured in a real browser through the public API.
 *
 * `pnpm bench:render`. The parser baseline (`pnpm bench:parser`) times the half of the work
 * that never touches Canvas; this times the half that does. Every shape is generated from a
 * fixed recipe, so two runs on the same machine are comparable and two machines differ only by
 * their own speed. A shape that exceeds its documented budget fails the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Budgets are what the project is willing to ship for a document of this size, not the current
 * measurement plus a margin. They sit roughly six times above the observed medians on the
 * container this baseline was recorded on, which is enough headroom that a shared runner's bad
 * minute does not fail the build while a real regression still does.
 */
const BUDGET_LOAD_MS = 4000;
const BUDGET_LAYOUT_MS = 3600;
const BUDGET_PAINT_MS = 150;

/** Repeats per measurement. The reported number is the median, after one warm run. */
const RUNS = 5;

interface Shape {
  readonly name: string;
  /** Built in the browser, so the generator has to survive being stringified. */
  readonly build: (count: number) => string;
  readonly count: number;
}

const prose = (paragraphs: number) => {
  let out = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Serif;}}\fs24 `;
  for (let index = 0; index < paragraphs; index++)
    out += `Paragraph ${index} carries enough words to wrap several times across a normal measure, which is what a long report actually looks like.\\par `;
  return `${out}}`;
};

const table = (rows: number) => {
  const definition = String.raw`\trowd\trgaph108\trbrdrt\brdrs\brdrw10\trbrdrl\brdrs\brdrw10\trbrdrb\brdrs\brdrw10\trbrdrr\brdrs\brdrw10\clpadfl3\clpadl108\cellx3000\clpadfl3\clpadl108\cellx6000\clpadfl3\clpadl108\cellx9000`;
  let out = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\froman Serif;}}\fs24 `;
  for (let index = 0; index < rows; index++)
    out += `${definition}\\intbl Row ${index} first\\cell Row ${index} second\\cell Row ${index} third\\cell\\row `;
  return `${out}}`;
};

const list = (items: number) => {
  let out =
    String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\froman Serif;}}` +
    String.raw`{\*\listtable{\list{\listlevel\levelnfc0\levelstartat1{\leveltext \'02\'00.;}{\levelnumbers \'01;}\fi-360\li720}\listid1}}` +
    String.raw`{\*\listoverridetable{\listoverride\listid1\ls1}}\fs24 `;
  for (let index = 0; index < items; index++)
    out += `\\ls1\\ilvl0 Item ${index} of a long numbered list.\\par `;
  return `${out}}`;
};

const unicode = (paragraphs: number) => {
  let out = String.raw`{\rtf1\ansi\ansicpg936\deff0\uc1{\fonttbl{\f0\fnil\fcharset134 SimSun;}}\fs24 `;
  for (let index = 0; index < paragraphs; index++)
    out += ` \\u19987?\\u26041?\\u25991?\\u23383? ${index}\\par `;
  return `${out}}`;
};

const SHAPES: readonly Shape[] = [
  { name: 'prose paragraphs', build: prose, count: 2000 },
  { name: 'table rows', build: table, count: 1000 },
  { name: 'list items', build: list, count: 3000 },
  { name: 'unicode paragraphs', build: unicode, count: 2000 },
];

interface Measurement {
  readonly shape: string;
  readonly count: number;
  readonly inputKiB: number;
  readonly pages: number;
  readonly fragments: number;
  readonly loadMs: number;
  readonly layoutMs: number;
  readonly paintMs: number;
}

test('layout and paint stay inside their documented budgets', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/test-harness.html');
  await page.waitForFunction(() => Boolean(window.__rtfTest));

  const measurements: Measurement[] = [];
  for (const shape of SHAPES) {
    const source = shape.build(shape.count);
    const measurement = await page.evaluate(
      async ({ source, runs }) => {
        const { RtfDocument } = window.__rtfTest;
        const bytes = new TextEncoder().encode(source);
        const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];

        // One warm load first, so the reported timings are not the first compile and the first
        // font query. It is also what supplies the page and fragment counts.
        const warm = await RtfDocument.load(bytes);
        const pages = warm.pageCount;
        let fragments = 0;
        for (let index = 0; index < pages; index++)
          for (const line of warm.getPageLayout(index).lines) fragments += line.fragments.length;

        const layouts: number[] = [];
        for (let run = 0; run < runs; run++) {
          const started = performance.now();
          await warm.relayout();
          layouts.push(performance.now() - started);
        }

        const canvas = document.createElement('canvas');
        const paints: number[] = [];
        for (let run = 0; run < runs; run++) {
          const started = performance.now();
          await warm.renderPage(canvas, 0, { ppi: 96 });
          paints.push(performance.now() - started);
        }
        warm.destroy();

        const loads: number[] = [];
        for (let run = 0; run < runs; run++) {
          const started = performance.now();
          const document_ = await RtfDocument.load(bytes);
          loads.push(performance.now() - started);
          document_.destroy();
        }

        return {
          inputKiB: Math.round(bytes.byteLength / 1024),
          pages,
          fragments,
          loadMs: median(loads),
          layoutMs: median(layouts),
          paintMs: median(paints),
        };
      },
      { source, runs: RUNS },
    );
    measurements.push({ shape: shape.name, count: shape.count, ...measurement });
  }

  const row = (cells: readonly (string | number)[]) =>
    `${String(cells[0]).padEnd(22)}${cells
      .slice(1)
      .map((cell) => String(cell).padStart(12))
      .join('')}`;
  const lines = [
    row(['shape', 'count', 'input KiB', 'pages', 'fragments', 'load ms', 'layout ms', 'paint ms']),
    ...measurements.map((measurement) =>
      row([
        measurement.shape,
        measurement.count,
        measurement.inputKiB,
        measurement.pages,
        measurement.fragments,
        measurement.loadMs.toFixed(1),
        measurement.layoutMs.toFixed(1),
        measurement.paintMs.toFixed(1),
      ]),
    ),
  ];
  console.log(lines.join('\n'));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/render-benchmark.json',
    `${JSON.stringify(
      {
        runs: RUNS,
        budgets: { loadMs: BUDGET_LOAD_MS, layoutMs: BUDGET_LAYOUT_MS, paintMs: BUDGET_PAINT_MS },
        measurements,
      },
      null,
      2,
    )}\n`,
  );

  for (const measurement of measurements) {
    expect(measurement.pages, `${measurement.shape} produced no pages`).toBeGreaterThan(0);
    expect(measurement.fragments, `${measurement.shape} produced no fragments`).toBeGreaterThan(0);
    expect(measurement.loadMs, `${measurement.shape} load`).toBeLessThan(BUDGET_LOAD_MS);
    expect(measurement.layoutMs, `${measurement.shape} layout`).toBeLessThan(BUDGET_LAYOUT_MS);
    expect(measurement.paintMs, `${measurement.shape} paint`).toBeLessThan(BUDGET_PAINT_MS);
  }
});
