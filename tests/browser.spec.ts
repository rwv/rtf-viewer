import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('opens the sample and supports navigation, zoom, and PNG export', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#file-name')).toHaveText('showcase.rtf');
  await expect(page.getByText('showcase.rtf opened with 2 pages.')).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');
  await expect(page.locator('#sheet-number')).toHaveText('01');

  const canvas = page.locator('#document-canvas');
  const initialWidth = await canvas.evaluate((node: HTMLCanvasElement) => node.width);
  expect(initialWidth).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  await expect(page.locator('#sheet-number')).toHaveText('02');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#zoom-value')).toHaveText('115%');
  const zoomedWidth = await canvas.evaluate((node: HTMLCanvasElement) => node.width);
  expect(zoomedWidth).toBeGreaterThan(initialWidth);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('showcase-page-2.png');
});

test('opens a local RTF file through the file input', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

  await page.locator('#file-input').setInputFiles(resolve('fixtures/synthetic/explicit-pages.rtf'));

  await expect(page.locator('#file-name')).toHaveText('explicit-pages.rtf');
  await expect(page.locator('#page-indicator')).toHaveText('1 / 3');
  await expect(page.locator('#paper-size')).toHaveText('612 × 792 pt');
  await expect(page.locator('#diagnostic-count')).toHaveText('0');
});
